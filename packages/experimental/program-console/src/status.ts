/**
 * Console activity status, unique active-target transitions, and model context text.
 * @module @deepseek-ai/dsh-program-console/status
 */

import { isSystemShell } from './terminal-descendants.ts'
import type { ConsoleBinding, ConsoleStatus } from './types.ts'

/** Runtime-context order after SUBAGENT_DELEGATION (120) and before HARNESS_SOURCE (200). */
export const PROGRAM_CONSOLE_CONTEXT_ORDER = 130

/** Name of the program-console runtime-context contribution. */
export const PROGRAM_CONSOLE_CONTEXT_NAME = 'program-console:status'

/** How often the host re-reads descendants to detect a process start or exit. */
export const STATUS_POLL_MS = 750

/** Delay after PTY output before a status refresh. */
export const STATUS_OUTPUT_DEBOUNCE_MS = 150

/** One Console used when computing the next unique active target. */
export interface ActiveCandidate {
  /** Binding key (`pid` and `start`). */
  readonly key: string
  /** True when a non-shell process is running in this Console. */
  readonly started: boolean
  /** Milliseconds since the Unix epoch when the Console was created. */
  readonly createdAt: number
}

/**
 * Whether a bound Console has a started non-shell process the model can type into.
 * A user-opened shell is started only when it has a non-shell descendant.
 * A `launch()` binding is started when it is attachable and the bound process is not a system shell,
 * including when that process is the session's top-level process.
 * A Console that is not attachable is never started.
 * @param input - Attachability, the bound executable, and the live session's descendants.
 * @returns true when a non-shell process has been started in this Console.
 */
export function consoleHasStartedProcess(input: {
  readonly attachable: boolean
  readonly exe: string
  readonly pid: number
  readonly shellPid: number | undefined
  readonly nonShellDescendants: readonly number[]
}): boolean {
  if (!input.attachable) return false
  if (input.shellPid !== undefined && input.pid === input.shellPid) {
    if (isSystemShell(input.exe)) return input.nonShellDescendants.length > 0
    return true
  }
  return !isSystemShell(input.exe)
}

/**
 * Choose the unique model-active Console after a status refresh.
 * A Console that newly starts a process becomes the active target.
 * If several start in the same refresh, the latest `createdAt` wins, then the binding key.
 * If the previous active Console is no longer started, the active target is cleared
 * rather than promoting another ready Console.
 * @param input - Previous started keys, the current started set, and the current active key.
 * @returns the binding key to treat as active, or undefined when none should be green.
 */
export function nextActiveKey(input: {
  readonly previousStarted: ReadonlySet<string>
  readonly current: readonly ActiveCandidate[]
  readonly activeKey: string | undefined
}): string | undefined {
  const newly = input.current
    .filter(entry => entry.started && !input.previousStarted.has(entry.key))
    .sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key))
  const latest = newly[newly.length - 1]
  if (latest !== undefined) return latest.key
  if (input.activeKey !== undefined && input.current.some(entry => entry.started && entry.key === input.activeKey)) {
    return input.activeKey
  }
  return undefined
}

/**
 * Map a started flag and the unique active key onto a Console status.
 * @param started - True when a non-shell process is running in this Console.
 * @param active - True when this Console is the unique model-active target.
 * @returns `idle`, `ready`, or `active`.
 */
export function statusFromFlags(started: boolean, active: boolean): ConsoleStatus {
  if (!started) return 'idle'
  return active ? 'active' : 'ready'
}

/**
 * A Console row for {@link formatConsoleContext}, with an optional running program.
 */
export interface ConsoleContextRow extends ConsoleBinding {
  /** Short name of the non-shell program running in this Console, when known. */
  readonly running?: string
}

/**
 * Short label for the non-shell program running in a Console, when one is known.
 * Prefers current non-shell descendant executables; otherwise a non-shell bound
 * command line or executable name. A shell-only Console has no label.
 * @param input - Bound executable, bound command line, and descendant executables.
 * @returns a short program name, or undefined when only a system shell is present.
 */
export function consoleRunningLabel(input: {
  readonly exe: string
  readonly commandLine: string
  readonly nonShellDescendantExes: readonly string[]
}): string | undefined {
  const names: string[] = []
  const seen = new Set<string>()
  for (const exe of input.nonShellDescendantExes) {
    const name = executableBaseName(exe)
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (names.length > 0) return names.join(', ')
  if (isSystemShell(input.exe)) return undefined
  const line = input.commandLine.trim()
  if (line !== '' && line.length <= 80) return line
  const base = executableBaseName(input.exe)
  return base === '' ? undefined : base
}

function executableBaseName(exe: string): string {
  const trimmed = exe.replaceAll('\\', '/').split('/').pop() ?? ''
  return trimmed.replace(/\.exe$/i, '')
}

/**
 * Build the runtime-context text that lists Console ids, states, and the active target.
 * @param bindings - Consoles in the calling session, already annotated with `status`.
 * @returns the context paragraph, or an empty string when the session has no Consoles.
 */
export function formatConsoleContext(bindings: readonly ConsoleContextRow[]): string {
  if (bindings.length === 0) return ''
  const lines: string[] = [
    'Program consoles in this session. Each id is the process id shown on the Console tab. Use that id with program_console_write and program_console_select. Only the Console ids listed here exist in this session; ignore process ids from earlier turns that are not listed. Do not use bash, ps, or pwsh to find, inspect, or type into Consoles.',
  ]
  const ordered = [...bindings].sort((left, right) => left.pid - right.pid || left.key.localeCompare(right.key))
  for (const binding of ordered) {
    const running = binding.running !== undefined && binding.running !== '' ? `; running ${binding.running}` : ''
    lines.push(`- Console ${String(binding.pid)}: ${statusContextLabel(binding.status)}${running}`)
  }
  const active = bindings.find(binding => binding.status === 'active')
  if (active !== undefined) {
    lines.push(
      `The active Console id is ${String(active.pid)}. Type into it with program_console_write. If it already has a program, do not call program_console_launch to start a duplicate. After the user starts a process in a Console or picks one with /console, the active id in this list is the target to use. When several Consoles exist or the user asks to use another one, call program_console_select with that Console's process id first.`,
    )
  } else {
    lines.push(
      'There is no active (green) Console. Start a process in a Console, or call program_console_select on a ready (orange) Console, then type into that id with program_console_write.',
    )
  }
  return lines.join('\n')
}

function statusContextLabel(status: ConsoleStatus): string {
  if (status === 'active') return 'active (green) — unique target the model should type into'
  if (status === 'ready') return 'ready (orange) — a process has started; not currently the model-active target'
  return 'idle (red) — no process has been started yet, or this Console is not attachable'
}
