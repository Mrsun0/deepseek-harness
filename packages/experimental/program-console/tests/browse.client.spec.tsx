// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileTreeInput, TreeEntry } from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import { en as filesEn } from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/locales.ts'
import { FileTree } from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/FileTree.tsx'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleAddress } from '../src/process-list.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from '../src/types.ts'
import { ProcessAccessory, ProgramBrowse, type ProgramBrowseProps } from '../src/client/Browse.tsx'
import { ConsoleBody, ConsolePane, ConsoleTitle } from '../src/client/ConsolePane.tsx'
import { browseDefinition, processDefinition } from '../src/client/definition.ts'
import { apply } from '../src/client/index.ts'
import { ConsoleOpener } from '../src/client/Opener.tsx'

const t = (key: string): string => key

/** The row marker comes from the workspace file tree. */
function processToggle(path: string): HTMLElement {
  const button = document.querySelector(`[data-files-path="${path}"] > div button[aria-label="browse.showProcesses"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing process toggle for ${path}`)
  return button
}

type FilesTreeProps = FactoryComponentPropsOf<'sidebar.files.tree'>

const filesT: FilesTreeProps['t'] = (key) => {
  const dictionary: Record<string, string> = filesEn
  return dictionary[key] ?? key
}

const unusedFactory: FilesTreeProps['renderFactorySlot'] = () => null

function renderFactorySlot(
  name: 'sidebar.files.tree',
  props: FileTreeInput,
  options?: {
    slots?: { accessory?: (props: { readonly entry: TreeEntry }) => ReactNode }
    fallback?: ReactNode
  },
): ReactNode {
  if (name !== 'sidebar.files.tree') return options?.fallback ?? null
  const accessory = options?.slots?.accessory
  // The slot renderer supplies the remaining factory props. This passes the entries and the accessory.
  return createElement(FileTree, {
    ...props,
    t: filesT,
    renderFactorySlot: unusedFactory,
    useFactorySlot: (_name, fallback) => accessory ?? fallback,
  } as FilesTreeProps)
}

function renderBrowse(props: Omit<ProgramBrowseProps, 't' | 'renderFactorySlot'>): ReturnType<typeof render> {
  return render(createElement(ProgramBrowse, { t, renderFactorySlot, ...props }))
}

function hoverMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(hover: hover)' && matches,
  }))
}
const row: ListedProcess = { pid: 7, start: '70', exe: '/usr/bin/node', commandLine: 'node loop' }

function binding(sessionId: string): ConsoleBinding {
  return {
    key: '7\n70', pid: 7, start: '70', exe: '/usr/bin/node', commandLine: 'node loop', sessionId, createdAt: 1,
  }
}

/** jsdom does not load CSS modules, so the scroll test installs the browse sheet itself. */
function installBrowseStyles(windowClass: string): HTMLStyleElement {
  const directory = dirname(fileURLToPath(import.meta.url))
  const text = readFileSync(resolve(directory, '../src/client/Browse.module.css'), 'utf8')
    .replaceAll('.processWindow', `.${windowClass}`)
  const stylesheet = document.createElement('style')
  stylesheet.textContent = text
  document.head.append(stylesheet)
  return stylesheet
}

describe('program console browse', () => {
  beforeEach(() => { hoverMedia(true) })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows an empty list, a failed list, and ignores a list that finishes after unmount', async () => {
    const failed = renderBrowse({
      list: () => Promise.reject(new Error('down')), launch: async () => {}, openProcess: async () => 'opened',
    })
    expect(await screen.findByText('browse.listFailed')).toBeTruthy()
    failed.unmount()

    const empty = renderBrowse({
      list: () => Promise.resolve([]), launch: async () => {}, openProcess: async () => 'opened',
    })
    expect(await screen.findByText('browse.empty')).toBeTruthy()
    fireEvent.click(screen.getByText('browse.refresh'))
    expect(await screen.findByText('browse.empty')).toBeTruthy()
    empty.unmount()

    let resolveRows: (rows: readonly ListedProcess[]) => void = () => {}
    const resolved = renderBrowse({
      list: () => new Promise<readonly ListedProcess[]>((resolve) => { resolveRows = resolve }),
      launch: async () => {},
      openProcess: async () => 'opened',
    })
    resolved.unmount()
    resolveRows([row])
    let rejectRows: (error: Error) => void = () => {}
    const rejected = renderBrowse({
      list: () => new Promise<readonly ListedProcess[]>((_resolve, reject) => { rejectRows = reject }),
      launch: async () => {},
      openProcess: async () => 'opened',
    })
    rejected.unmount()
    rejectRows(new Error('late'))
    await Promise.resolve()
  })

  it('expands directories before a file, then its processes, and launches a command', async () => {
    let outcome: 'opened' | 'taken' = 'taken'
    const launch = vi.fn<(command: string) => Promise<void>>()
    launch.mockResolvedValue(undefined)
    const prefix = { ...row, pid: 4, start: '40', exe: '/usr/bin', commandLine: 'bin itself' }
    const view = renderBrowse({
      list: () => Promise.resolve([row, { ...row, pid: 8, start: '80', commandLine: 'node other' }, prefix]),
      launch,
      openProcess: async () => outcome,
    })
    expect(await screen.findByText('usr')).toBeTruthy()
    expect(screen.queryByText('bin')).toBeNull()
    fireEvent.click(screen.getByText('usr'))
    fireEvent.click(screen.getByText('bin'))
    expect(screen.getByText('node')).toBeTruthy()
    expect(screen.queryByText('node loop')).toBeNull()
    expect(screen.queryByText('bin itself')).toBeNull()
    fireEvent.click(screen.getByText('node'))
    expect(screen.queryByText('node loop')).toBeNull()
    const nodeToggle = processToggle('/usr/bin/node')
    fireEvent.pointerEnter(nodeToggle, { pointerType: 'mouse' })
    fireEvent.click(nodeToggle)
    fireEvent.click(screen.getByText('node loop'))
    expect(await screen.findByText('browse.taken')).toBeTruthy()
    outcome = 'opened'
    fireEvent.pointerEnter(nodeToggle, { pointerType: 'mouse' })
    fireEvent.click(screen.getByText('node other'))
    await waitFor(() => { expect(screen.queryByText('browse.taken')).toBeNull() })
    fireEvent.click(screen.getByText('bin'))
    expect(screen.queryByText('node')).toBeNull()

    fireEvent.click(screen.getByText('browse.new'))
    fireEvent.click(screen.getByText('browse.start'))
    expect(await screen.findByText('browse.commandEmpty')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('browse.command'), { target: { value: 'node loop' } })
    launch.mockRejectedValueOnce(new Error('missing'))
    fireEvent.click(screen.getByText('browse.start'))
    expect(await screen.findByText('browse.launchFailed')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('browse.command'), { target: { value: 'node stay' } })
    fireEvent.click(screen.getByText('browse.start'))
    expect(await screen.findByText('browse.new')).toBeTruthy()
    expect(screen.queryByText('browse.launchFailed')).toBeNull()
    expect(launch).toHaveBeenLastCalledWith('node stay')
    fireEvent.click(screen.getByText('browse.new'))
    fireEvent.click(screen.getByText('browse.cancel'))
    expect(screen.queryByLabelText('browse.command')).toBeNull()
    view.unmount()
  })

  it('keeps every process reachable inside a ten-row window', async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      pid: index + 1,
      start: String(index + 1),
      exe: '/bin/true',
      commandLine: `true ${String(index)}`,
    }))
    const previousHeight = window.innerHeight
    const previousWidth = window.innerWidth
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    const view = renderBrowse({
      list: () => Promise.resolve(many),
      launch: async () => {},
      openProcess: async () => 'opened',
    })
    fireEvent.click(await screen.findByText('bin'))
    const toggle = processToggle('/bin/true')
    let rect = new DOMRect(0, 100, 16, 16)
    vi.spyOn(toggle, 'getBoundingClientRect').mockImplementation(() => rect)
    fireEvent.pointerEnter(toggle, { pointerType: 'mouse' })
    const processWindow = document.querySelector('[data-program-console="processes"]')
    if (!(processWindow instanceof HTMLElement)) throw new Error('missing process window')
    const stylesheet = installBrowseStyles(processWindow.className)
    expect(getComputedStyle(processWindow).position).toBe('fixed')
    expect(getComputedStyle(processWindow).overflowY).toBe('auto')
    expect(getComputedStyle(processWindow).maxHeight).toBe('calc(10 * var(--program-console-row))')
    expect(getComputedStyle(processWindow).getPropertyValue('--program-console-row').trim()).toBe('32px')
    expect(processWindow.style.top).toBe('116px')
    stylesheet.remove()
    rect = new DOMRect(0, 20, 16, 16)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 })
    fireEvent.scroll(window)
    expect(processWindow.style.top).toBe('36px')
    rect = new DOMRect(0, 350, 16, 16)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    fireEvent.resize(window)
    expect(processWindow.style.top).toBe('30px')
    for (let index = 0; index < 11; index += 1) expect(screen.getByText(`true ${String(index)}`)).toBeTruthy()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth })
    view.unmount()
  })

  it('opens a normalized windows path from the triangle', async () => {
    const view = renderBrowse({
      list: () => Promise.resolve([{ ...row, exe: 'C:\\Windows\\node.exe', commandLine: 'windows node' }]),
      launch: async () => {},
      openProcess: async () => 'opened',
    })
    fireEvent.click(await screen.findByText('C:'))
    fireEvent.click(screen.getByText('Windows'))
    fireEvent.pointerEnter(processToggle('C:/Windows/node.exe'), { pointerType: 'touch' })
    fireEvent.pointerLeave(processToggle('C:/Windows/node.exe'), { pointerType: 'touch' })
    vi.spyOn(HTMLElement.prototype, 'matches').mockReturnValue(false)
    fireEvent.focus(processToggle('C:/Windows/node.exe'))
    expect(screen.queryByText('windows node')).toBeNull()
    const toggle = processToggle('C:/Windows/node.exe')
    fireEvent.pointerLeave(toggle, { pointerType: 'mouse', relatedTarget: document.body })
    fireEvent.pointerEnter(toggle, { pointerType: 'mouse' })
    const panel = document.querySelector('[data-program-console="processes"]')
    if (!(panel instanceof HTMLElement)) throw new Error('missing process window')
    fireEvent.pointerLeave(toggle, { pointerType: 'mouse', relatedTarget: panel })
    expect(screen.getByText('windows node')).toBeTruthy()
    fireEvent.pointerLeave(toggle, { pointerType: 'mouse', relatedTarget: null })
    fireEvent.pointerEnter(panel, { pointerType: 'mouse' })
    await new Promise((resolve) => { setTimeout(resolve, 250) })
    expect(screen.getByText('windows node')).toBeTruthy()
    fireEvent.pointerLeave(panel, { pointerType: 'mouse', relatedTarget: document.body })
    await waitFor(() => { expect(screen.queryByText('windows node')).toBeNull() })
    view.unmount()
  })

  it('toggles the process window when the pointer cannot hover', async () => {
    hoverMedia(false)
    const view = renderBrowse({
      list: () => Promise.resolve([row]),
      launch: async () => {},
      openProcess: async () => 'opened',
    })
    fireEvent.click(await screen.findByText('usr'))
    fireEvent.click(screen.getByText('bin'))
    const toggle = processToggle('/usr/bin/node')
    fireEvent.pointerEnter(toggle, { pointerType: 'mouse' })
    fireEvent.pointerLeave(toggle, { pointerType: 'mouse', relatedTarget: document.body })
    expect(screen.queryByText('node loop')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('node loop')).toBeTruthy()
    fireEvent.pointerDown(toggle)
    fireEvent.pointerDown(screen.getByText('node loop'))
    expect(screen.getByText('node loop')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('node loop')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByText('node loop')).toBeNull()
    view.unmount()
  })

  it('opens the process window from the keyboard and keeps it while focus stays inside', async () => {
    const view = renderBrowse({
      list: () => Promise.resolve([row]),
      launch: async () => {},
      openProcess: async () => 'opened',
    })
    fireEvent.click(await screen.findByText('usr'))
    fireEvent.click(screen.getByText('bin'))
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(selector => selector === ':focus-visible')
    const toggle = processToggle('/usr/bin/node')
    fireEvent.focus(toggle)
    const option = screen.getByText('node loop')
    fireEvent.blur(toggle, { relatedTarget: option })
    expect(screen.getByText('node loop')).toBeTruthy()
    fireEvent.focus(option)
    fireEvent.blur(option, { relatedTarget: toggle })
    expect(screen.getByText('node loop')).toBeTruthy()
    fireEvent.blur(option, { relatedTarget: null })
    expect(screen.queryByText('node loop')).toBeNull()
    view.unmount()
  })

  it('draws no triangle outside the browse page', () => {
    const entry: TreeEntry = { path: '/usr/bin/node', name: 'node' }
    const view = render(createElement(ProcessAccessory, { entry }))
    expect(view.container.querySelector('button')).toBeNull()
    view.unmount()
  })

  it('renders a process console and a missing address', () => {
    const translate = t as TranslateNS<'programConsole'>
    const definition = processDefinition(translate)
    const guide = browseDefinition(translate)
    expect(guide.title('sidebar://program-console')).toBe('type.label')
    expect(guide.guide?.[0]?.title()).toBe('guide.title')
    expect(guide.guide?.[0]?.description?.()).toBe('guide.description')
    expect(definition.canOpen?.('nope')).toBe(false)
    const address = consoleAddress('4\n5')
    expect(definition.canOpen?.(address)).toBe(true)
    expect(definition.title('nope')).toBe('console.chip')
    expect(definition.title(address)).toBe('console.chip 4')

    const missing = render(createElement(ConsoleBody, { address: 'nope', t: translate }))
    expect(screen.getByText('console.missing')).toBeTruthy()
    missing.unmount()
    const body = render(createElement(ConsoleBody, { address, t: translate }))
    expect(screen.getByText('console.pid 4')).toBeTruthy()
    expect(screen.getByText('console.start 5')).toBeTruthy()
    expect(screen.getByText('console.inputUnavailable')).toBeTruthy()
    body.unmount()

    const navigation = (value: string) => ({ address: value, params: undefined, revision: 0 })
    const paneProps = {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
    } as Parameters<typeof ConsolePane>[0]
    const pane = render(createElement(ConsolePane, paneProps))
    expect(screen.getByText('console.bound')).toBeTruthy()
    pane.unmount()
    const titleProps = {
      useTabInfo: () => ({ tab: { navigation: navigation('nope') } }),
      t: translate,
    } as Parameters<typeof ConsoleTitle>[0]
    const title = render(createElement(ConsoleTitle, titleProps))
    expect(screen.getByText('console.chip')).toBeTruthy()
    title.unmount()
    const namedProps = {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
    } as Parameters<typeof ConsoleTitle>[0]
    const named = render(createElement(ConsoleTitle, namedProps))
    expect(screen.getByText('console.chip 4')).toBeTruthy()
    named.unmount()

    const stop = vi.fn()
    const opener = render(createElement(ConsoleOpener, {
      watchConsoles: () => stop,
    } as Parameters<typeof ConsoleOpener>[0]))
    opener.unmount()
    expect(stop).toHaveBeenCalledOnce()
  })
})

interface InjectedCalls {
  list?: () => Promise<unknown>
  launch?: (command: string) => Promise<unknown>
  openProcess?: (pid: number, start: string) => Promise<unknown>
  watchConsoles?: () => () => void
}

describe('program console client apply', () => {
  it('mounts the remote and opens a console for this session only', async () => {
    const entries: { name: string; inject?: (sessionId: SessionId) => InjectedCalls }[] = []
    const openResourceIn = vi.fn()
    const mount = vi.fn(async () => () => {})
    const remote = {
      list: vi.fn(async (): Promise<RemoteResult<ListedProcess[]>> => ({ ok: true, value: [] })),
      launch: vi.fn(async (): Promise<RemoteResult<ConsoleOpenResult>> => ({
        ok: true,
        value: { binding: binding('session'), created: true },
      })),
      open: vi.fn(async (): Promise<RemoteResult<ConsoleOpenResult>> => ({
        ok: true,
        value: { binding: binding('other'), created: false },
      })),
      consoles: vi.fn(async (): Promise<RemoteResult<ConsoleBinding[]>> => ({
        ok: false,
        error: new RemoteError('gateway/internal', 'down', {}),
      })),
    }
    const subscribe = vi.fn(() => () => {})
    let bound = false
    const ctx = {
      remote: { $mount: mount, programConsole: remote },
      locale: { bind: () => t, register: vi.fn(() => () => {}) },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      sidebarRight: { openResourceIn },
      sessions: { binding: () => bound ? { session: { subscribe } } : undefined },
      slots: {
        inject: (_name: string, factory: () => void) => { factory(); return () => {} },
        register: (meta: { name: string; inject?: (sessionId: SessionId) => InjectedCalls }) => {
          entries.push(meta)
          return () => {}
        },
      },
      effect: (run: () => void) => { run() },
    } as never
    await apply(ctx)
    expect(mount).toHaveBeenCalledOnce()
    const browse = entries.find(entry => entry.inject !== undefined && entry.name === 'sidebar.right.pane.tab')
    if (browse?.inject === undefined) throw new Error('browse inject missing')
    const actions = browse.inject('session' as SessionId)
    if (actions.list === undefined || actions.launch === undefined || actions.openProcess === undefined) {
      throw new Error('browse callbacks missing')
    }
    await actions.list()
    remote.list.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
    await expect(actions.list()).rejects.toThrow('program-console remote call failed')
    await actions.launch('node stay')
    expect(openResourceIn).toHaveBeenCalledOnce()
    await expect(actions.openProcess(7, '70')).resolves.toBe('taken')
    remote.open.mockResolvedValueOnce({ ok: true, value: { binding: binding('session'), created: false } })
    await expect(actions.openProcess(7, '70')).resolves.toBe('opened')
    const opener = entries.find(entry => entry.name === 'conversation.session.header.actions')
    if (opener?.inject === undefined) throw new Error('opener inject missing')
    const first = opener.inject('session' as SessionId)
    expect(opener.inject('session' as SessionId)).toBe(first)
    if (first.watchConsoles === undefined) throw new Error('watch missing')
    const release = first.watchConsoles()
    release()
    bound = true
    remote.consoles.mockResolvedValue({
      ok: true,
      value: [{ ...binding('next'), createdAt: Date.now() }],
    })
    vi.useFakeTimers()
    const nextWatch = opener.inject('next' as SessionId).watchConsoles
    if (nextWatch === undefined) throw new Error('watch missing')
    const second = nextWatch()
    expect(subscribe).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    expect(openResourceIn).toHaveBeenCalledTimes(3)
    second()
    vi.useRealTimers()
  })
})
