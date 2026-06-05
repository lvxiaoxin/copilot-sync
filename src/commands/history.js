import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, c, UserError } from '../log.js';
import { requireConfig, saveConfig, backupsDir, pruneBackups } from '../config.js';
import {
  exists,
  walk,
  assertInside,
  writeFileAtomic,
  ensureDir,
  toPosix,
} from '../fsutil.js';
import { ensureGitAvailable, git, ensureIdentity } from '../git.js';
import { ensureRepoReady } from '../repo.js';
import { renderTree } from '../tree.js';
import { createPrompter } from '../prompt.js';
import {
  HISTORY_AGENT,
  HISTORY_DENY,
  agentBase,
  sessionsRoot,
  sharedStorePath,
  fmtSize,
  listLocalSessions,
  listRemoteSessionIds,
  listRemoteSessions,
  resolveSelector,
  resolveAgent,
  parseSince,
  collectSession,
  readHistoryMeta,
  writeHistoryMeta,
  HARD_FILE_LIMIT,
  WARN_FILE_LIMIT,
  WARN_TOTAL,
} from '../history.js';
import {
  exportSessionIndex,
  importSessionIndexes,
  readSessionIndexFile,
  writeSessionIndexFile,
} from '../history-store.js';

function historyRepoDir(repo, agent = HISTORY_AGENT) {
  return path.join(repo, 'history', agent);
}

function shortId(id) {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function privacyReminder() {
  log.warn('Session history can contain secrets, file contents, and command output.');
  log.warn('Only sync to a ' + c.bold('private') + ' repository.');
}

function archiveNote() {
  log.info(
    c.dim(
      'Note: this archives/restores the session folder and its shared session-store metadata ' +
        'so Copilot session browsers can see restored sessions.'
    )
  );
}

function displayPathForSession(agent, sessionId, rel) {
  const sessionPrefix = `${agent.sessionsSubdir}/${sessionId}/`;
  if (rel.startsWith(sessionPrefix)) return rel.slice(sessionPrefix.length);
  const rootPrefix = `${agent.sessionsSubdir}/`;
  if (rel.startsWith(rootPrefix)) return rel.slice(rootPrefix.length);
  return rel;
}

function remoteFilesForSession(repoHistory, agent, session) {
  const sessRepo = path.join(repoHistory, ...session.rel.split('/'));
  const files = [];
  for (const node of walk(sessRepo, '', HISTORY_DENY)) {
    if (node.type !== 'file') continue;
    const rel = `${session.rel}/${node.rel}`;
    files.push({
      rel,
      src: path.join(sessRepo, ...node.rel.split('/')),
      treePath: node.rel,
    });
  }
  return files;
}

// ---- history push ---------------------------------------------------------

export async function historyPush(opts = {}) {
  const cfg = requireConfig();
  await ensureGitAvailable();
  const agent = resolveAgent();
  const since = opts.since != null ? parseSince(opts.since) : null;

  log.plain(
    c.bold('copilot-sync history push') +
      (since ? c.dim(`  since: ${opts.since}`) : '') +
      (opts.dryRun ? c.dim('  (dry run)') : '')
  );

  const all = listLocalSessions(agent.name);
  if (!all.length) {
    log.warn(`No ${agent.label} sessions found at ${c.dim(sessionsRoot(agent.name))}.`);
    return;
  }

  let selected = resolveSelector(opts.session, all);

  // Skip active sessions unless forced (avoids torn DB copies / live writes).
  const activeSkipped = opts.force ? [] : selected.filter((s) => s.active);
  if (!opts.force) selected = selected.filter((s) => !s.active);

  // Narrow to recently-modified sessions when --since is given.
  let agedOut = [];
  if (since != null) {
    agedOut = selected.filter((s) => s.mtimeMs < since);
    selected = selected.filter((s) => s.mtimeMs >= since);
  }

  const collected = selected.map((s) => collectSession(s));
  const allFiles = collected.flatMap((x) => x.files);

  privacyReminder();
  log.plain('');

  for (const x of collected) {
    const bytes = x.files.reduce((n, f) => n + f.size, 0);
    log.info(
      `${c.cyan(shortId(x.id))} ${c.dim(`(${x.files.length} file(s), ${fmtSize(bytes)})`)}` +
        (x.sensitive.length ? c.yellow(`, ${x.sensitive.length} sensitive excluded`) : '') +
        (x.symlinks.length ? c.dim(`, ${x.symlinks.length} symlink(s) skipped`) : '')
    );
    for (const s of x.sensitive) log.warn(`  sensitive file excluded: ${s}`);
  }
  if (activeSkipped.length) {
    log.warn(
      `${activeSkipped.length} active session(s) skipped (recently modified). Use ${c.bold('--force')} to include.`
    );
  }
  if (agedOut.length) {
    log.warn(
      `${agedOut.length} session(s) older than ${c.bold('--since ' + opts.since)} skipped.`
    );
  }

  if (!allFiles.length) {
    log.plain('');
    // Be specific when an explicit --session was filtered out by --since.
    if (opts.session && since != null && agedOut.length) {
      log.warn(
        `Session "${opts.session}" matched but is older than --since ${opts.since}; nothing pushed.`
      );
    } else {
      log.warn('Nothing to push (no eligible sessions).');
    }
    return;
  }

  // Size accounting + guards.
  const totalBytes = allFiles.reduce((n, f) => n + f.size, 0);
  const tooBig = allFiles.filter((f) => f.size >= HARD_FILE_LIMIT);
  const bigWarn = allFiles.filter((f) => f.size >= WARN_FILE_LIMIT && f.size < HARD_FILE_LIMIT);
  if (tooBig.length && !opts.forceLarge) {
    log.plain('');
    log.error("File(s) at/over GitHub's 100MB limit:");
    for (const f of tooBig) log.plain(`  ${c.red(f.rel)} (${fmtSize(f.size)})`);
    throw new UserError(
      `Aborted. Remove the file(s) or pass ${c.bold('--force-large')} (push may be rejected by GitHub).`
    );
  }
  for (const f of bigWarn) log.warn(`  large file: ${f.rel} (${fmtSize(f.size)})`);
  if (totalBytes >= WARN_TOTAL) {
    log.warn(`Large push: ${fmtSize(totalBytes)} across ${allFiles.length} file(s).`);
  }

  if (opts.dryRun) {
    log.plain('');
    log.plain(c.dim('Dry run — nothing pushed. Sessions that would sync:'));
    log.plain('');
    for (const x of collected) {
      log.plain(`${c.cyan(x.id)} ${c.dim(`(${x.files.length} file(s))`)}`);
      const entries = x.files.map((f) => ({
        path: displayPathForSession(agent, x.id, f.rel),
      }));
      for (const line of renderTree(entries)) log.plain(line);
      log.plain('');
    }
    log.plain(c.dim(`Total: ${allFiles.length} file(s), ${fmtSize(totalBytes)}.`));
    return;
  }

  // One-time acknowledgment (persisted), since history bypasses secret scanning.
  if (!cfg.history?.acknowledged) {
    if (!opts.yes) {
      const p = createPrompter();
      const ok = await p.confirm(
        'Push session history to your remote? It may contain sensitive data',
        false
      );
      p.close();
      if (!ok) {
        log.info('Aborted — nothing pushed.');
        return;
      }
    }
    cfg.history = { ...(cfg.history || {}), acknowledged: true };
    saveConfig(cfg);
  }

  // Additive mirror: copy local sessions into the repo without deleting remote
  // sessions/files created on other machines.
  const dir = await ensureRepoReady(cfg, { update: true });
  const repoHistory = historyRepoDir(dir, agent.name);
  ensureDir(repoHistory);
  const meta = readHistoryMeta(repoHistory);
  const storePath = agent.sharedStore ? sharedStorePath(agent.name) : null;

  let copied = 0;
  let indexed = 0;
  let missingIndex = 0;
  for (const x of collected) {
    for (const f of x.files) {
      const dest = path.join(repoHistory, ...f.rel.split('/'));
      assertInside(repoHistory, dest, 'history dest');
      let buf;
      try {
        buf = fs.readFileSync(f.abs);
      } catch {
        log.warn(`  could not read ${f.rel} (vanished or locked?) — skipped.`);
        continue;
      }
      const mode = f.mode & 0o777;
      const key = toPosix(f.rel);
      try {
        writeFileAtomic(dest, buf, mode);
      } catch (e) {
        log.warn(`  could not stage ${f.rel}: ${e.message} — skipped.`);
        continue;
      }
      // Track exec bit; clear a stale entry if the file lost its +x bit so a
      // later pull doesn't resurrect it as executable.
      if (mode & 0o111) meta.modes[key] = mode.toString(8);
      else delete meta.modes[key];
      copied++;
    }
    if (storePath) {
      const indexPayload = exportSessionIndex(storePath, x.id);
      writeSessionIndexFile(repoHistory, indexPayload);
      if (indexPayload.missing) missingIndex++;
      else indexed++;
    }
  }
  writeHistoryMeta(repoHistory, meta);

  if (!copied) {
    log.plain('');
    log.warn('Nothing could be archived (all files unreadable).');
    return;
  }

  const id = await ensureIdentity(dir);
  if (id.usedFallback) {
    log.warn('No git identity found; committing as "copilot-sync <copilot-sync@localhost>".');
  }

  // Additive: stage additions/modifications under the history tree only, and
  // never stage deletions, so sessions/files from other machines are preserved
  // even if the local clone is dirty.
  await git(['add', '--ignore-removal', '--', `history/${agent.name}`], { cwd: dir });
  const status = (
    await git(['status', '--porcelain', '--', `history/${agent.name}`], { cwd: dir })
  ).trim();
  if (!status) {
    log.ok('Already up to date — nothing to push.');
    return;
  }

  const subject = `history: ${os.hostname()} (${process.platform}) ${new Date().toISOString()}`;
  const body = collected.map((x) => `${x.id}: ${x.files.length} file(s)`).join('\n');
  await git(['commit', '-m', subject, '-m', body], { cwd: dir });

  log.step('Pushing to remote ...');
  try {
    await git(['push', '-u', 'origin', cfg.branch], { cwd: dir, interactive: true });
  } catch (e) {
    throw new UserError(
      `Push failed. Check your access to ${cfg.remote}.\n${e.stderr || e.message}`
    );
  }

  log.ok(`Pushed history for ${collected.length} session(s), ${fmtSize(totalBytes)}.`);
  if (indexed) {
    log.info(`Updated shared session-store metadata for ${indexed} session(s).`);
  }
  if (missingIndex) {
    log.warn(
      `${missingIndex} session(s) had no shared session-store rows; they were archived file-only.`
    );
  }
}

// ---- history pull ---------------------------------------------------------

export async function historyPull(opts = {}) {
  const cfg = requireConfig();
  await ensureGitAvailable();
  const agent = resolveAgent();

  log.plain(
    c.bold('copilot-sync history pull') +
      (opts.dryRun ? c.dim('  (dry run)') : '')
  );

  const dir = await ensureRepoReady(cfg, { update: true });
  const repoHistory = historyRepoDir(dir, agent.name);
  const remoteSessions = listRemoteSessions(repoHistory, agent.name);
  if (!remoteSessions.length) {
    log.warn('No session history in the remote yet. Run `copilot-sync history push` elsewhere first.');
    return;
  }

  const selected = resolveSelector(opts.session, remoteSessions);
  const meta = readHistoryMeta(repoHistory);
  const base = agentBase(agent.name);
  const storePath = agent.sharedStore ? sharedStorePath(agent.name) : null;
  const localActive = new Set(
    listLocalSessions(agent.name).filter((s) => s.active).map((s) => s.id)
  );
  const backupRun = path.join(backupsDir(), tsStamp(), 'history', agent.name);
  const indexPayloads = [];
  let indexedMissing = 0;

  let wrote = 0;
  let overwritten = 0;
  let unchanged = 0;
  let skippedLocked = 0;
  let skippedActive = 0;

  log.plain('');

  for (const sel of selected) {
    if (storePath) {
      const indexPayload = readSessionIndexFile(repoHistory, sel.id);
      if (indexPayload) indexPayloads.push(indexPayload);
      else indexedMissing++;
    }
    const sessActive = localActive.has(sel.id) && !opts.force;
    const dryEntries = [];
    let applied = 0;
    let deferred = 0;

    for (const item of remoteFilesForSession(repoHistory, agent, sel)) {
      const rel = item.rel;
      const src = item.src;
      const dest = path.join(base, ...rel.split('/'));
      try {
        assertInside(base, dest, 'dispatch dest');
      } catch (e) {
        log.warn(`  ${e.message}`);
        continue;
      }

      let srcBuf;
      try {
        srcBuf = fs.readFileSync(src);
      } catch {
        continue;
      }
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

      // A write is needed. Never write into a locally-active session unless
      // forced — but only defer the changed files, so an already-restored
      // (unchanged) session stays silent on re-pull.
      if (sessActive) {
        deferred++;
        continue;
      }

      if (opts.dryRun) {
        dryEntries.push({ path: item.treePath, tag: destExists ? 'overwrite' : 'new' });
        if (destExists) overwritten++;
        else wrote++;
        applied++;
        continue;
      }

      if (destExists) {
        const bdest = path.join(backupRun, sel.id, ...item.treePath.split('/'));
        try {
          ensureDir(path.dirname(bdest));
          fs.copyFileSync(dest, bdest);
        } catch {
          /* best effort */
        }
      }

      const modeStr = meta.modes[toPosix(rel)];
      const mode = modeStr ? parseInt(modeStr, 8) : undefined;
      try {
        writeFileAtomic(dest, srcBuf, mode);
        if (destExists) overwritten++;
        else wrote++;
        applied++;
      } catch {
        skippedLocked++;
        log.warn(`  could not write ${rel} (locked?). Close the agent and retry.`);
      }
    }

    if (deferred) {
      skippedActive++;
      log.warn(
        `${c.cyan(shortId(sel.id))} — ${deferred} change(s) deferred; local session looks active. Use ${c.bold('--force')}.`
      );
    }

    if (opts.dryRun) {
      const label = applied
        ? `${c.cyan(sel.id)} ${c.dim(`(${applied} to apply)`)}`
        : `${c.cyan(sel.id)} ${c.dim('(no changes)')}`;
      log.plain(label);
      for (const line of renderTree(dryEntries)) log.plain(line);
      log.plain('');
    } else if (applied) {
      log.info(`${c.cyan(shortId(sel.id))}: ${applied} file(s) applied`);
    }
  }

  if (opts.dryRun) {
    const parts = [];
    if (wrote) parts.push(c.green(`${wrote} new`));
    if (overwritten) parts.push(c.yellow(`${overwritten} overwrite`));
    parts.push(c.dim(`${unchanged} unchanged`));
    if (skippedActive) parts.push(c.yellow(`${skippedActive} active session(s) skipped`));
    log.plain(c.dim('Dry run — no changes written. ') + parts.join(c.dim(', ')) + c.dim('.'));
    if (overwritten) {
      log.plain(
        c.dim('On a real pull, files marked ') +
          c.yellow('overwrite') +
          c.dim(' are backed up to ~/.copilot-sync/backups/ first.')
      );
    }
    return;
  }

  let importedIndex = 0;
  let missingIndex = 0;
  if (indexPayloads.length) {
    try {
      const imported = importSessionIndexes(storePath, indexPayloads);
      importedIndex = imported.imported;
      missingIndex = imported.missing;
    } catch (e) {
      throw new UserError(
        `Restored session files, but could not update ${storePath}.\n` +
          'Close Copilot or any tool using the shared session DB, then retry.\n' +
          `Underlying error: ${e.message}`
      );
    }
  }

  pruneBackups();

  log.plain('');
  if (wrote + overwritten === 0) {
    log.ok(
      `Everything already up to date (${unchanged} unchanged).` +
        (skippedActive ? c.yellow(` ${skippedActive} active session(s) skipped.`) : '')
    );
  } else {
    log.ok(
      `Applied ${wrote} new + ${overwritten} updated file(s); ${unchanged} unchanged.` +
        (skippedLocked ? c.yellow(` ${skippedLocked} skipped (locked).`) : '') +
        (skippedActive ? c.yellow(` ${skippedActive} active skipped.`) : '')
    );
    if (overwritten) log.info(`Backups of replaced files: ${c.dim(backupRun)}`);
  }
  if (importedIndex) {
    log.info(`Updated shared session-store metadata for ${importedIndex} session(s): ${c.dim(storePath)}`);
  }
  if (missingIndex || indexedMissing) {
    log.warn(
      `${missingIndex + indexedMissing} session(s) were restored without shared session-store metadata.`
    );
  }
  archiveNote();
}

// ---- history list ---------------------------------------------------------

export async function historyList(opts = {}) {
  const cfg = requireConfig();
  await ensureGitAvailable();
  const agent = resolveAgent();
  const since = opts.since != null ? parseSince(opts.since) : null;

  const dir = await ensureRepoReady(cfg, { update: true });
  const repoHistory = historyRepoDir(dir, agent.name);
  let local = listLocalSessions(agent.name);
  if (since != null) local = local.filter((s) => s.mtimeMs >= since);
  const localById = new Map(local.map((s) => [s.id, s]));
  const remoteIds = listRemoteSessionIds(repoHistory, agent.name);
  const remoteSet = new Set(remoteIds);

  log.plain(c.bold('copilot-sync history'));
  log.info(
    `Local sessions:  ${local.length}` +
      (since != null ? c.dim(` (within --since ${opts.since})`) : '') +
      `  ${c.dim(sessionsRoot(agent.name))}`
  );
  log.info(`Remote sessions: ${remoteIds.length}`);
  if (since != null) {
    log.info(c.dim('--since narrows local sessions only; remote timestamps are unreliable.'));
  }
  log.plain('');

  const ids = new Set([...localById.keys(), ...remoteIds]);
  const rows = [...ids].map((id) => {
    const l = localById.get(id);
    const state = l && remoteSet.has(id) ? 'synced' : l ? 'local-only' : 'remote-only';
    return { id, state, l };
  });
  // Order: local-only first (need pushing), then synced, then remote-only;
  // within a group, newest local activity first.
  const rank = { 'local-only': 0, synced: 1, 'remote-only': 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || (b.l?.mtimeMs || 0) - (a.l?.mtimeMs || 0));

  if (!rows.length) {
    log.warn('No sessions found locally or in the remote.');
    return;
  }

  for (const row of rows) {
    const tag =
      row.state === 'synced'
        ? c.green('synced     ')
        : row.state === 'local-only'
          ? c.yellow('local-only ')
          : c.cyan('remote-only');
    let detail = c.dim('(remote only)');
    if (row.l) {
      const when = new Date(row.l.mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
      detail = c.dim(`${fmtSize(row.l.sizeBytes)}, ${when}`) + (row.l.active ? c.yellow(' active') : '');
    }
    log.plain(`  ${row.id}  ${tag}  ${detail}`);
  }

  log.plain('');
  log.info(
    `Push: ${c.bold('copilot-sync history push')} · Pull: ${c.bold('copilot-sync history pull --session <id>')} (id prefix ok).`
  );
}
