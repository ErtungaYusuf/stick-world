// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld } from '../shared/world.js';
import { createSim } from '../server/sim/village.js';
import { openDb } from '../server/db.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'stickworld-'));
  const db = openDb(join(dir, 'test.db'));
  const world = createWorld(123);
  const sim = createSim(world, {
    event: (type, text, year) => db.insertEvent(year, type, text),
    birth: p => db.insertPerson(p),
    death: p => db.recordDeath(p),
    fx: () => {},
  });
  sim.found();
  return { dir, db, world, sim, cleanup: () => { db.raw.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a village lives for generations without breaking the rules', () => {
  const { db, sim, cleanup } = setup();
  try {
    sim.setTimeScale(40);
    const motherAges = [];
    let badPairs = 0, jobsSeen = new Set();
    for (let i = 0; i < 20 * 60 * 2; i++) {          // 2 minutes of 40× time ≈ 400 years
      sim.tick(1 / 20);
      for (const e of sim.S.people) {
        if (e.task) jobsSeen.add(e.task.type);
        const p = e.partner;
        if (p && (p.sex === e.sex || e.age < 18 || !p.alive || p.partner !== e)) badPairs++;
        if (e.preg > 0 && e.preg > .74) motherAges.push(e.age);
      }
    }
    const st = sim.stats();
    assert.equal(badPairs, 0, 'partners must be living adults of the other sex, mutually linked');
    assert.ok(st.births > 20, `expected births, got ${st.births}`);
    assert.ok(st.deaths > 10, `expected deaths, got ${st.deaths}`);
    assert.ok(st.population > 0 && st.population <= 80, `population ${st.population}`);
    assert.ok(motherAges.every(a => a >= 16 && a <= 47), 'conception only at fertile ages');
    for (const job of ['chop', 'water', 'talk', 'wander']) assert.ok(jobsSeen.has(job), `villagers should ${job}`);
    assert.ok(jobsSeen.has('forage') || jobsSeen.has('fish'), 'villagers should gather food');

    // database keeps everyone who ever lived, with consistent parents
    const everyone = db.listPeople({ aliveOnly: false, limit: 10000, offset: 0 });
    assert.equal(everyone.length, st.births + 14);
    assert.equal(everyone.filter(p => !p.alive).length, st.deaths);
    for (const p of everyone.filter(p => p.mother_id)) {
      const m = db.person(p.mother_id);
      assert.equal(m.sex, 'F', 'mothers are female');
    }
    console.log(`  ${Math.floor(sim.S.year)} years · pop ${st.population} · births ${st.births} · deaths ${st.deaths} · jobs: ${[...jobsSeen].join(', ')}`);
  } finally { cleanup(); }
});

test('the world survives a save / load round trip', () => {
  const { db, world, sim, cleanup } = setup();
  try {
    sim.setTimeScale(40);
    for (let i = 0; i < 20 * 30; i++) sim.tick(1 / 20);
    db.save(sim.serialize());
    const before = sim.stats();
    const couples = sim.S.people.filter(e => e.partner).map(e => [e.id, e.partner.id]);

    const sim2 = createSim(world, { event() {}, birth() {}, death() {}, fx() {} });
    sim2.restore(db.load());
    const after = sim2.stats();
    assert.equal(after.population, before.population);
    assert.equal(after.births, before.births);
    assert.equal(after.year, before.year);
    for (const [a, b] of couples) assert.equal(sim2.S.byId.get(a).partner.id, b, 'marriages restored');
    for (let i = 0; i < 100; i++) sim2.tick(1 / 20);   // and it keeps running
  } finally { cleanup(); }
});
