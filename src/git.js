import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './log.js';

const pexec = promisify(execFile);

// Run a git command with an argv array (no shell — avoids injection).
// By default git is non-interactive so failures surface instead of hanging on
// a credential prompt. Set opts.interactive=true for onboarding clones.
export async function git(args, { cwd, interactive = false } = {}) {
  const env = { ...process.env };
  if (!interactive) env.GIT_TERMINAL_PROMPT = '0';
  try {
    const { stdout } = await pexec('git', args, {
      cwd,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').trim();
    const e = new Error(`git ${args.join(' ')} failed:\n${detail}`);
    e.gitFailed = true;
    e.stderr = detail;
    throw e;
  }
}

export async function ensureGitAvailable() {
  try {
    await pexec('git', ['--version']);
  } catch {
    throw new UserError(
      'git is required but was not found on PATH. Please install git and retry.'
    );
  }
}

export function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

// Ensure a local commit identity exists for this repo; set a clear fallback if
// the user has no global git identity configured.
export async function ensureIdentity(cwd) {
  let hasName = true;
  let hasEmail = true;
  try {
    await git(['config', 'user.name'], { cwd });
  } catch {
    hasName = false;
  }
  try {
    await git(['config', 'user.email'], { cwd });
  } catch {
    hasEmail = false;
  }
  if (!hasName) await git(['config', 'user.name', 'agent-sync'], { cwd });
  if (!hasEmail)
    await git(['config', 'user.email', 'agent-sync@localhost'], { cwd });
  return { usedFallback: !hasName || !hasEmail };
}

export async function currentBranch(cwd) {
  try {
    return (await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).trim();
  } catch {
    return null;
  }
}

export async function hasCommits(cwd) {
  try {
    await git(['rev-parse', 'HEAD'], { cwd });
    return true;
  } catch {
    return false;
  }
}
