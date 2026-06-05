import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDir, exists } from './fsutil.js';
import { UserError } from './log.js';

// Root for all copilot-sync state. Overridable for testing via COPILOT_SYNC_HOME.
export function appHome() {
  return process.env.COPILOT_SYNC_HOME || path.join(os.homedir(), '.copilot-sync');
}

export function configPath() {
  return path.join(appHome(), 'config.json');
}

export function repoDir() {
  return path.join(appHome(), 'repo');
}

export function backupsDir() {
  return path.join(appHome(), 'backups');
}

export function loadConfig() {
  const p = configPath();
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function requireConfig() {
  const cfg = loadConfig();
  if (!cfg || !cfg.remote) {
    throw new UserError(
      "Not onboarded yet. Run 'copilot-sync onboard' to set your remote repo first."
    );
  }
  return cfg;
}

export function saveConfig(cfg) {
  ensureDir(appHome());
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n');
}

// Keep only the most recent `keep` timestamped backup runs under backupsDir().
// Shared by both `pull` and `history pull`.
export function pruneBackups(keep = 20) {
  const root = backupsDir();
  if (!exists(root)) return;
  let entries;
  try {
    entries = fs
      .readdirSync(root)
      .filter((n) => {
        try {
          return fs.statSync(path.join(root, n)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return;
  }
  while (entries.length > keep) {
    const old = entries.shift();
    try {
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
