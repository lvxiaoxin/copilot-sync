# agent-sync

A tiny, cross-platform CLI (macOS / Linux / Windows) to **sync your AI agent
configuration** — skills, MCP servers, agents, prompts, and settings — across
multiple devboxes using a GitHub repository you own.

Supports three agents out of the box:

| Agent       | Config base   |
| ----------- | ------------- |
| Copilot CLI | `~/.copilot`  |
| Claude      | `~/.claude`   |
| Codex       | `~/.codex`    |

It syncs only **shareable artifacts** and refuses to sync sessions, logs,
databases, caches, and credentials — backed by a hard deny‑list and a secret
scanner that blocks any push containing token‑shaped values.

## Install

```bash
npm install -g @lvxiaoxin/agent-sync
```

Requires Node.js ≥ 18.17 and `git` on your `PATH`. Authentication uses your
existing git setup (SSH keys, credential manager, `gh`, etc.).

## Quick start

On your first machine:

```bash
agent-sync onboard        # set the GitHub repo (URL or owner/repo) + branch
agent-sync status         # see what would sync
agent-sync push           # upload this machine's artifacts
```

On every other machine:

```bash
agent-sync onboard        # same repo + branch
agent-sync pull           # apply the artifacts into the right local dirs
```

## Commands

- `agent-sync onboard` — interactive setup. Stores config at
  `~/.agent-sync/config.json` and clones the repo into `~/.agent-sync/repo`.
  Accepts a full git URL **or** `owner/repo` shorthand. Seeds a `.gitattributes`
  to keep line endings stable across OSes.
- `agent-sync push [--dry-run] [--unsafe-allow]` — collects curated artifacts
  for the current OS, mirrors them into the repo, **secret‑scans**, then commits
  and pushes. Deletions of synced files propagate to the repo.
- `agent-sync pull [--dry-run] [--unsafe-allow]` — pulls the repo and writes
  artifacts into the correct local dirs. Overwrites are **backed up** to
  `~/.agent-sync/backups/<timestamp>/`. Local‑only files are never deleted.
- `agent-sync status` — show config and a per‑agent summary of what would sync.

## What gets synced (default)

Relative to each agent's base dir:

- **copilot**: `mcp-config.json`, `settings.json`, `skills/`, `agents/`, `prompts/`
- **claude**: `settings.json`, `skills/`, `agents/`, `commands/`, `output-styles/`, `CLAUDE.md`
- **codex**: `AGENTS.md`, `skills/`, `prompts/`

> `codex/config.toml` is **excluded by default** because it commonly embeds a
> token (e.g. `ANTHROPIC_AUTH_TOKEN`). You can opt in via your config, but it is
> still secret‑scanned on every push.

## Safety model

1. **Curated allow‑list** — only listed paths are ever collected.
2. **Hard deny‑list** — sessions, `*.sqlite`/`*.db`, logs, caches, history,
   `config.json`, `settings.local.json`, etc. are blocked even if you override
   the manifest (unless you pass `--unsafe-allow`).
3. **Secret scanner** — token shapes (GitHub/OpenAI/Anthropic/AWS/JWT, etc.) and
   secret‑like `key = value` assignments abort the push.
4. **Symlinks are skipped**, path‑containment is enforced before any write or
   delete, and writes are atomic (temp file + rename) to tolerate locked files.

## Customizing the manifest

Edit `~/.agent-sync/config.json` and add a `manifest` block to override the
`base` and/or `include` list per agent:

```json
{
  "remote": "git@github.com:me/agent-store.git",
  "branch": "main",
  "agents": ["copilot", "claude", "codex"],
  "manifest": {
    "copilot": { "include": ["mcp-config.json", "settings.json", "skills"] }
  }
}
```

The hard deny‑list still applies to any custom includes.

## Notes & limitations

- POSIX executable bits on skill scripts are preserved across machines via a
  small `.agent-sync-meta.json` per agent and restored on pull (no‑op on Windows).
- Conflict handling is "last write wins, with local backups"; it does not do a
  three‑way merge. Pull on a machine before making large local edits.
- Close a running agent before `pull` if it holds config files open (Windows).

## License

MIT
