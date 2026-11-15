/**
 * Parse process listings, normalize executable paths for the workspace file tree, and keep one Console per process.
 * @module @deepseek-ai/dsh-program-console/process-list
 */

import type { ConsoleBinding, ConsoleOpenResult, ListedProcess, ProcessGroup } from './types.ts'

const ADDRESS_PREFIX = 'dsh-resource://program-console/'

const SHELL_WRAPPERS = new Set([
  'bash', 'sh', 'dash', 'zsh', 'cmd', 'cmd.exe', 'powershell.exe', 'pwsh.exe',
])

/**
 * Identity of one process: pid plus the start time from the platform command.
 * @param pid - Operating-system process id.
 * @param start - Start time text from the platform command.
 * @returns the binding key.
 */
export function processKey(pid: number, start: string): string {
  return `${String(pid)}\n${start}`
}

/**
 * Address of the Console tab for one process.
 * @param key - Binding key from {@link processKey}.
 * @returns a resource address the sidebar opens once per process.
 */
export function consoleAddress(key: string): string {
  return ADDRESS_PREFIX + encodeURIComponent(key)
}

/**
 * Read a process key back from a Console address.
 * @param address - Sidebar resource address.
 * @returns the key, or undefined when the address is not one process.
 */
export function keyFromAddress(address: string): string | undefined {
  if (!address.startsWith(ADDRESS_PREFIX)) return undefined
  let key: string
  try {
    key = decodeURIComponent(address.slice(ADDRESS_PREFIX.length))
  } catch (error: unknown) {
    // A broken percent-escape is not a process address.
    void error
    return undefined
  }
  const newline = key.indexOf('\n')
  if (newline <= 0 || newline !== key.lastIndexOf('\n') || newline === key.length - 1) return undefined
  const pid = key.slice(0, newline)
  const start = key.slice(newline + 1)
  if (!/^\d+$/.test(pid) || start.length === 0) return undefined
  return key
}

/**
 * Parse one listing from the Linux or Windows enumeration command.
 * Rows with an empty path, a bad pid, or a missing start time are omitted.
 * @param text - Stdout of the enumeration command.
 * @returns the processes that resolved to an executable.
 */
export function parseProcessLines(text: string): ListedProcess[] {
  const processes: ListedProcess[] = []
  for (const line of text.split('\n')) {
    const parsed = parseProcessLine(line.trim())
    if (parsed !== undefined) processes.push(parsed)
  }
  return processes
}

function parseProcessLine(line: string): ListedProcess | undefined {
  if (line.length === 0) return undefined
  const parts = line.split('\t')
  const pidText = parts[0]
  const start = parts[1]
  const exe = parts[2]
  if (pidText === undefined || start === undefined || exe === undefined) return undefined
  if (start.length === 0 || exe.length === 0) return undefined
  const pid = Number(pidText)
  if (!Number.isSafeInteger(pid) || pid <= 0 || String(pid) !== pidText) return undefined
  const commandLine = parts.slice(3).join('\t').trim()
  return { pid, start, exe, commandLine: commandLine.length > 0 ? commandLine : pidText }
}

/** One executable path, using `/` so the workspace file tree can split it. */
export interface ProgramPathEntry {
  /** Full path. Intermediate directories are not entries. */
  readonly path: string
  /** Final segment, drawn as the row name. */
  readonly name: string
}

/**
 * Turn one executable path into a workspace-file-tree key.
 * `\` becomes `/`, repeated separators collapse, and a trailing separator is dropped.
 * @param exe - Resolved executable path.
 * @returns the path and its final segment, or undefined when the path has no file name.
 */
function treePath(exe: string): ProgramPathEntry | undefined {
  const unified = exe.replaceAll('\\', '/').replaceAll(/\/+/g, '/')
  const path = unified.length > 1 && unified.endsWith('/') ? unified.slice(0, -1) : unified
  if (path.length === 0 || path === '/') return undefined
  const slash = path.lastIndexOf('/')
  return { path, name: slash < 0 ? path : path.slice(slash + 1) }
}

/**
 * Normalize executable paths for the workspace file tree and keep the processes on each path.
 * A path that is also a prefix of a deeper executable stays an entry.
 * The tree draws that row as a directory, and the row still lists its processes.
 * @param processes - Processes with readable executable paths.
 * @returns entries in first-seen order, and the processes for each path. A path with no file name is omitted.
 */
export function programPaths(processes: readonly ListedProcess[]): {
  readonly entries: readonly ProgramPathEntry[]
  readonly byPath: ReadonlyMap<string, readonly ListedProcess[]>
} {
  const byPath = new Map<string, ListedProcess[]>()
  const entries: ProgramPathEntry[] = []
  for (const entry of processes) {
    const path = treePath(entry.exe)
    if (path === undefined) continue
    const list = byPath.get(path.path)
    if (list === undefined) {
      byPath.set(path.path, [entry])
      entries.push(path)
    } else list.push(entry)
  }
  return { entries, byPath }
}

/**
 * Group listed processes by executable path. A path appears only when at least one process resolved to it.
 * @param processes - Processes with readable executable paths.
 * @returns groups in first-seen path order.
 */
export function groupByExe(processes: readonly ListedProcess[]): ProcessGroup[] {
  const groups = new Map<string, ListedProcess[]>()
  for (const entry of processes) {
    const list = groups.get(entry.exe)
    if (list === undefined) groups.set(entry.exe, [entry])
    else list.push(entry)
  }
  return [...groups.entries()].map(([exe, items]) => ({ exe, processes: items }))
}

/**
 * Drop quotes and collapse whitespace so a shell command matches `/proc` cmdline text.
 * @param command - A launch command or a process command line.
 * @returns the comparable text.
 */
export function normalizeCommand(command: string): string {
  return command.replaceAll(/["']/g, '').replaceAll(/\s+/g, ' ').trim()
}

/**
 * Read the `command` argument of a bash or pwsh tool call.
 * @param name - Tool name.
 * @param args - Parsed tool arguments.
 * @returns the command string, or undefined when this call is not a shell command.
 */
export function shellCommand(name: string, args: unknown): string | undefined {
  if (name !== 'bash' && name !== 'pwsh') return undefined
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  const command = args.command
  return typeof command === 'string' ? command : undefined
}

/**
 * Pick the process a launch just created.
 * Shell wrappers are skipped when a matching program is present, so `bash -c` does not take the Console.
 * @param before - Processes visible before the launch.
 * @param after - Processes visible after the launch.
 * @param command - The command the user or the skill asked to run.
 * @returns the new program, or undefined when none of the new processes match.
 */
export function chooseLaunched(
  before: readonly ListedProcess[],
  after: readonly ListedProcess[],
  command: string,
): ListedProcess | undefined {
  const seen = new Set(before.map(entry => processKey(entry.pid, entry.start)))
  const needle = normalizeCommand(command)
  if (needle.length === 0) return undefined
  const matched = after.filter(entry =>
    !seen.has(processKey(entry.pid, entry.start)) && normalizeCommand(entry.commandLine).includes(needle))
  return matched.find(entry => !SHELL_WRAPPERS.has(fileName(entry.exe).toLowerCase()))
}

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
}

/**
 * Focus the Console already bound to a process, or create the only one.
 * @param bindings - Consoles keyed by {@link processKey}.
 * @param sessionId - Session asking for the Console.
 * @param entry - The target process.
 * @param now - Creation time in milliseconds since the Unix epoch.
 * @returns the existing or new Console. `created` is false when one was already bound.
 */
export function ensureConsole(
  bindings: Map<string, ConsoleBinding>,
  sessionId: string,
  entry: ListedProcess,
  now: number,
): ConsoleOpenResult {
  const key = processKey(entry.pid, entry.start)
  const existing = bindings.get(key)
  if (existing !== undefined) return { binding: existing, created: false }
  const binding: ConsoleBinding = {
    key,
    pid: entry.pid,
    start: entry.start,
    exe: entry.exe,
    commandLine: entry.commandLine,
    sessionId,
    createdAt: now,
  }
  bindings.set(key, binding)
  return { binding, created: true }
}
