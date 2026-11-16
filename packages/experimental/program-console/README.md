---
description: "Bind one sidebar Console to a process and launch interactive commands on a PTY."
kind: "package-bundle"
---

# @deepseek-ai/dsh-program-console

English | [中文](README.zh.md)

## Summary

This experimental plugin binds one sidebar Console to each process started from the sidebar guide or the launch tool. A user click on the Console guide entry starts an interactive shell on a pseudo-terminal the host holds, binds that shell immediately, and opens the Console tab. The user starts a program by typing in that terminal. Each Console tab has a status light: red when no process has been started, orange when a process has started but the Console is not the model-active target, and green for the unique Console the model should type into. The model reads the bundled `program-console` skill and starts an interactive program with `program_console_launch`. That tool runs the command on a pseudo-terminal, binds a Console as the unique active target, and returns while the process stays running. After a Console is bound, the model types into the active Console with `program_console_write` and switches the active target with `program_console_select`. A runtime-context block lists every Console, its id (the process id on the tab), its state, the program running in it when known, and the unique active id; those ids replace any Console ids from earlier turns. Ordinary bash or pwsh commands are unchanged and do not create a Console PTY, and must not be used to find or type into Consoles.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Enable the bundle when a session should show a Console guide entry. The default composition does not load the plugin.

```yaml
plugins:
  - id: program-console
    name: '@deepseek-ai/dsh-program-console'
```

The guide entry starts a new interactive shell on a pseudo-terminal the host holds, binds that shell, and opens a Console tab with a red status light. The user types in that terminal to start a program such as `python3 -q`. When that process starts, the tab becomes the unique green target and any previous green tab turns orange. Clicking an orange light makes that Console the unique green target; a red light only focuses the tab. The user can also type `/console` to pick among ready (orange) and active (green) Consoles; choosing a row makes that Console the unique green target. That Console attaches to the same PTY master; unmounting the tab does not terminate the process. Each click starts a new Console. A process the host did not start this way has no attachable PTY. A contributor walkthrough of the sidebar, the held PTY, and `/console` is in the [program console cookbook](../../../docs/cookbook/program-console.md).

## Model Experience

### Program console skill

#### What the model sees

While the plugin is loaded, the skill catalog includes `program-console`. The model loads the body with the skill tool and starts an interactive program with `program_console_launch`. Each model turn also includes a program-console runtime context with every Console id, its idle/ready/active (red/orange/green) state, the program running in it when known, and the unique active id. The model should trust that list, type into an already-started active Console instead of launching a duplicate, and not use bash, ps, or pwsh to find Consoles. After a Console is bound, the model types into the active Console with `program_console_write`. When several Consoles exist or the user asks to use another one, the model calls `program_console_select` with that Console's process id first. The user can type `/console` to pick among ready (orange) and active (green) Consoles; the model still uses `program_console_select` and the runtime context. The skill body also points at a bundled terminal rose example, `examples/rose.py`, resolved against the skill's base directory.

##### Program console skill body

```markdown
# Program console

When the user asks to open a program console, or you need to start an interactive program (a REPL, debugger, or any process the user should type into in a Console), call program_console_launch with the full command. Do not start it with the bash or pwsh tool, and do not request a PTY from those tools. The tool returns once the process is bound; a Console opens for interactive input while the process stays running on a pseudo-terminal. That Console becomes the unique active (green) target.

Each model turn includes a program-console context listing every Console, its id (the process id shown on the tab), its state (idle/red, ready/orange, or active/green), the program running in it when known, and the unique active id. Trust that list: only those ids exist in this session, and ignore process ids from earlier turns that are not listed. After the user starts a process in a Console, or picks one with /console, that Console may become the active target and the context will show the new id. If the active Console already has a program, type into it with program_console_write; do not call program_console_launch to start a duplicate. Do not use bash, ps, or pwsh to find, inspect, or type into Consoles.

Type into a Console by calling program_console_write with the process id and the text. Use the active (green) Console id from the context unless the user asked for a different Console. When several Consoles exist or the user asks to use another one, call program_console_select with that Console's process id first; only a ready (orange) or already active Console can be selected. The user can type `/console` to pick among ready (orange) and active (green) Consoles; that switch is the same unique active target you read from the context and use with program_console_select. Include a trailing newline to submit a line; if you omit it, the tool adds one. Use this to interact with a REPL, debugger, or other program already shown in a Console. Do not try to type into that program with bash or pwsh.

A bundled example draws a five-petal rose in the terminal: `examples/rose.py`. Resolve that path against this skill's base directory. To run it, call program_console_launch with a Python REPL such as `python3 -q`, then program_console_write a command that executes the example, for instance `exec(open(r"<resolved-path>", encoding="utf-8").read())`.

If the user just wants a console and has no particular program, you may pass the launch command below.

launch-command: node -e "setInterval(() => {}, 1000000000)"
```

#### Token effect

The catalog entry is part of the skill list while this plugin is active. The body is added to the request only when the skill tool loads `program-console`.

#### KV Cache effect

An omitted plugin adds no request content. Loading the skill body changes the provider KV prefix at the skill insertion point.

## Known Limitations and Deferred Work

- **No PTY for processes we did not start** — a process whose PTY master the host does not hold cannot be attached. Only a user-opened Console and `program_console_launch` / `launch()` leave a master we can use.
- **Unreadable executables cannot be bound** — a process whose path or start time cannot be read is skipped, and `launch()` or a user Console start will not bind it either.
- **One enumeration after a compatibility bash hook returns** — a program that is not visible yet is not bound on that historical path. `launch()` and the launch tool poll briefly.

<a id="dev-note"></a>
### Dev Note

The guide entry calls `openUserConsole()`, which spawns an interactive shell, binds that shell with `ensureConsole`, and opens the process Console tab. The host watches for a non-shell descendant, updates the tab light, and records one optional active Console per session. The model path is `program_console_launch`, `program_console_write`, and `program_console_select`. The Console id used by those tools is the process id shown on the tab. The `/console` slash command lists ready and active Consoles in the official popup and selects the unique green target the same way an orange status-light click does. Decision history is in the [program-console Agent Note](../../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.md).
