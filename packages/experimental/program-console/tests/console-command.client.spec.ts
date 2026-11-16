import { describe, expect, it } from 'vitest'
import {
  CONSOLE_SWATCH_ACTIVE,
  CONSOLE_SWATCH_READY,
  consoleCommandOptions,
} from '../src/client/console-command.ts'
import type { ConsoleBinding } from '../src/types.ts'

const labels = {
  typeLabel: 'Console',
  activeDetail: 'Active with the model',
  readyDetail: 'Process started; not the model-active Console',
}

function binding(overrides: Partial<ConsoleBinding> & Pick<ConsoleBinding, 'pid' | 'status'>): ConsoleBinding {
  return {
    key: `${String(overrides.pid)}\nstart`,
    start: 'start',
    exe: '/bin/python3',
    commandLine: 'python3 -q',
    sessionId: 'session',
    createdAt: 1,
    attachable: true,
    ...overrides,
  }
}

describe('consoleCommandOptions', () => {
  it('omits idle Consoles and marks ready and active rows with tab-light colors', () => {
    const options = consoleCommandOptions([
      binding({ pid: 11, status: 'idle' }),
      binding({ pid: 12, status: 'ready' }),
      binding({ pid: 13, status: 'active' }),
    ], labels)
    expect(options).toEqual([
      {
        id: '12',
        label: 'Console 12',
        swatch: CONSOLE_SWATCH_READY,
        detail: labels.readyDetail,
      },
      {
        id: '13',
        label: 'Console 13',
        swatch: CONSOLE_SWATCH_ACTIVE,
        detail: labels.activeDetail,
        active: true,
      },
    ])
    expect(CONSOLE_SWATCH_READY).toBe('#ffb000')
    expect(CONSOLE_SWATCH_ACTIVE).toBe('#30f064')
    expect(options[0]?.active).toBeUndefined()
  })

  it('returns an empty list when no Console has started a process', () => {
    expect(consoleCommandOptions([binding({ pid: 14, status: 'idle' })], labels)).toEqual([])
    expect(consoleCommandOptions([], labels)).toEqual([])
  })
})
