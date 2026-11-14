import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopPid } from '../src/stop-pid.ts'

function thrownBy(pid: number): unknown {
  try {
    stopPid(pid)
  } catch (error: unknown) {
    return error
  }
  return undefined
}

describe('stopPid', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('ignores a process that has already exited and reports other failures', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('gone') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    })
    expect(thrownBy(40)).toBeUndefined()
    expect(kill).toHaveBeenCalledWith(40, 'SIGTERM')
    kill.mockImplementation(() => {
      const error = new Error('denied') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })
    expect(thrownBy(41)).toMatchObject({ message: 'denied' })
    kill.mockImplementation(() => { throw new Error('plain') })
    expect(thrownBy(42)).toMatchObject({ message: 'plain' })
    kill.mockImplementation(() => { throw 'text' })
    expect(thrownBy(43)).toBe('text')
    kill.mockImplementation(() => { throw null })
    expect(thrownBy(44)).toBeNull()
  })
})
