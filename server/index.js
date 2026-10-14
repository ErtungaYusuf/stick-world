// Stick World server: static frontend + REST API + WebSocket + simulation loop + SQLite.
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createWorld } from '../shared/world.js';
import { createSim } from './sim/village.js';
import { openDb } from './db.js';
import { createApi } from './api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5178;
const TICK = 1 / 20;            // simulation step (s)
const BROADCAST_EVERY = 2;      // ticks between state messages (10 Hz)
const SAVE_EVERY = 5;           // seconds between database snapshots

const db = openDb(process.env.DB_FILE || join(ROOT, 'data', 'world.db'));
const ctx = { db, seed: 0, world: null, sim: null, reset: null };

function boot(fresh) {
  if (fresh) db.reset();
  let seed = db.getMeta('seed');
  if (seed === undefined) { seed = Math.floor(Math.random() * 900) + 10; db.setMeta('seed', seed); }
  const world = createWorld(seed);
  const sim = createSim(world, {
    event: (type, text, year) => db.insertEvent(year, type, text),
    birth: p => db.insertPerson(p),
    death: p => db.recordDeath(p),
    fx: msg => broadcast({ t: 'fx', ...msg }),
  });
  const saved = db.load();
  if (saved) sim.restore(saved); else { sim.found(); db.save(sim.serialize()); }
  Object.assign(ctx, { seed, world, sim });
  console.log(saved ? `Resumed world ${seed} at year ${Math.floor(sim.S.year)} with ${sim.S.people.length} villagers`
    : `Founded new world ${seed}`);
}
ctx.reset = () => { boot(true); broadcast({ t: 'reset' }); };

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
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'player' && [m.x, m.z, m.h, m.y, m.vx, m.vz].every(Number.isFinite)) {
      ctx.sim.setPlayer(id, { x: m.x, z: m.z, h: m.h, y: m.y, vx: m.vx, vz: m.vz });
    }
  });
  ws.on('close', () => ctx.sim.removePlayer(id));
});

boot(false);

// fixed-step loop; the world only advances while someone is watching
let ticks = 0, sinceSave = 0;
setInterval(() => {
  if (!wss.clients.size) return;
  ctx.sim.tick(TICK);
  if (++ticks % BROADCAST_EVERY === 0) {
    const snap = ctx.sim.snapshot();
    snap.players = [...ctx.sim.S.players.entries()].map(([pid, p]) => ({ id: pid, ...p }));
    broadcast(snap);
  }
  if ((sinceSave += TICK) >= SAVE_EVERY) { sinceSave = 0; db.save(ctx.sim.serialize()); }
}, TICK * 1000);

function shutdown() { try { db.save(ctx.sim.serialize()); } finally { process.exit(0); } }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Stick World running at http://localhost:${PORT}`));
