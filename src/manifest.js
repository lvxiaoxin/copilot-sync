// Default sync policy. `include` paths are relative to the Copilot base dir
// and may be files or directories. Anything not included is never collected.
export const DEFAULT_MANIFEST = {
  copilot: {
    base: '~/.copilot',
    include: ['mcp-config.json', 'settings.json', 'skills', 'agents', 'prompts'],
  },
};

export const AGENTS = Object.keys(DEFAULT_MANIFEST);

// Hard deny-list applied to EVERY collected path (full relative path or
// basename). User include overrides cannot bypass these — they protect against
// syncing sessions, databases, logs, caches, and known secret-bearing files.
// Pass --unsafe-allow to disable (strongly discouraged).
export const HARD_DENY = [
  '**/config.json',
  '**/settings.local.json',
  '**/sessions/**',
  '**/session-state/**',
  '**/session-env/**',
  '**/session-store.db*',
  '**/todos/**',
  '**/history.jsonl',
  '**/command-history-state.json',
  '**/external_agent_session_imports.json',
  '**/session_index.jsonl',
  '**/telemetry/**',
  '**/statsig/**',
  '**/cache/**',
  '**/paste-cache/**',
  '**/file-history/**',
  '**/logs/**',
  '**/log/**',
  '**/crash-context/**',
  '**/shell_snapshots/**',
  '**/computer-use/**',
  '**/vendor_imports/**',
  '**/memories/**',
  '**/ide/**',
  '**/restart/**',
  '**/backups/**',
  '**/.tmp/**',
  '**/tmp/**',
  '**/installation_id',
  '**/version.json',
  '**/.personality_migration',
  '**/.last-cleanup',
  '**/stats-cache.json',
  '**/vscode.session.metadata.cache.json',
  '**/permissions-config.json',
  '**/*.sqlite',
  '**/*.sqlite-*',
  '**/*.db',
  '**/*.db-*',
  '**/*.log',
  '**/*.bak',
  '**/*.backup',
  '**/node_modules/**',
  '**/.git/**',
  '**/.DS_Store',
  '**/.agent-sync-meta.json',
];

// Merge user overrides (from config) on top of the defaults.
export function resolveManifest(userManifest) {
  const out = {};
  for (const agent of AGENTS) {
    const def = DEFAULT_MANIFEST[agent];
    const usr = userManifest?.[agent] || {};
    out[agent] = {
      base: usr.base || def.base,
      include:
        Array.isArray(usr.include) && usr.include.length
          ? usr.include
          : def.include,
    };
  }
  return out;
}
