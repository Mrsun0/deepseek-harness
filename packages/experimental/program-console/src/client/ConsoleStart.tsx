/** Fallback body when the Console guide type is opened as a page: start a bound Console and replace this tab. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { consoleAddress } from '../process-list.ts'
import type { ConsoleOpenResult } from '../types.ts'
import type {} from './locales.ts'
import css from './ConsoleStart.module.css'

/** Host callback that spawns a user shell and binds a Console to it. */
export interface ConsoleStartInjected {
  /** @returns the new Console binding once the shell is attached. */
  readonly openUserConsole: () => Promise<ConsoleOpenResult>
}

type StartProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'programConsole'>
  & InjectFace<ConsoleStartInjected>

/**
 * Start a user Console as soon as this page mounts, then replace the tab.
 * Used when the guide type is opened without the custom guide entry, for
 * example from the guide More menu.
 * @param props - Copy, tab actions, and the host start callback.
 * @returns a short pending or error message.
 */
export function ConsoleStart({ t, useTabInfo, openUserConsole }: StartProps): ReactNode {
  const { tab } = useTabInfo()
  const actionsRef = useRef(tab.actions)
  actionsRef.current = tab.actions
  const [error, setError] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(undefined)
    void openUserConsole().then((result) => {
      if (cancelled) return
      actionsRef.current.openResource(consoleAddress(result.binding.key), { replaceTab: true })
      actionsRef.current.close()
    }, (cause: unknown) => {
      void cause
      if (!cancelled) setError(t('guide.failed'))
    })
    return () => { cancelled = true }
  }, [openUserConsole, attempt, t])

  return (
    <section className={css.page} data-program-console="start">
      {error === undefined
        ? <p className={css.status}>{t('guide.opening')}</p>
        : (
          <p className={css.alert} role="alert">
            {error}
            {' '}
            <button type="button" className={css.retry} onClick={() => { setAttempt(value => value + 1) }}>
              {t('guide.retry')}
            </button>
          </p>
        )}
    </section>
  )
}
