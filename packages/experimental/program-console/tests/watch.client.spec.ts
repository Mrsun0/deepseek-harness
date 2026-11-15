import { describe, expect, it, vi } from 'vitest'
import type { ConsoleBinding } from '../src/types.ts'
import { CONSOLE_WATCH_DELAY_MS, watchConsoles } from '../src/client/watch.ts'

function binding(key: string, sessionId: string, createdAt: number): ConsoleBinding {
  const [pid, start] = key.split('\n')
  return {
    key, pid: Number(pid), start: start ?? '', exe: '/bin/node', commandLine: 'node', sessionId, createdAt,
  }
}

describe('console watch', () => {
  it('opens only a recent console for this session', async () => {
    vi.useFakeTimers()
    const now = 10_000
    const open = vi.fn()
    let records: readonly ConsoleBinding[] = [
      binding('1\n1', 'other', now),
      binding('2\n2', 'session', now - 20_000),
      binding('3\n3', 'session', now - 1_000),
    ]
    let listener: () => void = () => {}
    const stop = watchConsoles('session', {
      consoles: () => Promise.resolve(records),
      open,
      subscribe: (next) => {
        listener = next
        return () => {}
      },
      now: () => now,
    })
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_DELAY_MS)
    expect(open).toHaveBeenCalledExactlyOnceWith(records[2])
    listener()
    listener()
    records = [...records, binding('4\n4', 'session', now)]
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_DELAY_MS)
    expect(open).toHaveBeenCalledTimes(2)
    stop()
    listener()
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_DELAY_MS)
    expect(open).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('ignores a list that fails and a pull that resolves after stop', async () => {
    vi.useFakeTimers()
    const open = vi.fn()
    let resolveRows: (rows: readonly ConsoleBinding[]) => void = () => {}
    const stop = watchConsoles('session', {
      consoles: () => Promise.reject(new Error('offline')),
      open,
      subscribe: () => () => {},
    })
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_DELAY_MS)
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
    vi.setSystemTime(10_000)
    const opened = watchConsoles('session', {
      consoles: () => Promise.resolve([binding('5\n5', 'session', 9_000)]),
      open,
      subscribe: () => () => {},
    })
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_DELAY_MS)
    expect(open).toHaveBeenCalledOnce()
    opened()
    const pending = watchConsoles('session', {
      consoles: () => new Promise((resolve) => { resolveRows = resolve }),
      open,
      subscribe: () => () => {},
    })
    await vi.advanceTimersByTimeAsync(CONSOLE_WATCH_DELAY_MS)
    pending()
    resolveRows([binding('9\n9', 'session', Date.now())])
    await Promise.resolve()
    expect(open).toHaveBeenCalledOnce()
    stop()
    vi.useRealTimers()
  })
})
