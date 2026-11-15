import { readFileSync } from 'node:fs'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import { PROGRAM_CONSOLE_SKILL_RANK } from '../src/index.ts'
import { PROGRAM_CONSOLE_LAUNCH_COMMAND } from '../src/skill-file.ts'
import { launchCommand } from '../src/skill-text.ts'

describe('program console skill', () => {
  it('reads the launch command from the skill body', () => {
    expect(launchCommand('note\nlaunch-command: node -e "stay()"\n')).toBe('node -e "stay()"')
    expect(() => launchCommand('launch-command:\n')).toThrow('program console skill has no launch-command')
    expect(() => launchCommand('no command here')).toThrow('program console skill has no launch-command')
    expect(() => launchCommand('launch-command:   ')).toThrow('program console skill has no launch-command')
  })

  it('ships that command in the bundled skill file', () => {
    const body = readFileSync(new URL('../assets/program-console.md', import.meta.url), 'utf8')
    expect(PROGRAM_CONSOLE_LAUNCH_COMMAND).toBe('node -e "setInterval(() => {}, 1000000000)"')
    expect(body).toContain(`launch-command: ${PROGRAM_CONSOLE_LAUNCH_COMMAND}`)
    expect(body).toContain('run_in_background')
    expect(PROGRAM_CONSOLE_SKILL_RANK).toBe(BUNDLED_SKILL_RANK)
  })
})
