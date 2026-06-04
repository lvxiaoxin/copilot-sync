import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { log, UserError } from './log.js';
import { onboard } from './commands/onboard.js';
import { push } from './commands/push.js';
import { pull } from './commands/pull.js';
import { status } from './commands/status.js';
import { historyPush, historyPull, historyList } from './commands/history.js';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UserError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

export async function run(argv) {
  const program = new Command();

  program
    .name('agent-sync')
    .description(
      'Sync AI agent config artifacts (Copilot, Claude, Codex) across machines via a GitHub repo.'
    )
    .version(pkg.version);

  program
    .command('onboard')
    .description('Configure the remote GitHub repo used to store/sync configs.')
    .action(() => guard(onboard));

  program
    .command('push')
    .description('Collect this machine\'s agent artifacts and push them to the remote.')
    .option('--dry-run', 'Show what would be pushed without changing anything.')
    .option('--unsafe-allow', 'Bypass the deny-list and secret scan (discouraged).')
    .action((opts) => guard(() => push(opts)));

  program
    .command('pull')
    .description('Pull the remote and apply agent artifacts into this OS\'s config dirs.')
    .option('--dry-run', 'Show what would change locally without writing anything.')
    .option('--unsafe-allow', 'Bypass the deny-list when dispatching files (discouraged).')
    .action((opts) => guard(() => pull(opts)));

  program
    .command('status')
    .description('Show configuration and what would sync from this machine.')
    .action(() => guard(status));

  const history = program
    .command('history')
    .description('Sync Copilot CLI session history (archive/restore sessions across machines).');

  history
    .command('push')
    .description('Archive this machine\'s Copilot sessions to the remote (additive).')
    .option('--session <id>', 'Only this session (full id or unique prefix).')
    .option('--dry-run', 'Show what would be pushed without changing anything.')
    .option('--yes', 'Skip the one-time privacy confirmation.')
    .option('--force', 'Include sessions that look active (recently modified).')
    .option('--force-large', 'Allow files near GitHub\'s 100MB limit.')
    .action((opts) => guard(() => historyPush(opts)));

  history
    .command('pull')
    .description('Restore Copilot sessions from the remote into this machine.')
    .option('--session <id>', 'Only this session (full id or unique prefix).')
    .option('--dry-run', 'Show what would change locally without writing anything.')
    .option('--force', 'Overwrite even if the local session looks active.')
    .action((opts) => guard(() => historyPull(opts)));

  history
    .command('list')
    .description('List local and remote sessions and their sync state.')
    .action(() => guard(historyList));

  await program.parseAsync(argv);
}
