import { repoDir } from './config.js';
import { exists, rmrf } from './fsutil.js';
import { git, isGitRepo } from './git.js';
import { log, c, UserError } from './log.js';

// Ensure the local working clone exists and (optionally) is up to date with the
// remote. Returns the repo directory path.
export async function ensureRepoReady(cfg, { update = false } = {}) {
  const dir = repoDir();

  if (exists(dir) && !isGitRepo(dir)) rmrf(dir);

  if (!isGitRepo(dir)) {
    log.step(`Cloning ${c.bold(cfg.remote)} ...`);
    try {
      await git(['clone', '--branch', cfg.branch, cfg.remote, dir], {
        interactive: true,
      });
    } catch {
      try {
        await git(['clone', cfg.remote, dir], { interactive: true });
      } catch (e) {
        throw new UserError(
          `Could not clone the remote. Run 'agent-sync onboard' to reconfigure.\n${
            e.stderr || e.message
          }`
        );
      }
    }
  }

  // Always operate on the configured branch.
  await git(['checkout', '-B', cfg.branch], { cwd: dir }).catch(() => {});

  if (update) {
    log.step('Fetching latest from remote ...');
    try {
      await git(['pull', '--ff-only', 'origin', cfg.branch], {
        cwd: dir,
        interactive: true,
      });
    } catch (e) {
      // Empty remote / no upstream yet / non-ff: warn and continue.
      log.warn(`Could not fast-forward from remote (continuing): ${(e.stderr || e.message).split('\n')[0]}`);
    }
  }

  return dir;
}
