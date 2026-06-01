// Tiny dependency-free ANSI logger. Colors auto-disable when not a TTY
// or when NO_COLOR is set.
const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY;

function paint(code, s) {
  return useColor ? `\u001b[${code}m${s}\u001b[0m` : s;
}

export const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  blue: (s) => paint('34', s),
  cyan: (s) => paint('36', s),
};

export const log = {
  info: (msg) => console.log(msg),
  step: (msg) => console.log(`${c.cyan('›')} ${msg}`),
  ok: (msg) => console.log(`${c.green('✓')} ${msg}`),
  warn: (msg) => console.log(`${c.yellow('!')} ${msg}`),
  error: (msg) => console.error(`${c.red('✗')} ${msg}`),
  plain: (msg = '') => console.log(msg),
};

// Thrown for expected, user-facing failures (printed without a stack trace).
export class UserError extends Error {}
