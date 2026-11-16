/**
 * Bundled program-console skill and the host service that binds one Console per process.
 * @module @deepseek-ai/dsh-program-console
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'
import { ProgramConsole } from './service.ts'

const PROVIDER_NAME = 'program-console'

/** Rank of this bundled skill. It matches the skill package's bundled rank. */
export const PROGRAM_CONSOLE_SKILL_RANK = 600
const SKILL_BODY_URL = new URL('../assets/program-console.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = 'Start an interactive program in a bound Console with program_console_launch, or type into a Console the user already started. Each turn\'s program-console context lists the current Console ids, their state, the program running in each, and the unique active (green) id. Trust that list: ignore process ids from earlier turns that are not listed, and do not use bash, ps, or pwsh to find or type into Consoles. If the active Console already has a program, type into it with program_console_write; do not launch a duplicate. Switch the active Console with program_console_select, or when the user picks one with /console. Use when the user asks to open a program console, or when you need a REPL, debugger, or any process the user should type into in a Console.'

const CANDIDATE: SkillCandidate = {
  name: 'program-console',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: PROGRAM_CONSOLE_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'program-console'

/** The skill registry and tool registry must be present before the provider and the launch, write, and select tools are registered. */
export const inject = ['skills', 'tools']

export type { ConsoleBinding, ConsoleOpenResult, ConsoleStatus, ListedProcess, ProcessGroup } from './types.ts'
export {
  ProgramConsole,
  PROGRAM_CONSOLE_LAUNCH_TOOL,
  PROGRAM_CONSOLE_SELECT_TOOL,
  PROGRAM_CONSOLE_WRITE_TOOL,
} from './service.ts'
export {
  PROGRAM_CONSOLE_CONTEXT_NAME,
  PROGRAM_CONSOLE_CONTEXT_ORDER,
  formatConsoleContext,
} from './status.ts'
export { PROGRAM_CONSOLE_LAUNCH_COMMAND } from './skill-file.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Process Consoles for this host. */
    programConsole: ProgramConsole
  }
}

/**
 * Register the bundled skill, then start the Console service and the launch, write, and select tools.
 * @param ctx - Root context that already provides `skills`, `tools`, and `subprocess`.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.skills.registerProvider(() => provider)
  await ctx.plugin(ProgramConsole)
}
