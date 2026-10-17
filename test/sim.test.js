// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld } from '../shared/world.js';
import { createSim } from '../server/life/sim.js';
import { openDb } from '../server/db.js';
import { findPath } from '../server/life/util.js';

function setup(seed = 123) {
  const dir = mkdtempSync(join(tmpdir(), 'stickworld-'));
  const db = openDb(join(dir, 'test.db'));
  const world = createWorld(seed);
  const events = [];
  const sim = createSim(world, {
    event: (type, text, year) => { events.push({ type, text }); db.insertEvent(year, type, text); },
    birth: p => db.insertPerson(p),
    death: p => db.recordDeath(p),
    fx: () => {},
  });
  sim.found();
  return { dir, db, world, sim, events, cleanup: () => { db.raw.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const finite = o => Object.values(o).every(v => typeof v !== 'number' || Number.isFinite(v));

test('three bands are founded, live a year, and learn from what happens to them', () => {
  const { sim, cleanup } = setup();
  try {
    const S = sim.S;
    assert.ok(S.people.length >= 24, 'at least two bands of twelve');
    const seen = new Set();
    let badPairs = 0;
    while (S.year < 1) {
      sim.tick(.1);
      for (const e of S.people) {
        const T = e.task;
        if (!T) continue;
        seen.add(T.A.id);
        // lovemaking needs two consenting adults of opposite sex who are not close kin
        if (T.A.id === 'mate' && T.stage === 'do' && (T.tgt.sex === e.sex || T.tgt.age < 16 || e.age < 16)) badPairs++;
        assert.ok(finite({ x: e.x, z: e.z, food: e.food, water: e.water, health: e.health }), `${e.name} has a broken state`);
      }
    }
    assert.ok(S.people.length > 0, 'someone survives the first year');
    assert.equal(badPairs, 0);
    for (const a of ['drink', 'eat', 'pick', 'sleep', 'talk']) assert.ok(seen.has(a), `somebody did "${a}"`);
    // whoever has drunk a few times expects drinking to quench thirst
    const drinker = S.people.find(p => (p.M.get('drink:river') || { n: 0 }).n > 4);
    assert.ok(drinker, 'someone drank from the river several times');
    assert.ok(drinker.M.get('drink:river').d[1] > .2, 'and learned that it quenches thirst');
    const st = sim.stats();
    assert.ok(finite(st));
  } finally { cleanup(); }
});

test('the API views describe minds and society without crashing', () => {
  const { sim, cleanup } = setup(7);
  try {
    while (sim.S.year < .3) sim.tick(.1);
    const p = sim.S.people[0];
    const live = sim.live(p.id);
    assert.ok(live.goal && live.mood && Array.isArray(live.beliefs));
    assert.ok(sim.explain(p.id).length > 0);
    const soc = sim.society();
    assert.ok(Array.isArray(soc.bands) && Array.isArray(soc.goals));
    assert.ok(sim.economy().richest);
    const snap = sim.snapshot(true);
    assert.equal(snap.people.length, sim.S.people.length);
    assert.ok(Array.isArray(snap.animals) && snap.animals.length > 0);
    JSON.stringify(snap);
  } finally { cleanup(); }
});

test('the world survives a save / load round trip, minds included', () => {
  const { db, world, sim, cleanup } = setup(42);
  try {
    while (sim.S.year < .4) sim.tick(.1);
    db.save(sim.serialize());
    const saved = db.load();
    const again = createSim(world, { event: () => {}, birth: () => {}, death: () => {}, fx: () => {} });
    again.restore(saved);
    assert.equal(again.S.people.length, sim.S.people.length);
    const a = sim.S.people[0], b = again.S.byId.get(a.id);
    assert.equal(b.name, a.name);
    assert.equal(b.M.size, a.M.size, 'what they learned survives');
    assert.deepEqual([...b.W.keys()].sort(), [...a.W.keys()].sort(), 'and how they feel about things');
    for (let i = 0; i < 200; i++) again.tick(.1);   // and the restored world keeps running
    assert.ok(again.S.time > sim.S.time);
  } finally { cleanup(); }
});

test('people can find a way around water', () => {
  // a lake between start and goal: a disc of water centred at the origin
  const blocked = (x, z) => Math.hypot(x, z) < 100;
  const path = findPath(blocked, -150, 0, 150, 0);
  assert.ok(path && path.length > 2);
  for (const p of path) assert.ok(!blocked(p.x, p.z));
  assert.equal(findPath((x, z) => Math.abs(x) < 30, -200, 0, 200, 0), null, 'no way across an endless river');
});
