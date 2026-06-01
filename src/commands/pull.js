import fs from 'node:fs';
import path from 'node:path';
import { log, c } from '../log.js';
import { requireConfig, backupsDir } from '../config.js';
import { resolveManifest, HARD_DENY } from '../manifest.js';
import {
  expandHome,
  exists,
  walk,
  assertInside,
  writeFileAtomic,
  ensureDir,
  matchesAny,
  toPosix,
} from '../fsutil.js';
import { ensureGitAvailable } from '../git.js';
import { ensureRepoReady } from '../repo.js';

const META_FILE = '.agent-sync-meta.json';
const KEEP_BACKUPS = 20;

function pruneBackups() {
  const root = backupsDir();
  if (!exists(root)) return;
  let entries;
  try {
    entries = fs
      .readdirSync(root)
      .filter((n) => fs.statSync(path.join(root, n)).isDirectory())
      .sort();
  } catch {
    return;
  }
  while (entries.length > KEEP_BACKUPS) {
    const old = entries.shift();
    try {
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export async function pull(opts = {}) {
  const cfg = requireConfig();
  await ensureGitAvailable();

  const manifest = resolveManifest(cfg.manifest);
  const agents = (cfg.agents || Object.keys(manifest)).filter((a) => manifest[a]);
  const allowUnsafe = !!opts.unsafeAllow;

  const dir = await ensureRepoReady(cfg, { update: true });

  const backupRun = path.join(backupsDir(), new Date().toISOString().replace(/[:.]/g, '-'));
  let wrote = 0;
  let overwritten = 0;
  let unchanged = 0;
  let skippedLocked = 0;

  log.plain(c.bold('agent-sync pull'));

  for (const agent of agents) {
    const agentRepo = path.join(dir, agent);
    if (!exists(agentRepo)) {
      log.info(`${c.cyan(agent)}: ${c.dim('not present in remote yet — skipped')}`);
      continue;
    }

    const base = expandHome(manifest[agent].base);
    let modes = {};
    const metaPath = path.join(agentRepo, META_FILE);
    if (exists(metaPath)) {
      try {
        modes = JSON.parse(fs.readFileSync(metaPath, 'utf8')).modes || {};
      } catch {
        modes = {};
      }
    }

    let agentWrote = 0;
    for (const node of walk(agentRepo, '', ['**/.git/**'])) {
      if (node.type !== 'file') continue;
      const rel = node.rel;
      if (rel === META_FILE) continue;
      if (!allowUnsafe && matchesAny(rel, HARD_DENY)) continue;

      const src = path.join(agentRepo, ...rel.split('/'));
      const dest = path.join(base, ...rel.split('/'));
      try {
        assertInside(base, dest, 'dispatch dest');
      } catch (e) {
        log.warn(`  ${e.message}`);
        continue;
      }

      const srcBuf = fs.readFileSync(src);
      const destExists = exists(dest);
      let changed = true;
      if (destExists) {
        try {
          changed = !fs.readFileSync(dest).equals(srcBuf);
        } catch {
          changed = true;
        }
      }

      if (!changed) {
        unchanged++;
        continue;
      }

      if (opts.dryRun) {
        log.plain(`  ${destExists ? c.yellow('overwrite') : c.green('new')}  ${agent}/${rel}`);
        if (destExists) overwritten++;
        else wrote++;
        agentWrote++;
        continue;
      }

      // Back up an existing file before replacing it.
      if (destExists) {
        const bdest = path.join(backupRun, agent, ...rel.split('/'));
        try {
          ensureDir(path.dirname(bdest));
          fs.copyFileSync(dest, bdest);
        } catch {
          /* best effort */
        }
      }

      const modeStr = modes[toPosix(rel)];
      const mode = modeStr ? parseInt(modeStr, 8) : undefined;
      try {
        writeFileAtomic(dest, srcBuf, mode);
        if (destExists) overwritten++;
        else wrote++;
        agentWrote++;
      } catch (e) {
        // Likely a locked file (e.g. agent running on Windows).
        skippedLocked++;
        log.warn(`  could not update ${agent}/${rel} (locked?). Close the agent and retry.`);
      }
    }

    log.info(`${c.cyan(agent)}: ${agentWrote} file(s) ${opts.dryRun ? 'to apply' : 'applied'}`);
  }

  if (opts.dryRun) {
    log.plain('');
    log.info(c.dim(`Dry run — ${wrote} new, ${overwritten} overwrite, ${unchanged} unchanged.`));
    return;
  }

  pruneBackups();

  log.plain('');
  if (wrote + overwritten === 0) {
    log.ok(`Everything already up to date (${unchanged} unchanged).`);
  } else {
    log.ok(
      `Applied ${wrote} new + ${overwritten} updated file(s); ${unchanged} unchanged.` +
        (skippedLocked ? c.yellow(` ${skippedLocked} skipped (locked).`) : '')
    );
    if (overwritten) log.info(`Backups of replaced files: ${c.dim(backupRun)}`);
  }
}
