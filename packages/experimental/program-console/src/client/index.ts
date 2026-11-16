/** Register the Console guide, the process page, and the watch that opens a new binding. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import { IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import programConsoleRemote from '@deepseek-ai/dsh-program-console/remote'
import { consoleAddress } from '../process-list.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from '../types.ts'
import { ConsoleGuide, type ConsoleGuideInjected } from './ConsoleGuide.tsx'
import { ConsolePane, ConsoleTitle } from './ConsolePane.tsx'
import { ConsoleStart } from './ConsoleStart.tsx'
import { consoleCommandOptions } from './console-command.ts'
import { BROWSE_ID, BROWSE_KIND, PROCESS_ID, PROCESS_KIND, browseDefinition, processDefinition } from './definition.ts'
import { dictionaries } from './locales.ts'
import { ConsoleOpener, type ConsoleOpenerInjected } from './Opener.tsx'
import { watchConsoles } from './watch.ts'

/** Services the browser half uses. */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'remote', 'commandUi']

/**
 * Mount the remote, then register the guide and the process page.
 * @param ctx - Client context for the session that enabled this bundle.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(programConsoleRemote)
  const namespace = 'programConsole'
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => ctx.locale.register(namespace, dictionaries), 'program-console: copy')
  ctx.effect(() => ctx.sidebarRightTabs.register(browseDefinition(t)), 'program-console: browse')
  ctx.effect(() => ctx.sidebarRightTabs.register(processDefinition(t)), 'program-console: process')
  // The generated namespace only exists after this fiber's own mount; injecting
  // it on a child scope reads the carrier without making the face wait for a
  // service it creates itself.
  ctx.inject(['commandUi', 'remote.programConsole'], (scope) => {
    const programConsole = scope.remote.programConsole
    const openUserConsole = (sessionId: SessionId): ConsoleGuideInjected['openUserConsole'] => (
      async () => value(programConsole.openUserConsole(sessionId))
    )
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
      name: 'sidebar.right.tab.guide.entry',
      key: BROWSE_ID,
      locale: namespace,
      inject: (sessionId: SessionId) => ({ openUserConsole: openUserConsole(sessionId) }),
    }, ConsoleGuide)), 'program-console: guide')
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: BROWSE_ID,
      locale: namespace,
      inject: (sessionId: SessionId) => ({ openUserConsole: openUserConsole(sessionId) }),
    }, ConsoleStart)), 'program-console: start body')
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: PROCESS_ID,
      locale: namespace,
      inject: (sessionId: SessionId) => ({
        lookup: async (pid: number, start: string) => {
          const bindings = await value(programConsole.consoles(sessionId))
          return bindings.find(binding => binding.pid === pid && binding.start === start)
        },
        writeConsole: (pid: number, start: string, data: string) => value(programConsole.writeConsole(sessionId, pid, start, data)),
        resizeConsole: (pid: number, start: string, cols: number, rows: number) =>
          value(programConsole.resizeConsole(sessionId, pid, start, cols, rows)),
        followConsole: (pid: number, start: string, signal: AbortSignal) => programConsole.followConsole(sessionId, pid, start, signal),
        watchConsoles: (signal: AbortSignal) => programConsole.watchConsoles(sessionId, signal),
        selectConsole: (pid: number) => value(programConsole.select(sessionId, pid)).then(() => {}),
      }),
    }, ConsolePane)), 'program-console: process body')
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: PROCESS_ID,
      locale: namespace,
      inject: (sessionId: SessionId) => ({
        watchConsoles: (signal: AbortSignal) => programConsole.watchConsoles(sessionId, signal),
        selectConsole: (pid: number) => value(programConsole.select(sessionId, pid)).then(() => {}),
      }),
    }, ConsoleTitle)), 'program-console: process title')
    const watches = new Map<SessionId, ConsoleOpenerInjected>()
    ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'program-console',
      locale: namespace,
      inject: (sessionId: SessionId): ConsoleOpenerInjected => {
        const existing = watches.get(sessionId)
        if (existing !== undefined) return existing
        const created: ConsoleOpenerInjected = {
          watchConsoles: () => watchConsoles(sessionId, {
            consoles: () => value(programConsole.consoles(sessionId)),
            open: (binding) => { reveal(ctx, sessionId, binding) },
            subscribe: (listener) => {
              const binding = ctx.sessions.binding(sessionId)
              if (binding === undefined) return () => {}
              return binding.session.subscribe(listener)
            },
          }),
        }
        watches.set(sessionId, created)
        return created
      },
    }, ConsoleOpener)), 'program-console: opener')
    const command = scope.commandUi as CommandUiContract
    const sessions = scope.sessions
    ctx.effect(() => command.register({
      name: 'console',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: IconCodeOutlineRegular,
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        searchLabels: () => ({
          placeholder: t('command.search.placeholder'),
          empty: t('command.search.empty'),
          noResults: t('command.search.noResults'),
        }),
        options: async (session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('console selection is unavailable for addressed subagent sessions')
          }
          const bindings = await value(programConsole.consoles(session.sessionId))
          return consoleCommandOptions(
            bindings.filter(binding => binding.sessionId === session.sessionId),
            {
              typeLabel: t('type.label'),
              activeDetail: t('command.option.active'),
              readyDetail: t('command.option.ready'),
            },
          )
        },
        onSelect: async (option, session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('console selection is unavailable for addressed subagent sessions')
          }
          const pid = Number(option.id)
          const bindings = await value(programConsole.consoles(session.sessionId))
          const binding = bindings.find(row => row.pid === pid && row.sessionId === session.sessionId)
          if (binding === undefined) {
            throw new Error(`no Console with pid ${String(pid)} in this session`)
          }
          if (binding.status !== 'active') {
            await value(programConsole.select(session.sessionId, pid))
          }
          reveal(ctx, session.sessionId, binding)
        },
      },
    }), 'program-console: /console contribution')
  })
}

async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error('program-console remote call failed')
  return settled.value
}

function reveal(ctx: Context, sessionId: SessionId, binding: ConsoleBinding): void {
  ctx.sidebarRight.openResourceIn(sessionId, consoleAddress(binding.key), { kind: PROCESS_KIND })
}

export type { ListedProcess, ConsoleOpenResult }
export { BROWSE_KIND, PROCESS_KIND }
