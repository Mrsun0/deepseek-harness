/** Sidebar tab types for the program list and one process Console. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { GuideArtworkBrowser } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { keyFromAddress } from '../process-list.ts'
import type { ProgramConsoleKey } from './locales.ts'

/** Browse-page kind. The guide opens this. */
export const BROWSE_KIND = 'program-console'

/** Process Console kind. One resource address is one process. */
export const PROCESS_KIND = 'program-console-process'

/** Browse implementation id and slot key. */
export const BROWSE_ID = '@deepseek-ai/dsh-program-console'

/** Process Console implementation id and slot key. */
export const PROCESS_ID = '@deepseek-ai/dsh-program-console/process'

/**
 * Build the browse tab type.
 * @param t - Locale function for the guide and the chip.
 * @returns the tab definition.
 */
export function browseDefinition(t: TranslateNS<'programConsole'>): SidebarRightTabDefinition {
  return {
    id: BROWSE_ID,
    kind: BROWSE_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'program-console',
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: GuideArtworkBrowser,
    }],
  }
}

/**
 * Build the process Console tab type.
 * @param t - Locale function for the chip.
 * @returns the tab definition. It claims only addresses that decode to one process.
 */
export function processDefinition(t: TranslateNS<'programConsole'>): SidebarRightTabDefinition {
  return {
    id: PROCESS_ID,
    kind: PROCESS_KIND,
    priority: 'builtin',
    patterns: ['dsh-resource://program-console/**'],
    canOpen: address => keyFromAddress(address) !== undefined,
    title: (address) => {
      const key = keyFromAddress(address)
      return key === undefined ? t('console.chip') : `${t('console.chip')} ${key.slice(0, key.indexOf('\n'))}`
    },
  }
}

export type { ProgramConsoleKey }
