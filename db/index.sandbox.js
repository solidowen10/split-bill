// db/index.sandbox.js
// TESTING-ONLY driver using Node's built-in node:sqlite, because this sandbox
// has no internet access to compile better-sqlite3's native bindings.
// Wraps node:sqlite's DatabaseSync to expose the same .prepare().get/.all/.run
// surface that better-sqlite3 provides, so the rest of the app's code is
// identical between sandbox testing and production.
//
// DO NOT DEPLOY THIS FILE. On the real server, db/index.js (better-sqlite3)
// is used instead. See README.md.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'split-bill.sandbox.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
raw.exec(schema);

// Adapter: make node:sqlite's StatementSync look like better-sqlite3's Statement
function wrapStatement(stmt) {
  return {
    get: (...params) => stmt.get(...params),
    all: (...params) => stmt.all(...params),
    run: (...params) => {
      const info = stmt.run(...params);
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    }
  };
}

const db = {
  prepare: (sql) => wrapStatement(raw.prepare(sql)),
  exec: (sql) => raw.exec(sql),
  pragma: () => {}, // no-op shim, better-sqlite3-only call sites guard against this
  transaction: (fn) => {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  }
};

module.exports = db;
