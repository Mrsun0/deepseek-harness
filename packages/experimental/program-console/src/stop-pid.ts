/**
 * Stop a process this plugin launched. A process that has already exited is left alone.
 * @module @deepseek-ai/dsh-program-console/stop-pid
 */

/**
 * Send SIGTERM to a launched pid.
 * @param pid - Process id recorded when the launch was bound.
 * @throws when the signal fails for a reason other than the process already being gone.
 */
export function stopPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error: unknown) {
    if (!isGone(error)) throw error
  }
}

function isGone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'ESRCH'
}
