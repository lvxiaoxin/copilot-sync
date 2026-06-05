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

| Command | Description |
| --- | --- |
| `agent-sync history list` | Show every local and remote session with size, last-modified, and `synced` / `local-only` / `remote-only` state. |
| `agent-sync history push` | Archive this machine's sessions to `history/copilot/` in the repo. **Additive** — never deletes remote sessions, so sessions union across machines. |
| `agent-sync history pull` | Restore sessions into `~/.copilot/session-state/`. Overwrites are backed up first; local-only files are never touched. |

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
