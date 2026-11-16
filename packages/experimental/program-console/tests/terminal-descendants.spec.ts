import { describe, expect, it } from 'vitest'
import {
  descendantNonShellPids,
  isSystemShell,
  parseProcStatPpid,
  parseProcessRelatives,
  pidMatchesLaunchSession,
} from '../src/terminal-descendants.ts'
import type { ProcessRelative } from '../src/terminal-descendants.ts'

describe('launch terminal descendants', () => {
  it('treats login and interactive shells as system shells and leaves programs in', () => {
    expect(isSystemShell('/bin/bash')).toBe(true)
    expect(isSystemShell('/usr/bin/sh')).toBe(true)
    expect(isSystemShell('/usr/bin/zsh')).toBe(true)
    expect(isSystemShell('/usr/bin/dash')).toBe(true)
    expect(isSystemShell('/usr/bin/fish')).toBe(true)
    expect(isSystemShell('C:\\Windows\\System32\\cmd.exe')).toBe(true)
    expect(isSystemShell('powershell')).toBe(true)
    expect(isSystemShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(true)
    expect(isSystemShell('/usr/bin/node')).toBe(false)
    expect(isSystemShell('/usr/bin/python3')).toBe(false)
  })

  it('records readable non-shell descendants and skips the shell itself', () => {
    const processes: ProcessRelative[] = [
      { pid: 1, ppid: 0, exe: '/sbin/init' },
      { pid: 10, ppid: 1, exe: '/bin/bash' },
      { pid: 11, ppid: 10, exe: '/bin/bash' },
      { pid: 12, ppid: 11, exe: '/usr/bin/node' },
      { pid: 13, ppid: 11, exe: '/usr/bin/python3' },
      { pid: 14, ppid: 10, exe: '/usr/bin/fish' },
      { pid: 15, ppid: 1, exe: '/usr/bin/node' },
      { pid: 16, ppid: 12, exe: '' },
    ]
    expect(descendantNonShellPids(10, processes).sort((a, b) => a - b)).toEqual([12, 13])
    expect(descendantNonShellPids(10, processes).includes(10)).toBe(false)
    expect(descendantNonShellPids(10, processes).includes(15)).toBe(false)
  })

  it('treats the shell, recorded pids, and current non-shell descendants as attachable', () => {
    const processes: ProcessRelative[] = [
      { pid: 10, ppid: 1, exe: '/bin/bash' },
      { pid: 12, ppid: 10, exe: '/usr/bin/node' },
      { pid: 13, ppid: 10, exe: '/usr/bin/python3' },
    ]
    expect(pidMatchesLaunchSession(10, 10, [], processes)).toBe(true)
    expect(pidMatchesLaunchSession(12, 10, [], processes)).toBe(true)
    expect(pidMatchesLaunchSession(99, 10, [99], processes)).toBe(true)
    expect(pidMatchesLaunchSession(15, 10, [], processes)).toBe(false)
    expect(pidMatchesLaunchSession(11, 10, [], [
      { pid: 10, ppid: 1, exe: '/bin/bash' },
      { pid: 11, ppid: 10, exe: '/bin/bash' },
    ])).toBe(false)
  })

  it('parses relative listings and /proc stat parent ids', () => {
    expect(parseProcessRelatives([
      '10\t1\t/bin/bash',
      '12\t10\t/usr/bin/node',
      '0\t1\t/bin/true',
      '13\t10\t',
      'bad\t1\t/bin/true',
      '',
    ].join('\n'))).toEqual([
      { pid: 10, ppid: 1, exe: '/bin/bash' },
      { pid: 12, ppid: 10, exe: '/usr/bin/node' },
    ])
    expect(parseProcStatPpid('123 (some name) S 45 123 123 0 0')).toBe(45)
    expect(parseProcStatPpid('no-paren 1 2')).toBeUndefined()
  })
})
