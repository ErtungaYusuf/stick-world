// Stick World server: static frontend + REST API + WebSocket + simulation loop + SQLite.
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createWorld } from '../shared/world.js';
import { createSim } from './life/sim.js';
import { createEvolution } from './life/evolve.js';
import { openDb } from './db.js';
import { createApi } from './api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5178;
const TICK = 1 / 20;            // simulation step (s)
const BROADCAST_EVERY = 2;      // ticks between state messages (10 Hz)
const FULL_EVERY = 20;          // every 2 s the snapshot also carries slow-changing lists
const SAVE_EVERY = 20;          // seconds between full saves of the world

const db = openDb(process.env.DB_FILE || join(ROOT, 'data', 'life.db'));
let writes = [];
const flushWrites = () => { const w = writes; writes = []; db.flush(w); };
setInterval(flushWrites, 1000);
const ctx = { db, seed: 0, world: null, sim: null, reset: null };

function boot(fresh) {
  if (fresh) { writes = []; db.reset(); }
  let seed = db.getMeta('seed');
  if (seed === undefined) { seed = Math.floor(Math.random() * 900) + 10; db.setMeta('seed', seed); }
  const world = createWorld(seed);
  // database writes are queued and flushed once a second in a single transaction (no disk sync per event)
  const sim = createSim(world, {
    event: (type, text, year) => writes.push({ kind: 'event', type, text, year }),
    birth: p => writes.push({ kind: 'birth', p: { ...p, stats: { ...p.stats }, goal: { ...p.goal } } }),
    death: p => writes.push({ kind: 'death', p: { ...p, stats: { ...p.stats }, goal: { ...p.goal } } }),
    fx: msg => broadcast({ t: 'fx', ...msg }),
  });
  const saved = db.load();
  if (saved) sim.restore(saved); else { sim.found(); flushWrites(); db.save(sim.serialize()); }
  Object.assign(ctx, { seed, world, sim });
  console.log(saved ? `Resumed world ${seed} in year ${Math.floor(sim.S.year)} with ${sim.S.people.length} people`
    : `Founded new world ${seed}`);
}
ctx.reset = () => { boot(true); broadcast({ t: 'reset' }); };

// Many worlds at once in worker threads; the one with the most people alive at the end replaces the live world.
ctx.evolution = createEvolution();
ctx.evolve = opts => ctx.evolution.start(opts, winner => {
  writes = [];
  db.reset();
  db.setMeta('seed', winner.seed);
  db.save({ state: winner.state, people: [] });
  const s = winner.summary, h = ctx.evolution.status.history;
  db.flush([...winner.events.map(e => ({ kind: 'event', ...e })), {
    kind: 'event', type: 'evolution', year: winner.state.time / 360,
    text: `🧬 This world outlived ${ctx.evolution.status.total - 1} others${h.length > 1 ? ` over ${h.length} generations of worlds` : ''}: ${s.pop} alive after ${s.years} years`,
  }]);
  boot(false);
  ctx.sim.setSpeed(1);
  db.save(ctx.sim.serialize());   // a database row for everyone alive
  broadcast({ t: 'reset' });
});

const app = express();
app.use(express.json());
app.use('/api', createApi(ctx));
app.use('/shared', express.static(join(ROOT, 'shared')));
app.use(express.static(join(ROOT, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
let nextClient = 1;
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}
wss.on('connection', ws => {
  const id = nextClient++;
  ws.send(JSON.stringify({ t: 'hello', id, seed: ctx.seed }));
  // each browser keeps a token: the same stranger (belongings, recipe book) comes back after a reload
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && typeof m.token === 'string' && m.token.length >= 8) { ws.token = m.token.slice(0, 64); ctx.sim.join(ws.token, typeof m.name === 'string' ? m.name : null); return; }
    if (!ws.token) return;
    if (m.t === 'player' && [m.x, m.z, m.h, m.y, m.vx, m.vz].every(Number.isFinite)) ctx.sim.move(ws.token, { x: m.x, z: m.z, h: m.h, y: m.y, vx: m.vx, vz: m.vz });
    else if (m.t === 'act') ctx.sim.act(ws.token, m);
  });
  ws.on('close', () => { if (ws.token && ![...wss.clients].some(c => c !== ws && c.token === ws.token)) ctx.sim.leave(ws.token); });
});

boot(false);

// fixed-step loop; the world only advances while someone is watching.
// Game speed = simulated seconds per real second. Above ×20 the steps get coarser (up to 3× longer)
// so that ×100 costs about as much CPU as ×35; if the machine still can't keep up it drops the backlog.
let ticks = 0, sinceSave = 0, pending = 0;
setInterval(() => {
  if (!wss.clients.size) return;
  const speed = ctx.sim.S.speed, start = performance.now();
  const k = speed > 20 ? Math.min(3, Math.ceil(speed / 20)) : 1;
  pending = Math.min(pending + speed / k, Math.max(10, speed / k));
  while (pending >= 1 && performance.now() - start < TICK * 1000 * .8) { ctx.sim.tick(TICK * k); pending -= 1; }
  if (pending >= 1) pending = Math.min(pending, speed / k);
  if (++ticks % BROADCAST_EVERY === 0) {
    const snap = ctx.sim.snapshot(ticks % FULL_EVERY === 0);
    snap.players = ctx.sim.others();
    broadcast(snap);
    for (const c of wss.clients) if (c.readyState === 1 && c.token) { const v = ctx.sim.view(c.token, c.me || (c.me = {})); if (v) c.send(JSON.stringify(v)); }
  }
  if ((sinceSave += TICK) >= SAVE_EVERY) { sinceSave = 0; flushWrites(); db.save(ctx.sim.serialize()); }
}, TICK * 1000);

function shutdown() { try { flushWrites(); db.save(ctx.sim.serialize()); } finally { process.exit(0); } }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Stick World running at http://localhost:${PORT}`));
