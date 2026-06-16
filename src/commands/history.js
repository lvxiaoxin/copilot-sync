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
  rmrf,
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
  normalizeHistoryMode,
  HISTORY_MODE_SYNC,
  HARD_FILE_LIMIT,
  WARN_FILE_LIMIT,
  WARN_TOTAL,
} from '../history.js';
import {
  exportSessionIndex,
  importSessionIndexes,
  readSessionIndexFile,
  sessionIndexRel,
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

function parseTimestampMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return 0;
    return value < 100000000000 ? Math.round(value * 1000) : Math.round(value);
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return parseTimestampMs(Number(raw));
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? raw.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? '' : 'Z')
    : raw;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(ms) {
  if (!ms) return 'unknown';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function indexPayloadChangedMs(payload) {
  if (!payload || payload.missing) return 0;
  const candidates = [payload.session?.updated_at, payload.session?.created_at];
  for (const row of payload.turns || []) candidates.push(row.timestamp);
  for (const row of payload.checkpoints || []) candidates.push(row.created_at);
  for (const row of payload.files || []) candidates.push(row.first_seen_at);
  for (const row of payload.refs || []) candidates.push(row.created_at);
  return Math.max(0, ...candidates.map(parseTimestampMs));
}

function localSessionChangedMs(session, storePath) {
  let changedMs = session?.mtimeMs || 0;
  if (!storePath || !session) return changedMs;
  try {
    changedMs = Math.max(changedMs, indexPayloadChangedMs(exportSessionIndex(storePath, session.id)));
  } catch {
    /* best effort */
  }
  return changedMs;
}

async function gitSessionChangedMs(repoDir, agent, sessionId) {
  try {
    const out = await git(
      [
        'log',
        '-1',
        '--format=%ct',
        '--',
        `history/${agent.name}/${agent.sessionsSubdir}/${sessionId}`,
        `history/${agent.name}/${sessionIndexRel(sessionId)}`,
      ],
      { cwd: repoDir }
    );
    return parseTimestampMs(Number(out.trim()));
  } catch {
    return 0;
  }
}

async function remoteSessionChangedMs(repoDir, repoHistory, agent, session, meta) {
  const entry = meta.sessions?.[session.id];
  const metaMs = parseTimestampMs(entry?.mtimeMs) || parseTimestampMs(entry?.lastChangedAt);
  if (metaMs) return { changedMs: metaMs, source: 'metadata' };

  const indexMs = indexPayloadChangedMs(readSessionIndexFile(repoHistory, session.id));
  if (indexMs) return { changedMs: indexMs, source: 'session-store' };

  return { changedMs: await gitSessionChangedMs(repoDir, agent, session.id), source: 'git' };
}

function sessionMetaEntry(session, changedMs, bytes) {
  return {
    lastChangedAt: changedMs ? new Date(changedMs).toISOString() : null,
    mtimeMs: Math.round(changedMs || 0),
    fileCount: session.files.length,
    sizeBytes: bytes,
    syncedAt: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform,
  };
}

function clearSessionModes(meta, relPrefix) {
  const prefix = `${toPosix(relPrefix)}/`;
  for (const key of Object.keys(meta.modes || {})) {
    if (key.startsWith(prefix)) delete meta.modes[key];
  }
}

function stageLocalSessionInRepo(repoHistory, session, meta, changedMs) {
  const sessRepo = path.join(repoHistory, ...session.rel.split('/'));
  assertInside(repoHistory, sessRepo, 'history session dest');
  const tmp = `${sessRepo}.copilot-sync-tmp-${process.pid}-${Date.now()}`;
  assertInside(repoHistory, tmp, 'history session temp dest');
  if (exists(tmp)) rmrf(tmp);

  let copied = 0;
  let bytes = 0;
  try {
    ensureDir(tmp);
    for (const f of session.files) {
      const relPrefix = `${session.rel}/`;
      const treePath = f.rel.startsWith(relPrefix) ? f.rel.slice(relPrefix.length) : f.rel;
      const dest = path.join(tmp, ...treePath.split('/'));
      assertInside(tmp, dest, 'history session temp dest');
      const buf = fs.readFileSync(f.abs);
      const mode = f.mode & 0o777;
      writeFileAtomic(dest, buf, mode);
      copied++;
      bytes += f.size;
    }
    if (exists(sessRepo)) rmrf(sessRepo);
    ensureDir(path.dirname(sessRepo));
    fs.renameSync(tmp, sessRepo);
  } catch (e) {
    if (exists(tmp)) rmrf(tmp);
    throw e;
  }

  clearSessionModes(meta, session.rel);
  for (const f of session.files) {
    const mode = f.mode & 0o777;
    if (mode & 0o111) meta.modes[toPosix(f.rel)] = mode.toString(8);
  }
  meta.sessions[session.id] = sessionMetaEntry(session, changedMs, bytes);
  return { copied, bytes };
}

function restoreRemoteSessionToLocal(repoHistory, agent, session, meta, base, backupRun) {
  const files = remoteFilesForSession(repoHistory, agent, session);
  const destDir = path.join(base, ...session.rel.split('/'));
  assertInside(base, destDir, 'history session dest');
  const tmp = `${destDir}.copilot-sync-tmp-${process.pid}-${Date.now()}`;
  assertInside(base, tmp, 'history session temp dest');
  if (exists(tmp)) rmrf(tmp);

  try {
    ensureDir(tmp);
    for (const item of files) {
      const dest = path.join(tmp, ...item.treePath.split('/'));
      assertInside(tmp, dest, 'history session temp dest');
      const modeStr = meta.modes[toPosix(item.rel)];
      const mode = modeStr ? parseInt(modeStr, 8) : undefined;
      writeFileAtomic(dest, fs.readFileSync(item.src), mode);
    }

    const destExists = exists(destDir);
    if (destExists) {
      const bdest = path.join(backupRun, session.id);
      try {
        ensureDir(path.dirname(bdest));
        fs.cpSync(destDir, bdest, { recursive: true, force: true, verbatimSymlinks: true });
      } catch {
        /* best effort */
      }
      rmrf(destDir);
    }
    ensureDir(path.dirname(destDir));
    fs.renameSync(tmp, destDir);
    return { fileCount: files.length, overwritten: destExists };
  } catch (e) {
    if (exists(tmp)) rmrf(tmp);
    throw e;
  }
}

// ---- history push ---------------------------------------------------------

export async function historyPush(opts = {}) {
  const cfg = requireConfig();
  if (normalizeHistoryMode(cfg.history?.mode) === HISTORY_MODE_SYNC) {
    return historySyncMode(opts, { cfg, command: 'push' });
  }
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
    const bytes = x.files.reduce((n, f) => n + f.size, 0);
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
    let indexPayload = null;
    if (storePath) {
      indexPayload = exportSessionIndex(storePath, x.id);
      writeSessionIndexFile(repoHistory, indexPayload);
      if (indexPayload.missing) missingIndex++;
      else indexed++;
    }
    const changedMs = Math.max(x.mtimeMs || 0, indexPayloadChangedMs(indexPayload));
    meta.sessions[x.id] = sessionMetaEntry(x, changedMs, bytes);
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

// ---- sync history mode ----------------------------------------------------

async function historySyncMode(opts = {}, { cfg, command }) {
  await ensureGitAvailable();
  const agent = resolveAgent();
  const isPushCommand = command === 'push';
  const isPullCommand = command === 'pull';
  const since = isPushCommand && opts.since != null ? parseSince(opts.since) : null;

  log.plain(
    c.bold(`copilot-sync history ${command}`) +
      c.dim('  mode: sync') +
      (since ? c.dim(`  since: ${opts.since}`) : '') +
      (opts.dryRun ? c.dim('  (dry run)') : '')
  );

  const dir = await ensureRepoReady(cfg, { update: true });
  const repoHistory = historyRepoDir(dir, agent.name);
  const meta = readHistoryMeta(repoHistory);
  const base = agentBase(agent.name);
  const storePath = agent.sharedStore ? sharedStorePath(agent.name) : null;

  const localSessions = listLocalSessions(agent.name);
  const localById = new Map(localSessions.map((s) => [s.id, s]));
  const remoteSessions = listRemoteSessions(repoHistory, agent.name);
  const remoteById = new Map(remoteSessions.map((s) => [s.id, s]));
  const items = [...new Set([...localById.keys(), ...remoteById.keys()])].map((id) => ({ id }));
  const selected = resolveSelector(opts.session, items);

  if (!selected.length) {
    log.warn('No sessions found locally or in the remote.');
    return;
  }

  const plans = [];
  for (const item of selected) {
    const local = localById.get(item.id) || null;
    const remote = remoteById.get(item.id) || null;
    const localChangedMs = local ? localSessionChangedMs(local, storePath) : 0;
    const remoteTime = remote
      ? await remoteSessionChangedMs(dir, repoHistory, agent, remote, meta)
      : { changedMs: 0, source: 'none' };

    if (local?.active && !opts.force) {
      plans.push({ id: item.id, action: 'skip-active', local, remote, localChangedMs, remoteTime });
      continue;
    }

    if (since != null && local && local.mtimeMs < since) {
      plans.push({ id: item.id, action: 'skip-aged', local, remote, localChangedMs, remoteTime });
      continue;
    }

    if (local && !remote) {
      const collected = collectSession(local);
      plans.push({ id: item.id, action: 'push', reason: 'local-only', local, collected, localChangedMs });
      continue;
    }

    if (remote && !local) {
      plans.push({ id: item.id, action: 'pull', reason: 'remote-only', remote, remoteTime });
      continue;
    }

    if (localChangedMs > remoteTime.changedMs) {
      const collected = collectSession(local);
      plans.push({
        id: item.id,
        action: 'push',
        reason: 'local-newer',
        local,
        remote,
        collected,
        localChangedMs,
        remoteTime,
      });
      continue;
    }

    if (remoteTime.changedMs > localChangedMs) {
      plans.push({
        id: item.id,
        action: 'pull',
        reason: 'remote-newer',
        local,
        remote,
        localChangedMs,
        remoteTime,
      });
      continue;
    }

    plans.push({ id: item.id, action: 'unchanged', local, remote, localChangedMs, remoteTime });
  }

  const pushPlans = isPushCommand ? plans.filter((p) => p.action === 'push') : [];
  const pullPlans = isPullCommand ? plans.filter((p) => p.action === 'pull') : [];
  const oppositePlans = plans.filter((p) =>
    (isPushCommand && p.action === 'pull') || (isPullCommand && p.action === 'push')
  );
  const activePlans = plans.filter((p) => p.action === 'skip-active');
  const agedPlans = plans.filter((p) => p.action === 'skip-aged');
  const unchangedPlans = plans.filter((p) => p.action === 'unchanged');
  const pushFiles = pushPlans.flatMap((p) => p.collected.files);
  const totalLocalBytes = pushFiles.reduce((n, f) => n + f.size, 0);
  const localFileLimitHits = pushFiles.filter((f) => f.size >= HARD_FILE_LIMIT);
  const localFileWarnings = pushFiles.filter(
    (f) => f.size >= WARN_FILE_LIMIT && f.size < HARD_FILE_LIMIT
  );

  if (localFileLimitHits.length && !opts.forceLarge) {
    log.plain('');
    log.error("File(s) at/over GitHub's 100MB limit:");
    for (const f of localFileLimitHits) log.plain(`  ${c.red(f.rel)} (${fmtSize(f.size)})`);
    throw new UserError(
      `Aborted. Remove the file(s) or pass ${c.bold('--force-large')} (push may be rejected by GitHub).`
    );
  }

  for (const f of localFileWarnings) log.warn(`  large file: ${f.rel} (${fmtSize(f.size)})`);
  if (totalLocalBytes >= WARN_TOTAL) {
    log.warn(`Large push side of sync: ${fmtSize(totalLocalBytes)} across local-newer session file(s).`);
  }

  privacyReminder();
  log.plain('');

  for (const plan of plans) {
    if (plan.action === 'push') {
      const tag = plan.reason === 'local-only' ? 'local-only' : 'local newer';
      log.info(
        `${c.cyan(shortId(plan.id))}: ${c.green(isPushCommand ? 'push' : 'skip push')} ${c.dim(tag)} ` +
          c.dim(`local ${formatTimestamp(plan.localChangedMs)}`) +
          (plan.remoteTime ? c.dim(`, remote ${formatTimestamp(plan.remoteTime.changedMs)}`) : '')
      );
      for (const s of plan.collected.sensitive) log.warn(`  sensitive file excluded: ${s}`);
    } else if (plan.action === 'pull') {
      const tag = plan.reason === 'remote-only' ? 'remote-only' : 'remote newer';
      log.info(
        `${c.cyan(shortId(plan.id))}: ${c.blue(isPullCommand ? 'pull' : 'skip pull')} ${c.dim(tag)} ` +
          c.dim(`remote ${formatTimestamp(plan.remoteTime.changedMs)}`) +
          (plan.local ? c.dim(`, local ${formatTimestamp(plan.localChangedMs)}`) : '')
      );
    } else if (plan.action === 'skip-active') {
      log.warn(
        `${c.cyan(shortId(plan.id))}: skipped; local session looks active. Use ${c.bold('--force')}.`
      );
    } else if (plan.action === 'skip-aged') {
      log.warn(
        `${c.cyan(shortId(plan.id))}: skipped; older than ${c.bold('--since ' + opts.since)}.`
      );
    } else if (opts.dryRun) {
      log.info(`${c.cyan(shortId(plan.id))}: ${c.dim('unchanged')}`);
    }
  }

  if (opts.dryRun) {
    log.plain('');
    log.plain(
      c.dim('Dry run — no changes written. ') +
        [
          pushPlans.length ? c.green(`${pushPlans.length} push`) : null,
          pullPlans.length ? c.blue(`${pullPlans.length} pull`) : null,
          oppositePlans.length ? c.dim(`${oppositePlans.length} need ${isPushCommand ? 'pull' : 'push'}`) : null,
          activePlans.length ? c.yellow(`${activePlans.length} active skipped`) : null,
          agedPlans.length ? c.yellow(`${agedPlans.length} older skipped`) : null,
          c.dim(`${unchangedPlans.length} unchanged`),
        ].filter(Boolean).join(c.dim(', ')) +
        c.dim('.')
    );
    return;
  }

  if (pushPlans.length && !cfg.history?.acknowledged) {
    if (!opts.yes) {
      const p = createPrompter();
      const ok = await p.confirm(
        'Push session history to your remote? It may contain sensitive data',
        false
      );
      p.close();
      if (!ok) {
        log.info('Aborted — nothing synced.');
        return;
      }
    }
    cfg.history = { ...(cfg.history || {}), acknowledged: true };
    saveConfig(cfg);
  }

  if (pushPlans.length) ensureDir(repoHistory);

  let pushedSessions = 0;
  let pushedFiles = 0;
  let pushedBytes = 0;
  let indexed = 0;
  let missingIndex = 0;
  let failedPushes = 0;
  const stagedPushPlans = [];

  for (const plan of pushPlans) {
    try {
      const staged = stageLocalSessionInRepo(repoHistory, plan.collected, meta, plan.localChangedMs);
      pushedSessions++;
      pushedFiles += staged.copied;
      pushedBytes += staged.bytes;
      stagedPushPlans.push(plan);
    } catch (e) {
      failedPushes++;
      log.warn(`  could not stage ${plan.id}: ${e.message} — skipped.`);
      continue;
    }

    if (storePath) {
      const indexPayload = exportSessionIndex(storePath, plan.id);
      writeSessionIndexFile(repoHistory, indexPayload);
      if (indexPayload.missing) missingIndex++;
      else indexed++;
    }
  }

  if (pushedSessions) writeHistoryMeta(repoHistory, meta);

  let pushedRemote = false;
  if (pushedSessions) {
    const id = await ensureIdentity(dir);
    if (id.usedFallback) {
      log.warn('No git identity found; committing as "copilot-sync <copilot-sync@localhost>".');
    }

    await git(['add', '-A', '--', `history/${agent.name}`], { cwd: dir });
    const status = (
      await git(['status', '--porcelain', '--', `history/${agent.name}`], { cwd: dir })
    ).trim();
    if (status) {
      const subject = `history sync: ${os.hostname()} (${process.platform}) ${new Date().toISOString()}`;
      const body = stagedPushPlans.map((p) => `${p.id}: ${p.reason}`).join('\n');
      await git(['commit', '-m', subject, '-m', body], { cwd: dir });

      log.step('Pushing newer local sessions to remote ...');
      try {
        await git(['push', '-u', 'origin', cfg.branch], { cwd: dir, interactive: true });
        pushedRemote = true;
      } catch (e) {
        throw new UserError(
          `Push failed. No remote-newer sessions were applied locally yet. Check your access to ${cfg.remote}.\n${e.stderr || e.message}`
        );
      }
    }
  }

  let pulledSessions = 0;
  let pulledFiles = 0;
  let overwrittenSessions = 0;
  let skippedLocked = 0;
  let indexedMissing = 0;
  const backupRun = path.join(backupsDir(), tsStamp(), 'history', agent.name);
  const indexPayloads = [];

  for (const plan of pullPlans) {
    try {
      const restored = restoreRemoteSessionToLocal(repoHistory, agent, plan.remote, meta, base, backupRun);
      pulledSessions++;
      pulledFiles += restored.fileCount;
      if (restored.overwritten) overwrittenSessions++;
    } catch {
      skippedLocked++;
      log.warn(`  could not restore ${plan.id} (locked?). Close Copilot and retry.`);
      continue;
    }

    if (storePath) {
      const indexPayload = readSessionIndexFile(repoHistory, plan.id);
      if (indexPayload) indexPayloads.push(indexPayload);
      else indexedMissing++;
    }
  }

  let importedIndex = 0;
  if (indexPayloads.length) {
    try {
      const imported = importSessionIndexes(storePath, indexPayloads);
      importedIndex = imported.imported;
      indexedMissing += imported.missing;
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
  if (!pushedSessions && !pulledSessions) {
    const hasSkipped = failedPushes || oppositePlans.length || agedPlans.length || activePlans.length;
    const summary = hasSkipped
      ? `No sessions synced (${unchangedPlans.length} unchanged).`
      : `Everything already up to date (${unchangedPlans.length} unchanged).`;
    (hasSkipped ? log.warn : log.ok)(
      summary +
        (failedPushes ? c.yellow(` ${failedPushes} push skipped.`) : '') +
        (oppositePlans.length ? c.dim(` ${oppositePlans.length} need ${isPushCommand ? 'pull' : 'push'}.`) : '') +
        (agedPlans.length ? c.yellow(` ${agedPlans.length} older than --since skipped.`) : '') +
        (activePlans.length ? c.yellow(` ${activePlans.length} active session(s) skipped.`) : '')
    );
  } else {
    log.ok(
      `Synced ${pushedSessions} pushed + ${pulledSessions} pulled session(s).` +
        (failedPushes ? c.yellow(` ${failedPushes} push skipped.`) : '') +
        (skippedLocked ? c.yellow(` ${skippedLocked} skipped (locked).`) : '') +
        (oppositePlans.length ? c.dim(` ${oppositePlans.length} need ${isPushCommand ? 'pull' : 'push'}.`) : '') +
        (agedPlans.length ? c.yellow(` ${agedPlans.length} older than --since skipped.`) : '') +
        (activePlans.length ? c.yellow(` ${activePlans.length} active skipped.`) : '')
    );
    if (pushedSessions) {
      log.info(
        `Pushed ${pushedFiles} file(s), ${fmtSize(pushedBytes)}` +
          (pushedRemote ? '.' : ' (repo already had these bytes).')
      );
    }
    if (pulledSessions) {
      log.info(`Pulled ${pulledFiles} file(s) into ${c.dim(sessionsRoot(agent.name))}.`);
      if (overwrittenSessions) log.info(`Backups of replaced sessions: ${c.dim(backupRun)}`);
    }
  }
  if (indexed) log.info(`Updated remote session-store metadata for ${indexed} session(s).`);
  if (importedIndex) {
    log.info(`Updated local shared session-store metadata for ${importedIndex} session(s): ${c.dim(storePath)}`);
  }
  if (missingIndex || indexedMissing) {
    log.warn(`${missingIndex + indexedMissing} session(s) synced without shared session-store metadata.`);
  }
  archiveNote();
}

// ---- history pull ---------------------------------------------------------

export async function historyPull(opts = {}) {
  const cfg = requireConfig();
  if (normalizeHistoryMode(cfg.history?.mode) === HISTORY_MODE_SYNC) {
    return historySyncMode(opts, { cfg, command: 'pull' });
  }
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
