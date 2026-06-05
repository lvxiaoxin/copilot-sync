import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, c, UserError } from '../log.js';
import { requireConfig } from '../config.js';
import { resolveManifest } from '../manifest.js';
import { collectAgent } from '../collect.js';
import { scanFile } from '../secrets.js';
import {
  rmrf,
  ensureDir,
  assertInside,
  writeFileAtomic,
  toPosix,
} from '../fsutil.js';
import { ensureGitAvailable, git, ensureIdentity } from '../git.js';
import { ensureRepoReady } from '../repo.js';
import { renderTree } from '../tree.js';

const META_FILE = '.copilot-sync-meta.json';

export async function push(opts = {}) {
  const cfg = requireConfig();
  await ensureGitAvailable();

  const manifest = resolveManifest(cfg.manifest);
  const agents = (cfg.agents || Object.keys(manifest)).filter((a) => manifest[a]);
  const allowUnsafe = !!opts.unsafeAllow;

  // 1. Collect.
  const collected = {};
  let totalFiles = 0;
  for (const agent of agents) {
    const r = collectAgent(agent, manifest[agent], { allowUnsafe });
    collected[agent] = r;
    totalFiles += r.files.length;
  }

  // 2. Secret scan (source files) — the final safety gate.
  const secretHits = [];
  if (!allowUnsafe) {
    for (const agent of agents) {
      for (const f of collected[agent].files) {
        const findings = scanFile(f.abs);
        if (findings.length) secretHits.push({ agent, file: f.rel, findings });
      }
    }
  }

  // 3. Report.
  log.plain(c.bold('copilot-sync push'));
  for (const agent of agents) {
    const r = collected[agent];
    log.info(
      `${c.cyan(agent)}: ${r.files.length} file(s)` +
        (r.missing.length ? c.dim(`, ${r.missing.length} not present`) : '') +
        (r.symlinks.length ? c.yellow(`, ${r.symlinks.length} symlink(s) skipped`) : '') +
        (r.denied.length ? c.dim(`, ${r.denied.length} excluded`) : '')
    );
    for (const s of r.symlinks) log.warn(`  symlink skipped: ${agent}/${s}`);
  }

  if (secretHits.length) {
    log.plain('');
    log.plain(c.red('✗ Potential secrets detected — push aborted to protect you:'));
    for (const h of secretHits) {
      for (const f of h.findings) {
        log.plain(`  ${c.red(h.agent + '/' + h.file)}:${f.line}  ${c.dim(f.kind)}`);
      }
    }
    log.plain('');
    log.info('Fix options:');
    log.info('  • Remove the secret / move it to an env var or untracked file.');
    log.info('  • Exclude the file via your manifest in ~/.copilot-sync/config.json.');
    log.info(`  • Override (not recommended): ${c.bold('copilot-sync push --unsafe-allow')}`);
    throw new UserError('Aborted: secret-like content found.');
  }

  if (totalFiles === 0) {
    log.warn('Nothing to collect. Add skills/configs or adjust your manifest.');
    return;
  }

  if (opts.dryRun) {
    log.plain('');
    log.plain(c.dim('Dry run — no changes pushed. Files that would be synced:'));
    log.plain('');
    for (const agent of agents) {
      const files = collected[agent].files;
      if (!files.length) {
        log.plain(`${c.cyan(agent)} ${c.dim('(nothing to sync)')}`);
        log.plain('');
        continue;
      }
      log.plain(`${c.cyan(agent)} ${c.dim(`(${files.length} file(s))`)}`);
      for (const line of renderTree(files.map((f) => ({ path: f.rel })))) log.plain(line);
      log.plain('');
    }
    return;
  }

  // 4. Mirror into the local clone.
  const dir = await ensureRepoReady(cfg, { update: true });

  for (const agent of agents) {
    const agentRepo = path.join(dir, agent);
    assertInside(dir, agentRepo, 'agent repo dir');
    rmrf(agentRepo);
    const meta = {};
    for (const f of collected[agent].files) {
      const dest = path.join(agentRepo, ...f.rel.split('/'));
      assertInside(agentRepo, dest, 'mirror dest');
      const buf = fs.readFileSync(f.abs);
      const mode = f.mode & 0o777;
      writeFileAtomic(dest, buf, mode);
      // Record POSIX modes only when an exec bit is set (for restore on pull).
      if (mode & 0o111) meta[toPosix(f.rel)] = mode.toString(8);
    }
    if (Object.keys(meta).length) {
      ensureDir(agentRepo);
      writeFileAtomic(
        path.join(agentRepo, META_FILE),
        JSON.stringify({ version: 1, modes: meta }, null, 2) + '\n'
      );
    }
  }

  // 5. Commit & push.
  const id = await ensureIdentity(dir);
  if (id.usedFallback) {
    log.warn('No git identity found; committing as "copilot-sync <copilot-sync@localhost>".');
  }

  await git(['add', '-A'], { cwd: dir });
  const status = (await git(['status', '--porcelain'], { cwd: dir })).trim();
  if (!status) {
    log.ok('Already up to date — nothing to push.');
    return;
  }

  const subject = `sync: ${os.hostname()} (${process.platform}) ${new Date().toISOString()}`;
  const body = agents
    .map((a) => `${a}: ${collected[a].files.length} file(s)`)
    .join('\n');
  await git(['commit', '-m', subject, '-m', body], { cwd: dir });

  log.step('Pushing to remote ...');
  try {
    await git(['push', '-u', 'origin', cfg.branch], { cwd: dir, interactive: true });
  } catch (e) {
    throw new UserError(
      `Push failed. Check your access to ${cfg.remote}.\n${e.stderr || e.message}`
    );
  }

  log.ok(`Pushed ${totalFiles} file(s).`);
}
