/**
 * Process rows and Console bindings for the program console.
 * @module @deepseek-ai/dsh-program-console/types
 */

/** One process whose executable path the platform command could read. */
export interface ListedProcess {
  /** Operating-system process id. */
  readonly pid: number
  /** Start time from the platform command, paired with `pid` so a reused id is a new process. */
  readonly start: string
  /** Resolved executable path. */
  readonly exe: string
  /** Command line when the platform command could read it; otherwise the pid text. */
  readonly commandLine: string
}

/** Processes that share one resolved executable path. */
export interface ProcessGroup {
  /** Resolved executable path. */
  readonly exe: string
  /** Processes that resolved to `exe`. */
  readonly processes: readonly ListedProcess[]
}

/** One Console bound to one process. */
export interface ConsoleBinding {
  /** `pid` and `start` joined by a newline. */
  readonly key: string
  /** Operating-system process id. */
  readonly pid: number
  /** Start time captured when the Console was bound. */
  readonly start: string
  /** Resolved executable path. */
  readonly exe: string
  /** Command line captured when the Console was bound. */
  readonly commandLine: string
  /** Session that created the Console. Later sessions focus this binding and do not create another. */
  readonly sessionId: string
  /** Milliseconds since the Unix epoch when the Console was created. */
  readonly createdAt: number
}

/** Result of focusing an existing Console or creating the only one for a process. */
export interface ConsoleOpenResult {
  /** The Console for the process. */
  readonly binding: ConsoleBinding
  /** True when this call created the Console. */
  readonly created: boolean
}
