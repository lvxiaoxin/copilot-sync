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

## Why

You configure Copilot once — MCP servers, skills, prompts, agents, settings — then sit
down at another devbox and have to rebuild the same setup. **copilot-sync** collects the
shareable parts of `~/.copilot`, stores them in a GitHub repo you control, and restores
them on any OS.

- **`push` / `pull`** — one repo, many machines.
- **Copilot-only by design** — no multi-agent branching or cross-tool path quirks.
- **Safe by default** — curated allow-list, hard deny-list, and secret scanning.
- **Readable dry runs** — file trees show exactly what would change.
- **Session history** — opt-in archive/restore for Copilot CLI sessions.

## Install

```bash
npm install -g @lvxiaoxin/copilot-sync
```

**Requirements:** Node.js >= 18.17 and `git` on your `PATH`. Authentication reuses your
existing git setup; copilot-sync never handles credentials directly.

## Quick start

Create an empty private GitHub repo to act as your sync store, then:

```bash
# First machine
copilot-sync onboard
copilot-sync status
copilot-sync push

# Other machines
copilot-sync onboard
copilot-sync pull
```

> [!IMPORTANT]
> Use a **private** repository. Copilot config and session history can include personal
> workflow details, prompts, file paths, and command output.

## Commands

| Command | Description |
| --- | --- |
| `copilot-sync onboard` | Configure the remote repo and branch. State is stored under `~/.copilot-sync/`. |
| `copilot-sync status` | Show the configured remote and what this machine would sync. |
| `copilot-sync push` | Collect shareable Copilot config, secret-scan it, commit, and push. |
| `copilot-sync pull` | Pull remote config and apply it into `~/.copilot`, backing up overwrites first. |

Shared flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Preview changes without writing or pushing. |
| `--unsafe-allow` | Bypass deny-list / secret scanning for config sync. Discouraged. |

## Session history

> [!IMPORTANT]
> Session history can contain **secrets, file contents, and command output** verbatim.
> Only sync it to a private repository. This is opt-in and never runs as part of
> normal `push` / `pull`.

Copilot CLI stores session payloads in `~/.copilot/session-state/` and discovery/search
metadata in `~/.copilot/session-store.db`. copilot-sync carries both pieces so restored
sessions can appear in tools like `copilot-starter`.

> [!TIP]
> Use copilot-sync together with
> [copilot-starter](https://github.com/lvxiaoxin/copilot-starter): copilot-sync moves the
> sessions across machines, while copilot-starter gives you fuzzy search, previews, and
> one-key resume.

```console
$ copilot-sync history list
$ copilot-sync history push
$ copilot-sync history push --since 7d
$ copilot-sync history pull --session 1a2b
```

<details open>
<summary><b>history list</b> — local vs remote sessions</summary>

```console
$ copilot-sync history list
› Fetching latest from remote ...
copilot-sync history
Local sessions:  31  /Users/lvxiaoxin/.copilot/session-state
Remote sessions: 7

  ecd8804d-595d-49dd-b8a1-269f576aaf74  local-only   22MB, 2026-06-05 03:12
  c7f7fde3-8b6f-407f-9170-a54403e223d5  local-only   348KB, 2026-06-05 03:12
  cd60c9a8-1913-4a69-b2b9-5f67739d63c4  synced       1.3MB, 2026-06-05 04:01 active
  4e4ea67c-4f07-49a8-a949-2411141abae3  synced       720B, 2026-06-05 03:12
  …
```
</details>

<details open>
<summary><b>history push --since 7d</b> — scoped archive</summary>

```console
$ copilot-sync history push --since 7d
copilot-sync history push  since: 7d
! Session history can contain secrets, file contents, and command output.
! Only sync to a private repository.

4e4ea67c (2 file(s), 720B)
ecd8804d (23 file(s), 22MB)
f120e28f (9 file(s), 980KB)
! 1 active session(s) skipped (recently modified). Use --force to include.
! 21 session(s) older than --since 7d skipped.
› Fetching latest from remote ...
› Pushing to remote ...
✓ Pushed history for 9 session(s), 28MB.
Updated shared session-store metadata for 9 session(s).
```
</details>

| Command | Description |
| --- | --- |
| `copilot-sync history list` | Show local and remote sessions with `synced`, `local-only`, or `remote-only` state. |
| `copilot-sync history push` | Additively archive this machine's Copilot sessions to `history/copilot/`. |
| `copilot-sync history pull` | Restore sessions into `~/.copilot/session-state/` and merge `session-store.db` metadata. |

History flags:

| Flag | Effect |
| --- | --- |
| `--session <id>` | Limit to one session by full id or unique prefix. |
| `--since <window>` | Only include local sessions modified within `7d`, `2w`, `1m`, `1y`, or a number of days. |
| `--dry-run` | Preview per-session files without writing or pushing. |
| `--yes` | Skip the one-time privacy confirmation on history push. |
| `--force` | Include or overwrite sessions that look active. |
| `--force-large` | Allow files approaching GitHub's 100MB limit. |

## What gets synced

Config sync is relative to `~/.copilot` and includes:

| Path | Purpose |
| --- | --- |
| `mcp-config.json` | MCP server definitions. |
| `settings.json` | Copilot CLI settings. |
| `skills/` | Installed or custom skills. |
| `agents/` | Custom agents. |
| `prompts/` | Prompt files. |

Runtime/session data is excluded from normal config sync and only handled by
`copilot-sync history`.

## Safety model

copilot-sync treats your home directory as untrusted input:

1. **Allow-list collection** — only the paths above are collected for config sync.
2. **Hard deny-list** — auth config, session databases, logs, caches, backups, and runtime
   state are blocked even if a custom manifest includes them.
3. **Secret scanner** — token-shaped values and secret-like assignments abort config push.
4. **Atomic writes and backups** — overwrites are backed up under
   `~/.copilot-sync/backups/`; writes use temp-file + rename.

## Configuration

Config lives at `~/.copilot-sync/config.json`. You can override the Copilot base or include
list with an optional manifest:

```json
{
  "remote": "git@github.com:you/copilot-store.git",
  "branch": "main",
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

Paths:

| Path | Purpose |
| --- | --- |
| `~/.copilot-sync/config.json` | Remote, branch, and optional manifest. |
| `~/.copilot-sync/repo` | Local working clone of the sync store. |
| `~/.copilot-sync/backups/<timestamp>/` | Files replaced by recent pulls. |

Set `COPILOT_SYNC_HOME` to override the state directory, which is useful for tests.

## FAQ

**Does it sync secrets or API keys?**  
No. Known credential files and Copilot runtime databases are denied, and config pushes are
secret-scanned before commit.

**Will pulling delete local-only files?**  
No. Pull writes files present in the remote store and backs up overwritten local files; it
does not delete unrelated local files.

**Does normal `push` include session history?**  
No. Session history is opt-in through `copilot-sync history push`.

**Why keep `copilot/` and `history/copilot/` in the remote if the tool is Copilot-only?**  
Keeping those paths preserves compatibility with existing sync stores and leaves room for
future metadata without flattening old remotes.

## License

[MIT](./LICENSE) © lvxiaoxin

## 中文

### 为什么需要它

你在一台机器上配置好了 GitHub Copilot CLI：MCP servers、skills、agents、prompts、
settings。换到另一台开发机时又要重新配置。**copilot-sync** 会把 `~/.copilot`
中适合同步的部分收集起来，存到你自己控制的 GitHub 仓库，并在其他机器恢复。

- **`push` / `pull`** —— 一个仓库，多台机器。
- **只支持 Copilot** —— 不再包含其他工具的分支逻辑。
- **默认安全** —— allow-list、hard deny-list、secret scan。
- **可读 dry run** —— 用文件树展示会发生什么。
- **会话历史** —— 可选同步 Copilot CLI session history。

### 安装

```bash
npm install -g @lvxiaoxin/copilot-sync
```

要求 Node.js >= 18.17，并且 `git` 在 `PATH` 中。认证复用你现有的 git 配置。

### 快速开始

准备一个空的私有 GitHub 仓库作为同步存储：

```bash
# 第一台机器
copilot-sync onboard
copilot-sync status
copilot-sync push

# 其他机器
copilot-sync onboard
copilot-sync pull
```

### 命令

| 命令 | 说明 |
| --- | --- |
| `copilot-sync onboard` | 配置远端仓库和分支，状态存放在 `~/.copilot-sync/`。 |
| `copilot-sync status` | 查看当前配置以及本机会同步什么。 |
| `copilot-sync push` | 收集可同步的 Copilot 配置，secret scan 后提交并推送。 |
| `copilot-sync pull` | 拉取远端配置并写入 `~/.copilot`，覆盖前会备份。 |

### 会话历史同步

> [!IMPORTANT]
> 会话历史可能包含密钥、文件内容和命令输出。只建议同步到私有仓库。

Copilot CLI 的会话内容在 `~/.copilot/session-state/`，共享索引在
`~/.copilot/session-store.db`。copilot-sync 会同时携带这两部分，因此恢复后的
会话能被 `copilot-starter` 等工具看到。

> [!TIP]
> 建议和 [copilot-starter](https://github.com/lvxiaoxin/copilot-starter) 搭配使用：
> copilot-sync 负责跨机器同步会话，copilot-starter 负责模糊搜索、预览和一键恢复。

```console
$ copilot-sync history list
$ copilot-sync history push
$ copilot-sync history push --since 7d
$ copilot-sync history pull --session 1a2b
```

| 命令 | 说明 |
| --- | --- |
| `copilot-sync history list` | 展示本地和远端会话，以及 `synced`、`local-only`、`remote-only` 状态。 |
| `copilot-sync history push` | 追加式归档本机 Copilot 会话到 `history/copilot/`。 |
| `copilot-sync history pull` | 恢复会话到 `~/.copilot/session-state/`，并合并 `session-store.db` 元数据。 |

### 默认同步内容

普通配置同步相对于 `~/.copilot`：

| 路径 | 用途 |
| --- | --- |
| `mcp-config.json` | MCP server 配置。 |
| `settings.json` | Copilot CLI 设置。 |
| `skills/` | 技能。 |
| `agents/` | 自定义 agents。 |
| `prompts/` | Prompt 文件。 |

运行时数据和会话数据不会被普通 `push` 同步，只能通过 `copilot-sync history` 显式处理。

### 配置

配置文件在 `~/.copilot-sync/config.json`。可选 `manifest` 可以覆盖 Copilot base
或 include 列表：

```json
{
  "remote": "git@github.com:you/copilot-store.git",
  "branch": "main",
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

可以用 `COPILOT_SYNC_HOME` 覆盖状态目录，方便测试。

### FAQ

**会同步 secrets / API keys 吗？**  
不会。已知凭据文件和 Copilot 运行时数据库会被 deny-list 拦截，配置 push 前还会做 secret scan。

**`pull` 会删除本地独有文件吗？**  
不会。它只写远端仓库里存在的文件，并在覆盖前备份。

**普通 `push` 会带上 session history 吗？**  
不会。会话历史必须显式运行 `copilot-sync history push`。

### 许可证

[MIT](./LICENSE) © lvxiaoxin
