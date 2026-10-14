// SQLite persistence (Node's built-in node:sqlite, no native build needed).
// Living villagers are snapshotted periodically; births, deaths and events are written immediately,
// so the database also keeps the full family history of everyone who ever lived.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  surname         TEXT    NOT NULL,
  sex             TEXT    NOT NULL CHECK (sex IN ('M', 'F')),
  born_year       REAL    NOT NULL,
  died_year       REAL,
  age             REAL    NOT NULL,
  alive           INTEGER NOT NULL DEFAULT 1,
  x REAL, z REAL, heading REAL,
  hue             REAL    NOT NULL,
  tall            REAL    NOT NULL,
  mother_id       INTEGER REFERENCES people(id),
  father_id       INTEGER REFERENCES people(id),
  partner_id      INTEGER,
  preg            REAL    NOT NULL DEFAULT 0,
  preg_father     TEXT,             -- JSON snapshot of the father at conception
  last_birth      REAL    NOT NULL DEFAULT -99,
  children        INTEGER NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS graves (
  person_id INTEGER PRIMARY KEY REFERENCES people(id),
  x REAL NOT NULL, z REAL NOT NULL, year REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS village (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  x REAL NOT NULL, z REAL NOT NULL,
  food REAL NOT NULL, wood REAL NOT NULL, water REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS picked_bushes (
  obj_id    TEXT PRIMARY KEY,
  regrow_at REAL NOT NULL
);
`;

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const q = {
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    upsertPerson: db.prepare(`
      INSERT INTO people (id, name, surname, sex, born_year, age, alive, x, z, heading, hue, tall,
                          mother_id, father_id, partner_id, preg, preg_father, last_birth, children)
      VALUES (:id, :name, :surname, :sex, :born_year, :age, 1, :x, :z, :heading, :hue, :tall,
              :mother_id, :father_id, :partner_id, :preg, :preg_father, :last_birth, :children)
      ON CONFLICT(id) DO UPDATE SET
        age = excluded.age, x = excluded.x, z = excluded.z, heading = excluded.heading,
        partner_id = excluded.partner_id, preg = excluded.preg, preg_father = excluded.preg_father,
        last_birth = excluded.last_birth, children = excluded.children`),
    markDead: db.prepare('UPDATE people SET alive = 0, died_year = :year, age = :age, x = :x, z = :z, partner_id = NULL WHERE id = :id'),
    addGrave: db.prepare('INSERT OR REPLACE INTO graves (person_id, x, z, year) VALUES (?, ?, ?, ?)'),
    pruneGraves: db.prepare('DELETE FROM graves WHERE year < ?'),
    graves: db.prepare('SELECT person_id AS id, x, z, year FROM graves'),
    insertEvent: db.prepare('INSERT INTO events (year, type, text) VALUES (?, ?, ?)'),
    recentEvents: db.prepare('SELECT id, year, type, text, created_at FROM events ORDER BY id DESC LIMIT ?'),
    person: db.prepare('SELECT * FROM people WHERE id = ?'),
    children: db.prepare('SELECT id, name, surname, alive FROM people WHERE mother_id = ? OR father_id = ? ORDER BY born_year'),
    alivePeople: db.prepare('SELECT * FROM people WHERE alive = 1'),
    listPeople: db.prepare('SELECT id, name, surname, sex, born_year, died_year, age, alive, mother_id, father_id FROM people WHERE alive >= ? ORDER BY id LIMIT ? OFFSET ?'),
    saveVillage: db.prepare('INSERT INTO village (id, x, z, food, wood, water) VALUES (1, :x, :z, :food, :wood, :water) ON CONFLICT(id) DO UPDATE SET food = excluded.food, wood = excluded.wood, water = excluded.water'),
    village: db.prepare('SELECT x, z, food, wood, water FROM village WHERE id = 1'),
    clearPicked: db.prepare('DELETE FROM picked_bushes'),
    addPicked: db.prepare('INSERT INTO picked_bushes (obj_id, regrow_at) VALUES (?, ?)'),
    picked: db.prepare('SELECT obj_id AS id, regrow_at AS regrow FROM picked_bushes'),
  };

  const tx = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const personRow = e => ({
    id: e.id, name: e.name, surname: e.sur, sex: e.sex, born_year: e.bornYear, age: e.age,
    x: e.x, z: e.z, heading: e.heading, hue: e.hue, tall: e.tall,
    mother_id: e.motherId ?? null, father_id: e.fatherId ?? null, partner_id: e.partner ? e.partner.id : null,
    preg: e.preg, preg_father: e.pregFather ? JSON.stringify(e.pregFather) : null,
    last_birth: e.lastBirth, children: e.children,
  });

  return {
    raw: db,
    getMeta: k => { const r = q.getMeta.get(k); return r ? JSON.parse(r.value) : undefined; },
    setMeta: (k, v) => q.setMeta.run(k, JSON.stringify(v)),
    insertPerson: e => q.upsertPerson.run(personRow(e)),
    recordDeath: e => tx(() => {
      q.upsertPerson.run(personRow(e));
      q.markDead.run({ id: e.id, year: e.bornYear + e.age, age: e.age, x: e.x, z: e.z });
      q.addGrave.run(e.id, e.x, e.z, e.bornYear + e.age);
    }),
    insertEvent: (year, type, text) => q.insertEvent.run(year, type, text),
    recentEvents: limit => q.recentEvents.all(limit),
    person: id => q.person.get(id),
    childrenOf: id => q.children.all(id, id),
    listPeople: ({ aliveOnly, limit, offset }) => q.listPeople.all(aliveOnly ? 1 : 0, limit, offset),

    // full periodic save of the running simulation
    save(state) {
      tx(() => {
        for (const [k, v] of Object.entries(state.meta)) q.setMeta.run(k, JSON.stringify(v));
        if (state.village) q.saveVillage.run(state.village);
        for (const e of state.people) q.upsertPerson.run(personRow(e));
        q.clearPicked.run();
        for (const p of state.picked) q.addPicked.run(p.id, p.regrow);
        q.pruneGraves.run(state.meta.year - 8);
      });
    },
    // everything needed to resume the simulation, or null for a brand new world
    load() {
      const village = q.village.get();
      if (!village) return null;
      const meta = {};
      for (const k of ['time', 'dayT', 'year', 'nextId', 'births', 'deaths']) meta[k] = this.getMeta(k);
      const people = q.alivePeople.all().map(r => ({
        id: r.id, name: r.name, sur: r.surname, sex: r.sex, bornYear: r.born_year, age: r.age,
        x: r.x, z: r.z, heading: r.heading, hue: r.hue, tall: r.tall,
        motherId: r.mother_id, fatherId: r.father_id, partnerId: r.partner_id,
        preg: r.preg, pregFather: r.preg_father ? JSON.parse(r.preg_father) : null,
        lastBirth: r.last_birth, children: r.children,
      }));
      return { meta, village, people, picked: q.picked.all(), graves: q.graves.all() };
    },
    reset() {
      db.exec('DELETE FROM graves; DELETE FROM picked_bushes; DELETE FROM events; DELETE FROM people; DELETE FROM village; DELETE FROM meta;');
    },
  };
}
