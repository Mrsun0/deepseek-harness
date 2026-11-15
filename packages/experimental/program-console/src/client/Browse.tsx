/** Executable paths drawn by the workspace file tree, with a process window on each path that has processes. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, FormEvent, PointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconChevronRightOutlineRegular, usePointerGrace } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileTreeInput, TreeEntry } from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import { programPaths, type ProgramPathEntry } from '../process-list.ts'
import type { ListedProcess } from '../types.ts'
import css from './Browse.module.css'
import type { ProgramConsoleKey } from './locales.ts'

/** Rows the process window shows before it scrolls. */
const VISIBLE_PROCESS_ROWS = 10
/** One process row, matching the window's `--program-console-row`. */
const PROCESS_ROW_HEIGHT = 32
/** Width used to keep the window's right edge on the triangle. */
const PROCESS_WINDOW_WIDTH = 280
/** Gap between the window and the viewport edge. */
const PROCESS_WINDOW_MARGIN = 8

/**
 * The workspace file tree, the only factory this page renders.
 * The sidebar passes its generic factory renderer, which accepts this call.
 */
export interface ProgramFilesTreeSlot {
  /**
   * @param name - `sidebar.files.tree`.
   * @param props - Executable entries and which directories are open.
   * @param options - The process triangle, and what to draw when the factory is absent.
   */
  (
    name: 'sidebar.files.tree',
    props: FileTreeInput,
    options?: {
      slots?: { accessory?: (props: { readonly entry: TreeEntry }) => ReactNode }
      fallback?: ReactNode
    },
  ): ReactNode
}

/** Callbacks the sidebar injects. The component does not see the host context. */
export interface ProgramBrowseProps {
  /** Locale function. */
  readonly t: (key: ProgramConsoleKey) => string
  /** Renders the workspace file tree. The files plugin registers that factory. */
  readonly renderFactorySlot: ProgramFilesTreeSlot
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

/** Process lists the file-row triangle reads. The tree factory does not carry them. */
interface ProcessMenu {
  readonly byPath: ReadonlyMap<string, readonly ListedProcess[]>
  readonly openProcess: ProgramBrowseProps['openProcess']
  readonly onTaken: (taken: boolean) => void
  readonly t: ProgramBrowseProps['t']
}

const ProcessMenuContext = createContext<ProcessMenu | undefined>(undefined)

/** The workspace file tree's root has no row. Paths are absolute under it. */
const TREE_ROOT = ''

/** A file name does not open a Console. The process window does. */
function openNothing(): void {}

/**
 * Whether the primary pointer can hover.
 * Touch pointers are ignored separately, including on a device that also has a mouse.
 * @returns true when `(hover: hover)` matches.
 */
function canHover(): boolean {
  return window.matchMedia('(hover: hover)').matches
}

/**
 * Whether the pointer or focus is still on the triangle or its window.
 * @param target - The node the pointer or focus moved to.
 * @param button - The triangle button.
 * @param panel - The open window, when it is mounted.
 * @returns true when `target` is inside either element.
 */
function pointerStillInside(target: EventTarget | null, button: HTMLElement, panel: HTMLElement | null): boolean {
  if (!(target instanceof Node)) return false
  if (button.contains(target)) return true
  return panel !== null && panel.contains(target)
}

/**
 * Place the process window against the triangle, inside the viewport.
 * @param box - The triangle's rectangle.
 * @param rows - How many processes the window lists.
 * @returns the window's fixed `top` and `left`.
 */
function windowOrigin(box: DOMRect, rows: number): { top: number; left: number } {
  const height = Math.min(rows, VISIBLE_PROCESS_ROWS) * PROCESS_ROW_HEIGHT
  const room = Math.max(PROCESS_WINDOW_MARGIN, window.innerWidth - PROCESS_WINDOW_WIDTH - PROCESS_WINDOW_MARGIN)
  const left = Math.min(Math.max(PROCESS_WINDOW_MARGIN, box.right - PROCESS_WINDOW_WIDTH), room)
  const below = box.bottom
  const above = box.top - height
  const top = below + height > window.innerHeight - PROCESS_WINDOW_MARGIN && above >= PROCESS_WINDOW_MARGIN ? above : below
  return { top, left }
}

/**
 * Right-pointing triangle for one path that has processes.
 * Hovering, keyboard focus, or a click when the pointer cannot hover opens a window of those processes.
 * @param props - the tree row this accessory sits on.
 * @returns the triangle, or nothing when the path has no processes or the browse page is absent.
 */
export function ProcessAccessory({ entry }: { readonly entry: TreeEntry }): ReactNode {
  const menu = useContext(ProcessMenuContext)
  if (menu === undefined) return null
  const processes = menu.byPath.get(entry.path)
  if (processes === undefined) return null
  return <ProcessWindow menu={menu} processes={processes} />
}

/**
 * The triangle and the process window for one executable path.
 * @param props - the browse menu and the processes on this path.
 * @returns the row-end control.
 */
function ProcessWindow({ menu, processes }: {
  readonly menu: ProcessMenu
  readonly processes: readonly ListedProcess[]
}): ReactNode {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [keyed, setKeyed] = useState(false)
  const [box, setBox] = useState(() => new DOMRect())
  const closeHover = useCallback(() => { setHovering(false) }, [])
  const grace = usePointerGrace(closeHover)
  const open = hovering || pinned || keyed

  const place = useCallback(() => {
    const anchor = buttonRef.current
    /* v8 ignore next -- the triangle button owns the event, so its ref is set. */
    if (anchor === null) return
    setBox(anchor.getBoundingClientRect())
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const move = (): void => { place() }
    window.addEventListener('scroll', move, true)
    window.addEventListener('resize', move)
    return () => {
      window.removeEventListener('scroll', move, true)
      window.removeEventListener('resize', move)
    }
  }, [open, place])

  useEffect(() => {
    if (!pinned) return undefined
    const down = (event: globalThis.PointerEvent): void => {
      const anchor = buttonRef.current
      /* v8 ignore next -- the triangle stays mounted while its window is pinned. */
      if (anchor === null) return
      if (pointerStillInside(event.target, anchor, panelRef.current)) return
      setPinned(false)
    }
    document.addEventListener('pointerdown', down)
    return () => { document.removeEventListener('pointerdown', down) }
  }, [pinned])

  const showHover = (event: PointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'touch' || !canHover()) return
    grace.cancel()
    setHovering(true)
    place()
  }
  const hideHover = (event: PointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'touch' || !canHover()) return
    const anchor = buttonRef.current
    /* v8 ignore next -- the triangle button owns the event, so its ref is set. */
    if (anchor === null) return
    if (pointerStillInside(event.relatedTarget, anchor, panelRef.current)) return
    grace.arm()
  }
  const togglePinned = (): void => {
    if (canHover()) return
    setPinned(current => !current)
    place()
  }
  const showKeyed = (event: FocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.matches(':focus-visible')) return
    setKeyed(true)
    place()
  }
  const hideKeyed = (event: FocusEvent<HTMLElement>): void => {
    const anchor = buttonRef.current
    /* v8 ignore next -- the triangle stays mounted while focus is inside it. */
    if (anchor === null) return
    if (pointerStillInside(event.relatedTarget, anchor, panelRef.current)) return
    setKeyed(false)
  }
  const choose = (entry: ListedProcess): void => {
    grace.cancel()
    setHovering(false)
    setPinned(false)
    setKeyed(false)
    void menu.openProcess(entry.pid, entry.start).then((outcome) => { menu.onTaken(outcome === 'taken') })
  }

  const origin = windowOrigin(box, processes.length)
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={css.triangle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={menu.t('browse.showProcesses')}
        onPointerEnter={showHover}
        onPointerLeave={hideHover}
        onClick={togglePinned}
        onFocus={showKeyed}
        onBlur={hideKeyed}
      >
        <IconChevronRightOutlineRegular />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.processWindow}
          style={{ top: origin.top, left: origin.left }}
          data-program-console="processes"
          onPointerEnter={showHover}
          onPointerLeave={hideHover}
        >
          {processes.map(entry => (
            <button
              key={`${String(entry.pid)}:${entry.start}`}
              type="button"
              className={css.process}
              title={entry.commandLine}
              onClick={() => { choose(entry) }}
              onFocus={showKeyed}
              onBlur={hideKeyed}
            >
              {entry.commandLine}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * Render the program tree and the new-command dialog.
 * @param props - Copy, the workspace file tree, and host callbacks.
 * @returns the browse page.
 */
export function ProgramBrowse({ t, renderFactorySlot, list, launch, openProcess }: ProgramBrowseProps): ReactNode {
  const [nonce, setNonce] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [paths, setPaths] = useState<readonly ProgramPathEntry[]>([])
  const [byPath, setByPath] = useState<ReadonlyMap<string, readonly ListedProcess[]>>(() => new Map())
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [dialog, setDialog] = useState(false)
  const [command, setCommand] = useState('')
  const [dialogError, setDialogError] = useState<string | undefined>(undefined)
  const [taken, setTaken] = useState(false)

  useEffect(() => {
    let live = true
    setStatus('loading')
    list().then((rows) => {
      if (!live) return
      const next = programPaths(rows)
      setPaths(next.entries)
      setByPath(next.byPath)
      setStatus('ready')
    }, (error: unknown) => {
      // The page reports the failure; the list can be requested again.
      void error
      if (!live) return
      setStatus('failed')
    })
    return () => { live = false }
  }, [list, nonce])

  const menu = useMemo<ProcessMenu>(() => ({
    byPath, openProcess, onTaken: setTaken, t,
  }), [byPath, openProcess, t])

  const toggleDirectory = (entry: TreeEntry, next: boolean): void => {
    setExpanded(current => next
      ? [...current.filter(path => path !== entry.path), entry.path]
      : current.filter(path => path !== entry.path))
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
      {status === 'ready' && paths.length === 0 && <p>{t('browse.empty')}</p>}
      {status === 'ready' && paths.length > 0 && (
        <ProcessMenuContext.Provider value={menu}>
          <div className={css.tree}>
            {renderFactorySlot('sidebar.files.tree', {
              root: TREE_ROOT,
              entries: paths,
              expanded,
              onToggle: toggleDirectory,
              onOpen: openNothing,
            }, {
              slots: { accessory: ProcessAccessory },
              // The files plugin registers this factory. Without it, the paths cannot be drawn.
              fallback: <p className={css.alert} role="alert">{t('browse.listFailed')}</p>,
            })}
          </div>
        </ProcessMenuContext.Provider>
      )}
      {dialog && (
        <form className={css.dialog} data-program-console="dialog" onSubmit={(event: FormEvent<HTMLFormElement>) => {
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
        }}>
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
