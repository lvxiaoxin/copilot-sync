import { Command } from 'commander';
import { log, UserError } from './log.js';
import { onboard } from './commands/onboard.js';
import { push } from './commands/push.js';
import { pull } from './commands/pull.js';
import { status } from './commands/status.js';

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
    .version('0.1.0');

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

  await program.parseAsync(argv);
}
