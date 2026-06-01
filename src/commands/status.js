import os from 'node:os';
import { log, c } from '../log.js';
import { loadConfig, repoDir } from '../config.js';
import { resolveManifest } from '../manifest.js';
import { collectAgent } from '../collect.js';
import { exists } from '../fsutil.js';
import { isGitRepo } from '../git.js';

export async function status() {
  const cfg = loadConfig();
  log.plain(c.bold('agent-sync status'));
  log.info(`Host: ${c.bold(os.hostname())}   OS: ${c.bold(process.platform)} (${process.arch})`);

  if (!cfg || !cfg.remote) {
    log.warn("Not onboarded. Run 'agent-sync onboard' to configure a remote repo.");
    return;
  }

  log.info(`Remote:  ${c.bold(cfg.remote)}`);
  log.info(`Branch:  ${c.bold(cfg.branch)}`);
  log.info(`Agents:  ${c.bold((cfg.agents || []).join(', '))}`);
  log.info(`Clone:   ${exists(repoDir()) && isGitRepo(repoDir()) ? c.green('present') : c.yellow('not cloned yet')} ${c.dim(repoDir())}`);

  const manifest = resolveManifest(cfg.manifest);
  const agents = (cfg.agents || Object.keys(manifest)).filter((a) => manifest[a]);

  log.plain('');
  log.info(c.bold('Would sync from this machine:'));
  for (const agent of agents) {
    const r = collectAgent(agent, manifest[agent], {});
    log.info(
      `  ${c.cyan(agent)} ${c.dim(manifest[agent].base)} → ${r.files.length} file(s)` +
        (r.symlinks.length ? c.yellow(`, ${r.symlinks.length} symlink(s) skipped`) : '') +
        (r.missing.length ? c.dim(`, ${r.missing.length} not present`) : '')
    );
  }
  log.plain('');
  log.info(c.dim('Run `agent-sync push --dry-run` or `agent-sync pull --dry-run` for details.'));
}
