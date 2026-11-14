/** Two-level program list: executable paths, then the processes that resolved to each path. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { groupByExe } from '../process-list.ts'
import type { ListedProcess } from '../types.ts'
import css from './Browse.module.css'
import type { ProgramConsoleKey } from './locales.ts'

/** Callbacks the sidebar injects. The component does not see the host context. */
export interface ProgramBrowseProps {
  /** Locale function. */
  readonly t: (key: ProgramConsoleKey) => string
  /** @returns processes with a readable executable. */
  readonly list: () => Promise<readonly ListedProcess[]>
  /**
   * Launch a command and open its Console.
   * @param command - Text from the dialog.
   */
  readonly launch: (command: string) => Promise<void>
  /**
   * Open or focus the Console for one process.
   * @param pid - Process id.
   * @param start - Start time from the listing.
   * @returns `taken` when another session already owns the Console.
   */
  readonly openProcess: (pid: number, start: string) => Promise<'opened' | 'taken'>
}

/**
 * Render the program tree and the new-command dialog.
 * @param props - Copy and host callbacks.
 * @returns the browse page.
 */
export function ProgramBrowse({ t, list, launch, openProcess }: ProgramBrowseProps): ReactNode {
  const [nonce, setNonce] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [groups, setGroups] = useState<readonly { exe: string; processes: readonly ListedProcess[] }[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState(false)
  const [command, setCommand] = useState('')
  const [dialogError, setDialogError] = useState<string | undefined>(undefined)
  const [taken, setTaken] = useState(false)

  useEffect(() => {
    let live = true
    setStatus('loading')
    list().then((rows) => {
      if (!live) return
      setGroups(groupByExe(rows))
      setStatus('ready')
    }, (error: unknown) => {
      // The page reports the failure; the list can be requested again.
      void error
      if (!live) return
      setStatus('failed')
    })
    return () => { live = false }
  }, [list, nonce])

  const toggle = (exe: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(exe)) next.delete(exe)
      else next.add(exe)
      return next
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (command.trim().length === 0) {
      setDialogError(t('browse.commandEmpty'))
      return
    }
    setDialogError(undefined)
    void launch(command).then(() => {
      setDialog(false)
      setCommand('')
    }, (error: unknown) => {
      // The command did not leave a process. The dialog stays open.
      void error
      setDialogError(t('browse.launchFailed'))
    })
  }

  return (
    <section className={css.page} data-program-console="browse">
      <div className={css.toolbar}>
        <Button onClick={() => { setDialog(true); setDialogError(undefined) }}>{t('browse.new')}</Button>
        <Button onClick={() => { setNonce(value => value + 1) }}>{t('browse.refresh')}</Button>
      </div>
      {taken && <p className={css.alert} role="alert">{t('browse.taken')}</p>}
      {status === 'loading' && <p role="status">{t('browse.loading')}</p>}
      {status === 'failed' && <p className={css.alert} role="alert">{t('browse.listFailed')}</p>}
      {status === 'ready' && groups.length === 0 && <p>{t('browse.empty')}</p>}
      {status === 'ready' && groups.length > 0 && (
        <div className={css.tree}>
          {groups.map(group => (
            <div key={group.exe}>
              <button type="button" className={css.file} aria-expanded={expanded.has(group.exe)} onClick={() => { toggle(group.exe) }}>
                {group.exe}
              </button>
              {expanded.has(group.exe) && group.processes.map(entry => (
                <button
                  key={`${String(entry.pid)}:${entry.start}`}
                  type="button"
                  className={css.process}
                  onClick={() => {
                    void openProcess(entry.pid, entry.start).then((outcome) => { setTaken(outcome === 'taken') })
                  }}
                >
                  {entry.commandLine}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {dialog && (
        <form className={css.dialog} data-program-console="dialog" onSubmit={submit}>
          <label>
            {t('browse.command')}
            <input value={command} aria-label={t('browse.command')} onChange={(event) => { setCommand(event.target.value) }} />
          </label>
          <Button type="submit">{t('browse.start')}</Button>
          <Button onClick={() => { setDialog(false) }}>{t('browse.cancel')}</Button>
          {dialogError !== undefined && <p className={css.alert} role="alert">{dialogError}</p>}
        </form>
      )}
    </section>
  )
}
