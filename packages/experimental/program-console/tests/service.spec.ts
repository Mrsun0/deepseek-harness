import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-error'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ProgramConsolePlugin from '../src/index.ts'
import { PROGRAM_CONSOLE_LAUNCH_COMMAND } from '../src/skill-file.ts'

const LOOP = 'setInterval(() => {}, 1000000000)'

function agent(id: string): Agent {
  return { id: id as SessionId, session: { id: id as SessionId } } as Agent
}

function execution(command: string, caller: Agent | undefined, callId: string): ToolExecution {
  return {
    name: 'bash',
    arguments: { command },
    ...(caller === undefined ? {} : { agent: caller }),
    callId: callId as ToolExecution['callId'],
    rootCallId: callId as ToolExecution['rootCallId'],
    token: Symbol(callId) as ToolExecution['token'],
    signal: new AbortController().signal,
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

async function boot(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
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

  it('launches through bash -c and binds the new program, not a terminal', async () => {
    const { ctx, dispose } = await boot()
    const terminal = vi.spyOn(ctx.subprocess, 'spawnTerminal')
    const command = `${process.execPath} -e "${LOOP}"`
    try {
      const opened = await ctx.programConsole.launch(agent('session'), command)
      leftover.add(opened.binding.pid)
      expect(opened.created).toBe(true)
      expect(opened.binding.commandLine).toContain('setInterval')
      expect(opened.binding.exe.endsWith('node')).toBe(true)
      expect(terminal).not.toHaveBeenCalled()
      const again = await ctx.programConsole.launch(agent('other'), command)
      leftover.add(again.binding.pid)
      expect(again.created).toBe(true)
      expect(again.binding.key).not.toBe(opened.binding.key)
      process.kill(opened.binding.pid, 'SIGTERM')
      process.kill(again.binding.pid, 'SIGTERM')
    } finally {
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
