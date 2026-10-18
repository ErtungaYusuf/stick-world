// How expensive is a crowd? node scripts/perf.mjs [people] [seconds]
// Founds a world, then fills it with bands of grown people around many camps (as if centuries had passed)
// and measures the cost of one simulated second.
import { createWorld } from '../shared/world.js';
import { createSim } from '../server/life/sim.js';

const N = +process.argv[2] || 1000, SECS = +process.argv[3] || 30, seed = +process.argv[4] || 453, DT = +process.argv[5] || .1;
const sim = createSim(createWorld(seed), { event: () => {}, birth: () => {}, death: () => {}, fx: () => {} });
sim.found();
const S = sim.S;
if (process.argv.includes('coarse')) S.coarse = true;
for (let i = 0; i < 40; i++) sim.tick(.1);
// clone the founders' minds into new bands spread over the land around the first camp
const src = S.people.slice();
let k = 0;
while (S.people.length < N) {
  const ring = 300 + Math.floor(k / 12) * 160, a = (k % 12) / 12 * Math.PI * 2 + k * .37;
  const cx = S.home.x + Math.cos(a) * ring, cz = S.home.z + Math.sin(a) * ring;
  for (let j = 0; j < 12 && S.people.length < N; j++) {
    const p = sim.x.landAround(cx, cz, 0, 120);
    if (!p) break;
    sim.clonePerson(src[(k * 12 + j) % src.length], p.x, p.z);
  }
  k++;
}
console.log(`${S.people.length} people, ${S.animals.length} animals`);
for (let i = 0; i < 20; i++) sim.tick(.1);   // settle
const t0 = performance.now();
for (let i = 0; i < SECS / DT; i++) sim.tick(DT);
const ms = (performance.now() - t0) / SECS;
console.log(`${ms.toFixed(1)} ms per simulated second (${(ms / S.people.length * 1000).toFixed(1)} µs per person) · alive after: ${S.people.length}`);
