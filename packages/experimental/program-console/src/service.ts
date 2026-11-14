/**
 * Host Console bindings, process enumeration, and command launch without a PTY.
 * @module @deepseek-ai/dsh-program-console/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { enumerateArgv, launchArgv } from './argv.ts'
import {
  chooseLaunched,
  ensureConsole,
  normalizeCommand,
  parseProcessLines,
  shellCommand,
} from './process-list.ts'
import { PROGRAM_CONSOLE_LAUNCH_COMMAND } from './skill-file.ts'
import { stopPid } from './stop-pid.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from './types.ts'

const LAUNCH = normalizeCommand(PROGRAM_CONSOLE_LAUNCH_COMMAND)
const POLL_ATTEMPTS = 15
const POLL_DELAY_MS = 100

/**
 * One Console per process. User launch and a matching bash or pwsh result both call {@link ensureConsole}.
 * Launch uses `subprocess.spawn`, never a terminal.
 */
export class ProgramConsole extends TypertRemoteService {
  static inject = ['subprocess']

  private readonly bindings = new Map<string, ConsoleBinding>()
  private readonly snapshots = new Map<string, { readonly before: readonly ListedProcess[]; readonly command: string }>()
  private readonly launched = new Set<SubprocessHandle>()
  private readonly spawnedPids = new Set<number>()

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
    this.ctx.effect(() => () => { this.stopSpawned() }, 'program-console: stop spawned')
  }

  /**
   * List processes whose executable path the platform command could read.
   * @param agent - Caller. The list is the host process table, not session-private.
   * @returns processes grouped later by executable path. Unreadable paths are absent.
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
    return ensureConsole(this.bindings, agent.session.id, entry, Date.now())
  }

  /**
   * Run a command with `cmd.exe /d /s /c` or `bash -c`, then bind a Console to the new process.
   * @param agent - Session that will own the Console when the process has none.
   * @param command - The full command from the dialog. It is one argument to the system shell.
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
    const handle = this.ctx.subprocess.spawn(spawnSpec(launchArgv(process.platform, command)))
    this.launched.add(handle)
    try {
      const chosen = await this.waitForLaunched(before, command)
      if (chosen === undefined) {
        throw new HarnessError(
          'the command did not leave a process to bind',
          'PROGRAM_CONSOLE_LAUNCH_NOT_FOUND',
        )
      }
      this.spawnedPids.add(chosen.pid)
      return ensureConsole(this.bindings, agent.session.id, chosen, Date.now())
    } catch (error: unknown) {
      handle.terminate()
      throw error
    }
  }

  /**
   * Consoles created on this host.
   * @param agent - Caller. The client filters to its own session when opening a tab.
   * @returns every binding. A process has at most one.
   */
  @Remote
  consoles(agent: Agent): Promise<ConsoleBinding[]> {
    void agent
    return Promise.resolve([...this.bindings.values()])
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
    ensureConsole(this.bindings, exec.agent.session.id, chosen, Date.now())
  }

  private async waitForLaunched(before: readonly ListedProcess[], command: string): Promise<ListedProcess | undefined> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const chosen = chooseLaunched(before, await this.enumerate(), command)
      if (chosen !== undefined) return chosen
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
    for (const pid of this.spawnedPids) stopPid(pid)
    this.spawnedPids.clear()
    this.launched.clear()
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
