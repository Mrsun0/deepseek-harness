import { describe, expect, it } from 'vitest'
import {
  chooseLaunched,
  consoleAddress,
  ensureConsole,
  groupByExe,
  keyFromAddress,
  normalizeCommand,
  parseProcessLines,
  processKey,
  shellCommand,
} from '../src/process-list.ts'
import type { ConsoleBinding, ListedProcess } from '../src/types.ts'

const node: ListedProcess = {
  pid: 10, start: '100', exe: '/usr/bin/node', commandLine: 'node -e setInterval(() => {}, 1000000000)',
}
const bash: ListedProcess = {
  pid: 9, start: '90', exe: '/bin/bash', commandLine: 'bash -c node -e setInterval(() => {}, 1000000000)',
}

describe('process list', () => {
  it('parses complete rows and skips rows the platform command could not resolve', () => {
    const text = [
      '10\t100\t/usr/bin/node\tnode -e loop',
      '11\t200\tC:\\Windows\\node.exe\tnode\tone',
      '12\t300\t/bin/sleep',
      '',
      '0\t1\t/bin/true\ttrue',
      'nope\t1\t/bin/true\ttrue',
      '3\t\t/bin/true\ttrue',
      '4\t1\t\ttrue',
      '5\t1',
      '1.5\t1\t/bin/true\ttrue',
    ].join('\n')
    expect(parseProcessLines(text)).toEqual([
      { pid: 10, start: '100', exe: '/usr/bin/node', commandLine: 'node -e loop' },
      { pid: 11, start: '200', exe: 'C:\\Windows\\node.exe', commandLine: 'node\tone' },
      { pid: 12, start: '300', exe: '/bin/sleep', commandLine: '12' },
    ])
  })

  it('groups processes under the executable they resolved to', () => {
    expect(groupByExe([])).toEqual([])
    expect(groupByExe([node, { ...node, pid: 11 }, bash])).toEqual([
      { exe: '/usr/bin/node', processes: [node, { ...node, pid: 11 }] },
      { exe: '/bin/bash', processes: [bash] },
    ])
  })

  it('keeps one Console for a process and leaves a second session on that binding', () => {
    const bindings = new Map<string, ConsoleBinding>()
    const created = ensureConsole(bindings, 'session-a', node, 50)
    const again = ensureConsole(bindings, 'session-b', node, 80)
    expect(created).toEqual({
      created: true,
      binding: {
        key: processKey(10, '100'), pid: 10, start: '100', exe: '/usr/bin/node',
        commandLine: node.commandLine, sessionId: 'session-a', createdAt: 50, attachable: false, status: 'idle',
      },
    })
    expect(again).toEqual({ created: false, binding: created.binding })
    expect(bindings.size).toBe(1)
  })

  it('chooses the new program and skips the shell that launched it', () => {
    expect(chooseLaunched([bash], [bash, node], 'node -e "setInterval(() => {}, 1000000000)"')).toBe(node)
    expect(chooseLaunched([], [{ ...node, exe: 'node' }], 'node -e setInterval')).toMatchObject({ exe: 'node' })
    expect(chooseLaunched([], [{ ...node, exe: 'C:\\Windows\\node.exe' }], 'node -e setInterval')).toMatchObject({ exe: 'C:\\Windows\\node.exe' })
    expect(chooseLaunched([bash], [bash, { ...bash, pid: 12, start: '120' }], 'node -e setInterval')).toBeUndefined()
    expect(chooseLaunched([], [node], '   ')).toBeUndefined()
    expect(chooseLaunched([], [node], 'sleep 5')).toBeUndefined()
  })

  it('reads shell commands and process addresses', () => {
    expect(normalizeCommand(' node  -e "setInterval()" ')).toBe('node -e setInterval()')
    expect(shellCommand('bash', { command: 'echo hi' })).toBe('echo hi')
    expect(shellCommand('pwsh', { command: 'Get-Date' })).toBe('Get-Date')
    expect(shellCommand('read', { command: 'echo hi' })).toBeUndefined()
    expect(shellCommand('bash', null)).toBeUndefined()
    expect(shellCommand('bash', {})).toBeUndefined()
    expect(shellCommand('bash', { command: 1 })).toBeUndefined()
    const address = consoleAddress(processKey(10, '100'))
    expect(keyFromAddress(address)).toBe('10\n100')
    expect(keyFromAddress('https://example.test/10')).toBeUndefined()
    expect(keyFromAddress('dsh-resource://program-console/%')).toBeUndefined()
    expect(keyFromAddress(consoleAddress('10'))).toBeUndefined()
    expect(keyFromAddress(consoleAddress('x\n100'))).toBeUndefined()
    expect(keyFromAddress(consoleAddress('10\n100\nextra'))).toBeUndefined()
    expect(keyFromAddress(consoleAddress('10\n'))).toBeUndefined()
  })
})
