/**
 * Host Console bindings, process enumeration, command launch, and user-shell PTY attachment.
 * @module @deepseek-ai/dsh-program-console/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool, ToolContextUnavailableError, type PreToolDecision, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { enumerateArgv, launchArgv, launchTerminalArgv } from './argv.ts'
import {
  chooseLaunched,
  ensureConsole,
  normalizeCommand,
  parseProcessLines,
  processKey,
  shellCommand,
} from './process-list.ts'
import { PROGRAM_CONSOLE_LAUNCH_COMMAND } from './skill-file.ts'
import {
  PROGRAM_CONSOLE_CONTEXT_NAME,
  PROGRAM_CONSOLE_CONTEXT_ORDER,
  STATUS_OUTPUT_DEBOUNCE_MS,
  STATUS_POLL_MS,
  consoleHasStartedProcess,
  consoleRunningLabel,
  formatConsoleContext,
  nextActiveKey,
  statusFromFlags,
} from './status.ts'
import { stopPid } from './stop-pid.ts'
import { descendantNonShellPids, listProcessRelatives, pidMatchesLaunchSession } from './terminal-descendants.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from './types.ts'

/** Name of the model-facing tool that starts a command on a held PTY and binds a Console. */
export const PROGRAM_CONSOLE_LAUNCH_TOOL = 'program_console_launch'

/** Name of the model-facing tool that types into a bound, attachable Console and returns new output. */
export const PROGRAM_CONSOLE_WRITE_TOOL = 'program_console_write'

/** Name of the model-facing tool that sets the unique model-active Console. */
export const PROGRAM_CONSOLE_SELECT_TOOL = 'program_console_select'

const LAUNCH = normalizeCommand(PROGRAM_CONSOLE_LAUNCH_COMMAND)
const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}
const POLL_ATTEMPTS = 15
const POLL_DELAY_MS = 100
const WRITE_SETTLE_MS = 120
const WRITE_OUTPUT_TIMEOUT_MS = 2_000
const OUTPUT_BUFFER_CHARS = 1_000_000

interface LaunchTerminalSession {
  readonly handle: SubprocessTerminalHandle
  ended: boolean
  recorded: number[]
  readonly buffer: string[]
  bufferedChars: number
  readonly listeners: Set<(chunk: string) => void>
}

/**
 * One Console per process. User launch, a model launch tool call, and a matching
 * bash or pwsh result all call {@link ensureConsole}.
 * `launch()` starts the command with `subprocess.spawnTerminal` and keeps that
 * PTY session in {@link launchSessions}. `openUserConsole()` uses the same
 * collection: it spawns an interactive shell, binds that shell immediately, and
 * returns the binding so the client can open the Console tab.
 */
export class ProgramConsole extends TypertRemoteService {
  static inject = ['subprocess', 'tools']

  private readonly bindings = new Map<string, ConsoleBinding>()
  private readonly snapshots = new Map<string, { readonly before: readonly ListedProcess[]; readonly command: string }>()
  private readonly launched = new Set<SubprocessHandle>()
  private readonly spawnedPids = new Set<number>()
  private readonly launchSessions = new Set<LaunchTerminalSession>()
  private readonly activeBySession = new Map<string, string>()
  private readonly startedKeysBySession = new Map<string, Set<string>>()
  private snapshot: ConsoleBinding[] = []
  private runningByKey = new Map<string, string>()
  private revision = 0
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private outputRefreshTimer: ReturnType<typeof setTimeout> | undefined
  private refreshTail: Promise<void> = Promise.resolve()
  private readonly watchers = new Set<() => void>()

  /**
   * @param ctx - Plugin context. `subprocess` enumerates and launches processes.
   */
  constructor(ctx: Context) {
    super(ctx, 'programConsole')
  }

  protected [Service.init](): void {
    this.ctx.on('tools/pre-execute', (exec, next) => this.beforeShell(exec, next))
    this.ctx.on('tools/result', (exec, result) => {
      void this.afterShell(exec, result)
    })
    this.ctx.effect(() => () => {
      this.clearStatusTimers()
      this.stopSpawned()
    }, 'program-console: stop spawned')
    this.ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.context({
        name: PROGRAM_CONSOLE_CONTEXT_NAME,
        order: PROGRAM_CONSOLE_CONTEXT_ORDER,
        interpolate: false,
        text: (context) => {
          const sessionId = context.agent?.session.id
          if (sessionId === undefined) return ''
          return formatConsoleContext(this.contextRows(sessionId))
        },
      })
      scope.on('system-prompt/assemble', async (_assembly, context, next) => {
        if (context.agent !== undefined) await this.refreshBindings()
        return next()
      }, { prepend: true })
    })
    this.ctx.effect(() => this.ctx.tools.register(defineTool({
      name: PROGRAM_CONSOLE_LAUNCH_TOOL,
      description: 'Start a command on a pseudo-terminal and bind a Console to the new process. Use for a REPL, debugger, or any program the user should type into in a Console. Do not use bash or pwsh for those programs. The process stays running after this tool returns.',
      parameters: {
        command: {
          type: 'string',
          required: true,
          description: 'The full command to run on the pseudo-terminal, passed as one argument to bash -c or cmd.exe /d /s /c.',
        },
      },
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        if (exec.agent === undefined) {
          throw new ToolContextUnavailableError('program_console_launch requires a calling agent')
        }
        const result = await this.launch(exec.agent, args.command)
        return `Started pid ${String(result.binding.pid)}. A Console was bound to this process, it is now the unique active Console, and it will open for interactive input.`
      },
      presentCall: args => ({ card: 'generic', title: PROGRAM_CONSOLE_LAUNCH_TOOL, rawInput: args }),
    })), 'program-console: launch tool')
    this.ctx.effect(() => this.ctx.tools.register(defineTool({
      name: PROGRAM_CONSOLE_WRITE_TOOL,
      description: 'Write text into a bound, attachable Console and return the new output that arrives afterwards. Use the active (green) Console id from the current program-console context unless the user asked for a different Console, in which case call program_console_select first. If that Console already has a program, type into it; do not launch a duplicate. Include a trailing newline to submit a line; if you omit it, the tool adds one. Do not type into that program with bash, ps, or pwsh, and do not use those tools to find Consoles.',
      parameters: {
        pid: {
          type: 'integer',
          required: true,
          description: 'Process id of the bound Console (the active id from the program-console context, the pid program_console_launch returned, or the pid shown on the Console tab).',
        },
        data: {
          type: 'string',
          required: true,
          description: 'Text to write to the pseudo-terminal. Include a trailing newline to submit a line. If the text does not already end with a newline or carriage return, the tool appends a newline so the line is submitted.',
        },
      },
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        if (exec.agent === undefined) {
          throw new ToolContextUnavailableError('program_console_write requires a calling agent')
        }
        const session = await this.requireAttachedSessionByPid(args.pid)
        return await this.writeAndCollect(session, completeWriteData(args.data))
      },
      presentCall: args => ({ card: 'generic', title: PROGRAM_CONSOLE_WRITE_TOOL, rawInput: args }),
    })), 'program-console: write tool')
    this.ctx.effect(() => this.ctx.tools.register(defineTool({
      name: PROGRAM_CONSOLE_SELECT_TOOL,
      description: 'Set the unique model-active Console for this session. The pid is the process id shown on the Console tab. Only a Console that has already started a process (ready/orange or already active/green) can be selected. After this succeeds, type into that Console with program_console_write and that pid.',
      parameters: {
        pid: {
          type: 'integer',
          required: true,
          description: 'Process id of the Console to make the unique model-active target (the pid shown on the Console tab).',
        },
      },
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        if (exec.agent === undefined) {
          throw new ToolContextUnavailableError('program_console_select requires a calling agent')
        }
        const binding = await this.select(exec.agent, args.pid)
        return `Console ${String(binding.pid)} is now the unique active Console. Use program_console_write with pid ${String(binding.pid)}.`
      },
      presentCall: args => ({ card: 'generic', title: PROGRAM_CONSOLE_SELECT_TOOL, rawInput: args }),
    })), 'program-console: select tool')
  }

  /**
   * List processes whose executable path the platform command could read.
   * @param agent - Caller. The list is the host process table, not session-private.
   * @returns processes whose executable path the platform command could read. Unreadable paths are absent.
   */
  @Remote
  async list(agent: Agent): Promise<ListedProcess[]> {
    void agent
    return this.enumerate()
  }

  /**
   * Focus the Console for a process, or create it when none is bound.
   * @param agent - Session asking for the Console.
   * @param pid - Process id from {@link list}.
   * @param start - Start time from {@link list}, so a reused pid does not reuse the old Console.
   * @returns the single Console for that process.
   * @throws HarnessError `PROGRAM_CONSOLE_PROCESS_MISSING` when the process is not in the current listing.
   */
  @Remote
  async open(agent: Agent, pid: number, start: string): Promise<ConsoleOpenResult> {
    const entry = (await this.enumerate()).find(item => item.pid === pid && item.start === start)
    if (entry === undefined) {
      throw new HarnessError(
        'no process with that id and start time has a readable executable',
        'PROGRAM_CONSOLE_PROCESS_MISSING',
      )
    }
    const result = ensureConsole(this.bindings, agent.session.id, entry, Date.now())
    return { created: result.created, binding: await this.annotateBinding(result.binding) }
  }

  /**
   * Run a command with `cmd.exe /d /s /c` or `bash -c` on a pseudo-terminal, then bind a Console to the new process.
   * @param agent - Session that will own the Console when the process has none.
   * @param command - The full command from the dialog or the launch tool. It is one argument to the system shell.
   * @returns the Console for the process the command left running.
   * @throws HarnessError `PROGRAM_CONSOLE_COMMAND_EMPTY` when `command` is blank.
   * @throws HarnessError `PROGRAM_CONSOLE_LAUNCH_NOT_FOUND` when enumeration never sees a matching program.
   */
  @Remote
  async launch(agent: Agent, command: string): Promise<ConsoleOpenResult> {
    if (command.trim().length === 0) {
      throw new HarnessError('launch command is empty', 'PROGRAM_CONSOLE_COMMAND_EMPTY')
    }
    const before = await this.enumerate()
    const handle = await this.ctx.subprocess.spawnTerminal(launchCommandTerminalSpec(command))
    const session = this.retainLaunchSession(handle)
    try {
      const chosen = await this.waitForLaunched(before, command)
      if (chosen === undefined) {
        throw new HarnessError(
          'the command did not leave a process to bind',
          'PROGRAM_CONSOLE_LAUNCH_NOT_FOUND',
        )
      }
      this.spawnedPids.add(chosen.pid)
      const result = ensureConsole(this.bindings, agent.session.id, chosen, Date.now())
      this.activeBySession.set(agent.session.id, result.binding.key)
      return { created: result.created, binding: await this.annotateBinding(result.binding) }
    } catch (error: unknown) {
      void handle.terminate()
      this.launchSessions.delete(session)
      throw error
    }
  }

  /**
   * Start an interactive user shell on a pseudo-terminal, bind a Console to that
   * shell process, and return the binding so the client can open the Console tab.
   * Each call starts a new session. Closing the tab does not terminate the PTY.
   * @param agent - Session that will own the Console.
   * @returns the Console for the shell process.
   * @throws HarnessError `PROGRAM_CONSOLE_LAUNCH_NOT_FOUND` when enumeration never sees the shell.
   */
  @Remote
  async openUserConsole(agent: Agent): Promise<ConsoleOpenResult> {
    const handle = await this.ctx.subprocess.spawnTerminal(launchTerminalSpec())
    const session = this.retainLaunchSession(handle)
    try {
      const chosen = await this.waitForPid(handle.pid)
      if (chosen === undefined) {
        throw new HarnessError(
          'the shell did not leave a process to bind',
          'PROGRAM_CONSOLE_LAUNCH_NOT_FOUND',
        )
      }
      this.spawnedPids.add(chosen.pid)
      const result = ensureConsole(this.bindings, agent.session.id, chosen, Date.now())
      return { created: result.created, binding: await this.annotateBinding(result.binding) }
    } catch (error: unknown) {
      void handle.terminate()
      this.launchSessions.delete(session)
      throw error
    }
  }

  /**
   * Stream output for a bound process, starting with any retained scrollback.
   * The PTY stays alive when the stream ends. The carrier cancels the subscription.
   * @param agent - Session that owns or is viewing the Console.
   * @param pid - Process id of the bound Console.
   * @param start - Start time captured when the Console was bound.
   * @param signal - Stream cancellation owned by the Remote carrier.
   * @returns output chunks in delivery order.
   * @throws HarnessError `PROGRAM_CONSOLE_PTY_UNAVAILABLE` when this process has no attachable terminal.
   */
  @Remote({ mode: 'stream' })
  async *followConsole(agent: Agent, pid: number, start: string, signal: AbortSignal): AsyncIterable<string> {
    void agent
    const session = await this.requireAttachedSession(pid, start)
    yield* this.iterateSession(session, signal)
  }

  /**
   * Write text to the PTY of a bound process.
   * @param agent - Session that owns or is viewing the Console.
   * @param pid - Process id of the bound Console.
   * @param start - Start time captured when the Console was bound.
   * @param data - Text to deliver without implicit newline conversion.
   * @throws HarnessError `PROGRAM_CONSOLE_PTY_UNAVAILABLE` when this process has no attachable terminal.
   */
  @Remote
  async writeConsole(agent: Agent, pid: number, start: string, data: string): Promise<void> {
    void agent
    const session = await this.requireAttachedSession(pid, start)
    await session.handle.write(data)
  }

  /**
   * Change the PTY dimensions for a bound process.
   * @param agent - Session that owns or is viewing the Console.
   * @param pid - Process id of the bound Console.
   * @param start - Start time captured when the Console was bound.
   * @param cols - Positive column count.
   * @param rows - Positive row count.
   * @throws HarnessError `PROGRAM_CONSOLE_PTY_UNAVAILABLE` when this process has no attachable terminal.
   */
  @Remote
  async resizeConsole(agent: Agent, pid: number, start: string, cols: number, rows: number): Promise<void> {
    void agent
    const session = await this.requireAttachedSession(pid, start)
    await session.handle.resize(cols, rows)
  }

  /**
   * Consoles created on this host.
   * @param agent - Caller. The client filters to its own session when opening a tab.
   * @returns every binding, with current PTY attachability. A process has at most one.
   */
  @Remote
  async consoles(agent: Agent): Promise<ConsoleBinding[]> {
    void agent
    await this.refreshBindings()
    return this.snapshot
  }

  /**
   * Make a started Console the unique model-active target for this session.
   * The previous active Console, if any, becomes ready (orange).
   * @param agent - Session whose active Console is changing.
   * @param pid - Process id shown on the Console tab and used with `program_console_write`.
   * @returns the binding after it becomes active.
   * @throws HarnessError `PROGRAM_CONSOLE_PROCESS_MISSING` when no Console in this session has that pid.
   * @throws HarnessError `PROGRAM_CONSOLE_SELECT_IDLE` when the Console has not started a process.
   */
  @Remote
  async select(agent: Agent, pid: number): Promise<ConsoleBinding> {
    await this.refreshBindings()
    const current = this.snapshot.find(binding => binding.sessionId === agent.session.id && binding.pid === pid)
    if (current === undefined) {
      throw new HarnessError(
        `no Console with pid ${String(pid)} in this session`,
        'PROGRAM_CONSOLE_PROCESS_MISSING',
      )
    }
    if (current.status === 'idle') {
      throw new HarnessError(
        `Console ${String(pid)} has not started a process, so it cannot become the active target`,
        'PROGRAM_CONSOLE_SELECT_IDLE',
      )
    }
    this.activeBySession.set(agent.session.id, current.key)
    await this.refreshBindings()
    const updated = this.snapshot.find(binding => binding.key === current.key)
    return updated ?? { ...current, status: 'active' }
  }

  /**
   * Stream the current Console bindings and their status whenever they change.
   * The first yield is the current list. Later yields follow a process start,
   * exit, launch, or a change of the unique active Console.
   * @param agent - Caller. Each yield includes every binding; the client filters to its session.
   * @param signal - Stream cancellation owned by the Remote carrier.
   * @returns annotated bindings in successive snapshots.
   */
  @Remote({ mode: 'stream' })
  async *watchConsoles(agent: Agent, signal: AbortSignal): AsyncIterable<readonly ConsoleBinding[]> {
    void agent
    yield* this.iterateWatch(signal)
  }

  private async beforeShell(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const command = shellCommand(exec.name, exec.arguments)
    if (command !== undefined && exec.agent !== undefined && normalizeCommand(command) === LAUNCH) {
      try {
        this.snapshots.set(exec.callId, { before: await this.enumerate(), command })
      } catch (error: unknown) {
        this.ctx.logger.warn(`program-console: enumeration before ${exec.name} failed: ${message(error)}`)
      }
    }
    return next()
  }

  private async afterShell(exec: ToolExecution, result: ToolExecutionResult): Promise<void> {
    const snapshot = this.snapshots.get(exec.callId)
    this.snapshots.delete(exec.callId)
    if (snapshot === undefined || result.isError || exec.agent === undefined) return
    let after: readonly ListedProcess[]
    try {
      after = await this.enumerate()
    } catch (error: unknown) {
      this.ctx.logger.warn(`program-console: enumeration after ${exec.name} failed: ${message(error)}`)
      return
    }
    const chosen = chooseLaunched(snapshot.before, after, snapshot.command)
    if (chosen === undefined) return
    const opened = ensureConsole(this.bindings, exec.agent.session.id, chosen, Date.now())
    this.activeBySession.set(exec.agent.session.id, opened.binding.key)
    await this.refreshBindings()
  }

  private async waitForLaunched(before: readonly ListedProcess[], command: string): Promise<ListedProcess | undefined> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const chosen = chooseLaunched(before, await this.enumerate(), command)
      if (chosen !== undefined) return chosen
      if (attempt < POLL_ATTEMPTS - 1) await delay(POLL_DELAY_MS)
    }
    return undefined
  }

  private async waitForPid(pid: number): Promise<ListedProcess | undefined> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const found = (await this.enumerate()).find(item => item.pid === pid)
      if (found !== undefined) return found
      if (attempt < POLL_ATTEMPTS - 1) await delay(POLL_DELAY_MS)
    }
    return undefined
  }

  private async enumerate(): Promise<ListedProcess[]> {
    const handle = this.ctx.subprocess.spawn(spawnSpec(enumerateArgv(process.platform)))
    try {
      await handle.done
    } catch (error: unknown) {
      handle.terminate()
      throw error
    }
    return parseProcessLines(handle.collected.stdout?.readFrom(0).text ?? '')
  }

  private stopSpawned(): void {
    for (const handle of this.launched) handle.terminate()
    for (const session of this.launchSessions) {
      if (!session.ended) void session.handle.terminate()
    }
    for (const pid of this.spawnedPids) stopPid(pid)
    this.spawnedPids.clear()
    this.launched.clear()
    this.launchSessions.clear()
  }

  private async annotateBinding(binding: ConsoleBinding): Promise<ConsoleBinding> {
    await this.refreshBindings()
    return this.snapshot.find(item => item.key === binding.key) ?? { ...binding, attachable: false, status: 'idle' }
  }

  private retainLaunchSession(handle: LaunchTerminalSession['handle']): LaunchTerminalSession {
    const session = startLaunchTerminal(handle)
    this.launchSessions.add(session)
    const drop = (): void => { this.launchSessions.delete(session) }
    void handle.done.then(drop, drop)
    session.listeners.add(() => { this.scheduleOutputRefresh() })
    this.ensurePolling()
    return session
  }

  private refreshBindings(): Promise<void> {
    const run = this.refreshTail.then(() => this.computeSnapshot())
    this.refreshTail = run.then(() => undefined, () => undefined)
    return run
  }

  private async computeSnapshot(): Promise<void> {
    const sessions = this.liveSessions()
    const attachable = await this.attachablePids()
    let relatives: Awaited<ReturnType<typeof listProcessRelatives>> = []
    try {
      if (sessions.length > 0) {
        relatives = await listProcessRelatives(process.platform, argv => this.collectStdout(argv))
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`program-console: launch terminal descendant lookup failed: ${message(error)}`)
    }
    const descendants = new Map<number, number[]>()
    for (const session of sessions) {
      descendants.set(session.handle.pid, descendantNonShellPids(session.handle.pid, relatives))
    }
    const candidates: { binding: ConsoleBinding; started: boolean }[] = []
    for (const binding of this.bindings.values()) {
      const session = this.matchSession(binding.pid, sessions, relatives)
      const shellPid = session?.handle.pid
      const started = consoleHasStartedProcess({
        attachable: attachable.has(binding.pid),
        exe: binding.exe,
        pid: binding.pid,
        shellPid,
        nonShellDescendants: shellPid === undefined ? [] : descendants.get(shellPid) ?? [],
      })
      candidates.push({ binding, started })
    }
    const bySession = new Map<string, typeof candidates>()
    for (const candidate of candidates) {
      const list = bySession.get(candidate.binding.sessionId)
      if (list === undefined) bySession.set(candidate.binding.sessionId, [candidate])
      else list.push(candidate)
    }
    for (const [sessionId, list] of bySession) {
      const previous = this.startedKeysBySession.get(sessionId) ?? new Set()
      const current = list.map(entry => ({
        key: entry.binding.key,
        started: entry.started,
        createdAt: entry.binding.createdAt,
      }))
      const active = nextActiveKey({
        previousStarted: previous,
        current,
        activeKey: this.activeBySession.get(sessionId),
      })
      if (active === undefined) this.activeBySession.delete(sessionId)
      else this.activeBySession.set(sessionId, active)
      this.startedKeysBySession.set(sessionId, new Set(current.filter(entry => entry.started).map(entry => entry.key)))
    }
    const runningByKey = new Map<string, string>()
    for (const { binding } of candidates) {
      const session = this.matchSession(binding.pid, sessions, relatives)
      const shellPid = session?.handle.pid
      const descendantPids = shellPid === undefined ? [] : descendants.get(shellPid) ?? []
      const descendantExes: string[] = []
      for (const pid of descendantPids) {
        const exe = relatives.find(entry => entry.pid === pid)?.exe
        if (exe !== undefined && exe.length > 0) descendantExes.push(exe)
      }
      const running = consoleRunningLabel({
        exe: binding.exe,
        commandLine: binding.commandLine,
        nonShellDescendantExes: descendantExes,
      })
      if (running !== undefined) runningByKey.set(binding.key, running)
    }
    this.runningByKey = runningByKey
    const next = candidates.map(({ binding, started }) => {
      const attachableFlag = attachable.has(binding.pid)
      const status = statusFromFlags(started, this.activeBySession.get(binding.sessionId) === binding.key)
      if (attachableFlag === binding.attachable && status === binding.status) return binding
      return { ...binding, attachable: attachableFlag, status }
    })
    const changed = next.length !== this.snapshot.length
      || next.some((binding, index) => {
        const previous = this.snapshot[index]
        return previous === undefined
          || previous.key !== binding.key
          || previous.attachable !== binding.attachable
          || previous.status !== binding.status
      })
    this.snapshot = next
    if (changed) {
      this.revision += 1
      for (const listener of this.watchers) listener()
    }
    this.ensurePolling()
  }

  private matchSession(
    pid: number,
    sessions: readonly LaunchTerminalSession[],
    relatives: Awaited<ReturnType<typeof listProcessRelatives>>,
  ): LaunchTerminalSession | undefined {
    for (const session of sessions) {
      if (pidMatchesLaunchSession(pid, session.handle.pid, session.recorded, relatives)) return session
    }
    return undefined
  }

  private ensurePolling(): void {
    if (this.liveSessions().length === 0 && this.watchers.size === 0) {
      if (this.pollTimer !== undefined) {
        clearInterval(this.pollTimer)
        this.pollTimer = undefined
      }
      return
    }
    if (this.pollTimer !== undefined) return
    this.pollTimer = setInterval(() => { void this.refreshBindings() }, STATUS_POLL_MS)
  }

  private scheduleOutputRefresh(): void {
    if (this.outputRefreshTimer !== undefined) return
    this.outputRefreshTimer = setTimeout(() => {
      this.outputRefreshTimer = undefined
      void this.refreshBindings()
    }, STATUS_OUTPUT_DEBOUNCE_MS)
  }

  private clearStatusTimers(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    if (this.outputRefreshTimer !== undefined) {
      clearTimeout(this.outputRefreshTimer)
      this.outputRefreshTimer = undefined
    }
  }

  private async *iterateWatch(signal: AbortSignal): AsyncIterable<readonly ConsoleBinding[]> {
    await this.refreshBindings()
    let revision = this.revision
    yield this.snapshot
    let wake: (() => void) | undefined
    const listener = (): void => { wake?.() }
    const abort = (): void => { wake?.() }
    this.watchers.add(listener)
    this.ensurePolling()
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (this.revision !== revision) {
          revision = this.revision
          yield this.snapshot
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.watchers.delete(listener)
      this.ensurePolling()
    }
  }

  private contextRows(sessionId: string) {
    return this.snapshot
      .filter(binding => binding.sessionId === sessionId)
      .map((binding) => {
        const running = this.runningByKey.get(binding.key)
        return running === undefined ? binding : { ...binding, running }
      })
  }

  private liveSessions(): LaunchTerminalSession[] {

    return [...this.launchSessions].filter(session => !session.ended)
  }

  private async attachablePids(): Promise<Set<number>> {
    const sessions = this.liveSessions()
    if (sessions.length === 0) return new Set()
    const pids = new Set<number>()
    for (const session of sessions) {
      pids.add(session.handle.pid)
      for (const pid of session.recorded) pids.add(pid)
    }
    try {
      const relatives = await listProcessRelatives(process.platform, argv => this.collectStdout(argv))
      for (const session of sessions) {
        for (const pid of descendantNonShellPids(session.handle.pid, relatives)) pids.add(pid)
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`program-console: launch terminal descendant lookup failed: ${message(error)}`)
    }
    return pids
  }

  /**
   * Resolve a live PTY session by process id only. When a Console is already
   * bound to that pid, its recorded start time is used so attachability checks
   * match {@link requireAttachedSession}.
   * @param pid - Process id of the bound Console, or of a live launch-session descendant.
   * @returns the held session that can accept input for this pid.
   * @throws HarnessError `PROGRAM_CONSOLE_PTY_UNAVAILABLE` when this process has no attachable terminal.
   */
  private async requireAttachedSessionByPid(pid: number): Promise<LaunchTerminalSession> {
    const known = [...this.bindings.values()].find(binding => binding.pid === pid)
    return this.requireAttachedSession(pid, known?.start ?? '')
  }

  /**
   * Write text to a held PTY and collect output that arrives after the write.
   * Collection does not terminate the session.
   * @param session - Live launch or user-shell PTY session.
   * @param data - Text already newline-completed by the write tool, passed through to `handle.write`.
   * @returns newly arrived output, or a short message when nothing new appeared.
   */
  private async writeAndCollect(session: LaunchTerminalSession, data: string): Promise<string> {
    const chunks: string[] = []
    let arrived = false
    let wake: (() => void) | undefined
    const listener = (chunk: string): void => {
      if (chunk.length > 0) {
        chunks.push(chunk)
        arrived = true
      }
      wake?.()
    }
    session.listeners.add(listener)
    try {
      await session.handle.write(data)
      const deadline = Date.now() + WRITE_OUTPUT_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (session.ended && !arrived) break
        if (arrived) {
          arrived = false
          const wait = Math.min(WRITE_SETTLE_MS, deadline - Date.now())
          if (wait <= 0) break
          await Promise.race([
            new Promise<void>((resolve) => { wake = resolve }),
            delay(wait),
          ])
          wake = undefined
          if (!arrived) break
          continue
        }
        const wait = deadline - Date.now()
        if (wait <= 0) break
        await Promise.race([
          new Promise<void>((resolve) => { wake = resolve }),
          delay(wait),
        ])
        wake = undefined
      }
      if (chunks.length === 0) return 'The input was written but no new output appeared.'
      return chunks.join('')
    } finally {
      session.listeners.delete(listener)
    }
  }

  private async requireAttachedSession(pid: number, start: string): Promise<LaunchTerminalSession> {
    const sessions = this.liveSessions()
    if (sessions.length === 0) {
      throw new HarnessError('this process has no attachable terminal', 'PROGRAM_CONSOLE_PTY_UNAVAILABLE')
    }
    const known = this.bindings.get(processKey(pid, start))
      ?? [...this.bindings.values()].find(binding => binding.pid === pid)
    if (known !== undefined && known.start !== start) {
      throw new HarnessError(
        'no process with that id and start time has a readable executable',
        'PROGRAM_CONSOLE_PROCESS_MISSING',
      )
    }
    let relatives: Awaited<ReturnType<typeof listProcessRelatives>> = []
    try {
      relatives = await listProcessRelatives(process.platform, argv => this.collectStdout(argv))
    } catch (error: unknown) {
      this.ctx.logger.warn(`program-console: launch terminal descendant lookup failed: ${message(error)}`)
    }
    for (const session of sessions) {
      if (pidMatchesLaunchSession(pid, session.handle.pid, session.recorded, relatives)) return session
    }
    throw new HarnessError('this process has no attachable terminal', 'PROGRAM_CONSOLE_PTY_UNAVAILABLE')
  }

  private async *iterateSession(session: LaunchTerminalSession, signal: AbortSignal): AsyncIterable<string> {
    for (const chunk of session.buffer) {
      if (signal.aborted) return
      yield chunk
    }
    const queue: string[] = []
    let wake: (() => void) | undefined
    const listener = (chunk: string): void => {
      queue.push(chunk)
      wake?.()
    }
    const abort = (): void => { wake?.() }
    session.listeners.add(listener)
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (queue.length > 0) {
          const chunk = queue.shift()
          if (chunk !== undefined) yield chunk
          continue
        }
        if (session.ended) return
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
      session.listeners.delete(listener)
    }
  }

  private async collectStdout(argv: readonly string[]): Promise<string> {
    const handle = this.ctx.subprocess.spawn(spawnSpec(argv))
    try {
      await handle.done
    } catch (error: unknown) {
      handle.terminate()
      throw error
    }
    return handle.collected.stdout?.readFrom(0).text ?? ''
  }
}

function startLaunchTerminal(handle: SubprocessTerminalHandle): LaunchTerminalSession {
  const session: LaunchTerminalSession = {
    handle,
    ended: false,
    recorded: [],
    buffer: [],
    bufferedChars: 0,
    listeners: new Set(),
  }
  const finish = (): void => {
    if (session.ended) return
    session.ended = true
    for (const listener of session.listeners) listener('')
  }
  void handle.done.then(finish, finish)
  void pumpLaunchTerminal(session).finally(finish)
  return session
}

async function pumpLaunchTerminal(session: LaunchTerminalSession): Promise<void> {
  for await (const chunk of session.handle.output) {
    const text = outputText(chunk)
    if (text.length === 0) continue
    session.buffer.push(text)
    session.bufferedChars += text.length
    while (session.bufferedChars > OUTPUT_BUFFER_CHARS && session.buffer.length > 1) {
      const removed = session.buffer.shift()
      if (removed !== undefined) session.bufferedChars -= removed.length
    }
    for (const listener of session.listeners) listener(text)
  }
}

function outputText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk
  if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk)
  return ''
}

function launchTerminalSpec(): SubprocessTerminalSpawnSpec {
  return {
    argv: launchTerminalArgv(process.platform),
    cwd: process.cwd(),
    rows: 24,
    cols: 80,
    terminalType: 'xterm-256color',
    shellActivity: true,
    graceMs: 200,
  }
}

function launchCommandTerminalSpec(command: string): SubprocessTerminalSpawnSpec {
  return {
    argv: launchArgv(process.platform, command),
    cwd: process.cwd(),
    rows: 10,
    cols: 80,
    terminalType: 'xterm-256color',
    shellActivity: true,
    graceMs: 200,
  }
}

function spawnSpec(argv: readonly string[]): SubprocessSpawnSpec {
  return {
    argv,
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 8_000_000, spill: { maxBytes: 16_000_000 } },
      stderr: { maxBytes: 1_000_000, spill: { maxBytes: 1_000_000 } },
    },
    graceMs: 200,
  }
}

function completeWriteData(data: string): string {
  return data.endsWith('\n') || data.endsWith('\r') ? data : `${data}\n`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
