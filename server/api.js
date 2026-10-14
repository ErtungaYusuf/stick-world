// REST API. Real-time positions go over the WebSocket; everything else is plain JSON over HTTP.
import { Router } from 'express';
import { lifeStage } from './sim/village.js';

export function createApi(ctx) {
  const api = Router();
  const nameOf = id => { if (id == null) return null; const r = ctx.db.person(id); return r ? { id: r.id, name: `${r.name} ${r.surname}`, alive: !!r.alive } : null; };

  // world seed + constants the client needs to regenerate identical terrain
  api.get('/world', (req, res) => res.json({ seed: ctx.seed, spawn: ctx.world.findSpawn() }));

  // full current state (same shape as the WebSocket "state" message)
  api.get('/state', (req, res) => res.json(ctx.sim.snapshot()));

  api.get('/stats', (req, res) => res.json(ctx.sim.stats()));

  api.get('/events', (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    res.json(ctx.db.recentEvents(limit));
  });

  api.get('/people', (req, res) => {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100), offset = parseInt(req.query.offset, 10) || 0;
    res.json(ctx.db.listPeople({ aliveOnly: req.query.alive !== '0', limit, offset }));
  });

  // a person's full record: database history merged with what they are doing right now
  api.get('/people/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const r = ctx.db.person(id);
    if (!r) return res.status(404).json({ error: 'not found' });
    const live = ctx.sim.live(id);
    res.json({
      id: r.id, name: `${r.name} ${r.surname}`, sex: r.sex === 'M' ? 'Male' : 'Female',
      alive: !!live, age: live ? live.age : Math.floor(r.age), stage: live ? live.stage : lifeStage(r.age),
      doing: live ? live.doing : null, diedYear: r.died_year != null ? Math.floor(r.died_year) : null,
      spouse: live ? live.spouse : null, courting: live ? live.courting : null,
      pregnantMonth: live ? live.pregnantMonth : null,
      mother: nameOf(r.mother_id), father: nameOf(r.father_id),
      children: ctx.db.childrenOf(id).map(c => ({ id: c.id, name: `${c.name} ${c.surname}`, alive: !!c.alive })),
      founder: r.mother_id == null && r.father_id == null,
    });
  });

  // 1 = normal speed, 40 = fast-forward (shared by everyone connected)
  api.post('/time', (req, res) => {
    const scale = Number(req.body && req.body.scale);
    if (!Number.isFinite(scale)) return res.status(400).json({ error: 'scale must be a number' });
    ctx.sim.setTimeScale(scale);
    res.json({ timeScale: ctx.sim.S.timeScale });
  });

  // wipe the database and start a new world with a new seed
  api.post('/reset', (req, res) => { ctx.reset(); res.json({ seed: ctx.seed }); });

  return api;
}
