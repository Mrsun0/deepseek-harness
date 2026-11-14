/** English and Chinese copy for the program console sidebar. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** English copy. The keys are the locale contract. */
export const en = {
  'type.label': 'Console',
  'guide.title': 'Console',
  'guide.description': 'Bind a console to a running program',
  'browse.loading': 'Reading programs',
  'browse.empty': 'No programs with a readable executable',
  'browse.listFailed': 'The program list could not be read',
  'browse.new': 'New command',
  'browse.refresh': 'Refresh',
  'browse.command': 'Launch command',
  'browse.start': 'Start',
  'browse.cancel': 'Cancel',
  'browse.commandEmpty': 'Enter a command',
  'browse.launchFailed': 'The command did not leave a process to bind',
  'browse.taken': 'This process already has a console in another session',
  'browse.expandProcesses': 'Show processes',
  'browse.collapseProcesses': 'Hide processes',
  'console.chip': 'Console',
  'console.bound': 'This console is bound to the process',
  'console.missing': 'This console address is not a process',
  'console.inputUnavailable': 'This launch does not keep a terminal, so further input is not available',
  'console.pid': 'Process',
  'console.start': 'Start',
} as const

/** Locale key owned by this package. */
export type ProgramConsoleKey = keyof typeof en

/** Chinese copy for every {@link ProgramConsoleKey}. */
export const zh: Record<ProgramConsoleKey, string> = {
  'type.label': '控制台',
  'guide.title': '控制台',
  'guide.description': '把控制台绑定到正在运行的程序',
  'browse.loading': '正在读取程序',
  'browse.empty': '没有能读到可执行文件的程序',
  'browse.listFailed': '程序列表无法读取',
  'browse.new': '新建命令',
  'browse.refresh': '刷新',
  'browse.command': '启动命令',
  'browse.start': '启动',
  'browse.cancel': '取消',
  'browse.commandEmpty': '请输入命令',
  'browse.launchFailed': '这条命令没有留下可绑定的进程',
  'browse.taken': '这个进程的控制台已经在另一个会话里',
  'browse.expandProcesses': '展开进程',
  'browse.collapseProcesses': '收起进程',
  'console.chip': '控制台',
  'console.bound': '此控制台已绑定该进程',
  'console.missing': '这个控制台地址不是一个进程',
  'console.inputUnavailable': '这次启动没有留下终端，不能再继续输入',
  'console.pid': '进程',
  'console.start': '启动时间',
}

/** Dictionaries registered under the `programConsole` namespace. */
export const dictionaries = { en, zh }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    programConsole: ProgramConsoleKey
  }
}
