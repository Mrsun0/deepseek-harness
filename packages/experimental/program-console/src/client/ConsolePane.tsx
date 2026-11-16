/** Bound process Console: a full-pane PTY when we hold the master, otherwise an informational notice. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import '@xterm/xterm/css/xterm.css'
import { keyFromAddress } from '../process-list.ts'
import type { ConsoleBinding, ConsoleStatus } from '../types.ts'
import css from './ConsolePane.module.css'
import type { ProgramConsoleKey } from './locales.ts'

type PaneProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'programConsole'> & Partial<ConsolePaneInjected>

/** Host callbacks for one bound process Console. */
export interface ConsolePaneInjected {
  /**
   * Look up the current binding, including whether a live PTY can be attached.
   * @param pid - Process id from the tab address.
   * @param start - Start time from the tab address.
   */
  readonly lookup: (pid: number, start: string) => Promise<ConsoleBinding | undefined>
  /**
   * Write typed input to the bound process PTY.
   * @param pid - Process id from the tab address.
   * @param start - Start time from the tab address.
   * @param data - Text from the emulator, without an implicit newline.
   */
  readonly writeConsole: (pid: number, start: string, data: string) => Promise<void>
  /**
   * Notify the bound process PTY of a new grid size.
   * @param pid - Process id from the tab address.
   * @param start - Start time from the tab address.
   * @param cols - Column count.
   * @param rows - Row count.
   */
  readonly resizeConsole: (pid: number, start: string, cols: number, rows: number) => Promise<void>
  /**
   * Subscribe to bound-process terminal output for the lifetime of `signal`.
   * @param pid - Process id from the tab address.
   * @param start - Start time from the tab address.
   * @param signal - Cancelled when the panel unmounts.
   */
  readonly followConsole: (pid: number, start: string, signal: AbortSignal) => AsyncIterable<string>
  /**
   * Subscribe to Console bindings and their status for the lifetime of `signal`.
   * @param signal - Cancelled when the title or panel unmounts.
   */
  readonly watchConsoles: (signal: AbortSignal) => AsyncIterable<readonly ConsoleBinding[]>
  /**
   * Make a ready Console the unique model-active target.
   * @param pid - Process id shown on the Console tab.
   */
  readonly selectConsole: (pid: number) => Promise<void>
}

/**
 * Render the process bound to this tab, or a notice when the address is not a process.
 * @param props - Tab address, copy, and optional PTY callbacks.
 * @returns the console page.
 */
export function ConsolePane({
  useTabInfo, t, lookup, writeConsole, resizeConsole, followConsole, watchConsoles,
}: PaneProps): ReactNode {
  return (
    <ConsoleBody
      address={useTabInfo().tab.navigation.address}
      t={t}
      lookup={lookup}
      writeConsole={writeConsole}
      resizeConsole={resizeConsole}
      followConsole={followConsole}
      watchConsoles={watchConsoles}
    />
  )
}

/**
 * Render the chip title for a process Console, including the activity light.
 * @param props - Tab address, copy, and optional status callbacks.
 * @returns the chip with a status light.
 */
export function ConsoleTitle({ useTabInfo, t, watchConsoles, selectConsole }: PaneProps): ReactNode {
  const key = keyFromAddress(useTabInfo().tab.navigation.address)
  const pid = key === undefined ? undefined : Number(key.slice(0, key.indexOf('\n')))
  const start = key === undefined ? undefined : key.slice(key.indexOf('\n') + 1)
  const binding = useLiveBinding(pid, start, watchConsoles)
  const status = binding?.status ?? 'idle'
  const label = pid === undefined || Number.isNaN(pid) ? t('console.chip') : `${t('console.chip')} ${String(pid)}`
  return (
    <span className={css.title} data-program-console="title">
      <StatusLight
        status={status}
        label={t(statusLabelKey(status))}
        selectable={status === 'ready' && pid !== undefined && !Number.isNaN(pid) && selectConsole !== undefined}
        onSelect={pid === undefined || Number.isNaN(pid) || selectConsole === undefined
          ? undefined
          : () => { void selectConsole(pid) }}
      />
      <span>{label}</span>
    </span>
  )
}

function statusLabelKey(status: ConsoleStatus): ProgramConsoleKey {
  if (status === 'active') return 'console.status.active'
  if (status === 'ready') return 'console.status.ready'
  return 'console.status.idle'
}

/** Vector disc for the tab status light, so the small circle stays sharp. */
function StatusLightMark(): ReactNode {
  return (
    <svg className={css.lightMark} viewBox="0 0 16 16" width="6" height="6" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
    </svg>
  )
}

function StatusLight({
  status, label, selectable, onSelect,
}: {
  readonly status: ConsoleStatus
  readonly label: string
  readonly selectable: boolean
  readonly onSelect?: () => void
}): ReactNode {
  const tone = status === 'active' ? css.lightActive : status === 'ready' ? css.lightReady : css.lightIdle
  if (selectable) {
    return (
      <button
        type="button"
        className={`${css.lightButton} ${tone}`}
        data-program-console="status-light"
        data-status={status}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSelect?.()
        }}
      >
        <StatusLightMark />
      </button>
    )
  }
  return (
    <span
      className={`${css.light} ${tone}`}
      data-program-console="status-light"
      data-status={status}
      aria-label={label}
      title={label}
    >
      <StatusLightMark />
    </span>
  )
}

function useLiveBinding(
  pid: number | undefined,
  start: string | undefined,
  watchConsoles: ConsolePaneInjected['watchConsoles'] | undefined,
): ConsoleBinding | undefined {
  const [binding, setBinding] = useState<ConsoleBinding | undefined>(undefined)
  useEffect(() => {
    if (watchConsoles === undefined || pid === undefined || start === undefined || Number.isNaN(pid)) {
      setBinding(undefined)
      return
    }
    const lifetime = new AbortController()
    void (async () => {
      try {
        for await (const records of watchConsoles(lifetime.signal)) {
          if (lifetime.signal.aborted) break
          setBinding(records.find(record => record.pid === pid && record.start === start))
        }
      } catch (error: unknown) {
        void error
      }
    })()
    return () => { lifetime.abort() }
  }, [watchConsoles, pid, start])
  return binding
}

/** Props for the address-driven console body. */
export interface ConsoleBodyProps {
  /** Sidebar resource address. */
  readonly address: string
  /** Locale function. */
  readonly t: (key: ProgramConsoleKey) => string
  /** Look up the current binding when the tab remounts. */
  readonly lookup?: ConsolePaneInjected['lookup']
  /** Write typed input to the bound process PTY. */
  readonly writeConsole?: ConsolePaneInjected['writeConsole']
  /** Resize the bound process PTY. */
  readonly resizeConsole?: ConsolePaneInjected['resizeConsole']
  /** Follow bound-process terminal output. */
  readonly followConsole?: ConsolePaneInjected['followConsole']
  /** Follow Console bindings and their status. */
  readonly watchConsoles?: ConsolePaneInjected['watchConsoles']
}

/**
 * Render console copy or an attached terminal for one address.
 * @param props - Address, copy, and optional PTY callbacks.
 * @returns the page body.
 */
export function ConsoleBody({
  address, t, lookup, writeConsole, resizeConsole, followConsole, watchConsoles,
}: ConsoleBodyProps): ReactNode {
  const key = keyFromAddress(address)
  if (key === undefined) return <p data-program-console="missing">{t('console.missing')}</p>
  const newline = key.indexOf('\n')
  const pid = Number(key.slice(0, newline))
  const start = key.slice(newline + 1)
  return (
    <BoundConsole
      pid={pid}
      start={start}
      t={t}
      lookup={lookup}
      writeConsole={writeConsole}
      resizeConsole={resizeConsole}
      followConsole={followConsole}
      watchConsoles={watchConsoles}
    />
  )
}

function BoundConsole({
  pid, start, t, lookup, writeConsole, resizeConsole, followConsole, watchConsoles,
}: {
  readonly pid: number
  readonly start: string
  readonly t: (key: ProgramConsoleKey) => string
  readonly lookup?: ConsolePaneInjected['lookup']
  readonly writeConsole?: ConsolePaneInjected['writeConsole']
  readonly resizeConsole?: ConsolePaneInjected['resizeConsole']
  readonly followConsole?: ConsolePaneInjected['followConsole']
  readonly watchConsoles?: ConsolePaneInjected['watchConsoles']
}): ReactNode {
  const [binding, setBinding] = useState<ConsoleBinding | undefined>(undefined)
  const [ready, setReady] = useState(lookup === undefined)
  const live = useLiveBinding(pid, start, watchConsoles)
  const resolved = live ?? binding

  useEffect(() => {
    if (lookup === undefined) {
      setBinding(undefined)
      setReady(true)
      return
    }
    let cancelled = false
    setReady(false)
    void lookup(pid, start).then((found) => {
      if (cancelled) return
      setBinding(found)
      setReady(true)
    }, (error: unknown) => {
      void error
      if (cancelled) return
      setBinding(undefined)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [lookup, pid, start])

  const attachable = ready && resolved?.attachable === true
    && writeConsole !== undefined && resizeConsole !== undefined && followConsole !== undefined

  if (attachable) {
    return (
      <BoundTerminal
        pid={pid}
        commandLine={resolved?.commandLine}
        status={resolved?.status}
        t={t}
        write={data => writeConsole(pid, start, data)}
        resize={(cols, rows) => resizeConsole(pid, start, cols, rows)}
        follow={signal => followConsole(pid, start, signal)}
      />
    )
  }

  return (
    <section className={css.page} data-program-console="page">
      <p>{t('console.bound')}</p>
      <p>{t('console.pid')} {String(pid)}</p>
      <p>{t('console.start')} {start}</p>
      {ready && <p>{t('console.inputUnavailable')}</p>}
    </section>
  )
}

const BOUND_TERMINAL_COLS = 80
const BOUND_TERMINAL_ROWS = 24

/** Fallback when the Console typography token has not been published yet. */
const CODE_FONT_FALLBACK = '"Ubuntu Sans Mono", "Noto Sans Mono", "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "Noto Sans Mono CJK SC", "PingFang SC", "Microsoft YaHei"'

/**
 * Resolve the Console typography so the bound terminal matches the comment header.
 * @param node - Element already in the document, used to read computed theme tokens.
 */
function resolveCodeFontFamily(node: HTMLElement): string {
  const probe = document.createElement('span')
  probe.style.fontFamily = 'var(--program-console-font), var(--ds-font-family-code)'
  node.appendChild(probe)
  const family = getComputedStyle(probe).fontFamily.trim()
  probe.remove()
  return family === '' ? CODE_FONT_FALLBACK : family
}

function BoundTerminal({
  pid, commandLine, status, t, write, resize, follow,
}: {
  readonly pid: number
  readonly commandLine: string | undefined
  readonly status: ConsoleStatus | undefined
  readonly t: (key: ProgramConsoleKey) => string
  readonly write: (data: string) => Promise<void>
  readonly resize: (cols: number, rows: number) => Promise<void>
  readonly follow: (signal: AbortSignal) => AsyncIterable<string>
}): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal>(undefined)
  const writeRef = useRef(write)
  const resizeRef = useRef(resize)
  const followRef = useRef(follow)
  writeRef.current = write
  resizeRef.current = resize
  followRef.current = follow
  const [error, setError] = useState<string | undefined>(undefined)

  useLayoutEffect(() => {
    const node = host.current
    if (node === null) return
    const xterm = new Terminal({
      cols: BOUND_TERMINAL_COLS,
      rows: BOUND_TERMINAL_ROWS,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: resolveCodeFontFamily(node),
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
      },
    })
    const addon = new FitAddon()
    xterm.loadAddon(addon)
    xterm.open(node)
    term.current = xterm
    const input = xterm.onData((data) => { void writeRef.current(data) })
    const fit = (): void => {
      if (node.clientWidth === 0 || node.clientHeight === 0) return
      const proposed = addon.proposeDimensions()
      if (proposed === undefined || proposed.cols < 2 || proposed.rows < 1) return
      addon.fit()
      void resizeRef.current(proposed.cols, proposed.rows)
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : undefined
    observer?.observe(node)
    fit()
    return () => {
      observer?.disconnect()
      input.dispose()
      xterm.dispose()
      term.current = undefined
    }
  }, [])

  useEffect(() => {
    const lifetime = new AbortController()
    let stream: AsyncIterable<string> | undefined
    void (async () => {
      try {
        stream = followRef.current(lifetime.signal)
        for await (const chunk of stream) {
          if (lifetime.signal.aborted) break
          term.current?.write(chunk)
        }
      } catch (cause: unknown) {
        void cause
        if (!lifetime.signal.aborted) setError(t('console.terminalFailed'))
      }
    })()
    return () => {
      lifetime.abort()
      if (stream !== undefined && typeof stream === 'object' && stream !== null && 'dispose' in stream) {
        const closer = stream.dispose
        if (typeof closer === 'function') closer.call(stream)
      }
    }
  }, [t])

  return (
    <section className={css.console} data-program-console="bound-terminal">
      <header className={css.header} data-program-console="bound-header">
        <p className={css.hint} data-program-console="bound-hint">{t('console.startHint')}</p>
        {status === 'active' && (
          <p className={css.activeHint} data-program-console="active-hint">{t('console.activeHint')}</p>
        )}
        <div className={css.meta}>
          <span>{t('console.pid')} {String(pid)}</span>
          {commandLine !== undefined && commandLine.length > 0 && (
            <span className={css.command}>{commandLine}</span>
          )}
        </div>
      </header>
      <div ref={host} className={css.screen} data-program-console="bound-terminal-screen" />
      {error !== undefined && <p className={css.alert} role="alert">{error}</p>}
    </section>
  )
}
