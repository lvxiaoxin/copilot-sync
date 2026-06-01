import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Expand a leading ~ to the user's home directory. Works on all platforms.
export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// Convert a glob (supporting **, *, ?) into a RegExp matched against a
// forward-slash-normalised relative path. `**/` matches zero or more whole
// path segments; `*` and `?` never cross a `/`.
export function globToRegExp(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      let j = i;
      while (glob[j] === '*') j++;
      const isGlobstar = j - i >= 2;
      if (isGlobstar) {
        const prevStart = i === 0 || glob[i - 1] === '/';
        const nextSlash = glob[j] === '/';
        if (prevStart && nextSlash) {
          re += '(?:[^/]+/)*'; // **/ => zero or more full segments
          i = j + 1;
        } else {
          re += '.*';
          i = j;
        }
      } else {
        re += '[^/]*';
        i = j;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if ('\\^$+.()|[]{}'.includes(ch)) {
      re += '\\' + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

// True if `rel` (a posix relative path) matches any of the given globs.
// Tests the full path and the basename; for directories also tests with a
// trailing slash so patterns like `**/logs/**` match the `logs` dir itself.
export function matchesAny(rel, globs, { dir = false } = {}) {
  const base = rel.split('/').pop();
  const candidates = dir ? [rel, base, rel + '/'] : [rel, base];
  for (const g of globs) {
    const re = globToRegExp(g);
    if (candidates.some((cand) => re.test(cand))) return true;
  }
  return false;
}

export function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// Ensure `child` resolves to a location inside `parent`. Guards against
// path traversal and accidental operations on home / filesystem roots.
export function assertInside(parent, child, label = 'path') {
  const rp = path.resolve(parent);
  const rc = path.resolve(child);
  const rel = path.relative(rp, rc);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside) {
    throw new Error(`Refusing unsafe ${label}: "${rc}" is not inside "${rp}"`);
  }
  return rc;
}

// Reject obviously dangerous deletion targets (root, home, drive roots).
export function assertSafeToDelete(target) {
  const rt = path.resolve(target);
  const home = path.resolve(os.homedir());
  const parsed = path.parse(rt);
  if (rt === parsed.root || rt === home) {
    throw new Error(`Refusing to delete protected directory: ${rt}`);
  }
}

// Recursively walk a directory, returning entries relative to `root`.
// Symlinks are reported (type: 'symlink') but never followed.
// `denyGlobs` short-circuits entire subtrees.
export function* walk(root, rel = '', denyGlobs = []) {
  const abs = path.join(root, rel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    const isDir = ent.isDirectory() && !ent.isSymbolicLink();
    if (denyGlobs.length && matchesAny(childRel, denyGlobs, { dir: isDir })) {
      yield { rel: childRel, type: 'denied' };
      continue;
    }
    if (ent.isSymbolicLink()) {
      yield { rel: childRel, type: 'symlink' };
    } else if (ent.isDirectory()) {
      yield { rel: childRel, type: 'dir' };
      yield* walk(root, childRel, denyGlobs);
    } else if (ent.isFile()) {
      yield { rel: childRel, type: 'file' };
    }
  }
}

export function rmrf(target) {
  assertSafeToDelete(target);
  fs.rmSync(target, { recursive: true, force: true });
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Atomically write content: write to a temp file in the same directory then
// rename into place. Tolerates locked targets better than in-place writes.
export function writeFileAtomic(dest, data, mode) {
  ensureDir(path.dirname(dest));
  const tmp = `${dest}.agent-sync-tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  if (mode !== undefined && process.platform !== 'win32') {
    try {
      fs.chmodSync(tmp, mode);
    } catch {
      /* best effort */
    }
  }
  fs.renameSync(tmp, dest);
}

// Heuristic: treat a buffer as binary if it contains a NUL byte in the
// first 8KB. Used to skip binary files during secret scanning.
export function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
