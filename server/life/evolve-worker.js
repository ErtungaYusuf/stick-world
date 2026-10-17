// Runs whole worlds headless, one at a time, for the tournament in evolve.js.
import { parentPort } from 'node:worker_threads';
import { createWorld } from '../../shared/world.js';
import { createSim } from './sim.js';

const DT = .15;   // the same coarse step the server uses when fast-forwarding

parentPort.on('message', job => {
  const { id, seed, years, ancestors } = job;
  const events = [];
  const sim = createSim(createWorld(seed), {
    event: (type, text, year) => { events.push({ type, text, year }); if (events.length > 4000) events.splice(0, 1000); },
    birth: () => {}, death: () => {}, fx: () => {},
  });
  sim.found({ ancestors });
  const S = sim.S, trace = [];
  let peak = S.people.length, lastReport = 0, nextTrace = 0;
  while (S.year < years && S.people.length) {
    sim.tick(DT);
    if (S.people.length > peak) peak = S.people.length;
    if (S.year >= nextTrace) { trace.push(S.people.length); nextTrace += 5; }
    if (S.year - lastReport >= 1) { lastReport = S.year; parentPort.postMessage({ id, progress: S.year / years }); }
  }
  const st = sim.stats();
  const soc = sim.society();
  // fitness: how many are alive at the end (ties: how far they got, then how many were born)
  const fitness = S.people.length * 1000 + Math.min(S.year, years) * 10 + S.births / 100;
  parentPort.postMessage({
    id, done: true, seed, fitness,
    summary: {
      seed, pop: S.people.length, peak, years: Math.floor(S.year), births: S.births, deaths: S.deaths, killings: st.killings,
      thefts: st.thefts, gifts: st.gifts, buildings: st.buildings, faiths: st.faiths, bands: st.bands, inventions: st.inventions, tame: st.tame,
      purpose: soc.goals[0] ? soc.goals[0].name : null, trace,
    },
    state: sim.serialize().state, heritage: sim.heritage(), events,
  });
});
