/**
 * Read the launch command stored in the bundled program-console skill.
 * @module @deepseek-ai/dsh-program-console/skill-text
 */

const MARKER = 'launch-command:'

/**
 * Read the `launch-command:` line from the skill body.
 * @param markdown - Skill markdown.
 * @returns the command the model passes to bash or pwsh.
 * @throws when the skill has no command.
 */
export function launchCommand(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(MARKER)) continue
    const command = trimmed.slice(MARKER.length).trim()
    if (command.length > 0) return command
  }
  throw new Error('program console skill has no launch-command')
}
