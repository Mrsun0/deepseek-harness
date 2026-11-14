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
const DESCRIPTION = 'Start the program console process with the bash tool on Linux or the pwsh tool on Windows, using the launch command in this skill. Use when the user asks to open a program console or start its program.'

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

/** The skill registry must be present before the provider is registered. */
export const inject = ['skills']

export type { ConsoleBinding, ConsoleOpenResult, ListedProcess, ProcessGroup } from './types.ts'
export { ProgramConsole } from './service.ts'
export { PROGRAM_CONSOLE_LAUNCH_COMMAND } from './skill-file.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Process Consoles for this host. */
    programConsole: ProgramConsole
  }
}

/**
 * Register the bundled skill, then start the Console service.
 * @param ctx - Root context that already provides `skills` and `subprocess`.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.skills.registerProvider(() => provider)
  await ctx.plugin(ProgramConsole)
}
