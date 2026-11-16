---
description: "为一个进程绑定一个侧栏控制台，并在伪终端上启动交互式命令。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-program-console

[English](README.md) | 中文

## 概述

这个实验插件为从侧栏入口或启动工具启动的每个进程绑定一个侧栏控制台。用户点击控制台入口后，本机会在其持有的伪终端上启动一个交互式 shell，立即绑定该 shell，并打开控制台页签。用户在该终端中输入即可启动程序。每个控制台页签都有状态灯：红色表示尚未启动进程，橙色表示已启动进程但不是模型当前的活动目标，绿色表示模型当前应向其输入的唯一控制台。模型读取内置的 `program-console` skill，再用 `program_console_launch` 启动交互式程序。该工具在伪终端上运行命令、将该控制台设为唯一的活动目标，并在进程继续运行时返回。控制台绑定之后，模型用 `program_console_write` 向活动控制台输入，并用 `program_console_select` 切换活动目标。运行时上下文会列出每个控制台、其编号（页签上的进程号）、状态以及唯一的活动编号。普通的 bash 或 pwsh 命令不会改变，也不会为此创建控制台伪终端。

## 目录

- [使用这个包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

需要在会话里看到控制台入口时启用这个 bundle。默认组合不加载该插件。

```yaml
plugins:
  - id: program-console
    name: '@deepseek-ai/dsh-program-console'
```

点击入口会在本机持有的伪终端上启动一个新的交互式 shell，绑定该 shell，并打开带红色状态灯的控制台页签。用户在该终端中输入即可启动程序，例如 `python3 -q`。该进程启动后，这个页签会成为唯一的绿色目标，此前的绿色页签变为橙色。点击橙色状态灯可将该控制台设为唯一的绿色目标；红色状态灯只会聚焦该页签。用户也可以输入 `/console`，在已启动的控制台（橙色和绿色）中选择一行，将该控制台设为唯一的绿色目标。该控制台接到同一对伪终端的主端；关闭页签不会终止进程。每次点击都会打开一个新的控制台。并非由此启动的进程没有可接入的伪终端。 侧栏、宿主持有的 PTY 以及 `/console` 的贡献者教程见[程序控制台手册](../../../docs/cookbook/program-console.zh.md)。

-----

<a id="model-experience"></a>
## 模型体验

### 程序控制台 skill

#### 模型看到的内容

插件加载后，skill 目录包含 `program-console`。模型用 skill 工具读取正文，并用 `program_console_launch` 启动交互式程序。每一轮模型请求还会包含一段程序控制台运行时上下文，列出每个控制台编号、其空闲/就绪/活动（红/橙/绿）状态、其中正在运行的程序（若已知），以及唯一的活动编号。模型应以该列表为准，忽略列表中没有的旧编号；若活动控制台里已经有程序，应直接写入，不要再启动一个重复进程，也不要用 bash、ps 或 pwsh 去查找或操作控制台。控制台绑定之后，模型用 `program_console_write` 向活动控制台输入。当存在多个控制台，或用户要求使用另一个控制台时，模型先用该控制台的进程号调用 `program_console_select`。用户可以输入 `/console`，在已启动的控制台（橙色和绿色）中选择；模型仍然使用 `program_console_select` 和运行时上下文。skill 正文还指向一个内置的终端玫瑰示例 `examples/rose.py`，路径相对于该 skill 的基目录解析。

##### 程序控制台 skill 正文

```markdown
# Program console

When the user asks to open a program console, or you need to start an interactive program (a REPL, debugger, or any process the user should type into in a Console), call program_console_launch with the full command. Do not start it with the bash or pwsh tool, and do not request a PTY from those tools. The tool returns once the process is bound; a Console opens for interactive input while the process stays running on a pseudo-terminal. That Console becomes the unique active (green) target.

Each model turn includes a program-console context listing every Console, its id (the process id shown on the tab), its state (idle/red, ready/orange, or active/green), the program running in it when known, and the unique active id. Trust that list: only those ids exist in this session, and ignore process ids from earlier turns that are not listed. After the user starts a process in a Console, or picks one with /console, that Console may become the active target and the context will show the new id. If the active Console already has a program, type into it with program_console_write; do not call program_console_launch to start a duplicate. Do not use bash, ps, or pwsh to find, inspect, or type into Consoles.

Type into a Console by calling program_console_write with the process id and the text. Use the active (green) Console id from the context unless the user asked for a different Console. When several Consoles exist or the user asks to use another one, call program_console_select with that Console's process id first; only a ready (orange) or already active Console can be selected. The user can type `/console` to pick among ready (orange) and active (green) Consoles; that switch is the same unique active target you read from the context and use with program_console_select. Include a trailing newline to submit a line; if you omit it, the tool adds one. Use this to interact with a REPL, debugger, or other program already shown in a Console. Do not try to type into that program with bash or pwsh.

A bundled example draws a five-petal rose in the terminal: `examples/rose.py`. Resolve that path against this skill's base directory. To run it, call program_console_launch with a Python REPL such as `python3 -q`, then program_console_write a command that executes the example, for instance `exec(open(r"<resolved-path>", encoding="utf-8").read())`.

If the user just wants a console and has no particular program, you may pass the launch command below.

launch-command: node -e "setInterval(() => {}, 1000000000)"
```

#### 对 token 的影响

插件处于启用状态时，目录项出现在 skill 列表中。正文只在 skill 工具加载 `program-console` 时进入请求。

#### 对 KV Cache 的影响

未启用的插件不增加请求内容。加载 skill 正文会在 skill 插入位置改变 provider 的 KV 前缀。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

- **未由我们启动的进程没有伪终端** — 本机未持有伪终端主端的进程无法接入。只有用户打开的控制台和 `program_console_launch` / `launch()` 会留下我们可以使用的主端。
- **读不到的可执行文件无法绑定** — 路径或启动时间读失败的进程会被跳过，`launch()` 或用户打开控制台时也不会绑定它。
- **兼容性 bash 钩子返回后只枚举一次** — 在那条历史路径上，那时还看不见的程序不会被绑定。`launch()` 和启动工具会短暂重试。

<a id="dev-note"></a>
### 开发备注

入口会调用 `openUserConsole()`：在交互式 shell 上建立伪终端，用 `ensureConsole` 绑定该 shell，并打开进程控制台页签。本机会监视非 shell 子进程、更新页签状态灯，并为每个会话记录一个可选的活动控制台。模型路径是 `program_console_launch`、`program_console_write` 和 `program_console_select`。这些工具使用的控制台编号就是页签上显示的进程号。`/console` 斜杠命令会在官方弹层中列出就绪和活动控制台，并以与点击橙色状态灯相同的方式切换唯一的绿色目标。 决策历程见[程序控制台 Agent Note](../../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.zh.md)。
