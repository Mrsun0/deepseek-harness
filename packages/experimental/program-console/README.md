---
description: "Bind one sidebar Console to a process, list programs by executable path, and launch commands without a PTY."
kind: "package-bundle"
---

# @deepseek-ai/dsh-program-console

English | [中文](README.zh.md)

## Summary

This experimental plugin lists processes whose executable path can be read, groups them by that path, and binds one sidebar Console to each process. A user starts a program with `bash -c` or `cmd.exe /d /s /c`. The model reads the bundled `program-console` skill and runs that command with the existing bash or pwsh tool. Neither path creates a terminal.

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

The guide opens the workspace file tree for executable paths. Directories are the segments above a file, and a file appears only when a process resolved to it. A row whose path has processes ends with a right-pointing triangle, and resting the pointer on the triangle opens those processes in a window of at most ten rows. Choosing a process focuses its Console when one is already bound, including a Console created by another session, and creates one only when the process has none. New command runs the dialog text as `bash -c` on Linux or `cmd.exe /d /s /c` on Windows through `subprocess.spawn`.

## Model Experience

### Program console skill

#### What the model sees

While the plugin is loaded, the skill catalog includes `program-console`. The model loads the body with the skill tool and passes its launch command to bash or pwsh.

##### Program console skill body

```markdown
# Program console

Start the console program by passing the launch command below as the exact command argument of the bash tool on Linux or the pwsh tool on Windows. Set run_in_background to true so the tool returns while the process stays running. Do not use a PTY and do not change the command. After the tool returns, one Console binds to the new process when that process does not already have one.

launch-command: node -e "setInterval(() => {}, 1000000000)"
```

#### Token effect

The catalog entry is part of the skill list while this plugin is active. The body is added to the request only when the skill tool loads `program-console`.

#### KV Cache effect

An omitted plugin adds no request content. Loading the skill body changes the provider KV prefix at the skill insertion point.

## Known Limitations and Deferred Work

- **No terminal after launch** — bash and pwsh ignore stdin when the caller does not pass one, and this launch does the same. The Console cannot type into the process afterward.
- **Unreadable executables are omitted** — a process whose path or start time cannot be read does not appear in the tree.
- **One enumeration after the shell tool returns** — a program that is not visible yet is not bound. The user dialog polls briefly; the shell-tool path does not.

<a id="dev-note"></a>
### Dev Note

The browse page calls the registered workspace file tree. `@deepseek-ai/dsh-client-ui-sidebar-files` is a development dependency for that tree's input type and for tests. The runtime does not import the tree component.
