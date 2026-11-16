# 程序控制台

[English](program-console.md) | 中文

实验性程序控制台为通过侧栏入口或 `program_console_launch` 启动的进程绑定一个侧栏控制台。[`@deepseek-ai/dsh-program-console`](../../packages/experimental/program-console/README.zh.md) 负责启动、枚举和控制台页签。默认组合不加载该插件。内置 skill 指向终端玫瑰示例 `examples/rose.py`，路径相对于该 skill 的基目录解析。每个页签都有状态灯：红色表示尚未启动进程，橙色表示已启动进程但不是模型当前的活动目标，绿色表示模型当前应向其输入的唯一控制台。

`ListedProcess`、`ConsoleBinding` 和 `ConsoleOpenResult` 是该服务的字段。绑定键由进程号和启动时间组成。`ConsoleBinding.status` 为 `idle`、`ready` 或 `active`，分别对应红、橙、绿三种页签状态灯。关闭控制台页签后进程继续运行。用户点击控制台入口会调用 `openUserConsole()`：在本机持有的伪终端上启动一个交互式 shell，绑定该 shell，并打开控制台页签。用户在该终端中输入启动程序后，该控制台会成为唯一的活动（绿色）目标。`launch()` 在本机持有的伪终端上启动命令，然后绑定一个可接入的控制台，并将其设为唯一的活动目标。模型用 `program_console_launch` 启动该程序，用 `program_console_write` 向活动控制台输入，并用 `program_console_select` 切换活动目标。这些工具使用的控制台编号就是页签上显示的进程号。运行时上下文会列出每个控制台、其编号、状态、其中正在运行的程序（若已知）以及唯一的活动编号；该列表会取代此前轮次中未再出现的控制台编号。点击橙色页签状态灯也可以选中该控制台。用户可以输入 `/console`，在已启动的控制台（橙色和绿色）中选择，其效果与点击橙色页签状态灯相同，都会切换唯一的绿色目标。本机未持有伪终端主端的进程无法接入。

贡献者教程见[程序控制台手册](../cookbook/program-console.zh.md)。已落地的决策与开发历程见[程序控制台 Agent Note](../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprogramconsole--programconsole"></a>

### `ctx.programConsole` — `ProgramConsole`

One Console per process. User launch, a model launch tool call, and a matching bash or pwsh result all call ensureConsole. `launch()` starts the command with `subprocess.spawnTerminal` and keeps that PTY session in a collection separate from the New command launch terminal.

```ts cordis-catalog
/**
 * List processes whose executable path the platform command could read.
 * @param agent - Caller. The list is the host process table, not session-private.
 * @returns processes grouped later by executable path. Unreadable paths are absent.
 */
@Remote async list(agent: Agent): Promise<ListedProcess[]>

/**
 * Focus the Console for a process, or create it when none is bound.
 * @param agent - Session asking for the Console.
 * @param pid - Process id from {@link list}.
 * @param start - Start time from {@link list}, so a reused pid does not reuse the old Console.
 * @returns the single Console for that process.
 * @throws HarnessError `PROGRAM_CONSOLE_PROCESS_MISSING` when the process is not in the current listing.
 */
@Remote async open(agent: Agent, pid: number, start: string): Promise<ConsoleOpenResult>

/**
 * Run a command with `cmd.exe /d /s /c` or `bash -c` on a pseudo-terminal, then bind a Console to the new process.
 * @param agent - Session that will own the Console when the process has none.
 * @param command - The full command from the dialog or the launch tool. It is one argument to the system shell.
 * @returns the Console for the process the command left running.
 * @throws HarnessError `PROGRAM_CONSOLE_COMMAND_EMPTY` when `command` is blank.
 * @throws HarnessError `PROGRAM_CONSOLE_LAUNCH_NOT_FOUND` when enumeration never sees a matching program.
 */
@Remote async launch(agent: Agent, command: string): Promise<ConsoleOpenResult>

/**
 * Consoles created on this host.
 * @param agent - Caller. The client filters to its own session when opening a tab.
 * @returns every binding. A process has at most one.
 */
@Remote consoles(agent: Agent): Promise<ConsoleBinding[]>
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/program-console/src/service.ts`](../../packages/experimental/program-console/src/service.ts)
<!-- END GENERATED cordis-surface -->
