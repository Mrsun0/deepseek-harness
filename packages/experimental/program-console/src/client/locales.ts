/** English and Chinese copy for the program console sidebar. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** English copy. The keys are the locale contract. */
export const en = {
  'type.label': 'Console',
  'guide.title': 'Console',
  'guide.description': 'Open a Console and start a program in it',
  'guide.opening': 'Opening a Console…',
  'guide.failed': 'The Console could not be opened',
  'guide.retry': 'Retry',
  'console.chip': 'Console',
  'console.bound': 'This console is bound to the process',
  'console.missing': 'This console address is not a process',
  'console.inputUnavailable': 'This process has no attachable terminal, so input is not available here',
  'console.terminalFailed': 'The console terminal could not be attached',
  'console.pid': 'Process',
  'console.start': 'Start',
  'console.startHint': '# Start a new process; starting it will automatically reach the model.',
  'console.status.active': 'Active with the model',
  'console.status.ready': 'Process started; click to make this the model-active Console',
  'console.status.idle': 'No process has been started yet',
  'console.activeHint': 'This Console is the model-active target. The model will type into this Console.',
  'command.label': 'Console',
  'command.description': 'Switch the model-active Console',
  'command.search.placeholder': 'Search Consoles…',
  'command.search.empty': 'No started (orange or green) Console yet.',
  'command.search.noResults': 'No matching Consoles.',
  'command.option.active': 'Active with the model',
  'command.option.ready': 'Process started; not the model-active Console',
} as const

/** Locale key owned by this package. */
export type ProgramConsoleKey = keyof typeof en

/** Chinese copy for every {@link ProgramConsoleKey}. */
export const zh: Record<ProgramConsoleKey, string> = {
  'type.label': '控制台',
  'guide.title': '控制台',
  'guide.description': '打开控制台并在其中启动程序',
  'guide.opening': '正在打开控制台…',
  'guide.failed': '无法打开控制台',
  'guide.retry': '重试',
  'console.chip': '控制台',
  'console.bound': '此控制台已绑定该进程',
  'console.missing': '这个控制台地址不是一个进程',
  'console.inputUnavailable': '此进程没有可接入的终端，无法在此输入',
  'console.terminalFailed': '无法接入该控制台终端',
  'console.pid': '进程',
  'console.start': '启动时间',
  'console.startHint': '# 请启动一个新进程，启动进程将自动触达模型。',
  'console.status.active': '正在与模型连接并活动',
  'console.status.ready': '已启动进程，点击可将此控制台设为模型活动目标',
  'console.status.idle': '尚未启动进程',
  'console.activeHint': '此控制台是模型的活动目标，模型会向此控制台输入。',
  'command.label': '控制台',
  'command.description': '切换模型当前使用的控制台',
  'command.search.placeholder': '搜索控制台…',
  'command.search.empty': '还没有已启动的控制台（橙色或绿色）。',
  'command.search.noResults': '没有匹配的控制台。',
  'command.option.active': '正在与模型连接并活动',
  'command.option.ready': '已启动进程，但不是模型当前目标',
}

/** Dictionaries registered under the `programConsole` namespace. */
export const dictionaries = { en, zh }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    programConsole: ProgramConsoleKey
  }
}
