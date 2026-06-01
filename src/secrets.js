import fs from 'node:fs';
import { looksBinary } from './fsutil.js';

// High-confidence token shapes (matched against the whole line).
const TOKEN_PATTERNS = [
  { name: 'GitHub token', re: /\b(gh[pousr])_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'OpenAI/Anthropic key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: 'JWT',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
];

// key = "value" / key: "value" assignments for secret-ish key names.
const ASSIGN_RE =
  /(?:api[_-]?key|secret|token|passwd|password|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?([^"'\s,}{]+)/i;

// Values that are clearly NOT real secrets (env var names, placeholders, etc.).
function isHarmlessValue(v) {
  if (!v) return true;
  if (v.length < 16) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return true; // env var NAME, not a value
  if (/\$\{?[A-Za-z_]/.test(v)) return true; // ${VAR} / $VAR interpolation
  if (/^<.*>$/.test(v)) return true; // <PLACEHOLDER>
  if (/^(x{6,}|\*{6,}|redacted|changeme|your[_-].*|example)$/i.test(v))
    return true;
  if (/^https?:\/\//i.test(v)) return true; // plain URL
  if (/^[~./\\]/.test(v)) return true; // filesystem path
  if (/^[0-9a-fA-F-]{1,}$/.test(v) && v.length < 32) return true; // short hex/uuid frag
  return false;
}

// Scan a single text file. Returns an array of { line, kind } findings.
export function scanText(content) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of TOKEN_PATTERNS) {
      if (p.re.test(line)) findings.push({ line: i + 1, kind: p.name });
    }
    const m = ASSIGN_RE.exec(line);
    if (m && !isHarmlessValue(m[1])) {
      findings.push({ line: i + 1, kind: 'secret-like assignment' });
    }
  }
  return findings;
}

// Scan a file on disk. Binary files are skipped. Returns findings array.
export function scanFile(absPath) {
  let buf;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return [];
  }
  if (looksBinary(buf)) return [];
  return scanText(buf.toString('utf8'));
}
