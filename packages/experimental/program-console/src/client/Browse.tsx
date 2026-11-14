/** File tree of executable paths, with one extra process level on each file. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  FileTypeIcon,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fileTree, type ProgramTreeNode } from '../process-list.ts'
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

/** Directory paths that are open, and file paths whose process list is open. */
interface TreeExpansion {
  readonly directories: ReadonlySet<string>
  readonly processes: ReadonlySet<string>
  readonly toggleDirectory: (path: string) => void
  readonly toggleProcesses: (path: string) => void
  readonly openProcess: ProgramBrowseProps['openProcess']
  readonly onTaken: (taken: boolean) => void
  readonly t: ProgramBrowseProps['t']
}

/**
 * Flip one path in an expansion set.
 * @param current - Paths that are open.
 * @param path - Path to open or close.
 * @returns the next set.
 */
function toggled(current: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

/**
 * Render one directory level.
 * @param props - Nodes and the shared expansion state.
 * @returns the list for this parent.
 */
function TreeLevel({ nodes, tree }: { readonly nodes: readonly ProgramTreeNode[]; readonly tree: TreeExpansion }): ReactNode {
  return (
    <ul className={css.level}>
      {nodes.map(node => <TreeRow key={node.path} node={node} tree={tree} />)}
    </ul>
  )
}

/**
 * Render one directory or file, and its process window when that file is open.
 * @param props - The node and the shared expansion state.
 * @returns the row and any open children.
 */
function TreeRow({ node, tree }: { readonly node: ProgramTreeNode; readonly tree: TreeExpansion }): ReactNode {
  const directory = node.children.length > 0
  const hasProcesses = node.processes.length > 0
  const directoryOpen = tree.directories.has(node.path)
  const processesOpen = tree.processes.has(node.path)
  let icon: ReactNode
  if (!directory) icon = <FileTypeIcon kind={classifyFileType(node.name)} size={16} className={css.fileIcon} />
  else if (directoryOpen) icon = <IconFolderOpenRegular className={css.icon} />
  else icon = <IconFolderCloseRegular className={css.icon} />
  return (
    <li className={css.item} data-program-console-path={node.path}>
      <div className={css.row}>
        <button
          type="button"
          className={css.action}
          aria-expanded={directory ? directoryOpen : processesOpen}
          onClick={() => {
            if (directory) tree.toggleDirectory(node.path)
            else tree.toggleProcesses(node.path)
          }}
        >
          {icon}
          <span className={css.name}>{node.name}</span>
        </button>
        {hasProcesses && (
          <button
            type="button"
            className={css.chevron}
            aria-expanded={processesOpen}
            aria-label={tree.t(processesOpen ? 'browse.collapseProcesses' : 'browse.expandProcesses')}
            onClick={() => { tree.toggleProcesses(node.path) }}
          >
            {processesOpen ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
          </button>
        )}
      </div>
      {directory && directoryOpen && <TreeLevel nodes={node.children} tree={tree} />}
      {processesOpen && (
        <div className={css.processWindow} data-program-console="processes">
          {node.processes.map(entry => (
            <button
              key={`${String(entry.pid)}:${entry.start}`}
              type="button"
              className={css.process}
              onClick={() => {
                void tree.openProcess(entry.pid, entry.start).then((outcome) => { tree.onTaken(outcome === 'taken') })
              }}
            >
              {entry.commandLine}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

/**
 * Render the program tree and the new-command dialog.
 * @param props - Copy and host callbacks.
 * @returns the browse page.
 */
export function ProgramBrowse({ t, list, launch, openProcess }: ProgramBrowseProps): ReactNode {
  const [nonce, setNonce] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [roots, setRoots] = useState<readonly ProgramTreeNode[]>([])
  const [directories, setDirectories] = useState<ReadonlySet<string>>(new Set())
  const [processes, setProcesses] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState(false)
  const [command, setCommand] = useState('')
  const [dialogError, setDialogError] = useState<string | undefined>(undefined)
  const [taken, setTaken] = useState(false)

  useEffect(() => {
    let live = true
    setStatus('loading')
    list().then((rows) => {
      if (!live) return
      setRoots(fileTree(rows))
      setStatus('ready')
    }, (error: unknown) => {
      // The page reports the failure; the list can be requested again.
      void error
      if (!live) return
      setStatus('failed')
    })
    return () => { live = false }
  }, [list, nonce])

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

  const tree: TreeExpansion = {
    directories,
    processes,
    toggleDirectory: (path) => { setDirectories(current => toggled(current, path)) },
    toggleProcesses: (path) => { setProcesses(current => toggled(current, path)) },
    openProcess,
    onTaken: setTaken,
    t,
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
      {status === 'ready' && roots.length === 0 && <p>{t('browse.empty')}</p>}
      {status === 'ready' && roots.length > 0 && (
        <div className={css.tree}>
          <TreeLevel nodes={roots} tree={tree} />
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
