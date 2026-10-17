// The primitive things a person can do. Each one only describes the physics: where you have to be,
// how long it takes, what changes in the world. None of them says when, why or to whom you should do it;
// that is decided in every person's own head (sim.js → choose) from what they have learned.
import { ITEMS, label, edible, recipeKey, ingredients, best as bestItem } from './items.js';
import { conceptName, like, SACRED } from './mind.js';
import { rnd, dist } from './util.js';

export const BUILD = {
  hut: { stick: 4 }, house: { stick: 2, stone: 4 }, store: { stick: 3 }, wall: { stone: 3 },
  totem: { stick: 2 }, pen: { stick: 4 }, dam: { stone: 3, stick: 2 },
  furnace: { stone: 4, clay: 3 },   // a clay-lined stone shaft: holds the heat that smelting needs
  well: { stone: 4 },               // water anywhere, and clean
  hall: { brick: 6, stick: 3 },     // a great brick house
  granary: { brick: 4, stick: 2 },  // a store that keeps
  stele: { stone: 2, tablet: 2 },   // a standing stone to carve what one knows into
  snare: { trap: 1 },               // set in the grass, catches small game by itself
};
export const BUILD_T = { hut: 18, house: 30, store: 14, wall: 12, totem: 10, pen: 16, dam: 20, furnace: 22, well: 20, hall: 40, granary: 24, stele: 14, snare: 2 };
const PICK_YIELD = { bush: ['berry', 3], tree: ['fruit', 3], mushroom: ['mushroom', 1], redcap: ['redcap', 1], herb: ['herb', 2], grass: ['fiber', 2], reed: ['fiber', 2] };
const GATHER = { shrub: 'stick', tree: 'stick', pine: 'stick', rock: 'stone', 'ore:copper': 'ore:copper', 'ore:iron': 'ore:iron', 'ore:gold': 'ore:gold', 'ore:sulfur': 'sulfur',
  'ore:tin': 'ore:tin', 'ore:saltpeter': 'saltpeter' };
// these remembered places are worth walking back to even when out of sight
const REMEMBERED = new Set(['bush', 'tree', 'mushroom', 'herb', 'shrub', 'rock', 'pine']);

export function createActions(x) {
  const { S, env } = x;
  const A = {}, LIST = [];
  const def = a => { a.reach ??= 10; a.val ??= 0; a.minAge ??= 4; LIST.push(a); A[a.id] = a; return a; };
  // a candidate: action, concept it is about (for likes), model key (action:target-kind), where, …
  const C = (act, k, o = {}) => ({ A: act, k, key: act.id + ':' + (o.cat || k), x: 0, z: 0, d: 0, ...o });
  const vis = (e, c) => e.seen.things.get(c) || [];
  const catOf = x.catOf;
  const at = (e, o) => ({ x: o.x, z: o.z, d: Math.hypot(o.x - e.x, o.z - e.z) });
  // a remembered place (unless they found it bare less than a minute ago)
  const memC = (act, e, c, o = {}) => {
    const m = e.mem.get(c);
    if (!m || (m.empty && S.time - m.empty < 60)) return null;
    return C(act, c, { x: m.x, z: m.z, d: Math.hypot(m.x - e.x, m.z - e.z), mem: true, ...o });
  };
  const bare = (e, c) => { const m = e.mem.get(c); if (m) m.empty = S.time; return false; };
  const push = (out, c) => { if (c) out.push(c); };
  const people = (e, P, n, ok) => { const r = []; for (const s of P.people) { if (r.length >= n) break; if (ok(s.p, s.d)) r.push(s); } return r; };

  // ───────── doing nothing much ─────────
  def({ id: 'idle', minAge: 0, reach: 0, dur: () => 3, label: () => 'Resting', anim: () => null,
    cands(e, P, out) { out.push(C(this, 'rest', { here: true })); } });

  def({ id: 'wander', minAge: 3, reach: 10, dur: () => 0, label: () => 'Wandering', anim: () => null,
    cands(e, P, out) {
      const p = x.landAround(e.x, e.z, 80, e.age < 10 ? 110 : 280);
      if (p) out.push(C(this, 'land', { x: p.x, z: p.z, d: Math.hypot(p.x - e.x, p.z - e.z) }));
    } });

  def({ id: 'sleep', minAge: 0, reach: 6, dur: () => 30, label: () => 'Sleeping', anim: () => 'sleep',
    cands(e, P, out) {
      out.push(C(this, 'ground', { here: true }));
      for (const c of ['hut', 'house', 'hall']) { const v = vis(e, c)[0]; push(out, v ? C(this, c, { tgt: v.o, ...at(e, v.o) }) : memC(this, e, c)); }
    },
    work(e, T) { e.asleep = true; if (e.energy >= .98 && T.t > 6) return 'done'; },
    // a good night under one's own roof is pinned on having built it
    finish(e, T) { if (T.tgt && T.tgt.builder === e.id && x.done(T.tgt)) x.learnBody(e, 'build:' + T.tgt.k, { energy: .35, warmth: .15 }); } });

  // ───────── food and water ─────────
  def({ id: 'drink', minAge: 2, reach: 9, val: 1, dur: (e, T) => T.item ? 2 : env.frozenAt(T.x, T.z) ? 7 : 3, label: (e, T) => T.item || !env.frozenAt(T.x, T.z) ? 'Drinking' : 'Breaking the ice to drink', anim: () => 'drink',
    cands(e, P, out) {
      if (P.shore) out.push(C(this, 'river', { x: P.shore.x, z: P.shore.z, d: P.shore.d }));
      else push(out, memC(this, e, 'river'));
      const w = vis(e, 'well').find(t => x.done(t.o));
      if (w) out.push(C(this, 'well', { tgt: w.o, well: true, ...at(e, w.o) }));
      for (const k in e.inv) if (e.inv[k] > 0 && ITEMS[k] && ITEMS[k].drink) out.push(C(this, k, { item: k, here: true }));
    },
    begin: (e, T) => T.item ? x.has(e, T.item) : true,
    finish(e, T) {
      if (T.item) { x.drinkItem(e, T.item); return; }
      if (T.well) { e.water = Math.min(1, e.water + .55); return; }
      e.water = Math.min(1, e.water + .55);
      if (env.frozenAt(T.x, T.z)) e.warmth = Math.max(0, e.warmth - .08);   // ice water chills
      const g = env.waterGerm(T.x, T.z);
      if (g) env.infect(e, g);
    } });

  // putting something on oneself: a bandage on a wound, medicine or herbs when sick
  def({ id: 'treat', minAge: 6, reach: 0, val: 1, dur: () => 3, label: (e, T) => `Using ${label(T.item)} on ${e.sex === 'M' ? 'himself' : 'herself'}`, anim: () => 'heal',
    cands(e, P, out) { for (const k of ['bandage', 'medicine']) if (x.has(e, k)) out.push(C(this, k, { item: k, here: true })); },
    begin: (e, T) => x.has(e, T.item),
    finish(e, T) { x.treat(e, e, T.item); } });

  def({ id: 'eat', minAge: 2, reach: 0, val: 1, dur: () => 2.5, label: (e, T) => `Eating ${label(T.item)}`, anim: () => 'eat',
    cands(e, P, out) { for (const k in e.inv) if (e.inv[k] > 0 && edible(k)) out.push(C(this, k, { item: k, here: true })); },
    begin: (e, T) => x.has(e, T.item),
    finish(e, T) { x.eat(e, T.item); } });

  def({ id: 'pick', minAge: 3, reach: 12, val: 1, dur: () => 3.5, label: (e, T) => `Picking ${T.k === 'crop' ? 'crops' : label(PICK_YIELD[T.k][0])}`, anim: () => 'pick',
    cands(e, P, out) {
      for (const c in PICK_YIELD) {
        const v = vis(e, c).find(t => env.ripe(t.o));
        if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) }));
        else if (REMEMBERED.has(c)) push(out, memC(this, e, c));
      }
      const cr = vis(e, 'crop').find(t => env.cropRipe(t.o));
      if (cr) out.push(C(this, 'crop', { tgt: cr.o, crop: true, ...at(e, cr.o) }));
    },
    begin(e, T) {
      if (T.crop) return S.crops.includes(T.tgt) && env.cropRipe(T.tgt);
      if (T.mem) { const o = x.findObj(T.x, T.z, 70, T.k, env.ripe); if (!o) return bare(e, T.k); Object.assign(T, { tgt: o, x: o.x, z: o.z, mem: false }); return 'go'; }
      return env.ripe(T.tgt);
    },
    finish(e, T) {
      if (T.crop) return x.harvestCrop(e, T.tgt);
      const [item, n] = PICK_YIELD[T.k];
      env.harvest(T.tgt);
      x.add(e, item, n + (x.has(e, 'basket') ? 1 : 0));
      if (T.k === 'grass' && env.season() !== 0 && rnd() < .5) x.add(e, 'grain');
    } });

  def({ id: 'gather', minAge: 5, reach: 14, label: (e, T) => T.k === 'rock' ? 'Gathering stones' : T.k.startsWith('ore') ? 'Mining ore' : 'Gathering wood',
    dur: (e, T) => T.k.startsWith('ore') ? (x.best(e, 'dig') ? 5 : 10) : T.k === 'rock' ? 5 : 4,
    anim: (e, T) => T.k === 'rock' || T.k.startsWith('ore') ? 'mine' : 'pick', tool: (e, T) => T.k.startsWith('ore') && x.best(e, 'dig') ? 'pick' : null,
    cands(e, P, out) {
      for (const c in GATHER) {
        const v = vis(e, c).find(t => GATHER[c] === 'stick' ? env.sticksLeft(t.o) >= 1 : !c.startsWith('ore') || env.oreLeft(t.o) > 0);
        if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) }));
        else if (REMEMBERED.has(c)) push(out, memC(this, e, c));
      }
    },
    begin(e, T) {
      if (T.mem) {
        const ok = GATHER[T.k] === 'stick' ? o => env.sticksLeft(o) >= 1 : () => true;
        const o = x.findObj(T.x, T.z, 70, T.k, ok);
        if (!o) return bare(e, T.k);
        Object.assign(T, { tgt: o, x: o.x, z: o.z, mem: false });
        return 'go';
      }
      return !T.tgt.felled;
    },
    finish(e, T) {
      const o = T.tgt, item = GATHER[T.k];
      if (item === 'stick') { if (env.sticksLeft(o) < 1) return false; env.takeStick(o); x.add(e, 'stick'); if (T.k === 'pine' && rnd() < .3) x.add(e, 'resin');
        if (T.k === 'tree' && rnd() < .04) { x.add(e, 'honey'); x.hurtPerson(e, .03, null, 'stings'); x.first('honey', 'discovery', `🍯 ${e.name} found a wild hive (and was stung)`); }
        return; }
      if (item === 'stone') { x.add(e, rnd() < .2 ? 'flint' : 'stone'); return; }
      if (env.oreLeft(o) <= 0) return false;
      if (rnd() < (x.best(e, 'dig') ? .85 : .35)) {
        env.takeOre(o); x.add(e, item);
        x.first(`ore:${item}`, 'discovery', `⛏ ${e.name} dug ${label(item)} out of a coloured rock`);
      } else x.add(e, 'stone');
    } });

  def({ id: 'chop', minAge: 12, reach: 14, val: -1, label: () => 'Felling a tree', anim: () => 'chop',
    dur: e => { const t = x.best(e, 'chop'); return t ? ITEMS[t].chop : 32; }, tool: e => x.best(e, 'chop') ? 'axe' : null,
    cands(e, P, out) {
      for (const c of ['tree', 'pine']) { const v = vis(e, c).find(t => !t.o.felled && !t.o.burning); if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) })); }
    },
    begin: (e, T) => !T.tgt.felled && !T.tgt.burning,
    finish(e, T) {
      if (T.tgt.felled) return false;
      env.fell(T.tgt);
      x.add(e, 'stick', 4); x.add(e, 'bark');
      x.fx({ kind: 'fell', id: T.tgt.id, x: T.tgt.x, z: T.tgt.z, dir: T.tgt.x >= e.x ? 1 : -1 });   // it falls away from the axe
      x.harm(e, T.k, .7, T.tgt);
      x.first('chop', 'work', `🪓 ${e.name} felled a tree for the first time`);
    } });

  def({ id: 'dig', minAge: 10, reach: 6, label: (e, T) => x.sandy(T.x, T.z) ? 'Digging sand' : 'Digging clay', anim: () => 'mine', dur: e => x.best(e, 'dig') ? 5 : 10, tool: e => x.best(e, 'dig') ? 'pick' : null,
    cands(e, P, out) {
      if (!P.shore || P.shore.d > 160) return;
      const p = x.landAround(P.shore.x, P.shore.z, 8, 26);
      if (p) out.push(C(this, 'ground', { x: p.x, z: p.z, d: Math.hypot(p.x - e.x, p.z - e.z) }));
    },
    finish(e, T) { if (x.sandy(T.x, T.z)) x.add(e, 'sand', 2); else x.add(e, 'clay', 2); } });

  def({ id: 'fish', minAge: 8, reach: 9, dur: () => 8, label: () => 'Fishing', anim: () => 'fish', tool: e => x.best(e, 'fish') ? 'spear' : null,
    cands(e, P, out) { if (P.shore) out.push(C(this, 'river', { x: P.shore.x, z: P.shore.z, d: P.shore.d })); else push(out, memC(this, e, 'river')); },
    begin: (e, T) => !env.frozenAt(T.x, T.z),
    finish(e, T) {
      const t = x.best(e, 'fish');
      const p = (t ? ITEMS[t].fish : .14) * (env.damNear(T.x, T.z) ? 1.6 : 1);
      if (rnd() > p) return false;
      x.add(e, 'fish');
      x.first('fish', 'work', `🐟 ${e.name} caught a fish`);
    } });

  def({ id: 'fill', minAge: 8, reach: 9, dur: () => 3, label: () => 'Filling a pot with water', anim: () => 'drink',
    cands(e, P, out) { if (!x.has(e, 'pot')) return; if (P.shore) out.push(C(this, 'river', { x: P.shore.x, z: P.shore.z, d: P.shore.d })); else push(out, memC(this, e, 'river')); },
    begin: (e, T) => x.has(e, 'pot') && !env.frozenAt(T.x, T.z),
    finish(e) { x.take(e, 'pot'); x.add(e, 'waterpot'); } });

  // ───────── animals ─────────
  def({ id: 'hunt', minAge: 12, val: -1, mobile: true, reach: e => x.reachOf(e), dur: () => 22,
    speed: (e, T) => T.tgt.state === 'flee' || T.tgt.state === 'fight' ? 'run' : 'sneak',
    label: (e, T) => `Hunting a ${T.k}`, anim: () => 'fight', tool: e => x.weaponOf(e),
    cands(e, P, out) {
      // going for a beast that is mauling someone, or one others are already fighting, is learned as its own thing:
      // whether standing together against wolves pays is for them to find out
      for (const { a, d } of P.animals.slice(0, 3)) {
        if (a.owner && a.owner !== e.id) continue;
        const mauling = a.state === 'fight' && a.threat && a.threat !== e && a.threat.name;
        const together = P.people.some(s => s.p.task && s.p.task.A.id === 'hunt' && s.p.task.tgt === a);
        out.push(C(this, a.k, { tgt: a, cat: a.k + (mauling ? ' attacking someone' : together ? ' with others' : ''), x: a.x, z: a.z, d }));
      }
    },
    begin: (e, T) => S.animals.includes(T.tgt),
    work(e, T, dt) {
      const a = T.tgt;
      if (!S.animals.includes(a)) return T.killed ? 'done' : 'fail';
      if (Math.hypot(a.x - e.x, a.z - e.z) > x.reachOf(e) + 5) return 'chase';
      if ((T.hitT = (T.hitT ?? 0) - dt) > 0) return;
      T.hitT = .9;
      x.face(e, a);
      const ambush = a.state === 'graze' ? 2 : 1;   // a first blow from hiding counts double
      if (x.zoo.hurt(a, x.strikePower(e) * (.6 + rnd() * .8) * ambush, e)) {
        T.killed = true; e.stats.hunted++;
        x.first(`hunt:${a.k}`, 'work', `🏹 ${e.name} killed a ${a.k}`);
        const body = S.corpses[S.corpses.length - 1];   // cut some meat off on the spot
        if (body && body.id === a.id) x.butcher(e, body);
        return 'done';
      }
    } });

  def({ id: 'butcher', minAge: 12, reach: 10, label: (e, T) => T.k === 'corpse' ? `Cutting up ${T.tgt.name}'s body` : `Butchering a ${T.tgt.k}`, anim: () => 'pick',
    dur: e => x.best(e, 'cut') || x.best(e, 'power') ? 3 : 6,
    cands(e, P, out) {
      for (const c of ['carcass', 'corpse']) { const v = vis(e, c).find(t => t.o.meat > 0 && env.rotOf(t.o) < 1.2); if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) })); }
    },
    begin: (e, T) => S.corpses.includes(T.tgt) && T.tgt.meat > 0,
    finish(e, T) { x.butcher(e, T.tgt); } });

  def({ id: 'feed', minAge: 6, reach: 14, val: 1, mobile: true, speed: () => 'sneak', dur: () => 2.5, label: (e, T) => `Feeding a ${T.k}`, anim: () => 'give',
    cands(e, P, out) {
      for (const { a, d } of P.animals.slice(0, 3)) { const item = x.feedFor(e, a); if (item) out.push(C(this, a.k, { tgt: a, item, x: a.x, z: a.z, d })); }
    },
    begin: (e, T) => S.animals.includes(T.tgt) && x.has(e, T.item),
    finish(e, T) { return x.feedAnimal(e, T.tgt, T.item); } });

  // ───────── other people ─────────
  // A fight: circling, feinting, blows that land or get blocked. It ends when one falls, gets away, or it drags on too long.
  def({ id: 'attack', minAge: 5, val: -1, mobile: true, reach: e => x.reachOf(e), dur: () => 20, speed: () => 'run',
    label: (e, T) => T.tgt.downUntil > S.time ? `Beating ${T.tgt.name}, who is down` : `Fighting ${T.tgt.name}`, anim: () => 'fight', tool: e => x.weaponOf(e),
    cands(e, P, out) {
      for (const { p, d } of people(e, P, 3, p => !p.held)) {
        const many = P.people.some(s => s.p !== e && s.p.task && s.p.task.A.id === 'attack' && s.p.task.tgt === p);
        out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: many ? 'outnumbered' : catOf(p), x: p.x, z: p.z, d }));
      }
      for (const { p, d } of P.strangers || []) out.push(C(this, 'p:' + p.id, { tgt: p, cat: 'stranger', x: p.x, z: p.z, d }));
    },
    begin(e, T) { if (T.tgt.downUntil > S.time) T.finishing = true; return T.tgt.alive; },   // going for someone already down
    work(e, T, dt) {
      const p = T.tgt;
      if (!p.alive) return 'done';
      const d = dist(e, p), reach = x.reachOf(e);
      if (d > 110) return 'fail';
      if (d > reach + 8) return 'chase';
      // knocked them down: the fight is won (whether to strike someone on the ground is a new choice)
      if (p.downUntil > S.time && !T.finishing) { T.won = true; return 'done'; }
      // circle the opponent, stepping in to strike and out again
      T.circ = (T.circ ?? rnd() * 6) + dt * (1.2 + rnd() * .4);
      const a = Math.atan2(e.z - p.z, e.x - p.x) + Math.sin(T.circ) * .5, r = reach * (.7 + .25 * Math.sin(T.circ * 2.3));
      x.stepTo(e, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 'walk', dt);
      x.face(e, p);
      if ((T.hitT = (T.hitT ?? .3 + rnd() * .4) - dt) > 0) return;
      T.hitT = .55 + rnd() * .5;
      if (p.isPlayer) { if (x.hurtAvatar(p, x.strikePower(e) * (.6 + rnd() * .8), e)) { T.killed = true; return 'done'; } return; }
      if (x.hurtPerson(p, x.strikePower(e) * (.6 + rnd() * .8), e, 'wounds')) { T.killed = true; return 'done'; }
    } });

  def({ id: 'flee', minAge: 2, reach: 10, dur: () => 0, speed: () => 'run', label: () => 'Running away', anim: () => null,
    cands(e, P, out) {
      for (const th of P.threats) {
        const dx = e.x - th.o.x, dz = e.z - th.o.z, d = Math.hypot(dx, dz) || 1;
        const p = x.landAround(e.x + dx / d * 150, e.z + dz / d * 150, 0, 40);
        if (p) out.push(C(this, th.c, { x: p.x, z: p.z, d: Math.hypot(p.x - e.x, p.z - e.z), from: th.o }));
      }
    } });

  def({ id: 'take', minAge: 5, reach: 9, dur: () => 1.5, mobile: T => !!T.p, speed: (e, T) => T.p ? 'sneak' : 'walk', anim: () => 'grab',
    label: (e, T) => T.p ? `Stealing from ${T.p.name}` : T.k === 'corpse' ? 'Looting a body' : T.own ? 'Taking from the store' : 'Raiding a store',
    cands(e, P, out) {
      for (const { p, d } of people(e, P, 3, p => p.age >= 3 && !p.held && x.invTotal(p) > 0)) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), x: p.x, z: p.z, d }));
      const c = vis(e, 'corpse').find(t => x.invTotal(t.o) > 0) || vis(e, 'carcass').find(t => x.invTotal(t.o) > 0);
      if (c) out.push(C(this, 'corpse', { tgt: c.o, ...at(e, c.o) }));
      for (const t of vis(e, 'store')) if (x.invTotal(t.o) > 0) out.push(C(this, 'store', { tgt: t.o, own: t.o.owner === e.id, cat: t.o.owner === e.id ? 'own store' : 'store', ...at(e, t.o) }));
    },
    begin: (e, T) => T.p ? T.p.alive : T.k === 'corpse' ? S.corpses.includes(T.tgt) : S.structs.includes(T.tgt),
    finish(e, T) {
      if (T.p) return x.steal(e, T.p);
      if (T.k === 'corpse') return x.loot(e, T.tgt);
      return T.own ? x.withdraw(e, T.tgt) : x.stealStore(e, T.tgt);
    } });

  def({ id: 'give', minAge: 4, reach: 10, val: 1, mobile: true, dur: () => 1.5, anim: () => 'give', label: (e, T) => `Giving ${label(T.item)} to ${T.tgt.name}`,
    cands(e, P, out) {
      if (!x.invTotal(e)) return;
      for (const { p, d } of people(e, P, 4, () => true)) { const item = x.giftFor(e, p); if (item) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), item, x: p.x, z: p.z, d })); }
    },
    begin: (e, T) => T.tgt.alive && x.has(e, T.item),
    finish(e, T) { x.giveItem(e, T.tgt, T.item); } });

  def({ id: 'talk', minAge: 3, reach: 14, val: 1, mobile: true, dur: () => 5, anim: () => 'talk', label: (e, T) => `Talking with ${T.tgt.name}`,
    cands(e, P, out) { for (const { p, d } of people(e, P, 3, p => p.age >= 3 && !p.held && !x.busy(p))) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), x: p.x, z: p.z, d })); },
    begin: (e, T) => x.join(T.tgt, e, 'talk', 5),
    finish(e, T) { x.chat(e, T.tgt); } });

  def({ id: 'teach', minAge: 10, reach: 14, val: 1, mobile: true, dur: () => 6, anim: () => 'command', label: (e, T) => `Teaching ${T.tgt.name}`,
    cands(e, P, out) {
      if (e.M.size < 4) return;
      for (const { p, d } of people(e, P, 2, p => p.age >= 3 && !p.held && !x.busy(p))) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), x: p.x, z: p.z, d }));
    },
    begin: (e, T) => x.join(T.tgt, e, 'listen', 6),
    finish(e, T) { x.teach(e, T.tgt); } });

  // only ever the other half of someone else's "teach"
  // ───────── power: demanding, giving in, refusing ─────────
  def({ id: 'demand', minAge: 14, reach: 12, val: -1, mobile: true, dur: () => 1.6, speed: (e, T) => Math.hypot(T.x - e.x, T.z - e.z) > 25 ? 'run' : 'walk', anim: () => 'command', label: (e, T) => `Demanding goods from ${T.tgt.name}`,
    cands(e, P, out) { for (const { p, d } of people(e, P, 2, p => p.age >= 6 && !p.held && !p.asleep && x.invTotal(p) > 0)) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), x: p.x, z: p.z, d })); },
    begin(e, T) {
      if (!T.tgt.alive || T.tgt.held) return false;
      T.choice = x.decideYield(T.tgt, e);
      x.join(T.tgt, e, T.choice, 1.6, true);
      return true;
    },
    finish(e, T) { if (!T.tgt.alive) return false; if (T.choice === 'yield') { x.tribute(e, T.tgt); return true; } x.refused(e, T.tgt); return false; } });
  def({ id: 'yield', minAge: 2, joinOnly: true, val: 1, dur: () => 1.6, anim: () => 'give', label: (e, T) => `Handing things over to ${T.tgt.name}`, cands() {} });
  def({ id: 'refuse', minAge: 2, joinOnly: true, val: -1, dur: () => 1.6, anim: () => 'argue', label: (e, T) => `Refusing ${T.tgt.name}`, cands() {} });

  // ───────── trade: something I want less for something I want more (if they see it the other way round) ─────────
  def({ id: 'trade', minAge: 10, reach: 12, val: 1, mobile: true, dur: () => 3, speed: (e, T) => Math.hypot(T.x - e.x, T.z - e.z) > 25 ? 'run' : 'walk', anim: () => 'give', label: (e, T) => `Trading ${label(T.give)} for ${label(T.get)} with ${T.tgt.name}`,
    cands(e, P, out) {
      if (x.invTotal(e) < 2) return;
      for (const { p, d } of people(e, P, 2, p => p.age >= 10 && !p.held && !p.asleep && x.invTotal(p) > 0)) {
        const deal = x.dealWith(e, p);
        if (deal) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), give: deal.give, get: deal.get, x: p.x, z: p.z, d }));
      }
    },
    begin(e, T) { return x.has(e, T.give) && x.has(T.tgt, T.get) && !T.tgt.asleep && x.acceptsDeal(T.tgt, e, T.get, T.give) && x.join(T.tgt, e, 'give', 3, true); },
    finish(e, T) { return x.swap(e, T.tgt, T.give, T.get); } });

  // ───────── music: a drum or a flute; everyone around feels it ─────────
  def({ id: 'play', minAge: 6, reach: 0, val: 1, dur: () => 8, label: (e, T) => `Playing the ${T.item}`, anim: (e, T) => T.item === 'drum' ? 'drum' : 'flute',
    cands(e, P, out) { const k = x.has(e, 'drum') ? 'drum' : x.has(e, 'flute') ? 'flute' : null; if (k) out.push(C(this, 'music', { item: k, here: true })); },
    begin: (e, T) => x.has(e, T.item),
    finish(e, T) { x.music(e, T.item); } });

  // ───────── herds: milk and wool from goats that trust you ─────────
  def({ id: 'milk', minAge: 8, reach: 10, val: 1, mobile: true, dur: () => 4, anim: () => 'pick', label: () => 'Milking a goat',
    cands(e, P, out) {
      const a = P.animals.find(({ a }) => a.k === 'goat' && (a.owner === e.id || (a.trust[e.id] || 0) >= .4) && !(S.time - (a.milkT || -999) < 90) && a.age > 1.5);
      if (a) out.push(C(this, 'goat', { tgt: a.a, x: a.a.x, z: a.a.z, d: a.d }));
    },
    begin: (e, T) => S.animals.includes(T.tgt),
    finish(e, T) { T.tgt.milkT = S.time; x.add(e, 'milk'); x.first('milk', 'herding', `🥛 ${e.name} milked a goat`); } });
  def({ id: 'shear', minAge: 10, reach: 10, val: 1, mobile: true, dur: () => 5, anim: () => 'chop', label: () => 'Shearing a goat', tool: () => 'blade',
    cands(e, P, out) {
      if (!x.best(e, 'cut')) return;
      const y = Math.floor(S.year);
      const a = P.animals.find(({ a }) => a.k === 'goat' && (a.owner === e.id || (a.trust[e.id] || 0) >= .4) && a.shornY !== y && a.age > 1);
      if (a) out.push(C(this, 'goat', { tgt: a.a, x: a.a.x, z: a.a.z, d: a.d }));
    },
    begin: (e, T) => S.animals.includes(T.tgt),
    finish(e, T) { T.tgt.shornY = Math.floor(S.year); x.add(e, 'wool', 2); x.first('wool', 'herding', `🐐 ${e.name} sheared a goat for its wool`); } });

  // ───────── writing: carving what one knows into a standing stone, and reading it ─────────
  def({ id: 'inscribe', minAge: 12, reach: 12, val: 1, dur: () => 7, anim: () => 'craft', label: () => 'Carving signs into the stone',
    cands(e, P, out) {
      const st = vis(e, 'stele').find(t => x.done(t.o));
      if (!st) return;
      const lore = st.o.lore || [];
      const rk = [...e.R.entries()].find(([k, r]) => r.ok && !lore.includes(k));
      if (rk) out.push(C(this, 'stele', { tgt: st.o, rk: rk[0], ...at(e, st.o) }));
    },
    finish(e, T) { x.inscribe(e, T.tgt, T.rk); } });
  def({ id: 'study', minAge: 6, reach: 12, val: 1, dur: () => 8, anim: () => 'pray', label: () => 'Studying the carved stone',
    cands(e, P, out) {
      const st = vis(e, 'stele').find(t => x.done(t.o) && (t.o.lore || []).some(k => !(e.R.get(k) || {}).ok));
      if (st) out.push(C(this, 'stele', { tgt: st.o, ...at(e, st.o) }));
    },
    finish(e, T) { return x.study(e, T.tgt); } });

  // ───────── planting trees: a seed in a stump; a seed where a wild plant died ─────────
  def({ id: 'sow', minAge: 8, reach: 10, val: 1, dur: () => 3, anim: () => 'plant', label: (e, T) => T.k === 'stump' ? 'Planting a tree' : 'Planting a bush again',
    cands(e, P, out) {
      const seed = x.has(e, 'seed') ? 'seed' : x.has(e, 'fruit') ? 'fruit' : x.has(e, 'berry') ? 'berry' : null;
      if (!seed) return;
      for (const c of ['stump', 'withered']) { const v = vis(e, c)[0]; if (v) out.push(C(this, c, { tgt: v.o, item: seed, ...at(e, v.o) })); }
    },
    begin: (e, T) => x.has(e, T.item),
    finish(e, T) {
      const ok = T.k === 'stump' ? env.plantTree(T.tgt) : env.replant(T.tgt);
      if (!ok) return false;
      x.take(e, T.item); e.stats.planted++;
      x.first('tree:' + T.k, 'farming', T.k === 'stump' ? `🌳 ${e.name} planted a tree where one had been cut` : `🌱 ${e.name} planted a dead bush again`);
    } });

  def({ id: 'listen', minAge: 2, joinOnly: true, dur: () => 6, anim: () => 'sit', label: (e, T) => `Listening to ${T.tgt.name}`, cands() {} });

  def({ id: 'mate', minAge: 16, reach: 10, val: 1, mobile: true, dur: () => 8, anim: () => 'love', label: (e, T) => `Making love with ${T.tgt.name}`,
    cands(e, P, out) {
      for (const { p, d } of people(e, P, 3, p => p.sex !== e.sex && p.age >= 16 && !x.kin(e, p) && !p.held && !x.busy(p)))
        out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: 'person', x: p.x, z: p.z, d }));
    },
    begin(e, T) {
      if (!x.consents(T.tgt, e)) { e.distress = Math.min(1, e.distress + .08); x.notice(e, 'p:' + T.tgt.id, .4); return false; }
      return x.join(T.tgt, e, 'mate', 8, true);
    },
    finish(e, T) { x.loveDone(e, T.tgt); } });

  def({ id: 'follow', minAge: 2, reach: 30, val: 1, mobile: true, dur: () => 18, label: (e, T) => `Following ${T.tgt.name}`, anim: () => null,
    cands(e, P, out) { for (const { p, d } of people(e, P, 3, p => p.age >= 14 && !p.held)) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: 'person', x: p.x, z: p.z, d })); },
    work(e, T) { if (!T.tgt.alive) return 'fail'; if (dist(e, T.tgt) > 48) return 'chase'; x.recordFollow(e, T.tgt); } });

  // taking in a small child whose mother is gone (the carer then carries and feeds them as a mother would)
  def({ id: 'adopt', minAge: 14, reach: 10, val: 1, mobile: true, dur: () => 3, anim: () => 'hug', label: (e, T) => `Taking in ${T.tgt.name}`,
    cands(e, P, out) {
      for (const { p, d } of people(e, P, 2, p => p.age < 5 && !x.carerOf(p))) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: 'child', x: p.x, z: p.z, d }));
    },
    begin: (e, T) => T.tgt.alive && !x.carerOf(T.tgt),
    finish(e, T) { x.adopt(e, T.tgt); } });

  def({ id: 'tend', minAge: 10, reach: 10, val: 1, mobile: true, dur: () => 7, anim: () => 'heal', label: (e, T) => `Tending to ${T.tgt.name}`,
    cands(e, P, out) {
      for (const { p, d } of people(e, P, 2, p => p.bleed > .02 || p.dis + p.tox > .15 || p.health < .65))
        out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), x: p.x, z: p.z, d }));
    },
    begin: (e, T) => T.tgt.alive,
    finish(e, T) { x.tend(e, T.tgt); } });

  // ───────── fire, craft, building, farming ─────────
  def({ id: 'warm', minAge: 2, reach: 26, dur: () => 8, label: () => 'Warming up by the fire', anim: () => 'warm',
    cands(e, P, out) { const v = vis(e, 'fire').find(t => !t.o.wild); push(out, v ? C(this, 'fire', { tgt: v.o, ...at(e, v.o) }) : memC(this, e, 'fire')); },
    begin: (e, T) => T.mem ? !!x.fireNear(e, 40) : S.fires.includes(T.tgt) });

  def({ id: 'kindle', minAge: 8, reach: 14, dur: () => 3, label: () => 'Feeding the fire', anim: () => 'kindle',
    cands(e, P, out) {
      const item = x.has(e, 'charcoal') ? 'charcoal' : x.has(e, 'stick') ? 'stick' : null;
      const v = item && vis(e, 'fire').find(t => !t.o.wild && t.o.fuel < 400);
      if (v) out.push(C(this, 'fire', { tgt: v.o, item, ...at(e, v.o) }));
    },
    begin: (e, T) => S.fires.includes(T.tgt) && x.has(e, T.item),
    finish(e, T) { x.take(e, T.item); T.tgt.fuel += ITEMS[T.item].fuel; } });

  def({ id: 'craft', minAge: 8, reach: (e, T) => T.away ? 28 : 0, dur: () => 6, anim: () => 'craft',
    label: (e, T) => { const r = e.R.get(T.rk), g = ingredients(T.rk); return r && r.res ? `Making ${label(r.res === 'FIRE' ? 'a fire' : r.res)}` : `Trying ${g.items.map(label).join(' + ')}${g.where ? ' in the ' + g.where : ''}`; },
    cands(e, P, out) {
      const kinds = Object.keys(e.inv).filter(k => e.inv[k] > 0);
      if (!kinds.length) return;
      const fire = !!x.fireNear(e, 35), furnace = !!x.furnaceNear(e, 40), keys = new Set();
      const wheres = [null, ...(fire || furnace ? ['fire'] : []), ...(furnace ? ['furnace'] : [])];
      const can = list => { const n = {}; for (const k of list) n[k] = (n[k] || 0) + 1; for (const k in n) if ((e.inv[k] || 0) < n[k]) return false; return true; };
      for (let i = 0; i < kinds.length; i++) for (let j = i; j < kinds.length; j++) {
        if (!can([kinds[i], kinds[j]])) continue;
        keys.add(recipeKey([kinds[i], kinds[j]]));
        for (const w of wheres) if (w && rnd() < .2) keys.add(recipeKey([kinds[i], kinds[j]], w));
      }
      for (const w of wheres) if (w) for (const k of kinds) keys.add(recipeKey([k], w));
      // three at once: a few random handfuls each time (the space is large; known ones are always kept below)
      for (let n = 0; n < 4 && kinds.length; n++) {
        const t = [kinds[Math.floor(rnd() * kinds.length)], kinds[Math.floor(rnd() * kinds.length)], kinds[Math.floor(rnd() * kinds.length)]];
        if (can(t)) keys.add(recipeKey(t, wheres[Math.floor(rnd() * wheres.length)]));
      }
      for (const [rk, r] of e.R) if (r.ok && !keys.has(rk)) { const g = ingredients(rk); if (can(g.items) && (!g.where || wheres.includes(g.where))) keys.add(rk); }
      const known = [], untried = [];
      for (const rk of keys) {
        const r = e.R.get(rk);
        if (r && r.ok) known.push(rk);
        else if (!r) untried.push(rk);
        else if (r.tries < 1 + 4 * e.tr.iq || rnd() < .03) untried.push(rk);   // the bright keep trying a while
      }
      // ore and metal want a furnace: walk to one they know of
      const m = !furnace && e.mem.get('furnace');
      if (m) for (const [rk, r] of e.R) {
        if (!r.ok || !rk.endsWith('+furnace')) continue;
        const g = ingredients(rk);
        if (can(g.items)) { out.push(C(this, r.res, { key: 'craft:' + rk, rk, away: true, x: m.x, z: m.z, d: Math.hypot(m.x - e.x, m.z - e.z), mem: true })); break; }
      }
      if (m && !out.some(c => c.away)) {
        const ore = kinds.find(k => k.startsWith('ore:'));
        const rk = ore && recipeKey(kinds.includes('charcoal') ? [ore, 'charcoal'] : [ore], 'furnace');
        if (ore && !(e.R.get(rk) || {}).tries) out.push(C(this, 'unknown', { key: 'craft:' + rk, rk, away: true, x: m.x, z: m.z, d: Math.hypot(m.x - e.x, m.z - e.z), mem: true }));
      }
      for (const rk of known.slice(0, 8)) out.push(C(this, e.R.get(rk).res === 'FIRE' ? 'fire' : e.R.get(rk).res, { key: 'craft:' + rk, rk, here: true }));
      for (let n = 0; n < 2 && untried.length; n++) {
        const rk = untried.splice(Math.floor(rnd() * untried.length), 1)[0];
        out.push(C(this, 'unknown', { key: 'craft:' + rk, rk, here: true }));
      }
    },
    begin(e, T) { return x.canCraft(e, T.rk); },
    finish(e, T) { return x.craft(e, T.rk); } });

  // Building: lay down the materials as a site, then work on it. Work done is never lost — the site stays, and
  // anyone passing (the builder or someone else) can carry on raising it until it stands.
  def({ id: 'build', minAge: 10, reach: 10, label: (e, T) => T.site && T.site.owner !== e.id ? `Helping build ${T.site.owner && x.byId(T.site.owner) ? x.byId(T.site.owner).name + "'s" : 'a'} ${T.k}` : `Building a ${T.k}`, anim: () => 'craft',
    dur: (e, T) => Math.min(12, BUILD_T[T.k] * (1 - (T.site ? T.site.prog : 0))),
    cands(e, P, out) {
      for (const k in BUILD) {
        if (!x.hasAll(e, BUILD[k])) continue;
        if (k === 'totem' && !x.sacredOf(e)) continue;
        if (k === 'dam' && !(P.shore && P.shore.d < 120)) continue;
        const spot = k === 'dam' ? { x: P.shore.x, z: P.shore.z } : x.buildSpot(e, k);
        if (spot) out.push(C(this, k, { x: spot.x, z: spot.z, d: Math.hypot(spot.x - e.x, spot.z - e.z) }));
      }
      // unfinished buildings in sight: one's own, or someone else's to lend a hand with
      let n = 0;
      for (const s of S.structs) {
        if (x.done(s) || n >= 2 || Math.abs(s.x - e.x) > 190 || Math.abs(s.z - e.z) > 190) continue;
        n++;
        out.push(C(this, s.k, { tgt: s, site: s, x: s.x, z: s.z, d: Math.hypot(s.x - e.x, s.z - e.z), cat: s.owner === e.id ? s.k : 'help' }));
      }
    },
    begin(e, T) {
      if (T.site) return S.structs.includes(T.site) && !x.done(T.site);
      if (!x.hasAll(e, BUILD[T.k]) || !x.spotFree(T.x, T.z, T.k)) return false;
      T.site = T.tgt = x.layFoundation(e, T.k, T.x, T.z);
      return true;
    },
    work(e, T, dt) {
      if (!S.structs.includes(T.site)) return 'fail';
      const speed = x.best(e, 'chop') ? 1.4 : 1;
      if (x.raiseSite(e, T.site, dt * speed / BUILD_T[T.k])) return 'done';
    } });

  def({ id: 'store', minAge: 10, reach: 10, dur: () => 3, label: () => 'Putting goods in the store', anim: () => 'give',
    cands(e, P, out) {
      if (x.invTotal(e) < 5) return;
      const v = vis(e, 'store').find(t => t.o.owner === e.id);
      if (v) out.push(C(this, 'store', { tgt: v.o, cat: 'own store', ...at(e, v.o) }));
    },
    begin: (e, T) => S.structs.includes(T.tgt),
    finish(e, T) { x.deposit(e, T.tgt); } });

  def({ id: 'plant', minAge: 8, reach: 4, dur: () => 4, label: (e, T) => `Planting ${label(T.item)}`, anim: () => 'plant',
    cands(e, P, out) {
      for (const k of ['seed', 'grain']) {
        if (!x.has(e, k)) continue;
        const p = x.plantSpot(e);
        if (p) out.push(C(this, k, { item: k, x: p.x, z: p.z, d: Math.hypot(p.x - e.x, p.z - e.z) }));
      }
    },
    begin: (e, T) => x.has(e, T.item),
    finish(e, T) { x.plant(e, T.item, T.x, T.z); } });

  // ───────── the dead, the sacred, destruction ─────────
  def({ id: 'bury', minAge: 12, reach: 10, val: 1, label: (e, T) => T.k === 'corpse' ? `Burying ${T.tgt.name}` : 'Burying a carcass', anim: () => 'mine',
    dur: e => x.best(e, 'dig') ? 6 : 12, tool: e => x.best(e, 'dig') ? 'pick' : null,
    cands(e, P, out) {
      for (const c of ['corpse', 'carcass', 'bones']) { const v = vis(e, c)[0]; if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) })); }
    },
    begin: (e, T) => S.corpses.includes(T.tgt),
    finish(e, T) { x.bury(e, T.tgt); } });

  def({ id: 'venerate', minAge: 5, reach: 30, val: 1, dur: () => 8, anim: (e, T) => x.ritualPose(e, T.k),
    label: (e, T) => T.k.startsWith('p:') ? `Praying at the grave of ${conceptName(T.k, S.names)}` : `Praying to ${conceptName(T.k, S.names)}`,
    cands(e, P, out) {
      // whatever out there they feel most strongly about
      const opts = P.sacred.slice().sort((a, b) => like(e, b.c) - like(e, a.c)).slice(0, 2);
      for (const s of opts) if (like(e, s.c) > -15) out.push(C(this, s.c, { x: s.x, z: s.z, d: Math.hypot(s.x - e.x, s.z - e.z), here: s.sky, cat: s.c.startsWith('p:') ? 'ancestor' : s.c }));
    },
    finish(e, T) { x.ritualDone(e, T.k); } });

  def({ id: 'burn', minAge: 12, reach: 18, val: -1, dur: () => 2, label: (e, T) => `Setting fire to a ${T.k}`, anim: () => 'throw',
    cands(e, P, out) {
      if (!x.has(e, 'torch')) return;
      for (const c of ['hut', 'store', 'totem', 'pen']) { const v = vis(e, c).find(t => t.o.owner !== e.id && !t.o.burning); if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) })); }
      const t = vis(e, 'tree')[0] || vis(e, 'pine')[0];
      if (t) out.push(C(this, 'tree', { tgt: t.o, ...at(e, t.o) }));
    },
    begin: (e, T) => x.has(e, 'torch') && !T.tgt.burning && !T.tgt.felled,
    finish(e, T) { x.arson(e, T.tgt, T.k); } });

  def({ id: 'bomb', minAge: 14, reach: 55, val: -1, dur: () => 1.5, mobile: T => !!T.p, label: () => 'Throwing a bomb', anim: () => 'throw',
    cands(e, P, out) {
      if (!x.has(e, 'bomb')) return;
      for (const { p, d } of people(e, P, 2, (p, d) => d > 25)) out.push(C(this, 'p:' + p.id, { tgt: p, p, cat: catOf(p), x: p.x, z: p.z, d }));
      for (const c of ['hut', 'house', 'store', 'wall', 'dam', 'totem']) { const v = vis(e, c).find(t => t.o.owner !== e.id); if (v) out.push(C(this, c, { tgt: v.o, ...at(e, v.o) })); }
    },
    begin: (e, T) => x.has(e, 'bomb'),
    finish(e, T) { x.take(e, 'bomb'); x.explode(T.tgt.x, T.tgt.z, e); } });

  return { LIST, A, BUILD, REMEMBERED, SACRED };
}
