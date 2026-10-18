// Run one world for a long time, headless, and keep its history:
//   node scripts/history.mjs <seed> <years> [dt] [resume]
// With "resume" it carries on from the last saved state (written every 25 years), so a long run survives restarts.
// Writes data/history/<seed>/: events.jsonl (everything logged), years.jsonl (one line of numbers per year),
// lives.jsonl (the stories of notable people when they die), state.json (the whole world, every 50 years).
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld } from '../shared/world.js';
import { createSim } from '../server/life/sim.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = +process.argv[2] || 1000 + Math.floor(Math.random() * 9000);
const years = +process.argv[3] || 2000, dt = +process.argv[4] || .1;
const dir = join(ROOT, 'data', 'history', String(seed));
mkdirSync(dir, { recursive: true });
const resume = process.argv.includes('resume') && existsSync(join(dir, 'state.json'));
if (!resume) for (const f of ['events.jsonl', 'years.jsonl', 'lives.jsonl']) writeFileSync(join(dir, f), '');

const world = createWorld(seed);
let evBuf = [], lifeBuf = [];
const sim = createSim(world, {
  event: (type, text, year) => evBuf.push(JSON.stringify({ y: Math.round(year * 10) / 10, type, text })),
  birth: () => {},
  // a life worth remembering: long story, or someone who mattered (followers, kills, inventions, tribute)
  death: p => {
    const st = p.stats || {}, story = p.story || [];
    const mark = story.length + (st.kills || 0) * 2 + (st.tribute || 0) + (p.followPeak || 0) + (st.crafted || 0) * .2;
    if (mark >= 9) lifeBuf.push(JSON.stringify({ name: `${p.name} ${p.sur}`, born: Math.round(p.bornYear), died: Math.round(sim.S.year), age: Math.floor(p.age),
      cause: p.cause, goal: p.goal && p.goal.k, kills: st.kills || 0, tribute: st.tribute || 0, followers: p.followPeak || 0, story }));
  },
  fx: () => {},
});
// the culture shared by all long runs (what peoples learned before, in any world)
const CULTURE = join(ROOT, 'data', 'history', 'culture.json');
if (existsSync(CULTURE)) try { sim.setCulture(JSON.parse(readFileSync(CULTURE, 'utf8'))); } catch { /* half-written: start without */ }
if (resume) sim.restore(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))); else sim.found();

const S = sim.S, t0 = Date.now();
let lastYear = Math.floor(S.year);
if (resume) console.log(`seed ${seed} resumed at year ${lastYear}`);
const flush = () => {
  if (evBuf.length) { appendFileSync(join(dir, 'events.jsonl'), evBuf.join('\n') + '\n'); evBuf = []; }
  if (lifeBuf.length) { appendFileSync(join(dir, 'lives.jsonl'), lifeBuf.join('\n') + '\n'); lifeBuf = []; }
};
while (S.year < years) {
  sim.tick(dt);
  const y = Math.floor(S.year);
  if (y === lastYear) continue;
  lastYear = y;
  const st = sim.stats();
  const ppl = S.people;
  const rulers = ppl.filter(p => p.ruler).length, revenge = ppl.filter(p => p.goal.k === 'revenge').length;
  const avgAge = ppl.length ? ppl.reduce((a, p) => a + p.age, 0) / ppl.length : 0;
  appendFileSync(join(dir, 'years.jsonl'), JSON.stringify({
    y, pop: ppl.length, births: S.births, deaths: S.deaths, killings: S.killings, thefts: S.thefts, gifts: S.gifts, trades: S.trades || 0,
    techs: S.techs.size, animals: S.animals.length, tame: S.animals.filter(a => a.owner).length, buildings: S.structs.filter(s => s.k !== 'grave').length,
    graves: S.structs.filter(s => s.k === 'grave').length, crops: S.crops.length, bands: S.bands.size, faiths: [...S.faiths.values()].filter(f => f.active).length,
    towns: S.towns.length, wars: [...S.hostility.values()].filter(h => h.war).length, rulers, revenge, winter: S.winterSev || 0, avgAge: Math.round(avgAge * 10) / 10,
    leader: st.chief ? st.chief.name : null, sec: Math.round((Date.now() - t0) / 1000),
  }) + '\n');
  flush();
  if (y % 25 === 0 && y > 0) {
    writeFileSync(join(dir, 'state.json'), JSON.stringify(sim.serialize().state));
    const c = sim.culture();
    if (c && c.people >= 8) { writeFileSync(CULTURE, JSON.stringify(c)); sim.setCulture(c); }
  }
  if (y % 25 === 0) console.log(`seed ${seed} · year ${y} · ${ppl.length} alive · ${S.techs.size} techs · ${Math.round((Date.now() - t0) / 1000)}s`);
}
flush();
writeFileSync(join(dir, 'state.json'), JSON.stringify(sim.serialize().state));
console.log(`seed ${seed} done: ${years} years in ${Math.round((Date.now() - t0) / 60000)} min`);
