import { describe, expect, it } from 'vitest'
import { enumerateArgv, launchArgv, launchTerminalArgv, LINUX_ENUMERATE_SCRIPT, WINDOWS_ENUMERATE_SCRIPT } from '../src/argv.ts'

describe('program console argv', () => {
  it('enumerates with the Linux proc commands and launches through bash -c', () => {
    expect(LINUX_ENUMERATE_SCRIPT).toContain('readlink -f "$d/exe"')
    expect(LINUX_ENUMERATE_SCRIPT).toContain("awk '{print $22}'")
    expect(LINUX_ENUMERATE_SCRIPT).toContain("tr '\\0' ' '")
    expect(enumerateArgv('linux')).toEqual(['bash', '-c', LINUX_ENUMERATE_SCRIPT])
    expect(launchArgv('linux', 'sleep 30')).toEqual(['bash', '-c', 'sleep 30'])
  })

  it('enumerates with Win32_Process and launches through cmd.exe', () => {
    expect(WINDOWS_ENUMERATE_SCRIPT).toContain('Get-CimInstance Win32_Process')
    expect(WINDOWS_ENUMERATE_SCRIPT).toContain('$_.ExecutablePath')
    expect(WINDOWS_ENUMERATE_SCRIPT).toContain('$_.CreationDate.ToUniversalTime()')
    expect(WINDOWS_ENUMERATE_SCRIPT).toContain('$_.CommandLine')
    expect(enumerateArgv('win32')[0]).toBe('powershell.exe')
    expect(enumerateArgv('win32').at(-1)).toBe(WINDOWS_ENUMERATE_SCRIPT)
    expect(launchArgv('win32', 'ping -n 30 127.0.0.1')).toEqual(['cmd.exe', '/d', '/s', '/c', 'ping -n 30 127.0.0.1'])
  })

  it('starts the launch terminal with the default interactive shell', () => {
    expect(launchTerminalArgv('linux', {})).toEqual(['/bin/bash', '-i'])
    expect(launchTerminalArgv('linux', { SHELL: '/bin/zsh' })).toEqual(['/bin/zsh', '-i'])
    expect(launchTerminalArgv('win32', {})).toEqual(['cmd.exe'])
    expect(launchTerminalArgv('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual(['C:\\Windows\\System32\\cmd.exe'])
    expect(launchTerminalArgv('win32', { ComSpec: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' })).toEqual([
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      '-NoLogo',
    ])
  })
})
