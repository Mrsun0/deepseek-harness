/**
 * Argument vectors for process enumeration and for launching a command.
 * @module @deepseek-ai/dsh-program-console/argv
 */

/**
 * Linux enumeration. `readlink -f` is the executable, `/proc/<pid>/stat` field 22 is the start time,
 * and `tr` reads the command line. A row that fails either read is skipped.
 */
export const LINUX_ENUMERATE_SCRIPT = `
for d in /proc/[0-9]*; do
  pid=\${d#/proc/}
  exe=$(readlink -f "$d/exe" 2>/dev/null) || continue
  [ -n "$exe" ] || continue
  start=$(awk '{print $22}' "$d/stat" 2>/dev/null) || continue
  [ -n "$start" ] || continue
  command=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null || true)
  printf '%s\\t%s\\t%s\\t%s\\n' "$pid" "$start" "$exe" "$command"
done
`.trim()

/**
 * Windows enumeration. `Win32_Process.ExecutablePath` is the executable and `CreationDate` is the start time.
 * Rows with an empty path are omitted. `CommandLine` is the process-row text.
 */
export const WINDOWS_ENUMERATE_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Get-CimInstance Win32_Process |',
  '  Where-Object { $_.ExecutablePath } |',
  '  ForEach-Object { "{0}`t{1:o}`t{2}`t{3}" -f $_.ProcessId, $_.CreationDate.ToUniversalTime(), $_.ExecutablePath, $_.CommandLine }',
].join('\n')

/**
 * Arguments that run the platform enumeration command.
 * @param platform - `process.platform` of the host.
 * @returns the argv passed to `subprocess.spawn`.
 */
export function enumerateArgv(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') {
    return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ENUMERATE_SCRIPT]
  }
  return ['bash', '-c', LINUX_ENUMERATE_SCRIPT]
}

/**
 * Arguments that run one user command through the system shell.
 * Windows uses `cmd.exe /d /s /c`. Linux uses `bash -c`, the same form as bash-local.
 * Used as the argv of a `launch()` PTY and of any ordinary child process.
 * @param platform - `process.platform` of the host.
 * @param command - The full command from the dialog, the launch tool, or the skill.
 * @returns the argv passed to `subprocess.spawnTerminal` or `subprocess.spawn`.
 */
export function launchArgv(platform: NodeJS.Platform, command: string): readonly string[] {
  if (platform === 'win32') return ['cmd.exe', '/d', '/s', '/c', command]
  return ['bash', '-c', command]
}

/**
 * Arguments that start an interactive shell in a user Console.
 * Unix uses `$SHELL` or `/bin/bash`. Windows uses `%ComSpec%` or `cmd.exe`.
 * @param platform - `process.platform` of the host.
 * @param env - Process environment providing `SHELL` or `ComSpec`.
 * @returns the argv passed to `subprocess.spawnTerminal`.
 */
export function launchTerminalArgv(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (platform === 'win32') {
    const shell = env.ComSpec?.trim() || 'cmd.exe'
    const name = fileName(shell).toLowerCase()
    if (name === 'powershell' || name === 'powershell.exe' || name === 'pwsh' || name === 'pwsh.exe') {
      return [shell, '-NoLogo']
    }
    return [shell]
  }
  return [env.SHELL?.trim() || '/bin/bash', '-i']
}

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
}
