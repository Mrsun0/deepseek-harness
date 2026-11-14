/**
 * Open a sidebar Console for a binding created while its session is on screen.
 * @module @deepseek-ai/dsh-program-console/client/watch
 */

import type { ConsoleBinding } from '../types.ts'

/** How long a newly created Console stays eligible for automatic open. */
export const RECENT_CONSOLE_MS = 10_000

/** Debounce between session updates and a console list pull. */
export const CONSOLE_WATCH_DELAY_MS = 300

/** Host calls the watcher uses. The component only starts and stops it. */
export interface ConsoleWatch {
  /** @returns the consoles currently bound on the host. */
  readonly consoles: () => Promise<readonly ConsoleBinding[]>
  /** Open the sidebar tab for one new binding. */
  readonly open: (binding: ConsoleBinding) => void
  /**
   * Listen for session updates.
   * @param listener - called when the session may have a new Console.
   * @returns the unsubscribe function.
   */
  readonly subscribe: (listener: () => void) => () => void
  /** Clock for the recent-binding window. Defaults to `Date.now`. */
  readonly now?: () => number
}

/**
 * Open each Console created for this session during the watch, and ignore older ones.
 * @param sessionId - Session whose new Consoles should appear.
 * @param watch - List, open, and session subscription.
 * @returns a stop function that drops a pending pull.
 */
export function watchConsoles(sessionId: string, watch: ConsoleWatch): () => void {
  const seen = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const pull = (): void => {
    watch.consoles().then((records) => {
      if (stopped) return
      const now = watch.now?.() ?? Date.now()
      for (const record of records) {
        if (record.sessionId !== sessionId || seen.has(record.key)) continue
        seen.add(record.key)
        if (now - record.createdAt <= RECENT_CONSOLE_MS) watch.open(record)
      }
    }, (error: unknown) => {
      // A failed list leaves the sidebar unchanged; the next session update tries again.
      void error
    })
  }
  const schedule = (): void => {
    if (stopped || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      pull()
    }, CONSOLE_WATCH_DELAY_MS)
  }
  const unsubscribe = watch.subscribe(schedule)
  schedule()
  return () => {
    stopped = true
    unsubscribe()
    if (timer !== undefined) clearTimeout(timer)
  }
}
