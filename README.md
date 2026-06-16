<h1 align="center">copilot-sync</h1>

<p align="center">
  <b>Sync your GitHub Copilot CLI setup across every machine.</b><br>
  MCP servers, skills, agents, prompts, settings, and opt-in session history —
  carried between devboxes through a GitHub repo you own.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lvxiaoxin/copilot-sync"><img alt="npm version" src="https://img.shields.io/npm/v/%40lvxiaoxin%2Fcopilot-sync?color=cb3837&logo=npm"></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/node/v/%40lvxiaoxin%2Fcopilot-sync?color=339933&logo=node.js&logoColor=white"></a>
  <img alt="platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue">
  <a href="#license"><img alt="license" src="https://img.shields.io/npm/l/%40lvxiaoxin%2Fcopilot-sync?color=blue"></a>
</p>

<p align="center">
  English · <a href="#中文">中文</a>
</p>

---

## Overview

Configure Copilot CLI once, then reuse that setup everywhere.

- Syncs shareable parts of `~/.copilot` across machines using a GitHub repo you own.
- Keeps config sync and session history sync separate.
- Defaults to safety: allow-list collection, deny-list blocking, secret scanning, backups.

> [!IMPORTANT]
> Use a **private** repository. Copilot config and session history can include personal
> workflow details, prompts, file paths, and command output.

## Install

```bash
npm install -g @lvxiaoxin/copilot-sync
```

Requirements: Node.js >= 18.17 and `git` on `PATH`.

## 1-Minute Setup

```bash
# First machine
copilot-sync onboard
copilot-sync status
copilot-sync push

# Other machines
copilot-sync onboard
copilot-sync pull
```

## Daily Usage

### Update your shared config

```bash
copilot-sync push
```

### Apply latest shared config on this machine

```bash
copilot-sync pull
```

### Preview before changing anything

```bash
copilot-sync push --dry-run
copilot-sync pull --dry-run
```

## Session History Usage

> [!IMPORTANT]
> Session history can contain secrets, file contents, and command output.
> Only sync it to a private repository.

> [!TIP]
> For a better end-to-end session workflow, use this together with
> [copilot-starter](https://github.com/lvxiaoxin/copilot-starter):
> copilot-sync handles cross-machine session transport, while copilot-starter
> focuses on search, preview, and quick resume.

Common flows:

```bash
# Inspect state
copilot-sync history list

# Upload local sessions
copilot-sync history push

# Upload only recent sessions
copilot-sync history push --since 7d

# Restore one session (full id or unique prefix)
copilot-sync history pull --session 1a2b
```

## History Modes (Configured During Onboard)

`copilot-sync onboard` asks for `history.mode`:

| Mode | `history push` behavior | `history pull` behavior |
| --- | --- | --- |
| `override` (default) | Archive local sessions additively to remote | Restore remote sessions locally (backup before overwrite) |
| `sync` | Only push `local-only` or `local-newer` sessions | Only pull `remote-only` or `remote-newer` sessions |

Notes for `sync` mode:

- Conflict unit is per session id.
- Newer last-change timestamp wins for that command direction.
- Active local sessions are skipped unless `--force` is used.
- Replaced local files are still backed up under `~/.copilot-sync/backups/`.

## Command Reference

Core commands:

| Command | Purpose |
| --- | --- |
| `copilot-sync onboard` | Configure remote repo, branch, and history mode (`~/.copilot-sync/config.json`). |
| `copilot-sync status` | Show remote, branch, history mode, and sync preview summary. |
| `copilot-sync push` | Collect config, secret-scan, commit, and push. |
| `copilot-sync pull` | Pull and apply config into `~/.copilot` with overwrite backups. |

History commands:

| Command | Purpose |
| --- | --- |
| `copilot-sync history list` | Show local/remote sessions and `synced` / `local-only` / `remote-only`. |
| `copilot-sync history push` | Push session history using configured history mode. |
| `copilot-sync history pull` | Pull session history using configured history mode. |

## Flags

Config sync flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Preview changes only. |
| `--unsafe-allow` | Bypass deny-list/secret scan for config sync (not recommended). |

History flags:

| Flag | Effect |
| --- | --- |
| `--session <id>` | Target one session (full id or unique prefix). |
| `--since <window>` | Push side filter for local sessions, e.g. `7d`, `2w`, `1m`, `1y`. |
| `--dry-run` | Preview history changes only. |
| `--yes` | Skip one-time privacy confirmation on history push. |
| `--force` | Include/overwrite sessions that look active. |
| `--force-large` | Allow files near GitHub 100MB limit. |

## What Gets Synced

Config sync (relative to `~/.copilot`):

| Path | Purpose |
| --- | --- |
| `mcp-config.json` | MCP server definitions |
| `settings.json` | Copilot CLI settings |
| `skills/` | Skills |
| `agents/` | Custom agents |
| `prompts/` | Prompt files |

Session history sync additionally handles:

- `~/.copilot/session-state/`
- `~/.copilot/session-store.db` related metadata

## Safety Model

1. Allow-list collection for config files.
2. Hard deny-list for auth/runtime/sensitive paths.
3. Secret scanning before config push.
4. Atomic writes and timestamped backups before overwrite.

## Configuration

Path: `~/.copilot-sync/config.json`

```json
{
  "remote": "git@github.com:you/copilot-store.git",
  "branch": "main",
  "history": { "mode": "sync" },
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

`history.mode` supports `override` and `sync`.

State directories:

| Path | Purpose |
| --- | --- |
| `~/.copilot-sync/config.json` | User config |
| `~/.copilot-sync/repo` | Local managed clone |
| `~/.copilot-sync/backups/<timestamp>/` | Pull/restore backups |

Set `COPILOT_SYNC_HOME` to override state root.

## FAQ

**Does this sync secrets or API keys?**  
No. Credential/runtime files are denied and config push is secret-scanned.

**Will pull delete my local-only files?**  
No. It writes files from the remote store and backs up overwritten files.

**Does normal `push` include session history?**  
No. Session history is only synced through `copilot-sync history ...`.

## License

[MIT](./LICENSE) © lvxiaoxin

## 中文

### 概览

在一台机器配置好 Copilot CLI 后，把同一套配置复用到所有开发机。

- 通过你自己的 GitHub 仓库同步 `~/.copilot` 中可共享的内容。
- 配置同步和会话历史同步分离。
- 默认安全：allow-list、deny-list、secret scan、覆盖前备份。

> [!IMPORTANT]
> 请使用**私有仓库**。Copilot 配置和会话历史可能包含个人工作信息、提示词、路径和命令输出。

### 安装

```bash
npm install -g @lvxiaoxin/copilot-sync
```

要求：Node.js >= 18.17，且 `git` 在 `PATH` 中。

### 1 分钟完成初始配置

```bash
# 第一台机器
copilot-sync onboard
copilot-sync status
copilot-sync push

# 其他机器
copilot-sync onboard
copilot-sync pull
```

### 日常使用

#### 更新共享配置

```bash
copilot-sync push
```

#### 在当前机器应用最新配置

```bash
copilot-sync pull
```

#### 先预览再执行

```bash
copilot-sync push --dry-run
copilot-sync pull --dry-run
```

### 会话历史使用

> [!IMPORTANT]
> 会话历史可能包含密钥、文件内容和命令输出。只建议同步到私有仓库。

> [!TIP]
> 想获得更好的整体使用体验，建议搭配
> [copilot-starter](https://github.com/lvxiaoxin/copilot-starter)：
> copilot-sync 负责跨机器传输会话，copilot-starter 负责检索、预览和快速恢复。

常用流程：

```bash
# 查看本地/远端会话状态
copilot-sync history list

# 上传本机会话
copilot-sync history push

# 只上传最近会话
copilot-sync history push --since 7d

# 恢复单个会话（完整 id 或唯一前缀）
copilot-sync history pull --session 1a2b
```

### 历史模式（onboard 时配置）

`copilot-sync onboard` 会让你选择 `history.mode`：

| 模式 | `history push` 行为 | `history pull` 行为 |
| --- | --- | --- |
| `override`（默认） | 追加式归档本机会话到远端 | 从远端恢复到本地（覆盖前备份） |
| `sync` | 仅推送 `local-only` 或 `local-newer` 会话 | 仅拉取 `remote-only` 或 `remote-newer` 会话 |

`sync` 模式说明：

- 冲突判断单位是会话 id。
- 以最近变更时间较新的一侧为准（按当前命令方向执行）。
- 本地活跃会话默认跳过，可用 `--force` 覆盖。
- 本地被替换文件仍会备份到 `~/.copilot-sync/backups/`。

### 命令参考

核心命令：

| 命令 | 用途 |
| --- | --- |
| `copilot-sync onboard` | 配置远端仓库、分支和 history mode（写入 `~/.copilot-sync/config.json`）。 |
| `copilot-sync status` | 查看远端、分支、history mode 和同步概览。 |
| `copilot-sync push` | 收集配置、secret scan、提交并推送。 |
| `copilot-sync pull` | 拉取并写入 `~/.copilot`，覆盖前备份。 |

历史命令：

| 命令 | 用途 |
| --- | --- |
| `copilot-sync history list` | 显示本地/远端会话及 `synced` / `local-only` / `remote-only`。 |
| `copilot-sync history push` | 按配置的 history mode 推送会话历史。 |
| `copilot-sync history pull` | 按配置的 history mode 拉取会话历史。 |

### 参数说明

配置同步参数：

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 仅预览，不写入不推送。 |
| `--unsafe-allow` | 配置同步时绕过 deny-list/secret scan（不推荐）。 |

历史同步参数：

| 参数 | 作用 |
| --- | --- |
| `--session <id>` | 只处理一个会话（完整 id 或唯一前缀）。 |
| `--since <window>` | push 侧本地会话窗口过滤，如 `7d`、`2w`、`1m`、`1y`。 |
| `--dry-run` | 仅预览历史同步变更。 |
| `--yes` | 跳过 history push 的一次性隐私确认。 |
| `--force` | 包含或覆盖看起来仍在活跃的会话。 |
| `--force-large` | 允许接近 GitHub 100MB 限制的大文件。 |

### 同步内容

配置同步（相对于 `~/.copilot`）：

| 路径 | 用途 |
| --- | --- |
| `mcp-config.json` | MCP server 定义 |
| `settings.json` | Copilot CLI 设置 |
| `skills/` | 技能 |
| `agents/` | 自定义 agents |
| `prompts/` | Prompt 文件 |

会话历史同步额外处理：

- `~/.copilot/session-state/`
- `~/.copilot/session-store.db` 相关元数据

### 安全模型

1. 配置文件使用 allow-list 收集。
2. 认证/运行时/敏感路径使用 hard deny-list 拦截。
3. 配置 push 前执行 secret scan。
4. 覆盖前做原子写入和时间戳备份。

### 配置文件

路径：`~/.copilot-sync/config.json`

```json
{
  "remote": "git@github.com:you/copilot-store.git",
  "branch": "main",
  "history": { "mode": "sync" },
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

`history.mode` 支持 `override` 和 `sync`。

状态目录：

| 路径 | 用途 |
| --- | --- |
| `~/.copilot-sync/config.json` | 用户配置 |
| `~/.copilot-sync/repo` | 本地托管克隆 |
| `~/.copilot-sync/backups/<timestamp>/` | pull/restore 备份 |

可通过 `COPILOT_SYNC_HOME` 覆盖状态目录根路径。

### FAQ

**会同步 secrets 或 API keys 吗？**  
不会。凭据/运行时文件会被拦截，配置 push 前会做 secret scan。

**`pull` 会删除本地独有文件吗？**  
不会。它只写入远端仓库中的文件，并在覆盖前备份。

**普通 `push` 会带上会话历史吗？**  
不会。会话历史仅通过 `copilot-sync history ...` 同步。

### 许可证

[MIT](./LICENSE) © lvxiaoxin
