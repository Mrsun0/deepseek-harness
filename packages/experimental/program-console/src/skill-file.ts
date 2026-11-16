/**
 * The launch command shipped in the bundled skill file.
 * @module @deepseek-ai/dsh-program-console/skill-file
 */

import { readFileSync } from 'node:fs'
import { launchCommand } from './skill-text.ts'

/** Example keep-alive command shipped in the bundled skill file. */
export const PROGRAM_CONSOLE_LAUNCH_COMMAND = launchCommand(readFileSync(
  new URL('../assets/program-console.md', import.meta.url),
  'utf8',
))
