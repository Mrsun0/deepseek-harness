/**
 * Identify non-shell descendant processes of a launch terminal.
 * @module @deepseek-ai/dsh-program-console/terminal-descendants
 */

import { readdir, readFile, readlink } from 'node:fs/promises'

/** Login and interactive shells excluded from the dismiss snapshot. */
const SYSTEM_SHELLS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
])

/** One process with a parent id and a readable executable path. */
export interface ProcessRelative {
  /** Operating-system process id. */
  readonly pid: number
  /** Parent process id. */
  readonly ppid: number
  /** Resolved executable path. */
  readonly exe: string
}

/**
 * Whether an executable is a system shell that should not be recorded on dismiss.
 * @param exe - Resolved executable path or file name.
 * @returns true for bash, sh, zsh, dash, fish, cmd, powershell, and pwsh, ignoring `.exe` and case.
 */
export function isSystemShell(exe: string): boolean {
  return SYSTEM_SHELLS.has(fileName(exe).toLowerCase())
}

/**
 * Collect descendant pids of a terminal shell whose executable is readable and is not a system shell.
 * The shell itself is never included.
 * @param rootPid - The terminal shell's process id.
 * @param processes - A process table that includes parent ids and readable executables.
 * @returns descendant pids in encounter order, without duplicates.
 */
export function descendantNonShellPids(rootPid: number, processes: readonly ProcessRelative[]): number[] {
  const children = new Map<number, ProcessRelative[]>()
  for (const entry of processes) {
    const list = children.get(entry.ppid)
    if (list === undefined) children.set(entry.ppid, [entry])
    else list.push(entry)
  }
  const found: number[] = []
  const seen = new Set<number>([rootPid])
  const stack = [...(children.get(rootPid) ?? [])]
  while (stack.length > 0) {
    const entry = stack.pop()
    if (entry === undefined) break
    if (seen.has(entry.pid)) continue
    seen.add(entry.pid)
    const nested = children.get(entry.pid)
    if (nested !== undefined) stack.push(...nested)
    if (entry.exe.length === 0 || isSystemShell(entry.exe)) continue
    found.push(entry.pid)
  }
  return found
}

/**
 * Whether a process can attach to a live launch-terminal session.
 * The session shell always matches. A pid also matches when it was recorded
 * on dismiss, or when it is a current non-shell descendant of that shell.
 * @param pid - Process id the Console is bound to.
 * @param shellPid - Top-level shell pid of the live launch-terminal handle.
 * @param recorded - Non-shell descendant pids snapshotted on dismiss.
 * @param processes - Current process table with parent ids and executables.
 * @returns true when `pid` is the shell or a current or recorded non-shell descendant.
 */
export function pidMatchesLaunchSession(
  pid: number,
  shellPid: number,
  recorded: readonly number[],
  processes: readonly ProcessRelative[],
): boolean {
  if (pid === shellPid) return true
  if (recorded.includes(pid)) return true
  return descendantNonShellPids(shellPid, processes).includes(pid)
}

/**
 * Read the parent pid from a Linux `/proc/<pid>/stat` file.
 * @param stat - The contents of the stat file.
 * @returns the parent pid, or undefined when the record cannot be parsed.
 */
export function parseProcStatPpid(stat: string): number | undefined {
  const close = stat.lastIndexOf(')')
  if (close < 0) return undefined
  const fields = stat.slice(close + 1).trim().split(/\s+/)
  const ppid = Number(fields[1])
  if (!Number.isSafeInteger(ppid) || ppid < 0) return undefined
  return ppid
}

/**
 * Parse tab-separated `pid`, `ppid`, and `exe` rows, skipping unreadable executables.
 * @param text - Listing text, one process per line.
 * @returns the processes that resolved to an executable.
 */
export function parseProcessRelatives(text: string): ProcessRelative[] {
  const processes: ProcessRelative[] = []
  for (const line of text.split('\n')) {
    const parsed = parseProcessRelative(line.trim())
    if (parsed !== undefined) processes.push(parsed)
  }
  return processes
}

/**
 * List processes with a readable executable and a parent id on this platform.
 * @param platform - `process.platform` of the host.
 * @param spawn - Runs a short-lived enumeration command on Windows.
 * @returns processes the dismiss snapshot can walk.
 */
export async function listProcessRelatives(
  platform: NodeJS.Platform,
  spawn: (argv: readonly string[]) => Promise<string>,
): Promise<ProcessRelative[]> {
  if (platform === 'win32') return parseProcessRelatives(await spawn(windowsRelativeArgv()))
  return linuxProcessRelatives()
}

/**
 * Arguments that list Windows processes with a parent id and a readable executable.
 * @returns the argv passed to `subprocess.spawn`.
 */
export function windowsRelativeArgv(): readonly string[] {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Get-CimInstance Win32_Process |',
    '  Where-Object { $_.ExecutablePath } |',
    '  ForEach-Object { "{0}`t{1}`t{2}" -f $_.ProcessId, $_.ParentProcessId, $_.ExecutablePath }',
  ].join('\n')
  return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]
}

/**
 * Walk `/proc` for processes with a readable `exe` and a parent id.
 * @param procRoot - Proc filesystem root, normally `/proc`.
 * @returns the readable process table.
 */
export async function linuxProcessRelatives(procRoot = '/proc'): Promise<ProcessRelative[]> {
  let names: string[]
  try {
    names = await readdir(procRoot)
  } catch {
    return []
  }
  const processes: ProcessRelative[] = []
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    let exe: string
    try {
      exe = await readlink(`${procRoot}/${name}/exe`)
    } catch {
      continue
    }
    if (exe.length === 0) continue
    let stat: string
    try {
      stat = await readFile(`${procRoot}/${name}/stat`, 'utf8')
    } catch {
      continue
    }
    const ppid = parseProcStatPpid(stat)
    if (ppid === undefined) continue
    processes.push({ pid, ppid, exe })
  }
  return processes
}

function parseProcessRelative(line: string): ProcessRelative | undefined {
  if (line.length === 0) return undefined
  const parts = line.split('\t')
  const pidText = parts[0]
  const ppidText = parts[1]
  const exe = parts[2]
  if (pidText === undefined || ppidText === undefined || exe === undefined || exe.length === 0) return undefined
  const pid = Number(pidText)
  const ppid = Number(ppidText)
  if (!Number.isSafeInteger(pid) || pid <= 0 || String(pid) !== pidText) return undefined
  if (!Number.isSafeInteger(ppid) || ppid < 0 || String(ppid) !== ppidText) return undefined
  return { pid, ppid, exe }
}

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
}
