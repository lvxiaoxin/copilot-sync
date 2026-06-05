import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, c } from '../log.js';
import { createPrompter } from '../prompt.js';
import { loadConfig, saveConfig, repoDir, appHome } from '../config.js';
import { ensureDir, rmrf, exists, assertInside } from '../fsutil.js';
import { ensureGitAvailable, git, isGitRepo } from '../git.js';

// Expand "owner/repo" shorthand to a full GitHub HTTPS URL.
function normalizeRemote(input) {
  const v = input.trim();
  if (!v) return '';
  if (/^[\w.-]+\/[\w.-]+$/.test(v)) {
    return `https://github.com/${v.replace(/\.git$/, '')}.git`;
  }
  return v;
}

const GITATTRIBUTES = `# Managed by copilot-sync — keep line endings stable across OSes.
* text=auto
*.sh text eol=lf
*.bash text eol=lf
*.zsh text eol=lf
*.py text eol=lf
*.js text eol=lf
*.json text eol=lf
*.toml text eol=lf
*.yaml text eol=lf
*.yml text eol=lf
*.md text eol=lf
*.ps1 text eol=crlf
*.bat text eol=crlf
*.cmd text eol=crlf
`;

const README = `# copilot-sync store

This repository is managed by [copilot-sync](https://www.npmjs.com/package/@lvxiaoxin/copilot-sync).
It holds shareable GitHub Copilot artifacts (skills, MCP config, agents, prompts, settings)
and opt-in Copilot CLI session history.

- \`copilot-sync push\` uploads this machine's artifacts here.
- \`copilot-sync pull\` applies them on another machine.

Do not store secrets here. copilot-sync secret-scans every push.
`;

export async function onboard() {
  await ensureGitAvailable();

  const prompt = createPrompter();
  let remote, branch, existingCfg;
  try {
    const existing = loadConfig();
    existingCfg = existing;
    if (existing?.remote) {
      log.warn(`Already onboarded to ${c.bold(existing.remote)} (branch ${existing.branch}).`);
      const re = await prompt.confirm('Reconfigure?', false);
      if (!re) {
        log.info('Keeping existing configuration.');
        return;
      }
    }

    log.plain(c.bold('\ncopilot-sync onboarding'));
    log.info('This sets the GitHub repo used to store/sync your Copilot configs.\n');

    remote = '';
    while (!remote) {
      const raw = await prompt.ask(
        'Remote git repo (URL or owner/repo)',
        { default: existing?.remote }
      );
      remote = normalizeRemote(raw);
      if (!remote) log.error('A remote repo is required.');
    }

    branch = (await prompt.ask('Branch', { default: existing?.branch || 'main' })) || 'main';

  } finally {
    prompt.close();
  }

  const cfg = {
    version: 1,
    remote,
    branch,
    createdAt: existingCfg?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  ensureDir(appHome());
  saveConfig(cfg);
  log.ok(`Saved config to ${c.dim(path.join(appHome(), 'config.json'))}`);

  // Clone (or refresh) the local working copy of the remote.
  const dir = repoDir();
  assertInside(appHome(), dir, 'repo dir');
  if (exists(dir)) {
    if (isGitRepo(dir)) {
      log.step('Local repo clone already exists — updating remote URL.');
      await git(['remote', 'set-url', 'origin', remote], { cwd: dir }).catch(
        async () => {
          await git(['remote', 'add', 'origin', remote], { cwd: dir });
        }
      );
    } else {
      rmrf(dir);
    }
  }

  if (!isGitRepo(dir)) {
    log.step(`Cloning ${c.bold(remote)} ...`);
    try {
      await git(['clone', '--branch', branch, remote, dir], { interactive: true });
    } catch (e1) {
      // Branch may not exist yet (fresh/empty remote): clone without branch.
      try {
        await git(['clone', remote, dir], { interactive: true });
      } catch (e2) {
        throw new UserError(
          `Could not clone the remote.\n${e2.stderr || e2.message}\n\n` +
            `Make sure the repo exists and you have access. For a brand-new repo, create it empty on GitHub first.`
        );
      }
    }
  }

  // Make sure we are on the desired branch.
  await git(['checkout', '-B', branch], { cwd: dir }).catch(() => {});

  // Seed helpful repo files if missing (kept local until first push).
  const ga = path.join(dir, '.gitattributes');
  if (!exists(ga)) fs.writeFileSync(ga, GITATTRIBUTES);
  const rm = path.join(dir, 'README.md');
  if (!exists(rm)) fs.writeFileSync(rm, README);

  log.ok('Onboarding complete.');
  log.plain('');
  log.info(`Next: ${c.bold('copilot-sync push')} on this machine, then ${c.bold('copilot-sync pull')} on the others.`);
  log.info(`Host: ${c.dim(os.hostname())}  OS: ${c.dim(process.platform)}`);
}
