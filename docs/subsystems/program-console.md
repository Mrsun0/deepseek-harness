# Program console

English | [中文](program-console.zh.md)

The experimental program console binds one sidebar Console to one process and lists processes by executable path. [`@deepseek-ai/dsh-program-console`](../../packages/experimental/program-console/README.md) owns launch, enumeration, and the browse page. The default composition leaves the plugin unloaded.

`ListedProcess`, `ConsoleBinding`, and `ConsoleOpenResult` are the service fields. A binding key joins the process id and its start time. Closing the Console tab leaves the process running. Launch uses `subprocess.spawn` and leaves stdin ignored.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprogramconsole--programconsole"></a>

### `ctx.programConsole` — `ProgramConsole`

One Console per process. User launch and a matching bash or pwsh result both call ensureConsole. Launch uses `subprocess.spawn`, never a terminal.

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
 * Run a command with `cmd.exe /d /s /c` or `bash -c`, then bind a Console to the new process.
 * @param agent - Session that will own the Console when the process has none.
 * @param command - The full command from the dialog. It is one argument to the system shell.
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

Types: [Agent](core.md)

Source: [`packages/experimental/program-console/src/service.ts`](../../packages/experimental/program-console/src/service.ts)
<!-- END GENERATED cordis-surface -->
