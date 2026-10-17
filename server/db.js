// SQLite persistence (Node's built-in node:sqlite, no native build needed).
// Everyone who ever lived gets a row (the family history and how they died); events are an append-only chronicle;
// the full state of the running world (minds included) is one JSON document saved periodically.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;   -- with WAL this is crash-safe for the database file and avoids an fsync per write
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  surname    TEXT    NOT NULL,
  sex        TEXT    NOT NULL CHECK (sex IN ('M', 'F')),
  born_year  REAL    NOT NULL,
  died_year  REAL,
  age        REAL    NOT NULL,
  alive      INTEGER NOT NULL DEFAULT 1,
  mother_id  INTEGER,
  father_id  INTEGER,
  hue        REAL,
  tall       REAL,
  goal       TEXT,
  role       TEXT,
  kills      INTEGER NOT NULL DEFAULT 0,
  cause      TEXT
);
CREATE INDEX IF NOT EXISTS people_alive  ON people(alive);
CREATE INDEX IF NOT EXISTS people_mother ON people(mother_id);
CREATE INDEX IF NOT EXISTS people_father ON people(father_id);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  year       REAL NOT NULL,
  type       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_type ON events(type);
`;

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const q = {
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    upsertPerson: db.prepare(`
      INSERT INTO people (id, name, surname, sex, born_year, age, alive, mother_id, father_id, hue, tall, goal, role, kills)
      VALUES (:id, :name, :surname, :sex, :born_year, :age, 1, :mother_id, :father_id, :hue, :tall, :goal, :role, :kills)
      ON CONFLICT(id) DO UPDATE SET age = excluded.age, goal = excluded.goal, role = excluded.role, kills = excluded.kills`),
    markDead: db.prepare('UPDATE people SET alive = 0, died_year = :year, age = :age, cause = :cause WHERE id = :id'),
    insertEvent: db.prepare('INSERT INTO events (year, type, text) VALUES (?, ?, ?)'),
    recentEvents: db.prepare('SELECT id, year, type, text, created_at FROM events ORDER BY id DESC LIMIT ?'),
    recentEventsOfType: db.prepare('SELECT id, year, type, text, created_at FROM events WHERE type = ? ORDER BY id DESC LIMIT ?'),
    person: db.prepare('SELECT * FROM people WHERE id = ?'),
    children: db.prepare('SELECT id, name, surname, alive FROM people WHERE mother_id = ? OR father_id = ? ORDER BY born_year'),
    listPeople: db.prepare('SELECT id, name, surname, sex, born_year, died_year, age, alive, mother_id, father_id, goal, role, cause FROM people WHERE alive >= ? ORDER BY id LIMIT ? OFFSET ?'),
    searchPeople: db.prepare("SELECT id, name, surname, sex, born_year, died_year, age, alive FROM people WHERE alive >= ? AND (name || ' ' || surname) LIKE ? ORDER BY alive DESC, id DESC LIMIT ?"),
  };

  const tx = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const personRow = e => ({
    id: e.id, name: e.name, surname: e.sur, sex: e.sex, born_year: e.bornYear, age: e.age,
    mother_id: e.motherId ?? null, father_id: e.fatherId ?? null, hue: e.hue, tall: e.tall,
    goal: e.goal ? e.goal.k : null, role: e.role || null, kills: e.stats ? e.stats.kills : 0,
  });
  const dead = e => {
    q.upsertPerson.run(personRow(e));
    q.markDead.run({ id: e.id, year: e.bornYear + e.age, age: e.age, cause: e.cause || null });
  };

  return {
    raw: db,
    getMeta: k => { const r = q.getMeta.get(k); return r ? JSON.parse(r.value) : undefined; },
    setMeta: (k, v) => q.setMeta.run(k, JSON.stringify(v)),
    insertPerson: e => q.upsertPerson.run(personRow(e)),
    recordDeath: e => tx(() => dead(e)),
    insertEvent: (year, type, text) => q.insertEvent.run(year, type, text),
    // a batch of queued births / deaths / events in one transaction (see server/index.js)
    flush(ops) {
      if (!ops.length) return;
      tx(() => {
        for (const o of ops) {
          if (o.kind === 'event') q.insertEvent.run(o.year, o.type, o.text);
          else if (o.kind === 'birth') q.upsertPerson.run(personRow(o.p));
          else if (o.kind === 'death') dead(o.p);
        }
      });
    },
    recentEvents: (limit, type) => type ? q.recentEventsOfType.all(type, limit) : q.recentEvents.all(limit),
    person: id => q.person.get(id),
    childrenOf: id => q.children.all(id, id),
    listPeople: ({ aliveOnly, limit, offset }) => q.listPeople.all(aliveOnly ? 1 : 0, limit, offset),
    searchPeople: ({ q: text, aliveOnly, limit }) => q.searchPeople.all(aliveOnly ? 1 : 0, `%${text}%`, limit),

    // full periodic save of the running world
    save(snap) {
      tx(() => {
        q.setMeta.run('life', JSON.stringify(snap.state));
        for (const e of snap.people) q.upsertPerson.run(personRow(e));
      });
    },
    // the saved world, or null for a brand new one
    load() { const r = q.getMeta.get('life'); return r ? JSON.parse(r.value) : null; },
    reset() { db.exec('DELETE FROM events; DELETE FROM people; DELETE FROM meta;'); },
  };
}
