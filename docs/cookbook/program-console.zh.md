# 手册：程序控制台

[English](program-console.md) | 中文

本教程说明实验性插件 `@deepseek-ai/dsh-program-console` 的当前行为：右侧边栏页签如何创建、主机如何启动并持有伪终端（PTY）、`/console` 如何与右侧边栏及模型互动，以及最终可以完成什么。 [包 README](../../packages/experimental/program-console/README.zh.md) 是该包的契约。 [程序控制台子系统页](../subsystems/program-console.zh.md) 保存服务类型和生成的 Cordis API。 形成这些形态的迭代过程见[程序控制台 Agent Note](../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.zh.md)；本页使用现在时，只描述当前系统。

## 1. 结果与前提

在 Web 会话中加载该插件后，右侧边栏指南会出现一个控制台入口。 点击后会在本机持有的 PTY 上启动交互式 shell，立即绑定一个控制台页签，并让你在该终端中输入程序。 当模型用 `program_console_launch` 启动交互式程序时，控制台页签会打开在同一种被持有的 PTY 上，并成为模型应当向其输入的唯一绿色目标。 默认组合不加载该插件。

若使用已安装的 `dsh` 命令行加载：

```bash
dsh --profile web --patch packages/experimental/program-console/cordis.patch.yml --no-open
```

在仓库根目录的源码检出中，同一份 overlay 为：

```bash
pnpm dsh --profile web --patch packages/experimental/program-console/cordis.patch.yml --no-open
```

工作区里的 `dsh` 脚本是 `node --import tsx/esm apps/cli/src/bin.ts`，因此等价的直接调用是 `pnpm exec node --import tsx/esm apps/cli/src/bin.ts --profile web --patch ./packages/experimental/program-console/cordis.patch.yml --no-open`。 `--no-open` 会启动 Web UI，但不会打开浏览器。 该 patch 会插入 `@deepseek-ai/dsh-program-console` 插件。 重启该宿主会结束其进程下的 PTY 子进程，包括任何已打开的控制台。

## 2. 右侧边栏如何创建

客户端插件声明 `export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'remote', 'commandUi']`。 它不使用 `ctx.webTerminals`。 在 `apply` 中，它用 `ctx.remote.$mount(programConsoleRemote)` 挂载生成的 remote，注册文案，并注册两种右侧边栏页签定义：

- `browseDefinition` — kind 为 `program-console`，实现 id 为 `@deepseek-ai/dsh-program-console`。它的 `guide` 入口（顺序 40，标题为「控制台」）出现在右侧边栏指南中。自定义指南卡片会启动一个已绑定的控制台，而不是把这种 kind 作为持久页面打开。
- `processDefinition` — kind 为 `program-console-process`，实现 id 为 `@deepseek-ai/dsh-program-console/process`。它认领能解码为单个进程的 `dsh-resource://program-console/**` 地址，并用进程号作为页签标题。

插件随后填充这些插槽：

- `sidebar.right.tab.guide.entry` — `ConsoleGuide` 卡片。点击会调用 `openUserConsole()`，然后执行 `tab.actions.openResource(address, { replaceTab: true })` 和 `tab.actions.close()`，从而用进程页签替换指南页签。
- 指南 kind 的 `sidebar.right.pane.tab` — `ConsoleStart`，作为回退在挂载时调用 `openUserConsole()`（例如从指南的 More 菜单进入），并以同样方式替换页签。
- 进程 kind 的 `sidebar.right.pane.tab` 和 `sidebar.right.pane.tab.title` — `ConsolePane` 与 `ConsoleTitle`，即已绑定的终端和带状态灯的页签芯片。

生成的 `remote.programConsole` 命名空间只在该 fiber 自己的 `$mount` 之后才存在。 插件在这次挂载之后，于子作用域上注入 `'remote.programConsole'`，并同时注入 `'commandUi'`；它不能作为静态的顶层 `inject` 列出，否则界面会等待一个由它自己创建的服务。

`reveal(ctx, sessionId, binding)` 是聚焦已绑定控制台的共用方式：它调用 `ctx.sidebarRight.openResourceIn(sessionId, consoleAddress(binding.key), { kind: PROCESS_KIND })`。 客户端监视和 `/console` 的 `onSelect` 处理函数都使用 `reveal()`。 指南点击路径改为使用带 `replaceTab: true` 的 `tab.actions.openResource`，因为它要替换发起启动的指南页签。

## 3. 终端 / 伪终端如何创建

每个控制台会话由主机持有一对 PTY 主端和从端，并通过 `ctx.subprocess.spawnTerminal` 创建。 绑定页以及随后的页签都是该主端的视图。 主机未持有其 PTY 主端的进程无法接入。

有两条启动路径，它们把会话保存在同一个 `launchSessions` 集合中：

- 用户路径 — `openUserConsole()` 启动一个交互式 shell（使用平台对应的 `launchTerminalArgv`，尺寸为 24×80，`terminalType: 'xterm-256color'`），立即用 `ensureConsole` 绑定该 shell，并返回绑定结果以便客户端打开控制台页签。页签最初为闲置（红色）。用户在该终端中输入程序。
- 模型路径 — `program_console_launch`（即 `launch()` remote）在被持有的 PTY 上运行命令（`launchArgv`，尺寸为 10×80，终端类型相同），等到枚举能够绑定新进程后，把该控制台设为唯一活动目标，并在进程继续运行的情况下返回。挂在 `conversation.session.header.actions` 上的客户端监视会为会话仍显示在屏幕上、且在最近 10 秒内创建的每个控制台打开页签。

关闭控制台页签不得终止 PTY。 `ConsolePane` 卸载时会销毁 xterm 视图并中止输出订阅；它不会调用 `handle.terminate()`。 只有在插件 fiber 本身停止时（例如宿主进程退出或插件被卸载），主机才会结束所持有的会话。

绑定视图使用 `@xterm/xterm` 和 fit 插件。 xterm 的 `fontFamily` 不能接受尚未解析的 CSS `var()`；客户端会在终端宿主上挂一个探测元素，读取 `getComputedStyle`，再移除该元素，从而解析计算出的字体族。 排印令牌是 `--program-console-font: "Ubuntu Sans Mono", "Noto Sans Mono", var(--ds-font-family-code), …`。 该栈优先使用 Ubuntu Sans Mono 和 Noto Sans Mono，因为某些 Chrome fontconfig 配置不会暴露 JetBrains Mono 或 Fira Code，官方的 `--ds-font-family-code` 可能会回退到 Liberation Mono。 官方 ui-commands 包不能打包 webfont，本插件也不附带 webfont。

在已绑定终端上方，有一条注释风格的提示，告诉用户启动一个进程，并且启动后会触达模型。 英文文案是 `# Start a new process; starting it will automatically reach the model.` 当该控制台是唯一活动目标时，第二行会说明模型将向此控制台输入。 这些提示位于页眉中，而不是 PTY 输出流里。

## 4. 状态灯与唯一活动目标

每个进程页签显示一盏活动灯，由 `ConsoleBinding.status` 驱动：

- 红色（`idle`，`#ff3b30`）— 尚未启动非 shell 进程，或该控制台不可接入。
- 橙色（`ready`，`#ffb000`）— 已启动进程，但还不是模型唯一的活动目标。
- 绿色（`active`，`#30f064`）— 模型当前应向其输入的唯一控制台。

状态灯是 6px 的 SVG 圆盘（`StatusLightMark`）：`viewBox="0 0 16 16"` 的圆，填充 `currentColor`，没有黑色边框，也没有光晕。

新启动的非 shell 进程会成为唯一的绿色目标；此前的绿色页签（若有）变为橙色。 若同一次刷新中有多个控制台启动，则以最晚的 `createdAt` 为准，再比较绑定键。 若绿色进程退出后只剩下 shell，该页签变为红色，并清除活动目标；不会悄悄提升另一个就绪（橙色）控制台。 点击橙色灯会调用 `programConsole.select`，并把该控制台设为唯一的绿色目标。 点击红色灯只会聚焦该页签；对闲置控制台调用 `select` 会以 `PROGRAM_CONSOLE_SELECT_IDLE` 失败。

## 5. `/console` 如何与右侧边栏和模型互动

客户端通过 `command.register({ name: 'console', ui: { kind: 'popupSelect' } })` 注册一条贡献。 官方命令名是小写，且必须匹配 `^[a-z][a-z0-9_-]*$`；`/Console` 不是有效的提交 token，贡献表的查找也是精确匹配。 在已寻址的子代理会话中，该贡献会被隐藏（当 `sessions.subagentAddress(session.sessionId)` 有值时，`available` 为 false），这与官方目录对 `/model` 使用的规则相同。 它不会与官方宿主命令冲突，也不会把 `console` 加入官方 `SECTION_ROWS`；未列入该表的贡献行会按目录顺序排在 Commands 分区末尾。

官方 `SelectOption` 类型有可选的 `swatch` 字段，由 `PopupSelectView` 在标签前渲染成一个小色点。 就绪行使用 `#ffb000`；唯一活动行使用 `#30f064`，并设置 `active: true`。 闲置（红色）控制台不会出现在弹层中。

选中时，若所选控制台还不是活动目标，处理函数会调用 `programConsole.select(sessionId, pid)`，然后调用 `reveal()`。 若它已经是活动目标，处理函数只揭示该页签。 `/console` 不会追加用户消息或开发者消息，也不会开启一轮模型回复。

模型会在下一次请求时被告知，途径是通过 `systemPrompt.context` 注册的运行时上下文贡献：

- 名称：`program-console:status`。
- 顺序：`130`（位于顺序为 120 的 `SUBAGENT_DELEGATION` 之后、顺序为 200 的 `HARNESS_SOURCE` 之前）。
- 在 `system-prompt/assemble` 时，主机会先刷新绑定（`prepend: true`），使文本对应当前快照。

`formatConsoleContext` 会列出每个控制台编号（页签上显示的进程号）、其 idle/ready/active（红/橙/绿）状态、其中正在运行的程序（若已知），以及唯一的活动编号。 `consoleRunningLabel` 优先使用当前非 shell 子孙进程的可执行文件名；否则使用非 shell 的已绑定命令行（足够短时）或已绑定可执行文件的基名。 仅有 shell 的控制台没有正在运行的程序标签。 上下文还写明硬性规则：本会话中只存在列表里的编号；忽略此前轮次中未出现在列表里的进程号；不要用 bash、ps 或 pwsh 查找、检查或向控制台输入；若活动控制台里已经有程序，应使用 `program_console_write` 向其输入，而不要再启动一个重复实例。

面向模型的工具是：

- `program_console_launch` — 在被持有的 PTY 上启动命令，并绑定一个作为唯一活动目标的控制台。
- `program_console_write` — 向已绑定且可接入的控制台写入文本（若文本尚未以 `\n` 或 `\r` 结尾，工具会补上换行），并返回随后到达的输出。
- `program_console_select` — 用页签上显示的进程号设置唯一的模型活动控制台。

`src/index.ts` 中的 skill 目录说明和 `assets/program-console.md` 中的 skill 正文表述同一套规则。 若该会话中没有所请求 pid 的控制台，`select`（以及部分打开路径）会以 `PROGRAM_CONSOLE_PROCESS_MISSING` 失败。 选择闲置控制台会以 `PROGRAM_CONSOLE_SELECT_IDLE` 失败。 其他主机失败还包括 `PROGRAM_CONSOLE_COMMAND_EMPTY`、`PROGRAM_CONSOLE_LAUNCH_NOT_FOUND` 和 `PROGRAM_CONSOLE_PTY_UNAVAILABLE`。

## 6. 系统最终实现的功能

该插件为用户和模型提供两条启动路径，并共享同一个 PTY 视图。 用户可以从指南打开控制台、输入程序，并看到页签从红色变为唯一的绿色。 模型可以用 `program_console_launch` 启动交互式程序，这会绑定控制台并自动打开页签。 每个会话最多只有一个绿色的、模型活动的控制台。 用户可以通过点击橙色页签状态灯，或在 `/console` 中选择就绪或活动行，来切换该目标。 模型使用 `program_console_write` 输入，并用 `program_console_select` 切换，编号来自当前运行时上下文。 内置的玫瑰绘制示例位于 `assets/examples/rose.py`，并由 skill 正文引用，路径相对于该 skill 的基目录解析。 关闭控制台页签不会杀死进程。

## 7. 构建与重新加载说明

只有在 Remote 方法发生变化时，才需要用仓库根目录下的 `pnpm exec tsx scripts/generate-typert.ts` 重新生成 typpert 产物。 该命令会为工作区中每个相关包写入 typpert 输出，而不仅限于本包。

用以下命令编译宿主面：

```bash
pnpm exec tsc -b packages/experimental/program-console/tsconfig.host.json
```

用以下命令打包客户端面：

```bash
pnpm --filter @deepseek-ai/dsh-program-console run bundle
```

官方 ui-commands 在 Web 客户端中的运行时是由 tsdown 生成的 `lib/client.js`。 仅运行 `tsc -b` 并不足以让 `SelectOption.swatch` 或 `PopupSelectView` 的改动生效；需要执行 `pnpm --filter @deepseek-ai/dsh-client-ui-commands run bundle`，然后重启宿主，官方弹层才会显示色点。

仅限客户端的 program-console 改动可以在强制刷新 Web UI 后出现。 宿主 remote、运行时上下文以及官方命令外壳的改动需要重启宿主。 重启 dsh 会杀死该宿主下的 PTY 子进程。

## 验证

在仓库根目录，并确保工作区的 Node 工具链位于 `PATH` 中：

```bash
pnpm exec vitest run packages/experimental/program-console/tests/status.spec.ts packages/experimental/program-console/tests/skill-text.spec.ts packages/experimental/program-console/tests/service.spec.ts packages/experimental/program-console/tests/console-command.spec.ts packages/experimental/program-console/tests/guide.client.spec.tsx
```

手工验证：用第 1 节中的命令加载插件，从指南打开一个控制台，启动例如 `python3 -q` 的程序，确认页签变为绿色，输入 `/console` 并在存在另一个就绪控制台时选中它，然后询问模型当前活动的是哪一个控制台，并让它向该程序输入。 历史记录和被放弃的替代方案属于[程序控制台 Agent Note](../../.agents/notes/implemented/feature/2026-11-16-program-console-bound-pty.zh.md)，而不是本页。
