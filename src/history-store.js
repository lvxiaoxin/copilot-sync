import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { exists, ensureDir, writeFileAtomic } from './fsutil.js';

export const SESSION_INDEX_VERSION = 1;
export const SESSION_INDEX_SUBDIR = 'session-index';

const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT,
    repository TEXT,
    host_type TEXT,
    branch TEXT,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    turn_index INTEGER NOT NULL,
    user_message TEXT,
    assistant_response TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, turn_index)
  )`,
  `CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    checkpoint_number INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    history TEXT,
    work_done TEXT,
    technical_details TEXT,
    important_files TEXT,
    next_steps TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, checkpoint_number)
  )`,
  `CREATE TABLE IF NOT EXISTS session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    file_path TEXT NOT NULL,
    tool_name TEXT,
    turn_index INTEGER,
    first_seen_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, file_path)
  )`,
  `CREATE TABLE IF NOT EXISTS session_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    ref_type TEXT NOT NULL,
    ref_value TEXT NOT NULL,
    turn_index INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, ref_type, ref_value)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    content,
    session_id UNINDEXED,
    source_type UNINDEXED,
    source_id UNINDEXED
  )`,
];

function tableSet(db) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
      .all()
      .map((row) => row.name)
  );
}

function ensureSchema(db) {
  for (const sql of CORE_SCHEMA) db.exec(sql);
  const count = db.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n;
  if (count === 0) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SESSION_INDEX_VERSION);
  }
}

function openDb(dbPath, { readonly = false } = {}) {
  const db = new Database(dbPath, { readonly, fileMustExist: readonly });
  try {
    db.pragma(`busy_timeout = ${readonly ? 3000 : 5000}`);
  } catch {
    /* best effort */
  }
  return db;
}

function emptyPayload(id) {
  return {
    version: SESSION_INDEX_VERSION,
    session: null,
    turns: [],
    checkpoints: [],
    files: [],
    refs: [],
    search: [],
    missing: true,
    id,
  };
}

function allRows(db, sql, param) {
  return db.prepare(sql).all(param);
}

export function sessionIndexRel(id) {
  return `${SESSION_INDEX_SUBDIR}/${id}.json`;
}

export function writeSessionIndexFile(repoHistory, payload) {
  const dest = path.join(repoHistory, ...sessionIndexRel(payload.id).split('/'));
  writeFileAtomic(dest, JSON.stringify(payload, null, 2) + '\n');
}

export function readSessionIndexFile(repoHistory, id) {
  const file = path.join(repoHistory, ...sessionIndexRel(id).split('/'));
  if (!exists(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function exportSessionIndex(dbPath, sessionId) {
  if (!exists(dbPath)) return emptyPayload(sessionId);
  const db = openDb(dbPath, { readonly: true });
  try {
    const tables = tableSet(db);
    const session = db
      .prepare(
        `SELECT id, cwd, repository, host_type, branch, summary, created_at, updated_at
         FROM sessions WHERE id = ?`
      )
      .get(sessionId);
    if (!session) return emptyPayload(sessionId);
    return {
      version: SESSION_INDEX_VERSION,
      id: sessionId,
      missing: false,
      session,
      turns: tables.has('turns')
        ? allRows(
            db,
            `SELECT turn_index, user_message, assistant_response, timestamp
             FROM turns WHERE session_id = ? ORDER BY turn_index ASC`,
            sessionId
          )
        : [],
      checkpoints: tables.has('checkpoints')
        ? allRows(
            db,
            `SELECT checkpoint_number, title, overview, history, work_done,
                    technical_details, important_files, next_steps, created_at
             FROM checkpoints WHERE session_id = ? ORDER BY checkpoint_number ASC`,
            sessionId
          )
        : [],
      files: tables.has('session_files')
        ? allRows(
            db,
            `SELECT file_path, tool_name, turn_index, first_seen_at
             FROM session_files WHERE session_id = ? ORDER BY turn_index ASC, file_path ASC`,
            sessionId
          )
        : [],
      refs: tables.has('session_refs')
        ? allRows(
            db,
            `SELECT ref_type, ref_value, turn_index, created_at
             FROM session_refs WHERE session_id = ? ORDER BY created_at ASC`,
            sessionId
          )
        : [],
      search: tables.has('search_index')
        ? allRows(
            db,
            `SELECT content, session_id, source_type, source_id
             FROM search_index WHERE session_id = ?`,
            sessionId
          )
        : [],
    };
  } finally {
    db.close();
  }
}

export function importSessionIndexes(dbPath, payloads) {
  ensureDir(path.dirname(dbPath));
  const db = openDb(dbPath);
  try {
    ensureSchema(db);

    const upsertSession = db.prepare(
      `INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at)
       VALUES (@id, @cwd, @repository, @host_type, @branch, @summary, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         cwd = excluded.cwd,
         repository = excluded.repository,
         host_type = excluded.host_type,
         branch = excluded.branch,
         summary = excluded.summary,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    );
    const deleteTurns = db.prepare('DELETE FROM turns WHERE session_id = ?');
    const deleteCheckpoints = db.prepare('DELETE FROM checkpoints WHERE session_id = ?');
    const deleteFiles = db.prepare('DELETE FROM session_files WHERE session_id = ?');
    const deleteRefs = db.prepare('DELETE FROM session_refs WHERE session_id = ?');
    const deleteSearch = db.prepare('DELETE FROM search_index WHERE session_id = ?');
    const insertTurn = db.prepare(
      `INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
       VALUES (@session_id, @turn_index, @user_message, @assistant_response, @timestamp)`
    );
    const insertCheckpoint = db.prepare(
      `INSERT INTO checkpoints (
         session_id, checkpoint_number, title, overview, history, work_done,
         technical_details, important_files, next_steps, created_at
       ) VALUES (
         @session_id, @checkpoint_number, @title, @overview, @history, @work_done,
         @technical_details, @important_files, @next_steps, @created_at
       )`
    );
    const insertFile = db.prepare(
      `INSERT INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at)
       VALUES (@session_id, @file_path, @tool_name, @turn_index, @first_seen_at)`
    );
    const insertRef = db.prepare(
      `INSERT INTO session_refs (session_id, ref_type, ref_value, turn_index, created_at)
       VALUES (@session_id, @ref_type, @ref_value, @turn_index, @created_at)`
    );
    const insertSearch = db.prepare(
      `INSERT INTO search_index (content, session_id, source_type, source_id)
       VALUES (@content, @session_id, @source_type, @source_id)`
    );

    let imported = 0;
    let missing = 0;
    const tx = db.transaction((items) => {
      for (const item of items) {
        if (item?.version !== SESSION_INDEX_VERSION) {
          throw new Error(
            `Unsupported session index version for ${item?.id || 'unknown session'}: ${item?.version}`
          );
        }
        if (!item || item.missing || !item.session) {
          missing++;
          continue;
        }
        upsertSession.run(item.session);
        deleteTurns.run(item.id);
        deleteCheckpoints.run(item.id);
        deleteFiles.run(item.id);
        deleteRefs.run(item.id);
        deleteSearch.run(item.id);
        for (const row of item.turns || []) insertTurn.run({ session_id: item.id, ...row });
        for (const row of item.checkpoints || []) {
          insertCheckpoint.run({ session_id: item.id, ...row });
        }
        for (const row of item.files || []) insertFile.run({ session_id: item.id, ...row });
        for (const row of item.refs || []) insertRef.run({ session_id: item.id, ...row });
        for (const row of item.search || []) insertSearch.run(row);
        imported++;
      }
    });
    tx(payloads);
    return { imported, missing };
  } finally {
    db.close();
  }
}
