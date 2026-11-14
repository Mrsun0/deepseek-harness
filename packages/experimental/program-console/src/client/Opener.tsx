/** Watch Consoles while a session header is displayed. */
import { useEffect, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The plugin owns the watch. The component ties it to the displayed session. */
export interface ConsoleOpenerInjected {
  /** @returns the release of this session's console watch. */
  readonly watchConsoles: () => () => void
}

/**
 * Start the console watch while the session header is mounted.
 * @param props - Header lifetime and the watch owned by the plugin.
 * @returns nothing. The effect is the component.
 */
export function ConsoleOpener({ watchConsoles }: PropsRuntime<'conversation.session.header.actions'> & ConsoleOpenerInjected): ReactNode {
  useEffect(() => watchConsoles(), [watchConsoles])
  return null
}
