---
description: "按可执行文件列出进程，并在不使用 PTY 的情况下为一个进程绑定一个侧栏控制台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-program-console

[English](README.md) | 中文

## 摘要

这个实验插件列出能读到可执行文件路径的进程，按路径分组，并为一个进程绑定一个侧栏控制台。用户用 `bash -c` 或 `cmd.exe /d /s /c` 启动程序。模型读取内置的 `program-console` skill，再用现有的 bash 或 pwsh 工具执行其中的命令。两条路径都不创建终端。

## 目录

- [使用这个包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用这个包

需要在会话里看到控制台入口时启用这个 bundle。默认组合不加载该插件。

```yaml
plugins:
  - id: program-console
    name: '@deepseek-ai/dsh-program-console'
```

入口打开两层列表。第一层是可执行文件路径，第二层是解析到该路径的进程。选择进程时，若已有控制台则聚焦，包括另一个会话创建的控制台；没有时才新建。新建命令在 Linux 上是 `bash -c`，在 Windows 上是 `cmd.exe /d /s /c`，经 `subprocess.spawn` 执行。

-----

<a id="model-experience"></a>
## 模型体验

### 程序控制台 skill

#### 模型看到的内容

插件加载后，skill 目录包含 `program-console`。模型用 skill 工具读取正文，并把其中的启动命令交给 bash 或 pwsh。

##### 程序控制台 skill 正文

```markdown
# Program console

Start the console program by passing the launch command below as the exact command argument of the bash tool on Linux or the pwsh tool on Windows. Set run_in_background to true so the tool returns while the process stays running. Do not use a PTY and do not change the command. After the tool returns, one Console binds to the new process when that process does not already have one.

launch-command: node -e "setInterval(() => {}, 1000000000)"
```

#### 对 token 的影响

插件处于启用状态时，目录项出现在 skill 列表中。正文只在 skill 工具加载 `program-console` 时进入请求。

#### 对 KV Cache 的影响

未启用的插件不增加请求内容。加载 skill 正文会在 skill 插入位置改变 provider 的 KV 前缀。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

- **启动后没有终端** — 未单独传入 stdin 时，bash 和 pwsh 会忽略 stdin，这条启动路径也是如此。控制台之后不能再向该进程键入。
- **读不到的可执行文件不进树** — 路径或启动时间读失败的进程不会出现。
- **shell 工具返回后只枚举一次** — 那时还看不见的程序不会被绑定。用户对话框会短暂重试；shell 工具这条路径不会。
