import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDir } from './fsutil.js';
import { UserError } from './log.js';

// Root for all agent-sync state. Overridable for testing via AGENT_SYNC_HOME.
export function appHome() {
  return process.env.AGENT_SYNC_HOME || path.join(os.homedir(), '.agent-sync');
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
      "Not onboarded yet. Run 'agent-sync onboard' to set your remote repo first."
    );
  }
  return cfg;
}

export function saveConfig(cfg) {
  ensureDir(appHome());
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n');
}
