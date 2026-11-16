/**
 * Pure option builder for the `/console` popupSelect contribution.
 * Filters to started Consoles and marks the unique model-active target.
 */
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ConsoleBinding } from '../types.ts'

/** Tab-light green: the unique Console the model should type into. */
export const CONSOLE_SWATCH_ACTIVE = '#30f064'

/** Tab-light orange: a process has started, but this is not the model-active target. */
export const CONSOLE_SWATCH_READY = '#ffb000'

/** Localized strings the `/console` option rows need. */
export interface ConsoleCommandLabels {
  /** Type label placed before the process id, e.g. "Console". */
  readonly typeLabel: string
  /** Detail for the unique model-active (green) Console. */
  readonly activeDetail: string
  /** Detail for a started but not model-active (orange) Console. */
  readonly readyDetail: string
}

/**
 * Build popup rows for started Consoles. Idle (red) bindings are omitted.
 * @param bindings - Console bindings for the current session.
 * @param labels - Localized type label and status detail.
 * @returns ready and active options, in the given order, with tab-light colors.
 */
export function consoleCommandOptions(
  bindings: readonly ConsoleBinding[],
  labels: ConsoleCommandLabels,
): SelectOption[] {
  const options: SelectOption[] = []
  for (const binding of bindings) {
    if (binding.status !== 'ready' && binding.status !== 'active') continue
    const isActive = binding.status === 'active'
    options.push({
      id: String(binding.pid),
      label: `${labels.typeLabel} ${String(binding.pid)}`,
      swatch: isActive ? CONSOLE_SWATCH_ACTIVE : CONSOLE_SWATCH_READY,
      detail: isActive ? labels.activeDetail : labels.readyDetail,
      ...(isActive ? { active: true } : {}),
    })
  }
  return options
}
