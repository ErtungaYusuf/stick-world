// REST API. Real-time positions go over the WebSocket; everything else is plain JSON over HTTP.
import { Router } from 'express';
import { lifeStage } from './life/sim.js';

export function createApi(ctx) {
  const api = Router();
  const nameOf = id => { if (id == null) return null; const r = ctx.db.person(id); return r ? { id: r.id, name: `${r.name} ${r.surname}`, alive: !!r.alive } : null; };

  // world seed + constants the client needs to regenerate identical terrain
  api.get('/world', (req, res) => res.json({ seed: ctx.seed, spawn: ctx.sim.S.home || ctx.world.findSpawn() }));

  // full current state (same shape as the WebSocket "state" message)
  api.get('/state', (req, res) => res.json(ctx.sim.snapshot(true)));

  api.get('/stats', (req, res) => res.json(ctx.sim.stats()));

  api.get('/events', (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const type = typeof req.query.type === 'string' && /^[a-z]+$/.test(req.query.type) ? req.query.type : null;
    res.json(ctx.db.recentEvents(limit, type));
  });

  api.get('/people', (req, res) => {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100), offset = parseInt(req.query.offset, 10) || 0;
    const aliveOnly = req.query.alive !== '0';
    if (typeof req.query.q === 'string' && req.query.q.trim()) return res.json(ctx.db.searchPeople({ q: req.query.q.trim().slice(0, 40), aliveOnly, limit }));
    res.json(ctx.db.listPeople({ aliveOnly, limit, offset }));
  });

  // a person's record: history from the database, and (while alive) what is going on in their head
  api.get('/people/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const r = ctx.db.person(id);
    if (!r) return res.status(404).json({ error: 'not found' });
    const live = ctx.sim.live(id);
    res.json({
      id: r.id, name: `${r.name} ${r.surname}`, sex: r.sex === 'M' ? 'Male' : 'Female', alive: !!live,
      age: live ? live.age : Math.floor(r.age), stage: live ? live.stage : lifeStage(r.age),
      diedYear: r.died_year != null ? Math.floor(r.died_year) : null, cause: r.cause,
      mother: nameOf(r.mother_id), father: nameOf(r.father_id),
      children: ctx.db.childrenOf(id).map(c => ({ id: c.id, name: `${c.name} ${c.surname}`, alive: !!c.alive })),
      founder: r.mother_id == null && r.father_id == null,
      ...(live || { role: r.role, kills: r.kills }),
    });
  });

  // what someone is weighing up right now: their options, best first, with the value they give each
  api.get('/people/:id/why', (req, res) => {
    const options = ctx.sim.explain(parseInt(req.params.id, 10));
    if (!options) return res.status(404).json({ error: 'not alive' });
    res.json(options);
  });

  // stumps and saplings of felled trees (clients refetch when the snapshot's felledVer changes)
  api.get('/felled', (req, res) => res.json(ctx.sim.felled()));

  // what emerged: bands, faiths, knowledge, purposes, roles, plagues, wars, settlements
  api.get('/society', (req, res) => res.json(ctx.sim.society()));
  api.get('/settlements', (req, res) => res.json(ctx.sim.settlements()));
  // who owns, steals, gives, leads and kills
  api.get('/economy', (req, res) => res.json(ctx.sim.economy()));

  // whole-game speed: simulated seconds per real second (0 = paused)
  api.post('/speed', (req, res) => {
    const speed = Number(req.body && req.body.speed);
    if (!Number.isFinite(speed) || speed < 0 || speed > 200) return res.status(400).json({ error: 'speed must be between 0 and 200' });
    ctx.sim.setSpeed(speed);
    res.json({ speed: ctx.sim.S.speed });
  });

  // reproduction: fertility multiplies the chance that lovemaking leads to a child (0–20);
  // capacity is only a safety limit for the computer, above it conception becomes rare
  api.post('/fertility', (req, res) => {
    const f = Number(req.body && req.body.fertility);
    if (!Number.isFinite(f) || f < 0 || f > 20) return res.status(400).json({ error: 'fertility must be between 0 and 20' });
    ctx.sim.setFertility(f);
    res.json({ fertility: ctx.sim.S.fertility });
  });
  api.post('/capacity', (req, res) => {
    const c = Number(req.body && req.body.capacity);
    if (!Number.isFinite(c) || c < 10 || c > 2000) return res.status(400).json({ error: 'capacity must be between 10 and 2000' });
    ctx.sim.setCapacity(c);
    res.json({ capacity: ctx.sim.S.cap });
  });

  // ageing speed only: people grow older this many times faster than the seasons turn (1–40)
  api.post('/time', (req, res) => {
    const scale = Number(req.body && req.body.scale);
    if (!Number.isFinite(scale)) return res.status(400).json({ error: 'scale must be a number' });
    ctx.sim.setTimeScale(scale);
    res.json({ timeScale: ctx.sim.S.timeScale });
  });

  // natural selection between worlds: run many in parallel, keep the one with the most people alive
  api.get('/evolve', (req, res) => res.json(ctx.evolution.status));
  api.post('/evolve', (req, res) => {
    const b = req.body || {};
    const worlds = Math.round(Number(b.worlds ?? 100)), years = Number(b.years ?? 25), rounds = Math.round(Number(b.rounds ?? 1));
    if (!(worlds >= 2 && worlds <= 500) || !(years >= 1 && years <= 300) || !(rounds >= 1 && rounds <= 20)) return res.status(400).json({ error: 'worlds 2–500, years 1–300, rounds 1–20' });
    if (ctx.evolution.status.running) return res.status(409).json({ error: 'an evolution is already running' });
    ctx.evolve({ worlds, years, rounds });
    res.json({ started: true, worlds, years, rounds });
  });
  api.post('/evolve/cancel', (req, res) => { ctx.evolution.cancel(); res.json({ cancelled: true }); });

  // wipe the database and start a new world with a new seed
  api.post('/reset', (req, res) => { ctx.reset(); res.json({ seed: ctx.seed }); });

  return api;
}
