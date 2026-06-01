import fs from 'node:fs';
import path from 'node:path';
import { HARD_DENY } from './manifest.js';
import { expandHome, exists, walk, assertInside, matchesAny } from './fsutil.js';

// Collect the concrete files to sync for one agent based on its manifest.
// Returns { base, files: [{rel, abs, mode}], symlinks, denied, missing }.
// `rel` is posix and relative to the agent base.
export function collectAgent(agent, agentManifest, { allowUnsafe = false } = {}) {
  const base = expandHome(agentManifest.base);
  const deny = allowUnsafe ? [] : HARD_DENY;
  const files = [];
  const symlinks = [];
  const denied = [];
  const missing = [];

  for (const entry of agentManifest.include) {
    const entryRel = entry.split(path.sep).join('/').replace(/^\/+|\/+$/g, '');
    const abs = path.join(base, entryRel);

    // Prevent include overrides from escaping the agent base via .. or absolutes.
    try {
      assertInside(base, abs, 'include path');
    } catch {
      denied.push(entryRel);
      continue;
    }

    if (!exists(abs)) {
      missing.push(entryRel);
      continue;
    }

    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) {
      symlinks.push(entryRel);
      continue;
    }

    if (!allowUnsafe && matchesAny(entryRel, deny, { dir: st.isDirectory() })) {
      denied.push(entryRel);
      continue;
    }

    if (st.isFile()) {
      files.push({ rel: entryRel, abs, mode: st.mode });
    } else if (st.isDirectory()) {
      for (const node of walk(abs, '', deny)) {
        const rel = `${entryRel}/${node.rel}`;
        if (node.type === 'symlink') symlinks.push(rel);
        else if (node.type === 'denied') denied.push(rel);
        else if (node.type === 'file') {
          const f = path.join(abs, node.rel);
          files.push({ rel, abs: f, mode: fs.statSync(f).mode });
        }
      }
    }
  }

  return { base, files, symlinks, denied, missing };
}

export function collectAll(manifest, opts) {
  const result = {};
  for (const agent of Object.keys(manifest)) {
    result[agent] = collectAgent(agent, manifest[agent], opts);
  }
  return result;
}
