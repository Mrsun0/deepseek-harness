import { describe, expect, it } from 'vitest'
import {
  consoleHasStartedProcess,
  consoleRunningLabel,
  formatConsoleContext,
  nextActiveKey,
  statusFromFlags,
} from '../src/status.ts'
import type { ConsoleBinding, ConsoleStatus } from '../src/types.ts'

function binding(pid: number, status: ConsoleStatus, extras?: Partial<ConsoleBinding>): ConsoleBinding {
  return {
    key: `${String(pid)}\n${String(pid * 10)}`,
    pid,
    start: String(pid * 10),
    exe: '/usr/bin/python3',
    commandLine: 'python3 -q',
    sessionId: 'session',
    createdAt: pid,
    attachable: status !== 'idle',
    status,
    ...extras,
  }
}

describe('console status helpers', () => {
  it('treats a shell-only attachable Console as idle and a non-shell child as started', () => {
    expect(consoleHasStartedProcess({
      attachable: true,
      exe: '/bin/bash',
      pid: 10,
      shellPid: 10,
      nonShellDescendants: [],
    })).toBe(false)
    expect(consoleHasStartedProcess({
      attachable: true,
      exe: '/bin/bash',
      pid: 10,
      shellPid: 10,
      nonShellDescendants: [11],
    })).toBe(true)
    expect(consoleHasStartedProcess({
      attachable: true,
      exe: '/usr/bin/python3',
      pid: 20,
      shellPid: 19,
      nonShellDescendants: [20],
    })).toBe(true)
    expect(consoleHasStartedProcess({
      attachable: true,
      exe: '/usr/bin/python3',
      pid: 20,
      shellPid: 20,
      nonShellDescendants: [],
    })).toBe(true)
    expect(consoleHasStartedProcess({
      attachable: false,
      exe: '/usr/bin/python3',
      pid: 20,
      shellPid: undefined,
      nonShellDescendants: [],
    })).toBe(false)
    expect(consoleHasStartedProcess({
      attachable: true,
      exe: '/bin/bash',
      pid: 10,
      shellPid: undefined,
      nonShellDescendants: [],
    })).toBe(false)
  })

  it('makes a newly started Console the unique active target and does not promote on exit', () => {
    const first = { key: '1\n1', started: true, createdAt: 1 }
    const second = { key: '2\n2', started: true, createdAt: 2 }
    expect(nextActiveKey({
      previousStarted: new Set(),
      current: [first],
      activeKey: undefined,
    })).toBe('1\n1')
    expect(nextActiveKey({
      previousStarted: new Set(['1\n1']),
      current: [first, second],
      activeKey: '1\n1',
    })).toBe('2\n2')
    expect(nextActiveKey({
      previousStarted: new Set(['1\n1', '2\n2']),
      current: [{ ...first, started: false }, second],
      activeKey: '1\n1',
    })).toBeUndefined()
    expect(nextActiveKey({
      previousStarted: new Set(['1\n1', '2\n2']),
      current: [first, second],
      activeKey: '1\n1',
    })).toBe('1\n1')
    expect(statusFromFlags(false, true)).toBe('idle')
    expect(statusFromFlags(true, false)).toBe('ready')
    expect(statusFromFlags(true, true)).toBe('active')
  })

  it('names a running non-shell program and leaves a shell-only Console unlabeled', () => {
    expect(consoleRunningLabel({
      exe: '/bin/bash',
      commandLine: 'bash',
      nonShellDescendantExes: ['/usr/bin/python3'],
    })).toBe('python3')
    expect(consoleRunningLabel({
      exe: '/usr/bin/python3',
      commandLine: 'python3 -q',
      nonShellDescendantExes: [],
    })).toBe('python3 -q')
    expect(consoleRunningLabel({
      exe: '/bin/bash',
      commandLine: 'bash',
      nonShellDescendantExes: [],
    })).toBeUndefined()
  })

  it('lists Console ids, states, and the unique active id in context text', () => {
    const empty = formatConsoleContext([])
    expect(empty).toBe('')
    const text = formatConsoleContext([
      { ...binding(902207, 'active'), running: 'python3' },
      binding(899281, 'ready'),
      binding(632518, 'idle', { exe: '/bin/bash', commandLine: 'bash', attachable: true }),
    ])
    expect(text).toContain('Console 902207: active (green)')
    expect(text).toContain('running python3')
    expect(text).toContain('Console 899281: ready (orange)')
    expect(text).toContain('Console 632518: idle (red)')
    expect(text).not.toContain('Console 632518: idle (red); running')
    expect(text).toContain('The active Console id is 902207')
    expect(text).toContain('Only the Console ids listed here exist')
    expect(text).toContain('do not call program_console_launch to start a duplicate')
    expect(text).toContain('Do not use bash, ps, or pwsh')
    expect(text).toContain('program_console_write')
    expect(text).toContain('program_console_select')
    const idleOnly = formatConsoleContext([binding(10, 'idle', { attachable: true, exe: '/bin/bash' })])
    expect(idleOnly).toContain('There is no active (green) Console')
    expect(idleOnly).toContain('program_console_select')
    expect(idleOnly).toContain('Only the Console ids listed here exist')
  })
})
