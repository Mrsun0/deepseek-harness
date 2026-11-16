# Program console

English | [中文](program-console.zh.md)

The experimental program console binds one sidebar Console to one process started from the sidebar guide or with `program_console_launch`. [`@deepseek-ai/dsh-program-console`](../../packages/experimental/program-console/README.md) owns launch, enumeration, and the Console tab. The default composition leaves the plugin unloaded. The bundled skill points at a terminal rose example at `examples/rose.py`, resolved against the skill's base directory. Each tab shows a status light: red when no process has been started, orange when a process has started but the Console is not the model-active target, and green for the unique Console the model should type into.

`ListedProcess`, `ConsoleBinding`, and `ConsoleOpenResult` are the service fields. A binding key joins the process id and its start time. `ConsoleBinding.status` is `idle`, `ready`, or `active`, and matches the red, orange, and green tab lights. Closing the Console tab leaves the process running. A user click on the Console guide entry calls `openUserConsole()`, which starts an interactive shell on a pseudo-terminal the host holds, binds that shell, and opens the Console tab. The user starts a program by typing in that terminal; that Console then becomes the unique active (green) target. `launch()` starts a command on a pseudo-terminal the host holds, then binds an attachable Console and makes it the unique active target. The model starts that program with `program_console_launch`, types into the active Console with `program_console_write`, and switches the active target with `program_console_select`. The Console id for those tools is the process id shown on the tab. A runtime-context block lists every Console, its id, its state, the program running in it when known, and the unique active id; those ids replace any Console ids from earlier turns. Clicking an orange tab light also selects that Console. The user can type `/console` to pick among ready (orange) and active (green) Consoles, which switches the same unique green target as clicking an orange tab light. A process whose PTY master the host does not hold cannot be attached.

A contributor walkthrough is in the [program console cookbook](../cookbook/program-console.md). The shipped decision and development history are in the [program-console Agent Note](../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md)

Source: [`packages/experimental/program-console/src/service.ts`](../../packages/experimental/program-console/src/service.ts)
<!-- END GENERATED cordis-surface -->
