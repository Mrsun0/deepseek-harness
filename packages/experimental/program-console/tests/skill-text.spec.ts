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
    const rose = readFileSync(new URL('../assets/examples/rose.py', import.meta.url), 'utf8')
    expect(PROGRAM_CONSOLE_LAUNCH_COMMAND).toBe('node -e "setInterval(() => {}, 1000000000)"')
    expect(body).toContain(`launch-command: ${PROGRAM_CONSOLE_LAUNCH_COMMAND}`)
    expect(body).toContain('program_console_launch')
    expect(body).toContain('program_console_write')
    expect(body).toContain('program_console_select')
    expect(body).toContain('active (green)')
    expect(body).toContain('Trust that list')
    expect(body).toContain('do not call program_console_launch to start a duplicate')
    expect(body).toContain('Do not use bash, ps, or pwsh')
    expect(body).toContain('examples/rose.py')
    expect(body).toContain('python3 -q')
    expect(body).not.toContain('run_in_background')
    expect(body).not.toMatch(/Do not use a PTY/i)
    expect(body).not.toMatch(/exact command argument of the bash tool/i)
    expect(rose).toContain('five petals, two whorls')
    expect(rose).toContain('cos(5')
    expect(rose).not.toContain('PIL')
    expect(rose).not.toContain('/workspace/')
    expect(PROGRAM_CONSOLE_SKILL_RANK).toBe(BUNDLED_SKILL_RANK)
  })
})
