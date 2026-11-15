/** One process Console. Launch does not keep a terminal, so the page does not accept further input. */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { keyFromAddress } from '../process-list.ts'
import css from './ConsolePane.module.css'

type PaneProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'programConsole'>

/**
 * Render the process bound to this tab, or a notice when the address is not a process.
 * @param props - Tab address and copy.
 * @returns the console page.
 */
export function ConsolePane({ useTabInfo, t }: PaneProps): ReactNode {
  return <ConsoleBody address={useTabInfo().tab.navigation.address} t={t} />
}

/**
 * Render the chip title for a process Console.
 * @param props - Tab address and copy.
 * @returns the chip text.
 */
export function ConsoleTitle({ useTabInfo, t }: PaneProps): ReactNode {
  const key = keyFromAddress(useTabInfo().tab.navigation.address)
  const pid = key === undefined ? '' : key.slice(0, key.indexOf('\n'))
  return <span>{pid.length === 0 ? t('console.chip') : `${t('console.chip')} ${pid}`}</span>
}

/**
 * Render console copy for one address.
 * @param props - Address and copy.
 * @returns the page body.
 */
export function ConsoleBody({ address, t }: { readonly address: string; readonly t: PaneProps['t'] }): ReactNode {
  const key = keyFromAddress(address)
  if (key === undefined) return <p data-program-console="missing">{t('console.missing')}</p>
  const newline = key.indexOf('\n')
  return (
    <section className={css.page} data-program-console="page">
      <p>{t('console.bound')}</p>
      <p>{t('console.pid')} {key.slice(0, newline)}</p>
      <p>{t('console.start')} {key.slice(newline + 1)}</p>
      <p>{t('console.inputUnavailable')}</p>
    </section>
  )
}
