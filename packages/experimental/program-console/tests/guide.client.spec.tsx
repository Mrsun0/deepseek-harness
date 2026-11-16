// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

const xtermState = vi.hoisted(() => ({
  writes: [] as string[],
  disposed: 0,
  onData: undefined as ((data: string) => void) | undefined,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write(data: string): void { xtermState.writes.push(data) }
    open(_node: HTMLElement): void {}
    loadAddon(_addon: unknown): void {}
    dispose(): void { xtermState.disposed += 1 }
    onData(listener: (data: string) => void): { dispose(): void } {
      xtermState.onData = listener
      return { dispose(): void { if (xtermState.onData === listener) xtermState.onData = undefined } }
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions(): { cols: number; rows: number } {
      return { cols: 80, rows: 24 }
    }
    fit(): void {}
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
import { consoleAddress } from '../src/process-list.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from '../src/types.ts'
import { ConsoleGuide } from '../src/client/ConsoleGuide.tsx'
import { ConsoleStart } from '../src/client/ConsoleStart.tsx'
import { ConsoleBody, ConsolePane, ConsoleTitle } from '../src/client/ConsolePane.tsx'
import css from '../src/client/ConsolePane.module.css'
import { en, zh } from '../src/client/locales.ts'
import { BROWSE_KIND, PROCESS_KIND, browseDefinition, processDefinition } from '../src/client/definition.ts'
import { apply } from '../src/client/index.ts'
import { ConsoleOpener } from '../src/client/Opener.tsx'

const t = (key: string): string => key

function binding(sessionId: string): ConsoleBinding {
  return {
    key: '7\n70', pid: 7, start: '70', exe: '/bin/bash', commandLine: 'bash -i', sessionId, createdAt: 1,
    attachable: true, status: 'idle',
  }
}

function result(sessionId: string): ConsoleOpenResult {
  return { created: true, binding: binding(sessionId) }
}

describe('program console guide', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    xtermState.writes = []
    xtermState.disposed = 0
    xtermState.onData = undefined
    vi.restoreAllMocks()
  })

  it('opens a bound Console from the guide entry and does not show a browse or launch terminal', async () => {
    const openResource = vi.fn()
    const close = vi.fn()
    const openUserConsole = vi.fn(async () => result('session'))
    const view = render(createElement(ConsoleGuide, {
      title: 'guide.title',
      description: 'guide.description',
      kind: BROWSE_KIND,
      entryId: 'program-console',
      t,
      useTabInfo: () => ({
        tab: { actions: { openResource, close, openTab: vi.fn(), bindCommands: vi.fn() } },
      }),
      openUserConsole,
    } as Parameters<typeof ConsoleGuide>[0]))
    const entry = screen.getByRole('button', { name: 'guide.title guide.description' })
    expect(entry.getAttribute('data-program-console')).toBe('guide')
    expect(document.querySelector('[data-program-console="browse"]')).toBeNull()
    expect(document.querySelector('[data-program-console="launch-terminal"]')).toBeNull()
    fireEvent.click(entry)
    await waitFor(() => {
      expect(openUserConsole).toHaveBeenCalledOnce()
    })
    expect(openResource).toHaveBeenCalledWith(consoleAddress('7\n70'), { replaceTab: true })
    expect(close).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('shows a pending state while the host starts the shell and ignores a second click', async () => {
    const openResource = vi.fn()
    let release: (value: ConsoleOpenResult) => void = () => {}
    const openUserConsole = vi.fn(() => new Promise<ConsoleOpenResult>((resolve) => { release = resolve }))
    const view = render(createElement(ConsoleGuide, {
      title: 'guide.title',
      description: 'guide.description',
      kind: BROWSE_KIND,
      entryId: 'program-console',
      t,
      useTabInfo: () => ({
        tab: { actions: { openResource, close: vi.fn(), openTab: vi.fn(), bindCommands: vi.fn() } },
      }),
      openUserConsole,
    } as Parameters<typeof ConsoleGuide>[0]))
    const entry = screen.getByRole('button', { name: 'guide.title guide.description' })
    fireEvent.click(entry)
    expect(await screen.findByRole('button', { name: 'guide.title guide.opening' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'guide.title guide.opening' }))
    expect(openUserConsole).toHaveBeenCalledOnce()
    await act(async () => { release(result('session')) })
    await waitFor(() => {
      expect(openResource).toHaveBeenCalledOnce()
    })
    view.unmount()
  })

  it('shows an error on the guide entry when the host cannot start a Console', async () => {
    const openResource = vi.fn()
    const close = vi.fn()
    const openUserConsole = vi.fn(async () => { throw new Error('down') })
    const view = render(createElement(ConsoleGuide, {
      title: 'guide.title',
      description: 'guide.description',
      kind: BROWSE_KIND,
      entryId: 'program-console',
      t,
      useTabInfo: () => ({
        tab: { actions: { openResource, close, openTab: vi.fn(), bindCommands: vi.fn() } },
      }),
      openUserConsole,
    } as Parameters<typeof ConsoleGuide>[0]))
    fireEvent.click(screen.getByRole('button', { name: 'guide.title guide.description' }))
    expect(await screen.findByRole('button', { name: 'guide.title guide.failed' })).toBeTruthy()
    expect(openResource).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    view.unmount()
  })

  it('starts a bound Console when the guide type is opened as a page', async () => {
    const openResource = vi.fn()
    const close = vi.fn()
    const openUserConsole = vi.fn(async () => result('session'))
    const view = render(createElement(ConsoleStart, {
      t,
      useTabInfo: () => ({
        tab: { actions: { openResource, close, openTab: vi.fn(), bindCommands: vi.fn() } },
      }),
      openUserConsole,
    } as Parameters<typeof ConsoleStart>[0]))
    expect(screen.getByText('guide.opening')).toBeTruthy()
    await waitFor(() => {
      expect(openResource).toHaveBeenCalledWith(consoleAddress('7\n70'), { replaceTab: true })
    })
    expect(close).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-program-console="browse"]')).toBeNull()
    view.unmount()
  })

  it('lets the start page retry after a failed open', async () => {
    const openResource = vi.fn()
    const openUserConsole = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(result('session'))
    const view = render(createElement(ConsoleStart, {
      t,
      useTabInfo: () => ({
        tab: { actions: { openResource, close: vi.fn(), openTab: vi.fn(), bindCommands: vi.fn() } },
      }),
      openUserConsole,
    } as Parameters<typeof ConsoleStart>[0]))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(openResource).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'guide.retry' }))
    await waitFor(() => {
      expect(openResource).toHaveBeenCalledOnce()
    })
    expect(openUserConsole).toHaveBeenCalledTimes(2)
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

  it('attaches a bound terminal when the host reports an attachable session and does not terminate on unmount', async () => {
    const translate = t as TranslateNS<'programConsole'>
    const address = consoleAddress('4\n5')
    const writeConsole = vi.fn(async () => {})
    const resizeConsole = vi.fn(async () => {})
    const followConsole = vi.fn((_pid: number, _start: string, _signal: AbortSignal) => (async function* () {
      yield 'hello from pty\n'
    })())
    const lookup = vi.fn(async () => ({
      key: '4\n5',
      pid: 4,
      start: '5',
      exe: '/usr/bin/python3',
      commandLine: 'python3 -i',
      sessionId: 'session',
      createdAt: 1,
      attachable: true,
      status: 'idle',
    }))
    const navigation = (value: string) => ({ address: value, params: undefined, revision: 0 })
    const pane = render(createElement(ConsolePane, {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
      lookup,
      writeConsole,
      resizeConsole,
      followConsole,
    } as Parameters<typeof ConsolePane>[0]))
    await waitFor(() => {
      expect(document.querySelector('[data-program-console="bound-terminal"]')).toBeTruthy()
    })
    expect(screen.queryByText('console.inputUnavailable')).toBeNull()
    expect(screen.getByText('console.pid 4')).toBeTruthy()
    expect(screen.getByText('python3 -i')).toBeTruthy()
    const hint = document.querySelector('[data-program-console="bound-hint"]')
    const header = document.querySelector('[data-program-console="bound-header"]')
    const terminalScreen = document.querySelector('[data-program-console="bound-terminal-screen"]')
    expect(hint).toBeTruthy()
    expect(hint?.textContent).toBe('console.startHint')
    expect(en['console.startHint']).toBe('# Start a new process; starting it will automatically reach the model.')
    expect(zh['console.startHint']).toBe('# 请启动一个新进程，启动进程将自动触达模型。')
    expect(header?.contains(hint)).toBe(true)
    expect(terminalScreen).toBeTruthy()
    expect(hint!.compareDocumentPosition(terminalScreen!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => { expect(xtermState.writes.join('')).toContain('hello from pty') })
    expect(xtermState.writes.join('')).not.toContain('console.startHint')
    expect(xtermState.writes.join('')).not.toContain(en['console.startHint'])
    expect(followConsole).toHaveBeenCalled()
    xtermState.onData?.('print(1)\n')
    await waitFor(() => { expect(writeConsole).toHaveBeenCalledWith(4, '5', 'print(1)\n') })
    const disposed = xtermState.disposed
    pane.unmount()
    expect(xtermState.disposed).toBeGreaterThan(disposed)
    expect(writeConsole).toHaveBeenCalledTimes(1)
  })

  it('shows the notice and no terminal input when the bound process has no attachable PTY', async () => {
    const translate = t as TranslateNS<'programConsole'>
    const address = consoleAddress('4\n5')
    const writeConsole = vi.fn(async () => {})
    const lookup = vi.fn(async () => ({
      key: '4\n5',
      pid: 4,
      start: '5',
      exe: '/usr/bin/python3',
      commandLine: 'python3 -u demo.py',
      sessionId: 'session',
      createdAt: 1,
      attachable: false,
      status: 'idle',
    }))
    const navigation = (value: string) => ({ address: value, params: undefined, revision: 0 })
    const pane = render(createElement(ConsolePane, {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
      lookup,
      writeConsole,
      resizeConsole: async () => {},
      followConsole: () => (async function* () {})(),
    } as Parameters<typeof ConsolePane>[0]))
    expect(await screen.findByText('console.inputUnavailable')).toBeTruthy()
    expect(document.querySelector('[data-program-console="bound-terminal"]')).toBeNull()
    expect(document.querySelector('[data-program-console="bound-hint"]')).toBeNull()
    expect(screen.queryByText('console.startHint')).toBeNull()
    expect(screen.getByText('console.bound')).toBeTruthy()
    expect(writeConsole).not.toHaveBeenCalled()
    pane.unmount()
  })

  it('shows a status light, lets an orange light select the Console, and keeps hints out of the PTY', async () => {
    const translate = t as TranslateNS<'programConsole'>
    const address = consoleAddress('4\n5')
    const selectConsole = vi.fn(async () => {})
    const records: ConsoleBinding[] = [{
      key: '4\n5',
      pid: 4,
      start: '5',
      exe: '/usr/bin/python3',
      commandLine: 'python3 -i',
      sessionId: 'session',
      createdAt: 1,
      attachable: true,
      status: 'ready',
    }]
    const watchConsoles = vi.fn((_signal: AbortSignal) => (async function* () {
      yield records
    })())
    const navigation = (value: string) => ({ address: value, params: undefined, revision: 0 })
    const title = render(createElement(ConsoleTitle, {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
      watchConsoles,
      selectConsole,
    } as Parameters<typeof ConsoleTitle>[0]))
    const light = await screen.findByRole('button', { name: 'console.status.ready' })
    expect(light.getAttribute('data-status')).toBe('ready')
    expect(light.className).toContain(css.lightReady)
    expect(light.querySelector('svg circle')).not.toBeNull()
    fireEvent.click(light)
    await waitFor(() => { expect(selectConsole).toHaveBeenCalledWith(4) })
    title.unmount()

    records[0] = { ...records[0]!, status: 'idle' }
    const idleTitle = render(createElement(ConsoleTitle, {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
      watchConsoles: () => (async function* () { yield records })(),
      selectConsole,
    } as Parameters<typeof ConsoleTitle>[0]))
    const idle = await screen.findByTitle('console.status.idle')
    expect(idle.tagName).toBe('SPAN')
    expect(idle.getAttribute('data-status')).toBe('idle')
    expect(idle.className).toContain(css.lightIdle)
    expect(idle.querySelector('svg circle')).not.toBeNull()
    fireEvent.click(idle)
    expect(selectConsole).toHaveBeenCalledTimes(1)
    idleTitle.unmount()

    records[0] = { ...records[0]!, status: 'active' }
    const writeConsole = vi.fn(async () => {})
    const pane = render(createElement(ConsolePane, {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
      lookup: async () => records[0],
      writeConsole,
      resizeConsole: async () => {},
      followConsole: () => (async function* () { yield 'prompt>\n' })(),
      watchConsoles: () => (async function* () { yield records })(),
    } as Parameters<typeof ConsolePane>[0]))
    await waitFor(() => {
      expect(document.querySelector('[data-program-console="bound-terminal"]')).toBeTruthy()
    })
    const activeHint = document.querySelector('[data-program-console="active-hint"]')
    const header = document.querySelector('[data-program-console="bound-header"]')
    expect(activeHint?.textContent).toBe('console.activeHint')
    expect(header?.contains(activeHint)).toBe(true)
    await waitFor(() => { expect(xtermState.writes.join('')).toContain('prompt>') })
    expect(xtermState.writes.join('')).not.toContain('console.activeHint')
    expect(xtermState.writes.join('')).not.toContain('console.startHint')
    expect(en['console.status.active']).toBe('Active with the model')
    expect(zh['console.status.active']).toBe('正在与模型连接并活动')
    expect(en['console.status.ready']).toContain('click to make this the model-active Console')
    expect(zh['console.status.ready']).toContain('点击可将此控制台设为模型活动目标')
    expect(en['console.status.idle']).toBe('No process has been started yet')
    expect(zh['console.status.idle']).toBe('尚未启动进程')
    expect(en['console.activeHint']).toContain('model-active target')
    expect(zh['console.activeHint']).toContain('模型的活动目标')
    const stylesheet = readFileSync(resolve('packages/experimental/program-console/src/client/ConsolePane.module.css'), 'utf8')
    expect(stylesheet).toContain('--program-console-light-color: #ffb000')
    expect(stylesheet).toContain('--program-console-light-color: #ff3b30')
    expect(stylesheet).toContain('--program-console-light-color: #30f064')
    const green = render(createElement(ConsoleTitle, {
      useTabInfo: () => ({ tab: { navigation: navigation(address) } }),
      t: translate,
      watchConsoles: () => (async function* () { yield records })(),
      selectConsole,
    } as Parameters<typeof ConsoleTitle>[0]))
    const activeLight = await screen.findByTitle('console.status.active')
    expect(activeLight.tagName).toBe('SPAN')
    expect(activeLight.className).toContain(css.lightActive)
    fireEvent.click(activeLight)
    expect(selectConsole).toHaveBeenCalledTimes(1)
    green.unmount()
    pane.unmount()
  })
})

interface InjectedCalls {
  openUserConsole?: () => Promise<unknown>
  lookup?: (pid: number, start: string) => Promise<unknown>
  writeConsole?: (pid: number, start: string, data: string) => Promise<unknown>
  resizeConsole?: (pid: number, start: string, cols: number, rows: number) => Promise<unknown>
  followConsole?: (pid: number, start: string, signal: AbortSignal) => AsyncIterable<string>
  watchConsoles?: ((signal: AbortSignal) => AsyncIterable<unknown>) | (() => () => void)
  selectConsole?: (pid: number) => Promise<void>
}

describe('program console client apply', () => {
  it('mounts the remote and opens a console for this session only', async () => {
    const entries: { name: string; key?: string; inject?: (sessionId: SessionId) => InjectedCalls }[] = []
    const openResourceIn = vi.fn()
    const mount = vi.fn(async () => () => {})
    const remote = {
      list: vi.fn(async (): Promise<RemoteResult<ListedProcess[]>> => ({ ok: true, value: [] })),
      launch: vi.fn(async (): Promise<RemoteResult<ConsoleOpenResult>> => ({
        ok: true,
        value: { binding: binding('session'), created: true },
      })),
      openUserConsole: vi.fn(async (): Promise<RemoteResult<ConsoleOpenResult>> => ({
        ok: true,
        value: result('session'),
      })),
      writeConsole: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
      resizeConsole: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
      followConsole: vi.fn((_sessionId: SessionId, _pid: number, _start: string, _signal?: AbortSignal) => ({
        async *[Symbol.asyncIterator]() {},
        send() {},
        end() {},
        dispose() {},
      })),
      open: vi.fn(async (): Promise<RemoteResult<ConsoleOpenResult>> => ({
        ok: true,
        value: { binding: binding('other'), created: false },
      })),
      consoles: vi.fn(async (): Promise<RemoteResult<ConsoleBinding[]>> => ({
        ok: false,
        error: new RemoteError('gateway/internal', 'down', {}),
      })),
      select: vi.fn(async (): Promise<RemoteResult<ConsoleBinding>> => ({
        ok: true,
        value: { ...binding('session'), status: 'active' },
      })),
      watchConsoles: vi.fn((_sessionId: SessionId, _signal?: AbortSignal) => ({
        async *[Symbol.asyncIterator]() {},
        send() {},
        end() {},
        dispose() {},
      })),
    }
    const subscribe = vi.fn(() => () => {})
    let bound = false
    const ctx = {
      remote: { $mount: mount, programConsole: remote },
      locale: { bind: () => t, register: vi.fn(() => () => {}) },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      sidebarRight: { openResourceIn },
      sessions: {
        binding: () => bound ? { session: { subscribe } } : undefined,
        subagentAddress: () => undefined,
      },
      commandUi: {
        register: () => () => {},
      },
      slots: {
        inject: (_name: string, factory: () => void) => { factory(); return () => {} },
        register: (meta: { name: string; key?: string; inject?: (sessionId: SessionId) => InjectedCalls }) => {
          entries.push(meta)
          return () => {}
        },
      },
      effect: (run: () => void) => { run() },
      inject: (_names: string[], factory: (scope: unknown) => void) => { factory(ctx) },
    } as never
    await apply(ctx)
    expect(mount).toHaveBeenCalledOnce()
    const guide = entries.find(entry => entry.name === 'sidebar.right.tab.guide.entry')
    if (guide?.inject === undefined) throw new Error('guide inject missing')
    const guideActions = guide.inject('session' as SessionId)
    if (guideActions.openUserConsole === undefined) throw new Error('guide openUserConsole missing')
    expect(guideActions).not.toHaveProperty('openLaunchTerminal')
    expect(guideActions).not.toHaveProperty('dismissLaunchTerminal')
    await guideActions.openUserConsole()
    expect(remote.openUserConsole).toHaveBeenCalledOnce()
    const start = entries.find(entry => entry.name === 'sidebar.right.pane.tab' && entry.key === '@deepseek-ai/dsh-program-console')
    if (start?.inject === undefined) throw new Error('start inject missing')
    const startActions = start.inject('session' as SessionId)
    if (startActions.openUserConsole === undefined) throw new Error('start openUserConsole missing')
    await startActions.openUserConsole()
    expect(remote.openUserConsole).toHaveBeenCalledTimes(2)
    const processTab = entries.find(entry => entry.key === '@deepseek-ai/dsh-program-console/process')
    if (processTab?.inject === undefined) throw new Error('process inject missing')
    const processActions = processTab.inject('session' as SessionId)
    if (
      processActions.lookup === undefined
      || processActions.writeConsole === undefined
      || processActions.resizeConsole === undefined
      || processActions.followConsole === undefined
    ) {
      throw new Error('process callbacks missing')
    }
    remote.consoles.mockResolvedValueOnce({ ok: true, value: [binding('session')] })
    await expect(processActions.lookup(7, '70')).resolves.toMatchObject({ pid: 7, attachable: true })
    await processActions.writeConsole(7, '70', 'pwd\n')
    await processActions.resizeConsole(7, '70', 80, 24)
    processActions.followConsole(7, '70', new AbortController().signal)
    if (processActions.watchConsoles === undefined || processActions.selectConsole === undefined) {
      throw new Error('process status callbacks missing')
    }
    processActions.watchConsoles(new AbortController().signal)
    await processActions.selectConsole(7)
    expect(remote.writeConsole).toHaveBeenCalledOnce()
    expect(remote.resizeConsole).toHaveBeenCalledOnce()
    expect(remote.followConsole).toHaveBeenCalledOnce()
    expect(remote.watchConsoles).toHaveBeenCalledOnce()
    expect(remote.select).toHaveBeenCalledOnce()
    const titleTab = entries.find(entry => entry.name === 'sidebar.right.pane.tab.title')
    if (titleTab?.inject === undefined) throw new Error('title inject missing')
    const titleActions = titleTab.inject('session' as SessionId)
    if (titleActions.watchConsoles === undefined || titleActions.selectConsole === undefined) {
      throw new Error('title status callbacks missing')
    }
    titleActions.watchConsoles(new AbortController().signal)
    await titleActions.selectConsole(7)
    expect(remote.watchConsoles).toHaveBeenCalledTimes(2)
    expect(remote.select).toHaveBeenCalledTimes(2)
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
    expect(openResourceIn).toHaveBeenCalledTimes(1)
    second()
    vi.useRealTimers()
  })

  it('registers /console as a popupSelect that selects and reveals the chosen Console', async () => {
    const entries: { name: string; key?: string; inject?: (sessionId: SessionId) => InjectedCalls }[] = []
    const contributions: CommandContribution[] = []
    const openResourceIn = vi.fn()
    const remote = {
      list: vi.fn(),
      launch: vi.fn(),
      openUserConsole: vi.fn(),
      writeConsole: vi.fn(),
      resizeConsole: vi.fn(),
      followConsole: vi.fn(),
      open: vi.fn(),
      consoles: vi.fn(async (): Promise<RemoteResult<ConsoleBinding[]>> => ({ ok: true, value: [] })),
      select: vi.fn(async (): Promise<RemoteResult<ConsoleBinding>> => ({
        ok: true,
        value: { ...binding('session'), pid: 8, key: '8\n80', start: '80', status: 'active' },
      })),
      watchConsoles: vi.fn(),
    }
    const ctx = {
      remote: { $mount: vi.fn(async () => () => {}), programConsole: remote },
      locale: { bind: () => t, register: vi.fn(() => () => {}) },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      sidebarRight: { openResourceIn },
      sessions: { binding: () => undefined, subagentAddress: () => undefined },
      commandUi: {
        register: (contribution: CommandContribution) => {
          contributions.push(contribution)
          return () => {}
        },
      },
      slots: {
        inject: (_name: string, factory: () => void) => { factory(); return () => {} },
        register: (meta: { name: string; key?: string; inject?: (sessionId: SessionId) => InjectedCalls }) => {
          entries.push(meta)
          return () => {}
        },
      },
      effect: (run: () => void) => { run() },
      inject: (_names: string[], factory: (scope: unknown) => void) => { factory(ctx) },
    } as never
    await apply(ctx)
    expect(contributions).toHaveLength(1)
    const contribution = contributions[0]!
    expect(contribution.name).toBe('console')
    expect(contribution.ui.kind).toBe('popupSelect')
    expect(contribution.label?.()).toBe('command.label')
    const session = { sessionId: 'session' as SessionId }
    expect(contribution.available(session)).toBe(true)
    const ready: ConsoleBinding = { ...binding('session'), pid: 8, key: '8\n80', start: '80', status: 'ready' }
    const active: ConsoleBinding = { ...binding('session'), pid: 9, key: '9\n90', start: '90', status: 'active' }
    remote.consoles.mockResolvedValue({ ok: true, value: [binding('session'), ready, active] })
    const ui = contribution.ui
    if (ui.kind !== 'popupSelect') throw new Error('expected popupSelect')
    const options = await ui.options(session, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['8', '9'])
    await ui.onSelect(options[0]!, session)
    expect(remote.select).toHaveBeenCalledWith('session', 8)
    expect(openResourceIn).toHaveBeenCalledWith('session', consoleAddress(ready.key), { kind: PROCESS_KIND })
    await ui.onSelect(options[1]!, session)
    expect(remote.select).toHaveBeenCalledTimes(1)
    expect(openResourceIn).toHaveBeenCalledWith('session', consoleAddress(active.key), { kind: PROCESS_KIND })
  })
})
