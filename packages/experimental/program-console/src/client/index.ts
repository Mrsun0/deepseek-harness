/** Register the Console guide, the process page, and the watch that opens a new binding. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import programConsoleRemote from '@deepseek-ai/dsh-program-console/remote'
import { consoleAddress } from '../process-list.ts'
import type { ConsoleBinding, ConsoleOpenResult, ListedProcess } from '../types.ts'
import { ProgramBrowse } from './Browse.tsx'
import { ConsolePane, ConsoleTitle } from './ConsolePane.tsx'
import { BROWSE_ID, BROWSE_KIND, PROCESS_ID, PROCESS_KIND, browseDefinition, processDefinition } from './definition.ts'
import { dictionaries } from './locales.ts'
import { ConsoleOpener, type ConsoleOpenerInjected } from './Opener.tsx'
import { watchConsoles } from './watch.ts'

/** Services the browser half uses. */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'remote']

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
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: BROWSE_ID,
    locale: namespace,
    inject: (sessionId: SessionId) => ({
      list: () => value(ctx.remote.programConsole.list(sessionId)),
      launch: async (command: string) => {
        const opened = await value(ctx.remote.programConsole.launch(sessionId, command))
        reveal(ctx, sessionId, opened.binding)
      },
      openProcess: async (pid: number, start: string) => {
        const opened = await value(ctx.remote.programConsole.open(sessionId, pid, start))
        if (opened.binding.sessionId !== sessionId) return 'taken' as const
        reveal(ctx, sessionId, opened.binding)
        return 'opened' as const
      },
    }),
  }, ProgramBrowse)), 'program-console: browse body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PROCESS_ID, locale: namespace,
  }, ConsolePane)), 'program-console: process body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: PROCESS_ID, locale: namespace,
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
          consoles: () => value(ctx.remote.programConsole.consoles(sessionId)),
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
