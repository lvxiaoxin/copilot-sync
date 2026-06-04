import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MANIFEST } from './manifest.js';
import {
  expandHome,
  exists,
  walk,
  assertInside,
  matchesAny,
  writeFileAtomic,
  ensureDir,
  toPosix,
} from './fsutil.js';
import { UserError } from './log.js';

// Session-history sync currently targets the GitHub Copilot CLI only. Each
// session lives in its own self-contained folder under ~/.copilot/session-state/<uuid>/.
export const HISTORY_AGENT = 'copilot';
export const SESSIONS_SUBDIR = 'session-state';
export const META_FILE = '.agent-sync-meta.json';

// Patterns dropped during history collection: live SQLite sidecars, temp files,
// VCS metadata, and bulky build dirs that may appear inside session artifacts.
// Also applied on pull, to ignore anything hand-added to the remote.
export const HISTORY_DENY = [
  '**/*-wal',
  '**/*-shm',
  '**/*.tmp',
  '**/tmp/**',
  '**/.git/**',
  '**/node_modules/**',
  '**/.DS_Store',
];

// Credential-bearing basenames that must never be carried, even though history
// sync deliberately bypasses the normal HARD_DENY. Session `files/` artifacts
// can contain copied user files, so we guard the obvious ones.
const SENSITIVE_DENY = [
  '.env',
  '.env.*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  '.dockercfg',
  'credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '*.pem',
  '*.pfx',
  '*.p12',
  '*.ppk',
];

// A session is considered "active" if it was written very recently or has a
// live SQLite WAL/SHM sidecar. Active sessions are skipped by default to avoid
// torn database copies and clobbering an in-flight session.
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// GitHub rejects files >100MB; warn well before, hard-stop near the limit.
export const HARD_FILE_LIMIT = 95 * 1024 * 1024;
export const WARN_FILE_LIMIT = 50 * 1024 * 1024;
export const WARN_TOTAL = 100 * 1024 * 1024;

export function agentBase() {
  return expandHome(DEFAULT_MANIFEST[HISTORY_AGENT].base);
}

export function sessionsRoot() {
  return path.join(agentBase(), SESSIONS_SUBDIR);
}

export function fmtSize(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 || v >= 10 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}

function statSession(dir, id) {
  let mtimeMs = 0;
  let sizeBytes = 0;
  let fileCount = 0;
  let hasWal = false;
  for (const node of walk(dir, '', ['**/.git/**', '**/node_modules/**'])) {
    if (node.type !== 'file') continue;
    const abs = path.join(dir, ...node.rel.split('/'));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    sizeBytes += st.size;
    fileCount++;
    if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
    if (/(-wal|-shm)$/.test(node.rel)) hasWal = true;
  }
  const active = hasWal || (mtimeMs > 0 && Date.now() - mtimeMs < ACTIVE_WINDOW_MS);
  return { id, dir, mtimeMs, sizeBytes, fileCount, active };
}

// Enumerate local Copilot sessions, newest first.
export function listLocalSessions() {
  const root = sessionsRoot();
  if (!exists(root)) return [];
  let names;
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.isSymbolicLink())
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .map((id) => statSession(path.join(root, id), id))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Resolve a user-supplied --session selector against a list of items with `id`.
// Exact match wins; otherwise a unique prefix match is required.
export function resolveSelector(selector, items) {
  if (selector == null) return items;
  if (String(selector).trim() === '') {
    throw new UserError('--session requires a session id (or a unique prefix).');
  }
  const exact = items.find((s) => s.id === selector);
  if (exact) return [exact];
  const matches = items.filter((s) => s.id.startsWith(selector));
  if (matches.length === 0) {
    throw new UserError(`No session matches --session "${selector}".`);
  }
  if (matches.length > 1) {
    const sample = matches.slice(0, 5).map((m) => m.id).join(', ');
    throw new UserError(
      `--session "${selector}" is ambiguous (${matches.length} matches: ${sample}…). Use a longer id.`
    );
  }
  return matches;
}

// Collect the concrete files to sync for one local session.
// Returns { id, active, files:[{rel,abs,mode,size}], symlinks, sensitive, denied }.
// `rel` is posix and relative to the agent base (e.g. session-state/<id>/plan.md).
export function collectSession(session) {
  const base = agentBase();
  const dir = session.dir;
  const relPrefix = `${SESSIONS_SUBDIR}/${session.id}`;
  const files = [];
  const symlinks = [];
  const sensitive = [];
  const denied = [];

  for (const node of walk(dir, '', HISTORY_DENY)) {
    const rel = `${relPrefix}/${node.rel}`;
    if (node.type === 'symlink') {
      symlinks.push(rel);
      continue;
    }
    if (node.type === 'denied') {
      denied.push(rel);
      continue;
    }
    if (node.type !== 'file') continue;
    // Match case-insensitively: history bypasses the secret scanner, so a
    // file literally named `.ENV` or `ID_RSA` must still be excluded.
    if (matchesAny(node.rel.toLowerCase(), SENSITIVE_DENY)) {
      sensitive.push(rel);
      continue;
    }
    const abs = path.join(dir, ...node.rel.split('/'));
    try {
      assertInside(base, abs, 'session path');
    } catch {
      denied.push(rel);
      continue;
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    files.push({ rel, abs, mode: st.mode, size: st.size });
  }

  return { id: session.id, active: session.active, files, symlinks, sensitive, denied };
}

// List the session ids present in the remote clone's history tree.
export function listRemoteSessionIds(historyRepo) {
  const root = path.join(historyRepo, SESSIONS_SUBDIR);
  if (!exists(root)) return [];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

export function readHistoryMeta(historyRepo) {
  const p = path.join(historyRepo, META_FILE);
  if (!exists(p)) return { version: 1, modes: {} };
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { version: 1, modes: j.modes || {} };
  } catch {
    return { version: 1, modes: {} };
  }
}

// Persist exec-bit modes. Always writes (even when empty) so that cleared
// entries — e.g. a script that lost its +x bit — are not resurrected on pull.
export function writeHistoryMeta(historyRepo, meta) {
  const modes = (meta && meta.modes) || {};
  ensureDir(historyRepo);
  writeFileAtomic(
    path.join(historyRepo, META_FILE),
    JSON.stringify({ version: 1, modes }, null, 2) + '\n'
  );
}

export { toPosix };
