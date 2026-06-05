<h1 align="center">agent-sync</h1>

<p align="center">
  <b>Sync your AI agent configuration across every machine.</b><br>
  Skills, MCP servers, agents, prompts &amp; settings for <b>Copilot</b>, <b>Claude</b> &amp; <b>Codex</b> —
  carried between your devboxes through a GitHub repo you own.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lvxiaoxin/agent-sync"><img alt="npm version" src="https://img.shields.io/npm/v/@lvxiaoxin/agent-sync?color=cb3837&logo=npm"></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/node/v/@lvxiaoxin/agent-sync?color=339933&logo=node.js&logoColor=white"></a>
  <img alt="platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue">
  <a href="#license"><img alt="license" src="https://img.shields.io/npm/l/@lvxiaoxin/agent-sync?color=blue"></a>
</p>

<p align="center">
  English · <a href="#中文">中文</a>
</p>

---

## Why

You configure Copilot, Claude, and Codex on one machine — skills, MCP servers,
custom agents, prompts — then sit down at another devbox with none of it. **agent-sync**
collects the *shareable* parts of those configs, stores them in a GitHub repo you control,
and lays them back down in the right places on any OS.

- 🔁 **`push` / `pull`** — one repo, many machines (macOS · Linux · Windows).
- 🧠 **Three agents** — Copilot (`~/.copilot`), Claude (`~/.claude`), Codex (`~/.codex`).
- 🛡️ **Safe by default** — curated allow-list + hard deny-list + a secret scanner that
  blocks any push containing token-shaped values.
- 🌲 **Readable diffs** — `--dry-run` prints a per-agent file tree of exactly what changes.
- 💾 **Non-destructive** — overwrites are backed up; local-only files are never deleted.
- 📦 **Small** — a lean CLI that shells out to your existing `git` for auth.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [In action](#in-action)
- [Commands](#commands)
- [Session history](#session-history)
- [Resume sessions across devboxes](#resume-sessions-across-devboxes)
- [What gets synced](#what-gets-synced)
- [Safety model](#safety-model)
- [Configuration](#configuration)
- [How conflicts are handled](#how-conflicts-are-handled)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [License](#license)

## Install

```bash
npm install -g @lvxiaoxin/agent-sync
```

**Requirements:** Node.js ≥ 18.17 and `git` on your `PATH`. Authentication reuses your
existing git setup (SSH keys, credential manager, `gh`, or a PAT) — agent-sync never
handles credentials itself.

## Quick start

Create an **empty** GitHub repo to act as your store (e.g. `you/agent-store`), then:

> [!IMPORTANT]
> **Use a _private_ repository.** Even though agent-sync filters credentials and
> secret-scans every push, your skills, prompts, and MCP/agent settings are personal
> configuration — a private repo keeps them off the public internet and adds a second
> line of defense if something slips through the allow-list.


```bash
# On your first machine
agent-sync onboard      # point it at the repo (URL or owner/repo) + branch
agent-sync status       # preview what would sync
agent-sync push         # upload this machine's artifacts

# On every other machine
agent-sync onboard      # same repo + branch
agent-sync pull         # apply artifacts into the right local dirs
```

## In action

<details open>
<summary><b>onboard</b> — one-time setup per machine</summary>

```console
$ agent-sync onboard

agent-sync onboarding
This sets the GitHub repo used to store/sync your agent configs.

Remote git repo (URL or owner/repo): you/agent-store
Branch (main):

Agents to sync: copilot, claude, codex (default: all)
Comma-separated subset, or blank for all:
✓ Saved config to ~/.agent-sync/config.json
› Cloning https://github.com/you/agent-store ...
✓ Onboarding complete.

Next: agent-sync push on this machine, then agent-sync pull on the others.
```
</details>

<details open>
<summary><b>status</b> — what this machine would contribute</summary>

```console
$ agent-sync status
agent-sync status
Host: devbox-mac   OS: darwin (arm64)
Remote:  https://github.com/you/agent-store
Branch:  main
Agents:  copilot, claude, codex
Clone:   present ~/.agent-sync/repo

Would sync from this machine:
  copilot ~/.copilot → 2 file(s), 3 not present
  claude  ~/.claude  → 11 file(s), 2 symlink(s) skipped, 3 not present
  codex   ~/.codex   → 46 file(s), 2 symlink(s) skipped, 1 not present

Run `agent-sync push --dry-run` or `agent-sync pull --dry-run` for details.
```
</details>

<details>
<summary><b>push --dry-run</b> — a per-agent file tree of what would upload</summary>

```console
$ agent-sync push --dry-run
agent-sync push
copilot: 2 file(s), 3 not present
claude: 11 file(s), 3 not present, 2 symlink(s) skipped
!   symlink skipped: claude/skills/excalidraw-diagram
codex: 46 file(s), 1 not present, 2 symlink(s) skipped

Dry run — no changes pushed. Files that would be synced:

copilot (2 file(s))
├── mcp-config.json
└── settings.json

claude (11 file(s))
├── skills/
│   ├── agents/
│   │   ├── architect.md
│   │   ├── developer.md
│   │   └── pm.md
│   ├── crew/
│   │   └── SKILL.md
│   └── workflows/
│       ├── board-update.md
│       └── stage-gate.md
└── settings.json

codex (46 file(s))
├── skills/
│   └── .system/
│       ├── imagegen/
│       │   ├── scripts/
│       │   │   └── image_gen.py
│       │   └── SKILL.md
│       └── skill-creator/
│           └── SKILL.md
└── AGENTS.md
```
</details>

<details>
<summary><b>pull --dry-run</b> — tagged tree (<code>new</code> / <code>overwrite</code>) before anything is written</summary>

```console
$ agent-sync pull --dry-run
agent-sync pull  (dry run)

copilot (2 to apply)
├── mcp-config.json  new
└── settings.json  overwrite

claude (no changes)

Dry run — no changes written. 1 new, 1 overwrite, 4 unchanged.
On a real pull, files marked overwrite are backed up to ~/.agent-sync/backups/ first.
```
</details>

## Commands

| Command | Description |
| --- | --- |
| `agent-sync onboard` | Interactive setup. Accepts a git URL **or** `owner/repo` shorthand. Saves `~/.agent-sync/config.json`, clones into `~/.agent-sync/repo`, and seeds `.gitattributes` for stable line endings. |
| `agent-sync push` | Collect curated artifacts for the current OS → secret-scan → mirror into the repo → commit & push. Deletions of synced files propagate to the repo. |
| `agent-sync pull` | Pull the repo and write artifacts into the correct local dirs. Overwrites are backed up; local-only files are never touched. |
| `agent-sync status` | Show configuration and a per-agent summary of what would sync. |

**Shared flags** (`push` / `pull`):

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print the per-agent file tree of what would change — writes nothing. |
| `--unsafe-allow` | Bypass the deny-list / secret scan. Discouraged; use only if you know what you're doing. |

## Session history

> [!IMPORTANT]
> Session history can contain **secrets, file contents, and command output** verbatim.
> Only sync it to a **private** repository. This is opt-in (you confirm once) and never
> runs as part of `push`/`pull`.

> [!NOTE]
> **Copilot CLI only for now.** Session-history sync currently supports the
> **GitHub Copilot CLI** (`~/.copilot/session-state/`). The `--agent` flag is reserved so
> Claude Code and Codex can be added later — today only `--agent copilot` (the default)
> works; `--agent claude`/`--agent codex` fail with a clear "not supported yet" message.

Carry your Copilot CLI sessions (plans, checkpoints, transcripts, artifacts) between
machines so you can pick work back up on another devbox.

```console
$ agent-sync history list                 # local vs remote sessions and their state
$ agent-sync history push                 # archive this machine's sessions (one-time confirm)
$ agent-sync history push --since 7d       # only sessions modified in the last 7 days
$ agent-sync history pull --session 1a2b   # restore a session by id prefix on another machine
```

<details open>
<summary><b>history list</b> — local vs remote sessions, with active-session detection</summary>

```console
$ agent-sync history list
› Fetching latest from remote ...
agent-sync history  agent: copilot
Local sessions:  31  /Users/lvxin/.copilot/session-state
Remote sessions: 7

  ecd8804d-595d-49dd-b8a1-269f576aaf74  local-only   22MB, 2026-06-05 03:12
  c7f7fde3-8b6f-407f-9170-a54403e223d5  local-only   348KB, 2026-06-05 03:12
  cd60c9a8-1913-4a69-b2b9-5f67739d63c4  synced       1.3MB, 2026-06-05 04:01 active
  4e4ea67c-4f07-49a8-a949-2411141abae3  synced       720B, 2026-06-05 03:12
  …
```
</details>

<details open>
<summary><b>history push --since 7d</b> — scoped archive with active-session safety</summary>

```console
$ agent-sync history push --since 7d
agent-sync history push  agent: copilot  since: 7d
! Session history can contain secrets, file contents, and command output.
! Only sync to a private repository.

4e4ea67c (2 file(s), 720B)
ecd8804d (23 file(s), 22MB)
f120e28f (9 file(s), 980KB)
dec09c3d (11 file(s), 4.7MB)
c7f7fde3 (6 file(s), 348KB)
b9cb448b (5 file(s), 221KB)
66f3f126 (2 file(s), 544B)
4b32eecc (2 file(s), 544B)
8148c587 (5 file(s), 69KB)
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
| `agent-sync history list` | Show every local and remote session with size, last-modified, and `synced` / `local-only` / `remote-only` state. |
| `agent-sync history push` | Archive this machine's sessions to `history/copilot/` in the repo. **Additive** — never deletes remote sessions, so sessions union across machines. |
| `agent-sync history pull` | Restore sessions into `~/.copilot/session-state/` and merge their shared `session-store.db` metadata. Overwrites are backed up first; local-only files are never touched. |

| Flag | Applies to | Effect |
| --- | --- | --- |
| `--agent <name>` | push / pull / list | Which agent's history to sync. **Default `copilot`** — the only one supported today. |
| `--session <id>` | push / pull | Limit to one session (full id or a unique prefix). |
| `--since <window>` | push / list | Only sessions modified within a window: `7d`, `2w`, `1m` (= 30 days), `1y`, or a bare number of days. Push defaults to **all** sessions. |
| `--dry-run` | push / pull | Preview the per-session file tree — writes/pushes nothing. |
| `--yes` | push | Skip the one-time privacy confirmation. |
| `--force` | push / pull | Include / overwrite sessions that look **active** (recently modified). |
| `--force-large` | push | Allow files approaching GitHub's 100MB limit. |

How it stays safe:

- **Active sessions are skipped** by default (recent mtime or a live SQLite `-wal`/`-shm`
  sidecar), so an in-flight session can't be captured half-written or clobbered — including
  the very session running the command.
- **Credential files are excluded** (`.env`, `id_rsa`, `*.pem`, `.npmrc`, …) and symlinks
  are skipped, even though history bypasses the normal config allow-list.
- **Live database sidecars** (`*-wal`, `*-shm`) and temp/`node_modules`/`.git` paths are
  dropped to avoid torn or bulky copies.
- **Backups before overwrite** — replaced local files land in
  `~/.agent-sync/backups/<timestamp>/history/copilot/` exactly like a config `pull`.

> [!NOTE]
> For **Copilot CLI**, history sync now carries both the on-disk session folder and the
> matching rows from `~/.copilot/session-store.db`, so restored sessions show up in
> tools like `copilot-starter` and Copilot's own session browsers on the target machine.

## Resume sessions across devboxes

`agent-sync history` moves the session files **and, for Copilot, the shared session-store
metadata** between machines. To browse and resume a restored session comfortably, pair it
with a session launcher — a small TUI that lists your sessions and reopens the right one
in the agent CLI:

| Tool | For | Install | Launch |
| --- | --- | --- | --- |
| [**copilot-starter**](https://github.com/lvxiaoxin/copilot-starter) | GitHub Copilot CLI | `npm i -g copilot-starter` | `copilot-starter` |
| [**claude-starter**](https://github.com/Bojun-Vvibe/claude-starter) | Claude Code | `npm i -g claude-starter` | `claude-starter` |
| [**codex-starter**](https://github.com/Bojun-Vvibe/codex-starter) | Codex CLI | `npm i -g codex-starter` | `codex-starter` |

Each gives you fuzzy search, project grouping, live preview, and one-key resume instead of a
wall of UUIDs — so a session that started on one devbox can be found and continued on another.

> [!TIP]
> **The cross-devbox workflow:** `agent-sync history push` on the source machine →
> `agent-sync history pull` on the target machine → open the matching **`*-starter`** there
> and resume. `agent-sync` carries the history; the starters give you a great way to pick a
> session back up.

## What gets synced

Relative to each agent's base directory:

| Agent | Base | Default includes |
| --- | --- | --- |
| **copilot** | `~/.copilot` | `mcp-config.json`, `settings.json`, `skills/`, `agents/`, `prompts/` |
| **claude** | `~/.claude` | `settings.json`, `skills/`, `agents/`, `commands/`, `output-styles/`, `CLAUDE.md` |
| **codex** | `~/.codex` | `AGENTS.md`, `skills/`, `prompts/` |

> [!NOTE]
> `codex/config.toml` is **excluded by default** because it commonly embeds a token
> (e.g. `ANTHROPIC_AUTH_TOKEN`). You can opt in via your config — it is still
> secret-scanned on every push.

## Safety model

agent-sync treats your home dir as untrusted input and applies four layers:

1. **Curated allow-list** — only the paths listed above are ever collected.
2. **Hard deny-list** — sessions, `*.sqlite`/`*.db`, logs, caches, history,
   `config.json`, `settings.local.json`, etc. are blocked *even if* a custom manifest
   includes them (unless you pass `--unsafe-allow`).
3. **Secret scanner** — token shapes (GitHub / OpenAI / Anthropic / AWS / Google / Slack /
   JWT) and secret-like `key = value` assignments **abort the push**.
4. **Hardening** — symlinks are skipped, path-containment is enforced before every write or
   delete, and writes are atomic (temp file + rename) so locked files can't be corrupted.

## Configuration

Config lives at `~/.agent-sync/config.json`. Add an optional `manifest` block to override
the `base` and/or `include` list per agent:

```json
{
  "remote": "git@github.com:you/agent-store.git",
  "branch": "main",
  "agents": ["copilot", "claude", "codex"],
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

The hard deny-list still applies to any custom includes. Where things live:

| Path | Purpose |
| --- | --- |
| `~/.agent-sync/config.json` | Your remote, branch, agents, and optional manifest. |
| `~/.agent-sync/repo` | Local working clone of the store. |
| `~/.agent-sync/backups/<timestamp>/` | Files replaced by the last 20 `pull` / `history pull` runs. |

> Override the base directory with the `AGENT_SYNC_HOME` environment variable (handy for testing).

## How conflicts are handled

`pull` is **"remote wins, with a safety net"** — not a three-way merge:

- Files are compared by content. **Identical** → skipped. **Different** → the conflict path.
- Before overwriting, your existing local file is copied to
  `~/.agent-sync/backups/<timestamp>/<agent>/<path>` — nothing is lost.
- **Local-only files are never deleted.** Only files present in the repo are written.
- A **locked** file (e.g. an agent running on Windows) is skipped with a warning, not forced.
- Executable bits on skill scripts are preserved via a per-agent `.agent-sync-meta.json`
  and restored on pull (a no-op on Windows).

> [!TIP]
> Run `agent-sync pull --dry-run` first to see exactly which files are `new` vs `overwrite`
> before applying.

## Roadmap

Today agent-sync covers **shareable configuration**. Planned next, opt-in and behind the
same safety model:

- [x] **Session history sync** — carry sessions between machines (Copilot CLI; opt-in,
      private-repo only, active-session & credential guards). _Shipped._
- [ ] **Memory sync** — agent long-term memories / knowledge stores.
- [ ] **Selective profiles** — named subsets (e.g. `work` vs `personal`) you can push/pull
      independently.
- [ ] **Conflict review** — interactive per-file choose (`keep local` / `take remote` / `diff`).
- [ ] **More agents** — extend beyond Copilot, Claude, and Codex as new tools appear.

## FAQ

**Does it sync secrets or API keys?**
No. The deny-list excludes credential files, and the secret scanner aborts any push that
contains a token-shaped value.

**What auth does it use?**
Your existing `git` auth. If `git clone`/`push` works for the repo in your shell, agent-sync works.

**Can I sync only one agent?**
Yes — choose a subset during `onboard`, or edit `agents` in the config.

**Will pulling clobber my local edits?**
Conflicting files are overwritten by the remote version *after* being backed up. Use
`--dry-run` to preview, and `pull` before making large local changes.

**Should I use a private or public repo?**
A private repo is strongly recommended. Even though agent-sync filters credentials and
secret-scans every push, your skills, prompts, and MCP/agent settings are personal
configuration — a private repo keeps them off the public internet and adds a second line of
defense if something slips through the allow-list.

**Are agent-sync's own backups pushed?**
No. `pull` writes safety backups to `~/.agent-sync/backups/`, and the working clone lives in
`~/.agent-sync/repo/` — both outside the directories agent-sync reads from. A `history push`
only walks `~/.copilot/session-state/`, so backups never get re-uploaded.

**Which agents can I sync session history for?**
Copilot CLI only, for now. `history` defaults to `--agent copilot`; Claude Code and Codex
are reserved on the `--agent` flag and reported as "not supported yet" until implemented.

## License

[MIT](./LICENSE) © lvxiaoxin

## 中文

### 为什么需要它

你可能在一台机器上已经把 Copilot、Claude、Codex 的配置都调好了：技能、MCP
服务器、自定义 agents、prompts 一应俱全；换到另一台开发机时却什么都没有。
**agent-sync** 会把这些**适合同步的配置**收集起来，放进你自己控制的 GitHub 仓库，
然后在任意操作系统上恢复到正确的位置。

- 🔁 **`push` / `pull`** —— 一个仓库，多台机器（macOS · Linux · Windows）。
- 🧠 **三类 agent** —— Copilot（`~/.copilot`）、Claude（`~/.claude`）、Codex（`~/.codex`）。
- 🛡️ **默认安全** —— allow-list + hard deny-list + secret scanner，多一层保险。
- 🌲 **可读 diff** —— `--dry-run` 会按目录树展示将要同步的内容。
- 💾 **非破坏式** —— 覆盖前先备份，本地独有文件不会被删除。
- 📦 **轻量** —— CLI 本体很小，认证直接复用你现有的 `git`。

### 安装

```bash
npm install -g @lvxiaoxin/agent-sync
```

**要求：** Node.js ≥ 18.17，并且 `git` 在 `PATH` 中。认证直接复用你已有的
git 配置（SSH、credential manager、`gh`、PAT 等），agent-sync 不自己处理凭据。

### 快速开始

先准备一个**空的** GitHub 私有仓库作为同步存储（例如 `you/agent-store`），然后：

```bash
# 第一台机器
agent-sync onboard      # 配置远端仓库（URL 或 owner/repo）和分支
agent-sync status       # 预览本机会同步什么
agent-sync push         # 上传这台机器的配置

# 其他机器
agent-sync onboard      # 指向同一个仓库/分支
agent-sync pull         # 把配置恢复到本地正确位置
```

> [!IMPORTANT]
> **强烈建议使用私有仓库。** 尽管 agent-sync 会过滤凭据并做 secret scan，
> 但技能、提示词、MCP 设置本身仍然是个人配置，放在私有仓库更安全。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `agent-sync onboard` | 交互式初始化，保存 `~/.agent-sync/config.json` 并克隆远端仓库。 |
| `agent-sync push` | 收集当前机器的配置，做 secret scan，然后提交并推送到远端。 |
| `agent-sync pull` | 从远端拉取并应用到本地各 agent 配置目录。 |
| `agent-sync status` | 展示当前配置以及这台机器会同步哪些内容。 |

共享参数（`push` / `pull`）：

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只预览，不写入、不推送。 |
| `--unsafe-allow` | 跳过 deny-list / secret scan，不推荐。 |

### 会话历史同步

> [!IMPORTANT]
> 会话历史可能包含**密钥、文件内容、命令输出**等原始数据。
> 这部分同步是**显式 opt-in** 的，且**绝对建议只同步到私有仓库**。

> [!NOTE]
> 当前只支持 **GitHub Copilot CLI**。`history` 的 `--agent` 参数已经预留，
> 未来可以扩展到 Claude / Codex，但今天只有 `--agent copilot`（默认值）可用。

它可以把 Copilot CLI 的会话（plans、checkpoints、转录、产物）在不同机器之间带来带去。

```console
$ agent-sync history list                  # 看本地 / 远端有哪些会话
$ agent-sync history push                  # 把当前机器会话归档到远端（首次会确认）
$ agent-sync history push --since 7d       # 只推最近 7 天改动过的会话
$ agent-sync history pull --session 1a2b   # 在另一台机器恢复指定会话（支持前缀）
```

<details open>
<summary><b>history list</b> —— 查看本地 / 远端会话，以及 active 状态</summary>

```console
$ agent-sync history list
› Fetching latest from remote ...
agent-sync history  agent: copilot
Local sessions:  31  /Users/lvxin/.copilot/session-state
Remote sessions: 7

  ecd8804d-595d-49dd-b8a1-269f576aaf74  local-only   22MB, 2026-06-05 03:12
  c7f7fde3-8b6f-407f-9170-a54403e223d5  local-only   348KB, 2026-06-05 03:12
  cd60c9a8-1913-4a69-b2b9-5f67739d63c4  synced       1.3MB, 2026-06-05 04:01 active
  4e4ea67c-4f07-49a8-a949-2411141abae3  synced       720B, 2026-06-05 03:12
  …
```
</details>

<details open>
<summary><b>history push --since 7d</b> —— 按时间范围归档，并跳过活跃会话</summary>

```console
$ agent-sync history push --since 7d
agent-sync history push  agent: copilot  since: 7d
! Session history can contain secrets, file contents, and command output.
! Only sync to a private repository.

4e4ea67c (2 file(s), 720B)
ecd8804d (23 file(s), 22MB)
f120e28f (9 file(s), 980KB)
dec09c3d (11 file(s), 4.7MB)
c7f7fde3 (6 file(s), 348KB)
b9cb448b (5 file(s), 221KB)
66f3f126 (2 file(s), 544B)
4b32eecc (2 file(s), 544B)
8148c587 (5 file(s), 69KB)
! 1 active session(s) skipped (recently modified). Use --force to include.
! 21 session(s) older than --since 7d skipped.
› Fetching latest from remote ...
› Pushing to remote ...
✓ Pushed history for 9 session(s), 28MB.
Updated shared session-store metadata for 9 session(s).
```
</details>

| 命令 | 说明 |
| --- | --- |
| `agent-sync history list` | 列出本地与远端所有会话，展示大小、最后修改时间，以及 `synced` / `local-only` / `remote-only` 状态。 |
| `agent-sync history push` | 把本机 Copilot 会话归档到仓库中的 `history/copilot/`。**追加式**同步，不会删除其他机器已经推上去的会话。 |
| `agent-sync history pull` | 把会话恢复到 `~/.copilot/session-state/`，并合并对应的 `session-store.db` 元数据。覆盖前先备份，本地独有文件不会被删。 |

| 参数 | 适用命令 | 作用 |
| --- | --- | --- |
| `--agent <name>` | push / pull / list | 选择同步哪个 agent。**默认 `copilot`**，目前也只支持它。 |
| `--session <id>` | push / pull | 只处理一个会话（完整 id 或唯一前缀）。 |
| `--since <window>` | push / list | 限制为最近一段时间改动过的会话，比如 `7d`、`2w`、`1m`（30 天）、`1y`，或直接写天数。 |
| `--dry-run` | push / pull | 预览每个会话的文件树，不实际写入/推送。 |
| `--yes` | push | 跳过首次隐私确认。 |
| `--force` | push / pull | 包含 / 覆盖看起来仍然活跃的会话。 |
| `--force-large` | push | 允许接近 GitHub 100MB 限制的大文件。 |

#### 安全策略

- 默认会**跳过活跃会话**（最近刚写入，或仍有 SQLite `-wal` / `-shm` sidecar），避免同步半写入状态或覆盖正在使用的会话。
- 会排除明显的**凭据文件**（如 `.env`、`id_rsa`、`*.pem`、`.npmrc` 等），即使 history 模式绕过了普通配置同步的 allow-list。
- 会过滤 **`*-wal` / `*-shm`**、临时目录、`node_modules`、`.git` 等路径，避免 torn copy 或体积过大。
- 覆盖本地文件前会先备份到 `~/.agent-sync/backups/<timestamp>/history/copilot/`。

> [!NOTE]
> 对 **Copilot CLI** 而言，history sync 现在不仅同步磁盘上的 `session-state/`，
> 还会同步对应的 `~/.copilot/session-store.db` 元数据，因此恢复后的会话能被
> `copilot-starter` 和 Copilot 自己基于数据库的会话浏览器看到。

### 跨设备恢复会话

`agent-sync history` 会把会话文件带到另一台机器；对于 Copilot，还会同步共享的
`session-store.db` 元数据。恢复之后，推荐配合一个 session launcher 使用，这样
就不用面对一长串 UUID：

| 工具 | 对应 agent | 安装 | 启动 |
| --- | --- | --- | --- |
| [**copilot-starter**](https://github.com/lvxiaoxin/copilot-starter) | GitHub Copilot CLI | `npm i -g copilot-starter` | `copilot-starter` |
| [**claude-starter**](https://github.com/Bojun-Vvibe/claude-starter) | Claude Code | `npm i -g claude-starter` | `claude-starter` |
| [**codex-starter**](https://github.com/Bojun-Vvibe/codex-starter) | Codex CLI | `npm i -g codex-starter` | `codex-starter` |

这些 starter 都提供模糊搜索、按项目分组、实时预览、一键 resume 等能力，方便你在另一台机器继续先前的工作。

> [!TIP]
> 推荐流程：源机器上执行 `agent-sync history push` → 目标机器上执行
> `agent-sync history pull` → 再用对应的 `*-starter` 打开并恢复会话。

### 默认会同步什么

相对于各 agent 的基础目录：

| Agent | 基础目录 | 默认包含 |
| --- | --- | --- |
| **copilot** | `~/.copilot` | `mcp-config.json`, `settings.json`, `skills/`, `agents/`, `prompts/` |
| **claude** | `~/.claude` | `settings.json`, `skills/`, `agents/`, `commands/`, `output-styles/`, `CLAUDE.md` |
| **codex** | `~/.codex` | `AGENTS.md`, `skills/`, `prompts/` |

> [!NOTE]
> `codex/config.toml` 默认**不包含**，因为其中经常直接带 token
>（例如 `ANTHROPIC_AUTH_TOKEN`）。你可以在配置里显式放开，但 push 时仍会经过 secret scan。

### 安全模型

agent-sync 把 home 目录看作不可信输入，并分四层保护：

1. **Curated allow-list** —— 默认只收集 README 中列出的路径。
2. **Hard deny-list** —— sessions、`*.sqlite` / `*.db`、logs、caches、history、`config.json`、`settings.local.json` 等即使在自定义 manifest 中也会被拦掉（除非显式 `--unsafe-allow`）。
3. **Secret scanner** —— 一旦发现 GitHub / OpenAI / Anthropic / AWS / Google / Slack / JWT 等 token 形态，或 secret-like `key = value` 赋值，push 直接中止。
4. **Hardening** —— 跳过 symlink；所有写入/删除前都做路径 containment 校验；写文件采用 temp file + rename，尽量避免锁文件导致破坏。

### 配置

配置文件在 `~/.agent-sync/config.json`。你可以添加可选的 `manifest` 来覆盖每个 agent 的 `base` 和/或 `include` 列表：

```json
{
  "remote": "git@github.com:you/agent-store.git",
  "branch": "main",
  "agents": ["copilot", "claude", "codex"],
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

相关路径：

| 路径 | 用途 |
| --- | --- |
| `~/.agent-sync/config.json` | 远端仓库、分支、agent 列表，以及可选 manifest。 |
| `~/.agent-sync/repo` | 本地工作副本。 |
| `~/.agent-sync/backups/<timestamp>/` | 最近 20 次 `pull` / `history pull` 覆盖掉的备份。 |

> 也可以通过环境变量 `AGENT_SYNC_HOME` 覆盖基础目录（测试时很有用）。

### 冲突处理

`pull` 采用 **“远端优先，但带安全网”** 的策略，不做三方合并：

- 内容完全相同 → 跳过。
- 内容不同 → 进入覆盖流程。
- 覆盖前，现有本地文件会先复制到 `~/.agent-sync/backups/<timestamp>/<agent>/<path>`。
- **本地独有文件永远不会被删除。**
- 被锁住的文件（例如 Windows 上某个 agent 正在使用）会给 warning 并跳过，不会强制覆盖。
- skill 脚本的 executable bit 会通过每个 agent 的 `.agent-sync-meta.json` 保留，并在 pull 时恢复（Windows 上无效果）。

### 路线图

- [x] **Session history sync** —— 在多台机器间携带会话（Copilot CLI；需显式启用；仅建议私有仓库；有 active-session 与凭据保护）。
- [ ] **Memory sync** —— agent 的长期 memory / knowledge store。
- [ ] **Selective profiles** —— 支持命名配置集（例如 `work` / `personal`）并独立 push/pull。
- [ ] **Conflict review** —— 交互式按文件选择 `keep local` / `take remote` / `diff`。
- [ ] **More agents** —— 继续扩展更多 agent。

### FAQ

**会同步 secrets / API keys 吗？**  
不会。deny-list 会排除明显凭据文件，secret scanner 也会在发现 token 形态时直接中止 push。

**它用什么认证？**  
直接用你现有的 `git` 认证。如果你的 shell 里 `git clone` / `git push` 对那个仓库能工作，agent-sync 就能工作。

**能只同步某一个 agent 吗？**  
可以。初始化时可选子集，也可以直接修改配置里的 `agents`。

**`pull` 会覆盖我本地改动吗？**  
冲突文件会先备份，再用远端版本覆盖。建议先跑 `--dry-run` 预览。

**应该用私有仓库还是公有仓库？**  
强烈建议私有仓库。虽然 agent-sync 会做过滤和 secret scan，但你的技能、提示词、MCP 设置本身仍属于个人配置。

**agent-sync 自己产生的备份会被再次 push 吗？**  
不会。备份写在 `~/.agent-sync/backups/`，工作副本在 `~/.agent-sync/repo/`，都不在 agent-sync 默认采集的目录里。

**现在支持哪些 agent 的 session history？**  
目前只有 Copilot CLI。`history` 默认就是 `--agent copilot`；Claude Code 和 Codex 的接口已经预留，但现在会明确提示“not supported yet”。
