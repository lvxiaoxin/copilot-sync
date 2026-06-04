import fs from 'node:fs';
import path from 'node:path';
import { log, c } from '../log.js';
import { requireConfig, backupsDir, pruneBackups } from '../config.js';
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
import { renderTree } from '../tree.js';

const META_FILE = '.agent-sync-meta.json';

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

  log.plain(c.bold('agent-sync pull') + (opts.dryRun ? c.dim('  (dry run)') : ''));
  log.plain('');

  for (const agent of agents) {
    const agentRepo = path.join(dir, agent);
    if (!exists(agentRepo)) {
      log.plain(`${c.cyan(agent)} ${c.dim('(not in remote yet — skipped)')}`);
      if (opts.dryRun) log.plain('');
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
    const dryEntries = [];
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
        dryEntries.push({ path: rel, tag: destExists ? 'overwrite' : 'new' });
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

    if (opts.dryRun) {
      const label = agentWrote
        ? `${c.cyan(agent)} ${c.dim(`(${agentWrote} to apply)`)}`
        : `${c.cyan(agent)} ${c.dim('(no changes)')}`;
      log.plain(label);
      for (const line of renderTree(dryEntries)) log.plain(line);
      log.plain('');
    } else {
      log.info(`${c.cyan(agent)}: ${agentWrote} file(s) applied`);
    }
  }

  if (opts.dryRun) {
    const parts = [];
    if (wrote) parts.push(c.green(`${wrote} new`));
    if (overwritten) parts.push(c.yellow(`${overwritten} overwrite`));
    parts.push(c.dim(`${unchanged} unchanged`));
    log.plain(c.dim('Dry run — no changes written. ') + parts.join(c.dim(', ')) + c.dim('.'));
    if (overwritten) {
      log.plain(c.dim('On a real pull, files marked ') + c.yellow('overwrite') +
        c.dim(` are backed up to ~/.agent-sync/backups/ first.`));
    }
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
