/** Guide entry that starts a bound Console instead of opening the guide type as a page. */
import { useState, type ReactNode } from 'react'
import { PluginArtworkTerminal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { consoleAddress } from '../process-list.ts'
import type { ConsoleOpenResult } from '../types.ts'
import type {} from './locales.ts'
import css from './ConsoleGuide.module.css'

/** Host callback that spawns a user shell and binds a Console to it. */
export interface ConsoleGuideInjected {
  /** @returns the new Console binding once the shell is attached. */
  readonly openUserConsole: () => Promise<ConsoleOpenResult>
}

/** Guide-entry props: copy, the enclosing tab, and the host start callback. */
export type ConsoleGuideProps =
  & PropsRuntime<'sidebar.right.tab.guide.entry'>
  & PropsLocale<'programConsole'>
  & InjectFace<ConsoleGuideInjected>

/**
 * Open a bound Console from the guide card. The host starts a new PTY shell
 * first; the process tab replaces this guide so the browse page never appears.
 * @param props - Guide copy, tab actions, and the host start callback.
 * @returns the Console guide capsule.
 */
export function ConsoleGuide({
  title, description, kind, t, useTabInfo, openUserConsole,
}: ConsoleGuideProps): ReactNode {
  const { tab } = useTabInfo()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const label = error ?? (pending ? t('guide.opening') : description)
  const aria = label === undefined ? title : `${title} ${label}`

  const start = (): void => {
    if (pending) return
    setPending(true)
    setError(undefined)
    void openUserConsole().then((result) => {
      tab.actions.openResource(consoleAddress(result.binding.key), { replaceTab: true })
      tab.actions.close()
    }, (cause: unknown) => {
      void cause
      setError(t('guide.failed'))
    }).finally(() => {
      setPending(false)
    })
  }

  return (
    <button
      type="button"
      className={css.entry}
      data-sidebar-right-guide-entry={kind}
      data-program-console="guide"
      aria-label={aria}
      aria-busy={pending}
      disabled={pending}
      onClick={start}
    >
      <span className={css.icon} aria-hidden="true">
        <PluginArtworkTerminal size={description === undefined && error === undefined && !pending ? 22 : 26} />
      </span>
      <span className={css.text}>
        <span className={css.title} aria-hidden="true">{title}</span>
        {label !== undefined && (
          <span className={error === undefined ? css.description : css.alert} aria-hidden="true">{label}</span>
        )}
      </span>
    </button>
  )
}
