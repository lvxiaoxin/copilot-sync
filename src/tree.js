import { c } from './log.js';

// Build a nested tree from POSIX-style relative paths.
// entries: [{ path: 'skills/foo/SKILL.md', tag?: 'new'|'overwrite'|... }]
function buildTree(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean);
    const name = parts.pop();
    let node = root;
    for (const p of parts) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [] });
      node = node.dirs.get(p);
    }
    node.files.push({ name, tag: e.tag });
  }
  return root;
}

const TAG_COLOR = {
  new: c.green,
  overwrite: c.yellow,
  unchanged: c.dim,
  deleted: c.red,
};

function paintTag(tag) {
  if (!tag) return '';
  const fn = TAG_COLOR[tag] || c.dim;
  return '  ' + fn(tag);
}

function renderNode(node, prefix, lines) {
  const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  const items = [
    ...dirNames.map((n) => ({ type: 'dir', name: n, node: node.dirs.get(n) })),
    ...files.map((f) => ({ type: 'file', name: f.name, tag: f.tag })),
  ];
  items.forEach((it, i) => {
    const last = i === items.length - 1;
    const branch = last ? '└── ' : '├── ';
    if (it.type === 'dir') {
      lines.push(prefix + c.dim(branch) + c.cyan(it.name + '/'));
      renderNode(it.node, prefix + c.dim(last ? '    ' : '│   '), lines);
    } else {
      lines.push(prefix + c.dim(branch) + it.name + paintTag(it.tag));
    }
  });
}

// Returns an array of rendered lines (without a trailing newline) for the
// given entries, drawn as an indented file tree.
export function renderTree(entries) {
  const lines = [];
  renderNode(buildTree(entries), '', lines);
  return lines;
}
