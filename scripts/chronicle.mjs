// Condense the long runs in data/history/ into one summary for a report:
//   node scripts/chronicle.mjs [out.json]
// Per world: a population / technology curve (every few years), the great events (revolts, rulers, wars, great
// winters, arrivals, inventions, faiths…) and the most remarkable lives.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = join(ROOT, 'data', 'history');
const out = process.argv[2] || join(H, 'summary.json');
const lines = f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

// what makes history: the kinds of events kept in full, and those kept only the first few times
const GREAT = new Set(['revolt', 'war', 'arrival', 'winter', 'religion', 'leader', 'culture', 'settle', 'band', 'explosion', 'evolution']);
const FIRSTS = new Set(['invention', 'discovery', 'farming', 'herding', 'trade', 'cannibal', 'burial', 'healer', 'build', 'love', 'hunt', 'fire']);
const worlds = [];
for (const seed of readdirSync(H).filter(d => /^\d+$/.test(d))) {
  const years = lines(join(H, seed, 'years.jsonl'));
  if (!years.length) continue;
  const events = lines(join(H, seed, 'events.jsonl'));
  const lives = lines(join(H, seed, 'lives.jsonl'));
  const step = Math.max(1, Math.ceil(years.length / 400));
  const curve = years.filter((y, i) => i % step === 0 || i === years.length - 1).map(y => ({ y: y.y, pop: y.pop, techs: y.techs, animals: y.animals, buildings: y.buildings, killings: y.killings, rulers: y.rulers, wars: y.wars, faiths: y.faiths, bands: y.bands, trades: y.trades }));
  const seen = new Map(), great = [];
  for (const e of events) {
    if (GREAT.has(e.type) || (e.type === 'purpose' && /revenge|rule/.test(e.text)) || (e.type === 'killing' && /revenge|overthrown/.test(e.text))) great.push(e);
    else if (FIRSTS.has(e.type)) { const n = seen.get(e.type) || 0; if (n < 6) great.push(e); seen.set(e.type, n + 1); }
  }
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  const last = years[years.length - 1];
  const peak = years.reduce((a, y) => y.pop > a.pop ? y : a, years[0]);
  const extinctions = years.filter((y, i) => i && y.pop === 0 && years[i - 1].pop > 0).length;
  lives.sort((a, b) => (b.story.length + b.kills * 2 + b.tribute + b.followers) - (a.story.length + a.kills * 2 + a.tribute + a.followers));
  worlds.push({
    seed: +seed, years: last.y, now: last, peak: { y: peak.y, pop: peak.pop }, extinctions, counts, curve,
    events: great.slice(-1500), lives: lives.slice(0, 40),
  });
}
writeFileSync(out, JSON.stringify({ made: new Date().toISOString(), worlds }));
console.log(`summary of ${worlds.length} worlds → ${out} (${worlds.map(w => `${w.seed}: year ${w.years}, ${w.now.pop} alive`).join(' · ')})`);
