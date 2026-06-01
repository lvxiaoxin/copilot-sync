import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

// A prompter that buffers stdin lines into a queue. This is robust for both
// interactive TTY use and piped/automated input: when several lines arrive in
// a single chunk, readline emits all 'line' events at once — a naive
// per-question listener would drop the extras. Queuing avoids that.
export function createPrompter() {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
  const queue = [];
  const waiters = [];
  let closed = false;

  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });

  function nextLine() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  }

  async function ask(question, { default: def } = {}) {
    const suffix = def ? ` (${def})` : '';
    stdout.write(`${question}${suffix}: `);
    const line = await nextLine();
    const answer = (line == null ? '' : line).trim();
    return answer || def || '';
  }

  async function confirm(question, def = true) {
    const hint = def ? 'Y/n' : 'y/N';
    const ans = (await ask(`${question} [${hint}]`)).toLowerCase();
    if (!ans) return def;
    return ans === 'y' || ans === 'yes';
  }

  return { ask, confirm, close: () => rl.close() };
}

// Convenience one-shot helpers. Prefer createPrompter() for several questions.
export async function ask(question, opts) {
  const p = createPrompter();
  try {
    return await p.ask(question, opts);
  } finally {
    p.close();
  }
}

export async function confirm(question, def = true) {
  const p = createPrompter();
  try {
    return await p.confirm(question, def);
  } finally {
    p.close();
  }
}
