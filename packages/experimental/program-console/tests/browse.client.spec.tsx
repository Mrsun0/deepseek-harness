// @vitest-environment jsdom
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { consoleAddress } from '../src/process-list.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from '../src/types.ts'
import { ProgramBrowse } from '../src/client/Browse.tsx'
import { ConsoleBody, ConsolePane, ConsoleTitle } from '../src/client/ConsolePane.tsx'
import { browseDefinition, processDefinition } from '../src/client/definition.ts'
import { apply } from '../src/client/index.ts'
import { ConsoleOpener } from '../src/client/Opener.tsx'

const t = (key: string): string => key
const row: ListedProcess = { pid: 7, start: '70', exe: '/usr/bin/node', commandLine: 'node loop' }

function binding(sessionId: string): ConsoleBinding {
  return {
    key: '7\n70', pid: 7, start: '70', exe: '/usr/bin/node', commandLine: 'node loop', sessionId, createdAt: 1,
  }
}

describe('program console browse', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('shows an empty list, a failed list, and ignores a list that finishes after unmount', async () => {
    const failed = render(createElement(ProgramBrowse, {
      t, list: () => Promise.reject(new Error('down')), launch: async () => {}, openProcess: async (): Promise<'opened' | 'taken'> => 'opened',
    }))
    expect(await screen.findByText('browse.listFailed')).toBeTruthy()
    failed.unmount()

    const empty = render(createElement(ProgramBrowse, {
      t, list: () => Promise.resolve([]), launch: async () => {}, openProcess: async (): Promise<'opened' | 'taken'> => 'opened',
    }))
    expect(await screen.findByText('browse.empty')).toBeTruthy()
    fireEvent.click(screen.getByText('browse.refresh'))
    expect(await screen.findByText('browse.empty')).toBeTruthy()
    empty.unmount()

    let resolveRows: (rows: readonly ListedProcess[]) => void = () => {}
    const resolved = render(createElement(ProgramBrowse, {
      t,
      list: () => new Promise<readonly ListedProcess[]>((resolve) => { resolveRows = resolve }),
      launch: async () => {},
      openProcess: async (): Promise<'opened' | 'taken'> => 'opened',
    }))
    resolved.unmount()
    resolveRows([row])
    let rejectRows: (error: Error) => void = () => {}
    const rejected = render(createElement(ProgramBrowse, {
      t,
      list: () => new Promise<readonly ListedProcess[]>((_resolve, reject) => { rejectRows = reject }),
      launch: async () => {},
      openProcess: async (): Promise<'opened' | 'taken'> => 'opened',
    }))
    rejected.unmount()
    rejectRows(new Error('late'))
    await Promise.resolve()
  })

  it('expands an executable, opens or refuses its process, and launches a command', async () => {
    let outcome: 'opened' | 'taken' = 'taken'
    const launch = vi.fn<(command: string) => Promise<void>>()
    launch.mockResolvedValue(undefined)
    const view = render(createElement(ProgramBrowse, {
      t,
      list: () => Promise.resolve([row, { ...row, pid: 8, start: '80', commandLine: 'node other' }]),
      launch,
      openProcess: async () => outcome,
    }))
    expect(await screen.findByText('/usr/bin/node')).toBeTruthy()
    fireEvent.click(screen.getByText('/usr/bin/node'))
    fireEvent.click(screen.getByText('node loop'))
    expect(await screen.findByText('browse.taken')).toBeTruthy()
    outcome = 'opened'
    fireEvent.click(screen.getByText('node other'))
    await waitFor(() => { expect(screen.queryByText('browse.taken')).toBeNull() })
    fireEvent.click(screen.getByText('/usr/bin/node'))
    expect(screen.queryByText('node loop')).toBeNull()

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
