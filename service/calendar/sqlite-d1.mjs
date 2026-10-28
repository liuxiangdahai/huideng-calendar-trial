import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// A real SQLite-backed subset of D1's binding, used by local preview and tests.
// Production uses Cloudflare's DB binding directly, not this Node-only adapter.
export class SQLiteD1 {
  constructor(path) {
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    const existing = this.database.prepare("SELECT name FROM sqlite_master WHERE name = 'subscriptions'").get();
    if (!existing) this.database.exec(readFileSync(new URL('./migrations/0001_subscriptions.sql', import.meta.url), 'utf8'));
    // Older local databases already contain subscriptions. Apply each additive
    // migration independently so reopening never silently omits newer tables.
    const snapshots = this.database.prepare("SELECT name FROM sqlite_master WHERE name = 'feed_snapshots'").get();
    if (!snapshots) this.database.exec(readFileSync(new URL('./migrations/0002_feed_snapshots.sql', import.meta.url), 'utf8'));
    const creationKey = this.database.prepare('PRAGMA table_info(subscriptions)').all()
      .some(column => column.name === 'creation_key_hash');
    if (!creationKey) this.database.exec(readFileSync(new URL('./migrations/0003_creation_idempotency.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) { return new Statement(this, sql, []); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  async exec(sql) { this.database.exec(sql); return {count: 1, duration: 0}; }
  close() { this.database.close(); }
}
class Statement {
  constructor(db, sql, params) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async first(column) {
    const row = this.db.database.prepare(this.sql).get(...this.params);
    return column ? row?.[column] ?? null : row ? {...row} : null;
  }
  execute() {
    const result = this.db.database.prepare(this.sql).run(...this.params);
    return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}, results: []};
  }
  async run() { return this.execute(); }
  async all() {
    return {success: true, results: this.db.database.prepare(this.sql).all(...this.params).map(row => ({...row})), meta: {changes: 0}};
  }
}
