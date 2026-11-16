# Agent Note: Program consoles bound to a held PTY

Status: implemented

English | [中文](2026-11-16-program-console-bound-pty.zh.md)

## Problem

The experimental program-console plugin could list processes and bind a sidebar Console to a selected row, but that was not enough for interactive work. A Console that talked to a process through ordinary stdin and stdout pipes could not host a REPL, a debugger, or any other program that expects a real terminal. A process the host had not started itself had no PTY master the Console could attach to, so "bind any already-running process" was not a complete product. The intended capability is that when a person or the model starts an interactive program, a visible Console is bound to a PTY the host holds, the person can watch and type, and the model can type into a unique active Console without inventing process ids or sending a fake user message.

## Decision

The experimental [`@deepseek-ai/dsh-program-console`](../../../../packages/experimental/program-console/README.md) plugin binds one right-sidebar Console to a PTY session the host holds. The default composition leaves the plugin unloaded; a Web session loads it with the package `cordis.patch.yml`. The [program console cookbook](../../../../docs/cookbook/program-console.md) is the current how-to; this note records the shipped decision and the work that produced it.

### Held PTY and two start paths

The host creates each session with `ctx.subprocess.spawnTerminal` and retains one master and one slave. The bound page and the Console tab are views of that master. A process whose master the host does not hold cannot be attached.

`openUserConsole()` starts an interactive shell, binds that shell immediately, and returns the binding so the client can open a Console tab. The user types a program in that terminal; the tab starts red until a non-shell process appears. `program_console_launch` (`launch()`) starts the model's command on a held PTY, binds the new process, makes that Console the unique active target, and returns while the process stays running. A client watch opens a tab for a Console created while its session is on screen. Closing a Console tab does not call `handle.terminate()` and does not end the process.

### Sidebar presentation

The client injects `['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'remote', 'commandUi']` and does not use `ctx.webTerminals`. It registers a guide tab definition and a process tab definition, and fills `sidebar.right.tab.guide.entry`, `sidebar.right.pane.tab`, and `sidebar.right.pane.tab.title`. The generated `remote.programConsole` service is injected on a child scope after `$mount`, not as a static top-level inject. The bound view is an xterm PTY with the fit addon. xterm resolves a computed `fontFamily` through a probe element because it cannot take an unresolved CSS `var()`. `--program-console-font` prefers Ubuntu Sans Mono and Noto Sans Mono ahead of official `--ds-font-family-code`, because some Chrome fontconfig setups do not expose JetBrains Mono or Fira Code. A comment-style hint above the terminal tells the user that starting a process will reach the model.

### Unique active target, lights, and `/console`

Each tab has a status light: red idle, orange ready, green unique active. The lights are 6px SVG discs with fluorescent fills `#ff3b30`, `#ffb000`, and `#30f064`, with no black bezel and no glow. A newly started non-shell process becomes the unique green target; the previous green tab becomes orange. If the green process exits back to a shell only, the tab goes red and the active target is cleared, without silently promoting another ready Console. Clicking an orange light, or picking a ready or active row in `/console`, calls `programConsole.select` and then focuses the tab. Clicking a red light only focuses the tab.

`/console` is a client contribution, `command.register({ name: 'console', ui: { kind: 'popupSelect' } })`. Official command names are lowercase; `/Console` is not a valid submitted token. The contribution is hidden for addressed subagent sessions, the same availability rule the official catalog uses for `/model`. `console` is not added to official `SECTION_ROWS`. Official `SelectOption` has an optional `swatch`, rendered in `PopupSelectView`. `/console` does not append a user or developer message and does not start a model turn.

### Runtime context and model tools

The model reads the current Consoles from runtime context `program-console:status` (order 130) registered with `systemPrompt.context`. On `system-prompt/assemble` the host refreshes bindings first. The text lists each Console id (the process id on the tab), its state, the program running in it when known (`consoleRunningLabel` uses non-shell descendant executables or a non-shell command line), and the unique active id. It also states hard rules: only listed ids exist; ignore historical process ids that are not listed; do not use bash, ps, or pwsh to find or type into Consoles; if the active Console already has a program, call `program_console_write` rather than launching a duplicate. The skill catalog description in `src/index.ts` and the body in `assets/program-console.md` match those rules. The model tools are `program_console_launch`, `program_console_write`, and `program_console_select`. `PROGRAM_CONSOLE_PROCESS_MISSING` and `PROGRAM_CONSOLE_SELECT_IDLE` are the select-path failures. A bundled rose example lives at `assets/examples/rose.py`.

### Constraints that shipped

The plugin does not fake a user message to notify the model. Command names stay lowercase, and `console` is not added to official `SECTION_ROWS`. Official package assets cannot bundle fonts. Closing a tab does not terminate the PTY. Typpert artifacts are regenerated only when remotes change.

## Development history

The work recorded here happened on 2026-11-16, starting from the experimental plugin that had already landed on this fork: a process list presented as a file tree, with a Console bound to a selected process.

1. Hover and process-list polish. The popup trigger expanded to the whole row; typography matched the file tree, used blue text, and sat at the start of the filename plus about two spaces; tiny clipped glyphs were fixed.
2. The New Command toolbar copy and button landed, and refresh became a rotate-arrow in the tree corner.
3. After New Command, a green temporary terminal about ten rows tall appeared, with a check to dismiss it. Non-system processes started there were recorded, then bound through the file tree.
4. The team compared stdin/stdout pipes with a PTY. A PTY is the right fit for interactive programs. The host holds the PTY master; the bound page and later the tab are views of that master; a process whose master the host does not hold cannot be attached. Binding an already-started process without a held master is not possible.
5. The bound page was redesigned as a VS Code-like console (xterm on the held PTY), not a split log plus a three-line input that used pipes.
6. The main intended feature landed: when the model starts an interactive process, a Console is bound and presented automatically. `program_console_launch` calls `spawnTerminal` and the client watch opens the tab.
7. An end-to-end model walkthrough ran against the harness with an API key configured. `program_console_write` was added so the model can type; `1+1` returning `2` confirmed the write path.
8. The rose-drawing script was saved as the skill example at `assets/examples/rose.py`. The file-tree browse UI and the temporary LaunchTerminal were removed. Opening a new Console tab now goes directly to the bound PTY; the user starts a process inside it; a comment-style hint tells them that starting a process will reach the model.
9. Status lights (red, orange, green) and a unique active Console id for the model landed, with `program_console_select` and runtime context. Clicking orange selects; red only focuses.
10. `/console` was added as a slash command in the same style as `/model`: a popup of started (orange and green) Consoles with color swatches. That required a small official ui-commands extension (`SelectOption.swatch`) and a tsdown rebuild of official `lib/client.js`, plus a host restart, before swatches appeared. `/Console` with a capital C is invalid. After picking an orange row, a brief status-poll race was seen once (green flickered idle, then settled) and was not treated as a blocker.
11. Typography on the bound header first used an unattractive ui-monospace stack. Official `--ds-font-family-code` still fell through to Liberation Mono in this environment, because JetBrains Mono and Fira Code were not visible to the Chrome fontconfig in use. The fix is `--program-console-font`, which prefers Ubuntu Sans Mono and Noto Sans Mono, and xterm resolves the computed font-family.
12. Status lights were restyled first like a Dynamic Island LED: smaller, with a dark bezel, fluorescent color, and glow. That black border was rejected in favor of a clear small circle, then in favor of vector drawing. The final form is a 6px SVG circle, with no bezel or glow, and fluorescent fills `#ff3b30`, `#ffb000`, and `#30f064`.
13. A new Console was started with `python3`, and that pid became the unique green target. `/console` listed it and switched the right sidebar, but the command still felt unlinked from the model. The latest user message to the model was "which console you consoled? can you tell me what can you do by this console?" The runtime context already listed the older Consoles as ready and the new pid as active, but the model clung to a historical pid from an earlier launch, used sandboxed `ps` (which could not see these pids), and treated the new consoles as re-created and unusable. The fix enriched `formatConsoleContext` with running-program labels and hard rules, and updated the skill body and catalog description; it did not append a fake `user/message`. After a host restart (old consoles were dropped), the model treated the new unique green Console running `python3` as the active target, treated the other new Console as ready, and drew a rose into the active Console with `program_console_write`.

## Alternatives considered

**Pipes instead of a PTY.** Ordinary stdin and stdout are enough for a line-oriented log plus a small input box, and they are simpler to wire. They cannot present a full-screen interactive program, so the host holds a PTY master and the tab is a view of that master.

**Binding already-running processes without a held master.** Reusing the process list to attach to something the user or the model had already started would have avoided a second start path. Without the master, there is no attachable terminal, so only sessions this plugin starts remain bindable.

**Temporary LaunchTerminal plus file-tree bind, instead of opening a bound tab directly.** The first interactive path started a short-lived green terminal, recorded processes begun there, and asked the user to bind one from the file tree. That extra staging UI hid the intended path: opening a Console should already be a held PTY, and the user should start the program inside it.

**Appending a fake user message to notify the model, instead of runtime context on the next turn.** A synthetic `session.append('user/message')` when `/console` or a new process selected a target would have reached the model immediately, but it would have forged user text and started a turn the person did not send. The shipped path updates the green target in place and lets the next real request carry `program-console:status`.

**Bundling a webfont, instead of a Chrome-visible font stack.** A packaged mono face would have made the bound header and xterm look the same in every environment. Official package assets cannot bundle fonts, so the plugin prefers Ubuntu Sans Mono and Noto Sans Mono and resolves the computed family before giving it to xterm.

**CSS circles or an LED bezel, instead of SVG discs.** A CSS circle is simple, and the LED treatment (dark bezel, fluorescent fill, glow) was tried as a clearer affordance. The bezel and glow made the light look less sharp, so the shipped mark is a 6px SVG circle with a fluorescent fill only.

## Consequences

The person and the model share one visible, interactive Console on a PTY the host actually holds, and there is a unique green target the model can type into. The person can switch that target from the tab light or `/console` without composing a message, and the model sees the switch on the next turn. The cost is that already-running processes cannot be attached, `/console` does not itself start a model turn, restarting the host ends every Console PTY, typography depends on a Chrome-visible font stack, and official ui-commands had to grow an optional swatch so the popup can show the same colors as the tabs. When a green process exits back to a shell, the active target is cleared rather than silently moved, so the model must not assume a previous pid still works.

## Testing

Host coverage lives in `tests/service.spec.ts`, `tests/status.spec.ts`, `tests/skill-text.spec.ts`, `tests/terminal-descendants.spec.ts`, and related unit specs. Client coverage lives in `tests/guide.client.spec.tsx`, `tests/console-command.spec.ts`, and `tests/watch.client.spec.ts`. Official swatch rendering is covered in `packages/client/ui-commands/tests/popup-view.client.spec.tsx`. The end-to-end model path (launch, write, rose example, and `/console` followed by a later turn) is a manual check on a Web host with the plugin patch loaded.

## Related

- [Program console cookbook](../../../../docs/cookbook/program-console.md)
- [Package README](../../../../packages/experimental/program-console/README.md)
- [Subsystem reference](../../../../docs/subsystems/program-console.md)
