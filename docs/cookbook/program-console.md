# Cookbook: program console

English | [中文](program-console.zh.md)

This tutorial shows how the experimental `@deepseek-ai/dsh-program-console` plugin works today: how the right sidebar tab is created, how the host starts and holds a pseudo-terminal (PTY), how `/console` talks to the sidebar and to the model, and what you can do with the result. The [package README](../../packages/experimental/program-console/README.md) is the package contract. The [program-console subsystem page](../subsystems/program-console.md) holds the service types and the generated Cordis API. The iteration that produced these shapes is in the [program-console Agent Note](../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.md); this page stays in the present tense.

## 1. Outcome and prerequisites

After you load the plugin in a Web session, the right sidebar guide shows a Console entry. A click starts an interactive shell on a PTY the host holds, binds a Console tab immediately, and lets you type a program in that terminal. When the model starts an interactive program with `program_console_launch`, a Console tab opens on the same kind of held PTY and becomes the unique green target the model should type into. The default composition does not load the plugin.

To load it from an installed `dsh` CLI:

```bash
dsh --profile web --patch packages/experimental/program-console/cordis.patch.yml --no-open
```

From a source checkout at the repository root, the same overlay is:

```bash
pnpm dsh --profile web --patch packages/experimental/program-console/cordis.patch.yml --no-open
```

The `dsh` workspace script is `node --import tsx/esm apps/cli/src/bin.ts`, so the equivalent direct invocation is `pnpm exec node --import tsx/esm apps/cli/src/bin.ts --profile web --patch ./packages/experimental/program-console/cordis.patch.yml --no-open`. `--no-open` serves the Web UI without opening a browser. The patch inserts the `@deepseek-ai/dsh-program-console` plugin. Restarting that host ends PTY children of the host process, including any open Consoles.

## 2. How the right sidebar is created

The client plugin declares `export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'remote', 'commandUi']`. It does not use `ctx.webTerminals`. On `apply`, it mounts the generated remote with `ctx.remote.$mount(programConsoleRemote)`, registers locale copy, and registers two right-sidebar tab definitions:

- `browseDefinition` — kind `program-console`, implementation id `@deepseek-ai/dsh-program-console`. Its `guide` entry (order 40, title "Console") appears on the right-sidebar guide. A custom guide card starts a bound Console instead of opening this kind as a lasting page.
- `processDefinition` — kind `program-console-process`, implementation id `@deepseek-ai/dsh-program-console/process`. It claims `dsh-resource://program-console/**` addresses that decode to one process, and titles the tab with the process id.

The plugin then fills these slots:

- `sidebar.right.tab.guide.entry` — the `ConsoleGuide` card. A click calls `openUserConsole()`, then `tab.actions.openResource(address, { replaceTab: true })` and `tab.actions.close()`, so the process tab replaces the guide.
- `sidebar.right.pane.tab` for the guide kind — `ConsoleStart`, a fallback that calls `openUserConsole()` on mount (for example from the guide More menu) and replaces the tab the same way.
- `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` for the process kind — `ConsolePane` and `ConsoleTitle`, the bound terminal and the chip with the status light.

The generated `remote.programConsole` namespace exists only after this fiber's own `$mount`. The plugin injects `'remote.programConsole'` on a child scope after that mount, together with `'commandUi'`; it must not be listed as a static top-level `inject`, or the face would wait for a service it creates itself.

`reveal(ctx, sessionId, binding)` is the shared way to focus an already-bound Console: it calls `ctx.sidebarRight.openResourceIn(sessionId, consoleAddress(binding.key), { kind: PROCESS_KIND })`. The client watch and the `/console` `onSelect` handler both use `reveal()`. The guide click path uses `tab.actions.openResource` with `replaceTab: true` instead, because it is replacing the guide tab that initiated the start.

## 3. How the terminal / PTY is created

The host holds one PTY master and one slave per Console session, created with `ctx.subprocess.spawnTerminal`. The bound page and later the tab are views of that master. A process whose PTY master the host does not hold cannot be attached.

There are two start paths, and both keep the session in the same `launchSessions` collection:

- User path — `openUserConsole()` spawns an interactive shell (`launchTerminalArgv` for the platform, 24×80, `terminalType: 'xterm-256color'`), binds that shell immediately with `ensureConsole`, and returns the binding so the client can open the Console tab. The tab starts idle (red). The user types a program in that terminal.
- Model path — `program_console_launch` (the `launch()` remote) runs the command on a held PTY (`launchArgv`, 10×80, same terminal type), waits until enumeration can bind the new process, makes that Console the unique active target, and returns while the process stays running. A client watch on `conversation.session.header.actions` opens a tab for each Console created in the last 10 seconds while its session is on screen.

Closing a Console tab must not terminate the PTY. `ConsolePane` unmount disposes the xterm view and aborts the output subscription; it does not call `handle.terminate()`. The host ends held sessions only when the plugin fiber itself stops (for example when the host process exits or the plugin is unloaded).

The bound view uses `@xterm/xterm` and the fit addon. xterm's `fontFamily` cannot take an unresolved CSS `var()`; the client resolves the computed family with a probe element that is attached to the terminal host, reads `getComputedStyle`, and then removes the probe. The typography token is `--program-console-font: "Ubuntu Sans Mono", "Noto Sans Mono", var(--ds-font-family-code), …`. The stack prefers Ubuntu Sans Mono and Noto Sans Mono because some Chrome fontconfig setups do not expose JetBrains Mono or Fira Code, so official `--ds-font-family-code` can fall through to Liberation Mono. The official ui-commands package cannot bundle a webfont, and this plugin does not ship one either.

Above the bound terminal, a comment-style hint tells the user to start a process and that starting it will reach the model. The English copy is `# Start a new process; starting it will automatically reach the model.` When the Console is the unique active target, a second line states that the model will type into this Console. Those hints live in the header, not in the PTY stream.

## 4. Status lights and the unique active target

Each process tab shows one activity light, driven by `ConsoleBinding.status`:

- Red (`idle`, `#ff3b30`) — no non-shell process has been started, or the Console is not attachable.
- Orange (`ready`, `#ffb000`) — a process has started, but this is not the unique model-active target.
- Green (`active`, `#30f064`) — the unique Console the model should type into.

The lights are 6px SVG discs (`StatusLightMark`): a `viewBox="0 0 16 16"` circle filled with `currentColor`, with no black bezel and no glow.

A newly started non-shell process becomes the unique green target; the previous green tab, if any, becomes orange. If several Consoles start in the same refresh, the latest `createdAt` wins, then the binding key. If the green process exits back to a shell only, that tab goes red and the active target is cleared; another ready (orange) Console is not silently promoted. Clicking an orange light calls `programConsole.select` and makes that Console the unique green target. Clicking a red light only focuses the tab; `select` on an idle Console fails with `PROGRAM_CONSOLE_SELECT_IDLE`.

## 5. How `/console` interacts with the right sidebar and the model

The client registers a contribution with `command.register({ name: 'console', ui: { kind: 'popupSelect' } })`. Official command names are lowercase and match `^[a-z][a-z0-9_-]*$`; `/Console` is not a valid submitted token, and the contribution map lookup is exact. The contribution is hidden for addressed subagent sessions (`available` is false when `sessions.subagentAddress(session.sessionId)` is set), the same rule the official catalog uses for `/model`. There is no collision with official host commands, and `console` is not added to official `SECTION_ROWS`; unlisted contribution rows close the Commands section in catalog order.

The official `SelectOption` type has an optional `swatch` field, rendered in `PopupSelectView` as a small color dot before the label. Ready rows use `#ffb000`; the unique active row uses `#30f064` and `active: true`. Idle (red) Consoles are omitted from the popup.

On select, if the chosen Console is not already active, the handler calls `programConsole.select(sessionId, pid)` and then `reveal()`. If it is already active, the handler only reveals the tab. `/console` does not append a user or developer message, and it does not start a model turn.

The model is informed on the next request, through a runtime-context contribution registered with `systemPrompt.context`:

- Name: `program-console:status`.
- Order: `130` (after `SUBAGENT_DELEGATION` at 120 and before `HARNESS_SOURCE` at 200).
- On `system-prompt/assemble`, the host refreshes bindings first (`prepend: true`) so the text is the current snapshot.

`formatConsoleContext` lists each Console id (the process id shown on the tab), its idle/ready/active (red/orange/green) state, the program running in it when known, and the unique active id. `consoleRunningLabel` prefers current non-shell descendant executable names; otherwise it uses a non-shell bound command line (when it is short enough) or the bound executable's base name. A shell-only Console has no running label. The context also states hard rules: only the listed ids exist in this session; ignore process ids from earlier turns that are not listed; do not use bash, ps, or pwsh to find, inspect, or type into Consoles; if the active Console already has a program, type into it with `program_console_write` rather than launching a duplicate.

The model-facing tools are:

- `program_console_launch` — start a command on a held PTY and bind a Console as the unique active target.
- `program_console_write` — write text into a bound, attachable Console (the tool appends a newline when the text does not already end with `\n` or `\r`) and return output that arrives afterwards.
- `program_console_select` — set the unique model-active Console by the process id shown on the tab.

The skill catalog description in `src/index.ts` and the skill body in `assets/program-console.md` state the same rules. If no Console in the session has the requested pid, `select` (and some open paths) fail with `PROGRAM_CONSOLE_PROCESS_MISSING`. Selecting an idle Console fails with `PROGRAM_CONSOLE_SELECT_IDLE`. Other host failures include `PROGRAM_CONSOLE_COMMAND_EMPTY`, `PROGRAM_CONSOLE_LAUNCH_NOT_FOUND`, and `PROGRAM_CONSOLE_PTY_UNAVAILABLE`.

## 6. What the system ultimately does

The plugin gives the user and the model two start paths that share one PTY view. The user can open a Console from the guide, type a program, and see the tab turn from red to unique green. The model can start an interactive program with `program_console_launch`, which binds a Console and opens the tab automatically. There is at most one green, model-active Console per session. The user can switch that target by clicking an orange tab light or by picking a ready or active row in `/console`. The model types with `program_console_write` and switches with `program_console_select`, using the ids from the current runtime context. A bundled rose-drawing example lives at `assets/examples/rose.py` and is referenced from the skill body, resolved against the skill's base directory. Closing a Console tab does not kill the process.

## 7. Build and reload notes

Regenerate typpert artifacts only when Remote methods change, with `pnpm exec tsx scripts/generate-typert.ts` from the repository root. That command writes typpert output for every contributing workspace package, not only this one.

Compile the host face with:

```bash
pnpm exec tsc -b packages/experimental/program-console/tsconfig.host.json
```

Bundle the client face with:

```bash
pnpm --filter @deepseek-ai/dsh-program-console run bundle
```

The official ui-commands runtime for the Web client is `lib/client.js`, produced by tsdown. A change to `SelectOption.swatch` or `PopupSelectView` is not enough after `tsc -b` alone; rebuild with `pnpm --filter @deepseek-ai/dsh-client-ui-commands run bundle`, then restart the host before the official popup shows swatches.

Client-only program-console changes can appear after a hard reload of the Web UI. Host remotes, runtime context, and official shell changes need a host restart. Restarting dsh kills PTY children of that host.

## Verify

From the repository root, with the workspace Node toolchain on `PATH`:

```bash
pnpm exec vitest run packages/experimental/program-console/tests/status.spec.ts packages/experimental/program-console/tests/skill-text.spec.ts packages/experimental/program-console/tests/service.spec.ts packages/experimental/program-console/tests/console-command.spec.ts packages/experimental/program-console/tests/guide.client.spec.tsx
```

Manually: load the plugin with the command in section 1, open a Console from the guide, start a program such as `python3 -q`, confirm the tab turns green, type `/console` and pick another ready Console if one exists, then ask the model which Console is active and have it type into that program. History and rejected alternatives belong in the [program-console Agent Note](../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.md), not on this page.
