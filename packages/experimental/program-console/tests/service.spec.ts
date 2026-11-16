import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-error'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { ToolExecution, ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ProgramConsolePlugin from '../src/index.ts'
import {
  PROGRAM_CONSOLE_CONTEXT_NAME,
  PROGRAM_CONSOLE_CONTEXT_ORDER,
  PROGRAM_CONSOLE_LAUNCH_TOOL,
  PROGRAM_CONSOLE_SELECT_TOOL,
  PROGRAM_CONSOLE_WRITE_TOOL,
  formatConsoleContext,
} from '../src/index.ts'
import { consoleRunningLabel } from '../src/status.ts'
import { PROGRAM_CONSOLE_LAUNCH_COMMAND } from '../src/skill-file.ts'

const LOOP = 'setInterval(() => {}, 1000000000)'

function agent(id: string): Agent {
  return { id: id as SessionId, session: { id: id as SessionId } } as Agent
}

function execution(command: string, caller: Agent | undefined, callId: string): ToolRunContext {
  return toolExecution('bash', { command }, caller, callId)
}

function toolExecution(name: string, args: Record<string, unknown>, caller: Agent | undefined, callId: string): ToolRunContext {
  return {
    name,
    arguments: args,
    ...(caller === undefined ? {} : { agent: caller }),
    callId: callId as ToolExecution['callId'],
    rootCallId: callId as ToolExecution['rootCallId'],
    token: Symbol(callId) as ToolExecution['token'],
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

function success(): ToolExecutionResult {
  return { isError: false, value: 'ok', content: [] }
}

function failure(): ToolExecutionResult {
  return { isError: true, error: { message: 'failed' }, content: [] }
}

function fakeHandle(done: Promise<SubprocessOutcome>, text?: string): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: text === undefined ? {} : {
      stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
    },
    done,
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
}

interface RegisteredTool {
  readonly name: string
  readonly description: string
  execute: (args: Record<string, unknown>, exec: ToolRunContext) => Promise<unknown>
}

async function boot(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const tools = new Map<string, RegisteredTool>()
  ctx.provide('tools', {
    register(definition: RegisteredTool) {
      tools.set(definition.name, definition)
      return () => { tools.delete(definition.name) }
    },
    get(name: string) {
      return tools.get(name)
    },
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(ProgramConsolePlugin)
  return { ctx, dispose: () => fiber.dispose() }
}

describe('program console service', () => {
  const leftover = new Set<number>()

  afterEach(() => {
    for (const pid of leftover) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch (error: unknown) {
        // The process already exited, so there is nothing left to stop.
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error
      }
    }
    leftover.clear()
  })

  it('registers the skill and lists only processes with a readable executable', async () => {
    const { ctx, dispose } = await boot()
    try {
      expect((await ctx.skills.list()).map(item => item.name)).toContain('program-console')
      const loaded = await ctx.skills.get('program-console')
      expect(loaded?.content).toContain(PROGRAM_CONSOLE_LAUNCH_COMMAND)
      expect(loaded?.content).toContain(PROGRAM_CONSOLE_LAUNCH_TOOL)
      expect(loaded?.content).toContain(PROGRAM_CONSOLE_WRITE_TOOL)
      expect(loaded?.content).toContain(PROGRAM_CONSOLE_SELECT_TOOL)
      expect(loaded?.content).not.toMatch(/Do not use a PTY/i)
      expect(loaded?.description).toContain(PROGRAM_CONSOLE_LAUNCH_TOOL)
      expect(loaded?.description).toContain(PROGRAM_CONSOLE_WRITE_TOOL)
      expect(loaded?.description).toContain(PROGRAM_CONSOLE_SELECT_TOOL)
      expect(loaded?.description).not.toMatch(/bash tool|pwsh tool/i)
      expect(ctx.tools.get(PROGRAM_CONSOLE_LAUNCH_TOOL)?.name).toBe(PROGRAM_CONSOLE_LAUNCH_TOOL)
      expect(ctx.tools.get(PROGRAM_CONSOLE_WRITE_TOOL)?.name).toBe(PROGRAM_CONSOLE_WRITE_TOOL)
      expect(ctx.tools.get(PROGRAM_CONSOLE_SELECT_TOOL)?.name).toBe(PROGRAM_CONSOLE_SELECT_TOOL)
      expect(PROGRAM_CONSOLE_CONTEXT_NAME).toBe('program-console:status')
      expect(PROGRAM_CONSOLE_CONTEXT_ORDER).toBe(130)
      const rows = await ctx.programConsole.list(agent('session'))
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(row => row.exe.length > 0 && row.pid > 0 && row.start.length > 0)).toBe(true)
      const self = rows.find(row => row.pid === process.pid)
      if (self === undefined) throw new Error('the test process was not listed')
      const opened = await ctx.programConsole.open(agent('session'), self.pid, self.start)
      const again = await ctx.programConsole.open(agent('other'), self.pid, self.start)
      expect(opened.created).toBe(true)
      expect(again).toEqual({ created: false, binding: opened.binding })
      expect(again.binding.sessionId).toBe('session')
      await expect(ctx.programConsole.open(agent('session'), 2_000_000_000, 'missing')).rejects.toBeInstanceOf(HarnessError)
      await expect(ctx.programConsole.launch(agent('session'), '   ')).rejects.toMatchObject({ code: 'PROGRAM_CONSOLE_COMMAND_EMPTY' })
    } finally {
      await dispose()
    }
  })

  it('launches through a PTY and binds an attachable Console', async () => {
    const { ctx, dispose } = await boot()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const terminal = vi.spyOn(ctx.subprocess, 'spawnTerminal')
    const command = `${process.execPath} -e "${LOOP}"`
    try {
      const opened = await ctx.programConsole.launch(agent('session'), command)
      leftover.add(opened.binding.pid)
      expect(opened.created).toBe(true)
      expect(opened.binding.commandLine).toContain('setInterval')
      expect(opened.binding.exe.endsWith('node')).toBe(true)
      expect(opened.binding.attachable).toBe(true)
      expect(terminal).toHaveBeenCalled()
      expect(terminal.mock.calls.some(([spec]) => spec.argv.includes(command))).toBe(true)
      expect(spawn.mock.calls.some(([spec]) => spec.argv.includes(command) && spec.stdio.stdin === 'ignore')).toBe(false)
      await ctx.programConsole.writeConsole(agent('session'), opened.binding.pid, opened.binding.start, 'x')
      await ctx.programConsole.resizeConsole(agent('session'), opened.binding.pid, opened.binding.start, 80, 24)
      const again = await ctx.programConsole.launch(agent('other'), command)
      leftover.add(again.binding.pid)
      expect(again.created).toBe(true)
      expect(again.binding.attachable).toBe(true)
      expect(again.binding.key).not.toBe(opened.binding.key)
      process.kill(opened.binding.pid, 'SIGTERM')
      process.kill(again.binding.pid, 'SIGTERM')
    } finally {
      await dispose()
    }
  }, 30_000)

  it('starts an interactive process through the launch tool', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    const command = `${process.execPath} -e "${LOOP}"`
    try {
      const tool = ctx.tools.get(PROGRAM_CONSOLE_LAUNCH_TOOL)
      if (tool === undefined) throw new Error('program_console_launch was not registered')
      const launched = vi.spyOn(ctx.programConsole, 'launch')
      await expect(tool.execute({ command }, execution(command, undefined, 'call-no-agent'))).rejects.toMatchObject({
        name: 'ToolContextUnavailableError',
        message: 'program_console_launch requires a calling agent',
      })
      expect(launched).not.toHaveBeenCalled()
      const text = await tool.execute({ command }, execution(command, caller, 'call-launch'))
      expect(launched).toHaveBeenCalledWith(caller, command)
      const opened = await launched.mock.results[0]?.value as Awaited<ReturnType<typeof ctx.programConsole.launch>>
      leftover.add(opened.binding.pid)
      expect(opened.binding.attachable).toBe(true)
      expect(text).toContain(String(opened.binding.pid))
      expect(text).toContain('will open for interactive input')
    } finally {
      await dispose()
    }
  }, 30_000)

  it('writes into a bound Console through the write tool and returns new output', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    try {
      const write = ctx.tools.get(PROGRAM_CONSOLE_WRITE_TOOL)
      if (write === undefined) throw new Error('program_console_write was not registered')
      await expect(write.execute({ pid: process.pid, data: '1+1' }, toolExecution(PROGRAM_CONSOLE_WRITE_TOOL, { pid: process.pid, data: '1+1' }, undefined, 'call-write-no-agent'))).rejects.toMatchObject({
        name: 'ToolContextUnavailableError',
        message: 'program_console_write requires a calling agent',
      })

      const opened = await ctx.programConsole.launch(caller, 'python3 -q')
      leftover.add(opened.binding.pid)
      await waitForConsoleOutput(ctx, caller, opened.binding.pid, opened.binding.start, '>>>')

      const withoutNewline = await write.execute(
        { pid: opened.binding.pid, data: '1+1' },
        toolExecution(PROGRAM_CONSOLE_WRITE_TOOL, { pid: opened.binding.pid, data: '1+1' }, caller, 'call-write'),
      )
      expect(withoutNewline).toContain('2')

      const withNewline = await write.execute(
        { pid: opened.binding.pid, data: '3+4\n' },
        toolExecution(PROGRAM_CONSOLE_WRITE_TOOL, { pid: opened.binding.pid, data: '3+4\n' }, caller, 'call-write-nl'),
      )
      expect(withNewline).toContain('7')
    } finally {
      await dispose()
    }
  }, 30_000)

  it('rejects writing to a pid whose PTY we do not hold', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    const marker = `console-write-no-pty-${process.pid}-${Date.now()}`
    let child: SubprocessHandle | undefined
    try {
      const write = ctx.tools.get(PROGRAM_CONSOLE_WRITE_TOOL)
      if (write === undefined) throw new Error('program_console_write was not registered')
      child = ctx.subprocess.spawn({
        ...childSpec(),
        argv: [process.execPath, '-e', `void ${JSON.stringify(marker)}; ${LOOP}`],
      })
      await expect.poll(
        async () => (await ctx.programConsole.list(caller)).some(row => row.commandLine.includes(marker)),
        { timeout: 5_000 },
      ).toBe(true)
      const target = (await ctx.programConsole.list(caller)).find(item => item.commandLine.includes(marker))
      if (target === undefined) throw new Error('the ignored-stdin process was not listed')
      leftover.add(target.pid)
      await ctx.programConsole.open(caller, target.pid, target.start)
      await expect(write.execute(
        { pid: target.pid, data: 'x' },
        toolExecution(PROGRAM_CONSOLE_WRITE_TOOL, { pid: target.pid, data: 'x' }, caller, 'call-write-missing'),
      )).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_PTY_UNAVAILABLE',
      })
      await expect(write.execute(
        { pid: process.pid, data: 'x' },
        toolExecution(PROGRAM_CONSOLE_WRITE_TOOL, { pid: process.pid, data: 'x' }, caller, 'call-write-self'),
      )).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_PTY_UNAVAILABLE',
      })
    } finally {
      child?.terminate()
      await dispose()
    }
  }, 30_000)

  it('reports a command that exits before a program can be bound', async () => {
    const { ctx, dispose } = await boot()
    try {
      await expect(ctx.programConsole.launch(agent('session'), 'true')).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_LAUNCH_NOT_FOUND',
      })
    } finally {
      await dispose()
    }
  }, 30_000)

  it('binds a process after the skill command runs in bash and ignores other shell results', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    const matched = execution(PROGRAM_CONSOLE_LAUNCH_COMMAND, caller, 'call-match')
    const other = execution('echo hi', caller, 'call-other')
    let child: SubprocessHandle | undefined
    try {
      await ctx.waterfall('tools/pre-execute', matched, async () => ({ kind: 'allow' as const }))
      ctx.emit('tools/result', execution(PROGRAM_CONSOLE_LAUNCH_COMMAND, undefined, 'call-match'), success())
      expect(await ctx.programConsole.consoles(caller)).toEqual([])
      await ctx.waterfall('tools/pre-execute', other, async () => ({ kind: 'allow' as const }))
      ctx.emit('tools/result', other, success())
      await ctx.waterfall('tools/pre-execute', matched, async () => ({ kind: 'allow' as const }))
      ctx.emit('tools/result', matched, failure())
      expect(await ctx.programConsole.consoles(caller)).toEqual([])
      const missed = execution(PROGRAM_CONSOLE_LAUNCH_COMMAND, caller, 'call-miss')
      await ctx.waterfall('tools/pre-execute', missed, async () => ({ kind: 'allow' as const }))
      ctx.emit('tools/result', missed, success())
      await new Promise((resolve) => { setTimeout(resolve, 500) })
      expect(await ctx.programConsole.consoles(caller)).toEqual([])
      await ctx.waterfall('tools/pre-execute', matched, async () => ({ kind: 'allow' as const }))
      child = ctx.subprocess.spawn(childSpec())
      await expect.poll(async () => (await ctx.programConsole.list(caller)).some(row => row.commandLine.includes('setInterval')), { timeout: 5_000 }).toBe(true)
      ctx.emit('tools/result', matched, success())
      await expect.poll(async () => (await ctx.programConsole.consoles(caller)).some(row => row.commandLine.includes('setInterval')), { timeout: 5_000 }).toBe(true)
      const bound = (await ctx.programConsole.consoles(caller)).find(row => row.commandLine.includes('setInterval'))
      expect(bound?.sessionId).toBe('session')
      if (bound !== undefined) leftover.add(bound.pid)
    } finally {
      child?.terminate()
      await dispose()
    }
  }, 30_000)

  it('keeps the shell call going when enumeration fails and stops spawned pids on unload', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    const terminate = vi.fn()
    let mode: 'reject-string' | 'empty' | 'reject-error' | 'real' = 'reject-string'
    const rejectText = async (): Promise<never> => {
      throw 'boom'
    }
    ctx.subprocess.spawn = (spec: SubprocessSpawnSpec) => {
      if (mode === 'real') return original(spec)
      if (mode === 'empty') return fakeHandle(Promise.resolve({ exitCode: 0, signal: null }), undefined)
      const done = mode === 'reject-string' ? rejectText() : Promise.reject(new Error('enum failed'))
      return { ...fakeHandle(done, ''), terminate }
    }
    try {
      const matched = execution(PROGRAM_CONSOLE_LAUNCH_COMMAND, caller, 'call-fail')
      await ctx.waterfall('tools/pre-execute', matched, async () => ({ kind: 'allow' as const }))
      expect(terminate).toHaveBeenCalled()
      mode = 'empty'
      await ctx.waterfall('tools/pre-execute', matched, async () => ({ kind: 'allow' as const }))
      mode = 'reject-error'
      ctx.emit('tools/result', matched, success())
      await expect.poll(() => terminate.mock.calls.length).toBeGreaterThan(1)
      mode = 'real'
      const opened = await ctx.programConsole.launch(caller, `${process.execPath} -e "${LOOP}"`)
      leftover.add(opened.binding.pid)
    } finally {
      ctx.subprocess.spawn = original
      await dispose()
    }
  }, 30_000)
})

async function waitForConsoleOutput(
  ctx: Context,
  caller: Agent,
  pid: number,
  start: string,
  marker: string,
): Promise<void> {
  const lifetime = new AbortController()
  const chunks: string[] = []
  const consuming = (async () => {
    try {
      for await (const chunk of ctx.programConsole.followConsole(caller, pid, start, lifetime.signal)) {
        chunks.push(chunk)
        if (chunks.join('').includes(marker)) return
      }
    } catch {
      // Aborted after the marker arrived, or the follow ended with the test.
    }
  })()
  try {
    await expect.poll(() => chunks.join('').includes(marker), { timeout: 5_000 }).toBe(true)
  } finally {
    lifetime.abort()
    await consuming
  }
}

function childSpec(): SubprocessSpawnSpec {
  return {
    argv: [process.execPath, '-e', LOOP],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 1_000, spill: { maxBytes: 1_000 } },
      stderr: { maxBytes: 1_000, spill: { maxBytes: 1_000 } },
    },
    graceMs: 200,
  }
}


describe('program console user shell attachment', () => {
  const leftover = new Set<number>()

  afterEach(() => {
    for (const pid of leftover) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error
      }
    }
    leftover.clear()
  })

  function wrapTerminals(ctx: Context): { terminated: Set<number> } {
    const original = ctx.subprocess.spawnTerminal.bind(ctx.subprocess)
    const terminated = new Set<number>()
    ctx.subprocess.spawnTerminal = async (spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> => {
      const handle = await original(spec)
      leftover.add(handle.pid)
      return {
        get pid() { return handle.pid },
        get output() { return handle.output },
        get done() { return handle.done },
        write: (data: string) => handle.write(data),
        resize: (cols: number, rows: number) => handle.resize(cols, rows),
        inspectForeground: () => handle.inspectForeground(),
        inspectActivity: () => handle.inspectActivity(),
        signalForeground: signal => handle.signalForeground(signal),
        terminate: async () => {
          terminated.add(handle.pid)
          await handle.terminate()
        },
      }
    }
    return { terminated }
  }

  async function waitForCommand(ctx: Context, caller: Agent, needle: string): Promise<{ pid: number; start: string; commandLine: string }> {
    await expect.poll(async () => {
      return (await ctx.programConsole.list(caller)).some(row => row.commandLine.includes(needle))
    }, { timeout: 10_000 }).toBe(true)
    const row = (await ctx.programConsole.list(caller)).find(item => item.commandLine.includes(needle))
    if (row === undefined) throw new Error(`process for ${needle} was not listed`)
    leftover.add(row.pid)
    return row
  }

  it('opens a bound attachable Console for a new PTY shell, and a second open is a distinct session', async () => {
    const { ctx, dispose } = await boot()
    const { terminated } = wrapTerminals(ctx)
    const caller = agent('session')
    let disposed = false
    try {
      const first = await ctx.programConsole.openUserConsole(caller)
      leftover.add(first.binding.pid)
      expect(first.created).toBe(true)
      expect(first.binding.attachable).toBe(true)
      expect(first.binding.pid).toBeGreaterThan(0)

      const second = await ctx.programConsole.openUserConsole(caller)
      leftover.add(second.binding.pid)
      expect(second.created).toBe(true)
      expect(second.binding.attachable).toBe(true)
      expect(second.binding.key).not.toBe(first.binding.key)
      expect(second.binding.pid).not.toBe(first.binding.pid)

      const chunks: string[] = []
      const lifetime = new AbortController()
      const consuming = (async () => {
        for await (const chunk of ctx.programConsole.followConsole(caller, first.binding.pid, first.binding.start, lifetime.signal)) {
          chunks.push(chunk)
        }
      })()
      await ctx.programConsole.writeConsole(caller, first.binding.pid, first.binding.start, 'echo user-console-ready\n')
      await ctx.programConsole.resizeConsole(caller, first.binding.pid, first.binding.start, 80, 24)
      await expect.poll(() => chunks.join('').includes('user-console-ready') || chunks.length > 0, { timeout: 5_000 }).toBe(true)
      lifetime.abort()
      await consuming
      expect(terminated.size).toBe(0)
      expect(() => process.kill(first.binding.pid, 0)).not.toThrow()
      expect(() => process.kill(second.binding.pid, 0)).not.toThrow()

      await dispose()
      disposed = true
      expect(terminated.has(first.binding.pid)).toBe(true)
      expect(terminated.has(second.binding.pid)).toBe(true)
    } finally {
      if (!disposed) await dispose()
    }
  }, 30_000)

  it('treats a descendant started in a user Console as attachable', async () => {
    const { ctx, dispose } = await boot()
    const { terminated } = wrapTerminals(ctx)
    const caller = agent('session')
    const marker = `console-pty-child-${process.pid}-${Date.now()}`
    try {
      const opened = await ctx.programConsole.openUserConsole(caller)
      leftover.add(opened.binding.pid)
      await ctx.programConsole.writeConsole(
        caller,
        opened.binding.pid,
        opened.binding.start,
        `\n${process.execPath} -e ${JSON.stringify(`void ${JSON.stringify(marker)}; ${LOOP}`)}\n`,
      )
      const child = await waitForCommand(ctx, caller, marker)
      const bound = await ctx.programConsole.open(caller, child.pid, child.start)
      expect(bound.binding.attachable).toBe(true)
      await ctx.programConsole.writeConsole(caller, child.pid, child.start, 'x')
      await ctx.programConsole.resizeConsole(caller, child.pid, child.start, 80, 24)
      expect(terminated.size).toBe(0)
      expect(() => process.kill(child.pid, 0)).not.toThrow()
    } finally {
      await dispose()
    }
  }, 30_000)

  it('keeps a launch() session separate from a user Console and alive after the Console stream ends', async () => {
    const { ctx, dispose } = await boot()
    const { terminated } = wrapTerminals(ctx)
    const caller = agent('session')
    const userMarker = `console-pty-user-${process.pid}-${Date.now()}`
    let disposed = false
    try {
      const user = await ctx.programConsole.openUserConsole(caller)
      leftover.add(user.binding.pid)
      await ctx.programConsole.writeConsole(
        caller,
        user.binding.pid,
        user.binding.start,
        `\n${process.execPath} -e ${JSON.stringify(`void ${JSON.stringify(userMarker)}; ${LOOP}`)}\n`,
      )
      const child = await waitForCommand(ctx, caller, userMarker)
      const launched = await ctx.programConsole.launch(caller, `${process.execPath} -e "${LOOP}"`)
      leftover.add(launched.binding.pid)
      expect(launched.binding.attachable).toBe(true)
      expect(launched.binding.pid).not.toBe(child.pid)
      expect(launched.binding.pid).not.toBe(user.binding.pid)
      const boundChild = await ctx.programConsole.open(caller, child.pid, child.start)
      expect(boundChild.binding.attachable).toBe(true)

      const launchChunks: string[] = []
      const userChunks: string[] = []
      const lifetime = new AbortController()
      const consumingLaunch = (async () => {
        for await (const chunk of ctx.programConsole.followConsole(caller, launched.binding.pid, launched.binding.start, lifetime.signal)) {
          launchChunks.push(chunk)
        }
      })()
      const consumingUser = (async () => {
        for await (const chunk of ctx.programConsole.followConsole(caller, child.pid, child.start, lifetime.signal)) {
          userChunks.push(chunk)
        }
      })()
      const launchToken = `launch-token-${Date.now()}`
      const userToken = `user-token-${Date.now()}`
      await ctx.programConsole.writeConsole(caller, launched.binding.pid, launched.binding.start, launchToken)
      await ctx.programConsole.writeConsole(caller, child.pid, child.start, userToken)
      await expect.poll(() => userChunks.join('').includes(userMarker) || userChunks.length > 0, { timeout: 5_000 }).toBe(true)
      await new Promise((resolve) => { setTimeout(resolve, 300) })
      expect(launchChunks.join('')).not.toContain(userToken)
      expect(userChunks.join('')).not.toContain(launchToken)

      lifetime.abort()
      await consumingLaunch
      await consumingUser
      expect(terminated.size).toBe(0)
      expect(() => process.kill(launched.binding.pid, 0)).not.toThrow()
      expect(() => process.kill(child.pid, 0)).not.toThrow()
      const consoles = await ctx.programConsole.consoles(caller)
      expect(consoles.find(item => item.pid === launched.binding.pid)?.attachable).toBe(true)
      expect(consoles.find(item => item.pid === child.pid)?.attachable).toBe(true)

      await dispose()
      disposed = true
      expect(terminated.has(user.binding.pid)).toBe(true)
      expect(terminated.size).toBeGreaterThanOrEqual(2)
    } finally {
      if (!disposed) await dispose()
    }
  }, 30_000)

  it('terminates a new user shell when the process cannot be bound', async () => {
    const { ctx, dispose } = await boot()
    const { terminated } = wrapTerminals(ctx)
    const originalSpawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = (spec: SubprocessSpawnSpec) => {
      void spec
      return fakeHandle(Promise.resolve({ exitCode: 0, signal: null }), '')
    }
    const caller = agent('session')
    try {
      await expect(ctx.programConsole.openUserConsole(caller)).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_LAUNCH_NOT_FOUND',
      })
      expect(terminated.size).toBe(1)
    } finally {
      ctx.subprocess.spawn = originalSpawn
      await dispose()
    }
  }, 30_000)

  it('reports no attachable terminal for a process whose PTY we do not hold', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    const marker = `console-no-pty-${process.pid}-${Date.now()}`
    let child: SubprocessHandle | undefined
    try {
      child = ctx.subprocess.spawn({
        ...childSpec(),
        argv: [process.execPath, '-e', `void ${JSON.stringify(marker)}; ${LOOP}`],
      })
      await expect.poll(
        async () => (await ctx.programConsole.list(caller)).some(row => row.commandLine.includes(marker)),
        { timeout: 5_000 },
      ).toBe(true)
      const target = (await ctx.programConsole.list(caller)).find(item => item.commandLine.includes(marker))
      if (target === undefined) throw new Error('the ignored-stdin process was not listed')
      leftover.add(target.pid)
      const bound = await ctx.programConsole.open(caller, target.pid, target.start)
      expect(bound.binding.attachable).toBe(false)
      await expect(ctx.programConsole.writeConsole(caller, bound.binding.pid, bound.binding.start, 'x')).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_PTY_UNAVAILABLE',
      })
      await expect(ctx.programConsole.resizeConsole(caller, bound.binding.pid, bound.binding.start, 80, 24)).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_PTY_UNAVAILABLE',
      })
      const rows = await ctx.programConsole.list(caller)
      const self = rows.find(row => row.pid === process.pid)
      if (self === undefined) throw new Error('the test process was not listed')
      const opened = await ctx.programConsole.open(caller, self.pid, self.start)
      expect(opened.binding.attachable).toBe(false)
    } finally {
      child?.terminate()
      await dispose()
    }
  }, 30_000)
})

describe('program console status and selection', () => {
  const leftover = new Set<number>()

  afterEach(() => {
    for (const pid of leftover) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error
      }
    }
    leftover.clear()
  })

  it('marks a user shell idle, promotes a started process to the unique active Console, and clears active on exit', async () => {
    const { ctx, dispose } = await boot()
    const caller = agent('session')
    try {
      const user = await ctx.programConsole.openUserConsole(caller)
      leftover.add(user.binding.pid)
      expect(user.binding.status).toBe('idle')

      await ctx.programConsole.writeConsole(caller, user.binding.pid, user.binding.start, 'python3 -q\n')
      await expect.poll(async () => {
        const row = (await ctx.programConsole.consoles(caller)).find(item => item.pid === user.binding.pid)
        return row?.status
      }, { timeout: 10_000 }).toBe('active')

      const launched = await ctx.programConsole.launch(caller, `${process.execPath} -e "${LOOP}"`)
      leftover.add(launched.binding.pid)
      expect(launched.binding.status).toBe('active')
      expect((await ctx.programConsole.consoles(caller)).find(item => item.pid === user.binding.pid)?.status).toBe('ready')

      const selected = await ctx.programConsole.select(caller, user.binding.pid)
      expect(selected.status).toBe('active')
      expect((await ctx.programConsole.consoles(caller)).find(item => item.pid === launched.binding.pid)?.status).toBe('ready')

      const select = ctx.tools.get(PROGRAM_CONSOLE_SELECT_TOOL)
      if (select === undefined) throw new Error('program_console_select was not registered')
      await expect(select.execute(
        { pid: launched.binding.pid },
        toolExecution(PROGRAM_CONSOLE_SELECT_TOOL, { pid: launched.binding.pid }, undefined, 'call-select-no-agent'),
      )).rejects.toMatchObject({
        name: 'ToolContextUnavailableError',
        message: 'program_console_select requires a calling agent',
      })
      const text = await select.execute(
        { pid: launched.binding.pid },
        toolExecution(PROGRAM_CONSOLE_SELECT_TOOL, { pid: launched.binding.pid }, caller, 'call-select'),
      )
      expect(text).toContain(String(launched.binding.pid))
      expect((await ctx.programConsole.consoles(caller)).find(item => item.pid === launched.binding.pid)?.status).toBe('active')
      expect((await ctx.programConsole.consoles(caller)).find(item => item.pid === user.binding.pid)?.status).toBe('ready')

      const idle = await ctx.programConsole.openUserConsole(caller)
      leftover.add(idle.binding.pid)
      expect(idle.binding.status).toBe('idle')
      await expect(ctx.programConsole.select(caller, idle.binding.pid)).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_SELECT_IDLE',
      })
      await expect(ctx.programConsole.select(caller, 2_000_000_000)).rejects.toMatchObject({
        code: 'PROGRAM_CONSOLE_PROCESS_MISSING',
      })

      await ctx.programConsole.select(caller, user.binding.pid)
      await ctx.programConsole.writeConsole(caller, user.binding.pid, user.binding.start, 'import os, signal\nos.kill(os.getpid(), signal.SIGTERM)\n')
      await expect.poll(async () => {
        const row = (await ctx.programConsole.consoles(caller)).find(item => item.pid === user.binding.pid)
        return row?.status
      }, { timeout: 10_000 }).toBe('idle')
      const rows = await ctx.programConsole.consoles(caller)
      expect(rows.find(item => item.pid === user.binding.pid)?.status).toBe('idle')
      expect(rows.find(item => item.pid === launched.binding.pid)?.status).toBe('ready')
      expect(rows.some(item => item.status === 'active')).toBe(false)
    } finally {
      await dispose()
    }
  }, 30_000)

  it('exposes Console ids and the active target through system-prompt context', async () => {
    const ctx = new Context()
    const tools = new Map<string, RegisteredTool>()
    ctx.provide('tools', {
      register(definition: RegisteredTool) {
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      },
      get(name: string) {
        return tools.get(name)
      },
    })
    let contextText = ''
    const registered: { name: string; order: number; text: (input: { agent?: Agent }) => string }[] = []
    ctx.provide('systemPrompt', {
      context(definition: { name: string; order: number; text: (input: { agent?: Agent }) => string }) {
        registered.push(definition)
        return () => {}
      },
    })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(ProgramConsolePlugin)
    try {
      expect(registered.some(entry =>
        entry.name === PROGRAM_CONSOLE_CONTEXT_NAME && entry.order === PROGRAM_CONSOLE_CONTEXT_ORDER,
      )).toBe(true)
      const contribution = registered.find(entry => entry.name === PROGRAM_CONSOLE_CONTEXT_NAME)
      if (contribution === undefined) throw new Error('program-console context was not registered')
      const caller = agent('session')
      const opened = await ctx.programConsole.launch(caller, `${process.execPath} -e "${LOOP}"`)
      leftover.add(opened.binding.pid)
      const text = contribution.text({ agent: caller })
      contextText = text
      expect(text).toContain(`Console ${String(opened.binding.pid)}: active (green)`)
      expect(text).toContain(`The active Console id is ${String(opened.binding.pid)}`)
      expect(text).toContain('Only the Console ids listed here exist')
      const listed = (await ctx.programConsole.consoles(caller)).filter(item => item.sessionId === 'session')
      const expected = formatConsoleContext(listed.map((item) => {
        const running = consoleRunningLabel({
          exe: item.exe,
          commandLine: item.commandLine,
          nonShellDescendantExes: [],
        })
        return running === undefined ? item : { ...item, running }
      }))
      expect(text).toBe(expected)
      expect(text).toContain('running')
    } finally {
      await fiber.dispose()
    }
    expect(contextText).toContain('program_console_select')
  }, 30_000)
})
