# Agent Note: Program consoles bound to a held PTY

Status: implemented

[English](2026-11-16-program-console-bound-pty.md) | 中文

## 问题

实验性 program-console 插件已经能够列出进程，并把侧栏控制台绑定到选中的一行，但这还不足以支持交互式工作。 如果控制台只通过普通的 stdin 和 stdout 管道与进程通信，就无法承载 REPL、调试器，或其他期望真实终端的程序。 主机自己没有启动过的进程没有可供控制台接入的 PTY 主端，因此「绑定任意已经在运行的进程」并不是一个完整的产品。 目标能力是：当用户或模型启动交互式程序时，把可见的控制台绑定到主机所持有的 PTY 上，用户可以观看和输入，模型也可以向唯一的活动控制台输入，而不需要臆造进程号，或发送一条伪造的用户消息。

## 决定

实验性插件 [`@deepseek-ai/dsh-program-console`](../../../../packages/experimental/program-console/README.zh.md) 把一个右侧边栏控制台绑定到主机持有的 PTY 会话。 默认组合不加载该插件；Web 会话通过该包的 `cordis.patch.yml` 加载它。 [程序控制台手册](../../../../docs/cookbook/program-console.zh.md) 是当前的操作说明；本笔记记录已落地的决策，以及形成该决策的工作过程。

### 被持有的 PTY 与两条启动路径

主机用 `ctx.subprocess.spawnTerminal` 创建每个会话，并保留一对主端和从端。 绑定页和控制台页签都是该主端的视图。 主机未持有其主端的进程无法接入。

`openUserConsole()` 启动一个交互式 shell，立即绑定该 shell，并返回绑定结果以便客户端打开控制台页签。 用户在该终端中输入程序；在非 shell 进程出现之前，页签保持红色。 `program_console_launch`（即 `launch()`）在被持有的 PTY 上启动模型给出的命令，绑定新进程，将该控制台设为唯一活动目标，并在进程继续运行的情况下返回。 客户端监视会为会话仍显示在屏幕上时创建的控制台打开页签。 关闭控制台页签不会调用 `handle.terminate()`，也不会结束进程。

### 侧栏呈现

客户端注入 `['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'remote', 'commandUi']`，并且不使用 `ctx.webTerminals`。 它注册指南页签定义和进程页签定义，并填充 `sidebar.right.tab.guide.entry`、`sidebar.right.pane.tab` 和 `sidebar.right.pane.tab.title`。 生成的 `remote.programConsole` 服务在 `$mount` 之后注入到子作用域，而不是作为静态的顶层 inject。 绑定视图是带 fit 插件的 xterm PTY。 xterm 通过探测元素解析计算出的 `fontFamily`，因为它不能接受尚未解析的 CSS `var()`。 `--program-console-font` 把 Ubuntu Sans Mono 和 Noto Sans Mono 放在官方 `--ds-font-family-code` 之前，因为某些 Chrome fontconfig 配置不会暴露 JetBrains Mono 或 Fira Code。 终端上方一条注释风格的提示告诉用户：启动进程后会触达模型。

### 唯一活动目标、状态灯和 `/console`

每个页签都有一盏状态灯：红色表示闲置，橙色表示就绪，绿色表示唯一活动目标。 状态灯是 6px 的 SVG 圆盘，荧光填充色为 `#ff3b30`、`#ffb000` 和 `#30f064`，没有黑色边框，也没有光晕。 新启动的非 shell 进程会成为唯一的绿色目标；此前的绿色页签变为橙色。 若绿色进程退出后只剩下 shell，该页签变为红色并清除活动目标，而不会悄悄提升另一个就绪控制台。 点击橙色灯，或在 `/console` 中选择就绪或活动行，会调用 `programConsole.select`，然后聚焦该页签。 点击红色灯只会聚焦该页签。

`/console` 是一条客户端贡献，即 `command.register({ name: 'console', ui: { kind: 'popupSelect' } })`。 官方命令名是小写；带大写 C 的 `/Console` 不是有效的提交 token。 在已寻址的子代理会话中，该贡献会被隐藏，这与官方目录对 `/model` 使用的可用性规则相同。 `console` 不会被加入官方 `SECTION_ROWS`。 官方 `SelectOption` 有可选的 `swatch`，由 `PopupSelectView` 渲染。 `/console` 不会追加用户消息或开发者消息，也不会开启一轮模型回复。

### 运行时上下文与模型工具

模型通过用 `systemPrompt.context` 注册的运行时上下文 `program-console:status`（顺序 130）读取当前控制台。 在 `system-prompt/assemble` 时，主机会先刷新绑定。 这段文本列出每个控制台编号（页签上的进程号）、其状态、其中正在运行的程序（若已知；`consoleRunningLabel` 使用非 shell 子孙可执行文件或非 shell 命令行），以及唯一的活动编号。 它还写明硬性规则：只存在列表中的编号；忽略未出现在列表中的历史进程号；不要用 bash、ps 或 pwsh 查找或向控制台输入；若活动控制台里已经有程序，应调用 `program_console_write`，而不要再启动一个重复实例。 `src/index.ts` 中的 skill 目录说明和 `assets/program-console.md` 中的正文与这些规则一致。 模型工具是 `program_console_launch`、`program_console_write` 和 `program_console_select`。 `PROGRAM_CONSOLE_PROCESS_MISSING` 和 `PROGRAM_CONSOLE_SELECT_IDLE` 是选择路径上的失败。 内置玫瑰示例位于 `assets/examples/rose.py`。

### 已落地的约束

该插件不会伪造一条用户消息来通知模型。 命令名保持小写，并且不会把 `console` 加入官方 `SECTION_ROWS`。 官方包资源不能打包字体。 关闭页签不会终止 PTY。 只有在 remote 发生变化时才重新生成 typpert 产物。

## 开发历程

此处记录的工作发生在 2026-11-16，起点是已经落到本 fork 上的实验性插件：以文件树展示进程列表，并把控制台绑定到选中的进程。

1. 悬停与进程列表的打磨。弹出触发器扩大到整行；排印与文件树对齐，使用蓝色文字，并放在文件名开头再加大约两个空格的位置；还修复了被裁切的细小字形。
2. 落地了 New Command 工具栏文案和按钮，刷新变成树角落里的旋转箭头。
3. 在 New Command 之后，会出现一个大约十行高的绿色临时终端，并带有勾选以关闭它。在那里启动的非系统进程会被记录，再通过文件树绑定。
4. 团队比较了 stdin/stdout 管道与 PTY。PTY 更适合交互式程序。主机持有 PTY 主端；绑定页以及随后的页签都是该主端的视图；主机未持有其主端的进程无法接入。在没有被持有主端的情况下，绑定已经启动的进程是不可能的。
5. 绑定页被重新设计成类似 VS Code 的控制台（在被持有的 PTY 上使用 xterm），而不再是使用管道的分栏日志外加三行输入框。
6. 主要的目标功能落地：当模型启动交互式进程时，会自动绑定并展示控制台。`program_console_launch` 调用 `spawnTerminal`，客户端监视会打开页签。
7. 在已配置 API 密钥的 harness 上完成了端到端的模型演示。随后加入 `program_console_write`，让模型可以输入；`1+1` 返回 `2` 证实了写入路径。
8. 玫瑰绘制脚本作为 skill 示例保存到 `assets/examples/rose.py`。文件树浏览界面和临时的 LaunchTerminal 被移除。现在打开新的控制台页签会直接进入已绑定的 PTY；用户在其中启动进程；一条注释风格的提示告诉他们，启动进程后会触达模型。
9. 落地了状态灯（红、橙、绿）以及供模型使用的唯一活动控制台编号，并配合 `program_console_select` 和运行时上下文。点击橙色会选中；红色只聚焦。
10. 增加了与 `/model` 风格相同的斜杠命令 `/console`：弹出已启动（橙色和绿色）控制台的列表，并带有颜色色点。这需要给官方 ui-commands 做一个小扩展（`SelectOption.swatch`），并用 tsdown 重新构建官方 `lib/client.js`，再重启宿主，色点才会出现。带大写 C 的 `/Console` 无效。在选中一行橙色之后，曾短暂出现过一次状态轮询竞态（绿色先闪成闲置，随后稳定），这没有被当作阻塞问题。
11. 绑定页眉的排印最初使用了不好看的 ui-monospace 字体栈。在本环境中，官方 `--ds-font-family-code` 仍会回退到 Liberation Mono，因为当时的 Chrome fontconfig 看不到 JetBrains Mono 和 Fira Code。修复方式是 `--program-console-font`，它优先使用 Ubuntu Sans Mono 和 Noto Sans Mono，并且 xterm 会解析计算后的 font-family。
12. 状态灯先被改成类似灵动岛 LED 的样式：更小，带深色边框、荧光颜色和光晕。黑色边框被否定，改为清晰的小圆，然后再改为矢量绘制。最终形态是 6px 的 SVG 圆，没有边框或光晕，荧光填充色为 `#ff3b30`、`#ffb000` 和 `#30f064`。
13. 用户新开了一个控制台并启动 `python3`，该 pid 成为唯一的绿色目标。`/console` 能够列出它并切换右侧边栏，但这条命令仍显得没有与模型联动。发给模型的最新消息是 "which console you consoled? can you tell me what can you do by this console?" 运行时上下文已经把较旧的控制台列为就绪、把新的 pid 列为活动，但模型仍抓住更早一次启动留下的历史 pid，使用了沙箱中的 `ps`（看不到这些 pid），并把新控制台当成重新创建、无法使用的对象。修复方式是丰富 `formatConsoleContext`，加入正在运行的程序标签和硬性规则，并更新 skill 正文与目录说明；没有追加伪造的 `user/message`。在重启宿主（旧控制台被丢掉）之后，模型把正在运行 `python3` 的新的唯一绿色控制台当作活动目标，把另一个新控制台当作就绪，并用 `program_console_write` 在活动控制台里画出了玫瑰。

## 考虑过的替代方案

**用管道代替 PTY。** 普通的 stdin 和 stdout 足以支撑分行日志加上一个小输入框，接线也更简单。它们无法呈现全屏交互式程序，因此主机持有 PTY 主端，页签则是该主端的视图。

**在没有被持有主端的情况下绑定已经在运行的进程。** 复用进程列表，去接入用户或模型已经启动的进程，本可以避免第二条启动路径。但没有主端就没有可接入的终端，因此只有本插件启动的会话才能被绑定。

**用临时的 LaunchTerminal 加文件树绑定，而不是直接打开已绑定的页签。** 最早的交互路径会启动一个短生命周期的绿色终端，记录在那里开始的进程，再请用户从文件树里绑定一个。这层额外的过渡界面掩盖了目标路径：打开控制台就应该已经是被持有的 PTY，用户应在其中启动程序。

**追加一条伪造的用户消息来通知模型，而不是等到下一轮再提供运行时上下文。** 在 `/console` 或新进程选中目标时合成一条 `session.append('user/message')`，可以立刻触达模型，但会伪造用户文本，并开启一轮用户并未发送的对话。落地路径只就地更新绿色目标，让下一次真正的请求携带 `program-console:status`。

**打包 webfont，而不是使用 Chrome 可见的字体栈。** 附带一款等宽字体，可以让绑定页眉和 xterm 在所有环境中看起来一致。官方包资源不能打包字体，因此插件优先使用 Ubuntu Sans Mono 和 Noto Sans Mono，并在交给 xterm 之前解析计算出的字体族。

**用 CSS 圆或 LED 边框，而不是 SVG 圆盘。** CSS 圆更简单，而 LED 方案（深色边框、荧光填充、光晕）也曾作为更清晰的示能被尝试过。边框和光晕让灯看起来不够锐利，因此落地的标记是只有荧光填充的 6px SVG 圆。

## 影响

用户和模型共享一个可见的、交互式的控制台，它建立在主机真正持有的 PTY 上，并且存在一个模型可以向其输入的唯一绿色目标。 用户可以从页签状态灯或 `/console` 切换该目标，而不需要编写一条消息；模型会在下一轮看到这次切换。 代价是：已经在运行的进程无法接入，`/console` 本身不会开启一轮模型回复，重启宿主会结束所有控制台 PTY，排印依赖于 Chrome 可见的字体栈，而且官方 ui-commands 必须增加可选的 swatch，才能让弹层显示与页签相同的颜色。 当绿色进程退出后只剩下 shell 时，活动目标会被清除而不是被悄悄转移，因此模型不得假设先前的 pid 仍然有效。

## 测试

宿主覆盖位于 `tests/service.spec.ts`、`tests/status.spec.ts`、`tests/skill-text.spec.ts`、`tests/terminal-descendants.spec.ts` 以及相关单元测试。 客户端覆盖位于 `tests/guide.client.spec.tsx`、`tests/console-command.spec.ts` 和 `tests/watch.client.spec.ts`。 官方色点渲染由 `packages/client/ui-commands/tests/popup-view.client.spec.tsx` 覆盖。 端到端的模型路径（启动、写入、玫瑰示例，以及 `/console` 之后的下一轮）是在加载了插件 patch 的 Web 宿主上手动检查的。

## 相关

- [程序控制台手册](../../../../docs/cookbook/program-console.zh.md)
- [包 README](../../../../packages/experimental/program-console/README.zh.md)
- [子系统参考](../../../../docs/subsystems/program-console.zh.md)
