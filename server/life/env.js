// The world around the people: seasons and weather, water, plants, fire, the dead, disease, buildings, crops.
// These are the laws of nature of Stick World. People only ever see their effects.
import { TAU, clamp, smooth, frac } from '../../shared/core.js';
import { WATER, CH } from '../../shared/world.js';
import { YEAR, rnd, pick } from './util.js';

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];
const ROT_PERSON = 540, ROT_ANIMAL = 300;          // seconds until a body is bare bones
// seconds until a wild plant bears again after being picked bare: about one season for berries and herbs, more for fruit
const REGROW = { bush: 100, tree: 160, mush: 120, redcap: 120, herb: 120, tall: 40, reed: 40 };
// stripping a wild plant bare can kill it (roots torn, nothing left to seed); seeds blown in bring it back, slowly
const DIE = { bush: .3, mush: .45, redcap: .45, herb: .35, tree: 0, tall: 0, reed: 0 };
const REVIVE = .12;                 // chance per year that a dead wild plant comes back by itself
const TREE_SEED = .035;             // chance per year that a stump left alone sprouts a seedling (after 15 years)
const IN_SEASON = { bush: [0, 1, 2], tree: [1, 2], mush: [0, 1, 2], redcap: [0, 1, 2], herb: [0, 1, 2], tall: [0, 1, 2, 3], reed: [0, 1, 2, 3] };
export const BURNABLE = { hut: true, store: true, totem: true, pen: true };
export const STRUCT_SOLID = { wall: 10 };
const STRAIN_NAMES = ['the Grey Cough', 'the Red Fever', 'the Bloody Flux', 'the Black Boils', 'the Sweating Sickness', 'the Rot Fever',
  'the Pale Wasting', 'the Spotted Plague', 'the Marsh Ague', 'the Shaking Fever', 'the Weeping Sores', 'the Blue Lung'];

// what a person calls a world object
export function conceptOfObj(o) {
  switch (o.t) {
    case 'tree': return 'tree';
    case 'pine': return 'pine';
    case 'twig': return 'shrub';
    case 'bush': return 'bush';
    case 'boulder': return o.ore ? `ore:${o.ore}` : 'rock';
    case 'mush': return 'mushroom';
    case 'redcap': return 'redcap';
    case 'herb': return 'herb';
    case 'tall': return 'grass';
    case 'reed': return 'reed';
  }
  return null;
}

export function createEnv(world, S, x) {
  // ───────── time of year, weather, temperature ─────────
  const yearFrac = () => frac(S.time / YEAR);
  const season = () => Math.floor(yearFrac() * 4);
  // +0.12 midsummer … −0.26 midwinter, and some winters far colder than that
  const seasonTemp = () => .19 * Math.cos(TAU * (yearFrac() - .375)) - .07 - (season() === 3 ? S.winterSev || 0 : 0);
  const night = () => 1 - smooth(-.15, .25, Math.sin(S.dayT * TAU));
  const airTemp = (px, pz) => world.temp(px, pz) + seasonTemp() - night() * .08 - S.weather.rain * .07;
  const frozenAt = (px, pz) => world.temp(px, pz) + seasonTemp() < world.SNOW - .1;
  const growing = () => season() !== 3;

  // each winter is rolled as it comes: most are ordinary, some hard, a few terrible
  function winter() {
    const y = Math.floor(S.time / YEAR);
    if (season() !== 3) { if (S.winterSev && season() === 0) { S.winterSev = 0; } return; }
    if (S.winterYear === y) return;
    S.winterYear = y;
    const r = rnd();
    S.winterSev = r < .035 ? .2 + rnd() * .08 : r < .2 ? .08 + rnd() * .06 : 0;
    if (S.winterSev >= .2) x.log('winter', `❄ The Great Winter of year ${y}: rivers freeze, the snow does not stop`);
    else if (S.winterSev > 0) x.log('winter', `❄ A hard winter has come (year ${y})`);
  }
  function weather(dt) {
    winter();
    const w = S.weather;
    if ((w.t -= dt) > 0) return;
    const s = season();
    w.rain = rnd() < [.4, .22, .45, .3][s] ? .35 + rnd() * .65 : 0;
    w.storm = w.rain > .75 && s !== 3 && rnd() < .45;
    if (s === 3 && S.winterSev > .15) w.rain = Math.max(w.rain, .5 + rnd() * .5);   // blizzards
    w.t = 25 + rnd() * 70;
  }

  // ───────── water ─────────
  const shoreCache = new Map();
  function shoresOf(cx, cz) {
    const k = cx * 100003 + cz;
    let a = shoreCache.get(k);
    if (a) return a;
    a = [];
    for (let j = 0; j < CH; j += 14) for (let i = 0; i < CH; i += 14) {
      const px = cx * CH + i + 7, pz = cz * CH + j + 7;
      if (world.elev(px, pz) < WATER + .006) continue;
      if (world.blocked(px + 14, pz) || world.blocked(px - 14, pz) || world.blocked(px, pz + 14) || world.blocked(px, pz - 14)) a.push({ x: px, z: pz });
    }
    if (shoreCache.size > 4000) shoreCache.clear();
    shoreCache.set(k, a);
    return a;
  }
  function nearestShore(px, pz, r) {
    let best = null, bd = r;
    for (let cz = Math.floor((pz - r) / CH); cz <= Math.floor((pz + r) / CH); cz++)
      for (let cx = Math.floor((px - r) / CH); cx <= Math.floor((px + r) / CH); cx++)
        for (const p of shoresOf(cx, cz)) { const d = Math.hypot(p.x - px, p.z - pz); if (d < bd) { bd = d; best = p; } }
    return best ? { x: best.x, z: best.z, d: bd } : null;
  }

  // ───────── plants: berries, fruit, mushrooms, herbs, grass; trees can be felled or burnt ─────────
  const stOf = o => S.plants.get(o.id);
  function ensureSt(o) { let s = S.plants.get(o.id); if (!s) S.plants.set(o.id, s = {}); return s; }
  function ripe(o) {
    if (o.felled || o.burning) return false;
    if (o.dead) return false;
    if (o.t === 'bush' && !o.canBerry) return false;
    const ss = IN_SEASON[o.t];
    if (!ss || !ss.includes(season())) return false;
    const s = stOf(o);
    return !s || !s.next || s.next <= S.time;
  }
  function harvest(o) {
    const s = ensureSt(o);
    s.next = S.time + REGROW[o.t] * (.8 + rnd() * .4) * (o.t === 'bush' || o.t === 'herb' ? 1 + S.winterSev * 4 : 1);
    if (!s.tended && rnd() < (DIE[o.t] || 0)) { s.dead = S.time; o.dead = true; }
    S.plantVer++;
  }
  // sticks: a tree only sheds a few dry branches at a time
  function sticksLeft(o) {
    const s = stOf(o), cap = o.t === 'twig' ? 2 : 3;
    if (!s || s.sticks == null) return cap;
    return Math.min(cap, s.sticks + (S.time - s.stickT) / 40);
  }
  function takeStick(o) { const s = ensureSt(o); s.sticks = sticksLeft(o) - 1; s.stickT = S.time; }
  function fell(o, burnt = false) {
    const s = ensureSt(o);
    o.felled = true; s.felled = S.time; s.burnt = burnt;
    S.felledVer++;
  }
  function oreLeft(o) { const s = stOf(o); return o.ore ? (s && s.ore != null ? s.ore : 6) : 0; }
  function takeOre(o) { const s = ensureSt(o); s.ore = oreLeft(o) - 1; if (s.ore <= 0) { o.ore = null; s.spent = true; } }
  function objById(id) {
    const [cx, cz, i] = id.split(':').map(Number);
    return world.chunkData(cx, cz).objs[i];
  }
  // felled trees sprout again after years; restored state must be re-applied to the cached world objects
  function regrowYearly() {
    for (const [id, s] of S.plants) {
      const o = objById(id);
      if (s.felled != null) {
        const age = (S.time - s.felled) / YEAR;
        if (s.planted == null && age > 15 && rnd() < TREE_SEED) { s.planted = S.time; S.felledVer++; }
        if (s.planted != null && (S.time - s.planted) / YEAR > 12) { if (o) o.felled = false; delete s.felled; delete s.burnt; delete s.planted; S.felledVer++; }
        else if (o) o.felled = true;
      }
      if (s.dead != null) {
        if (rnd() < REVIVE || (s.tended && rnd() < .5)) { delete s.dead; if (o) o.dead = false; S.plantVer++; }
        else if (o) o.dead = true;
      }
      if (s.spent && o) o.ore = null;
      if (s.felled == null && s.dead == null && !s.spent && (s.next == null || s.next < S.time) && (s.sticks == null || S.time - s.stickT > 200)) S.plants.delete(id);
    }
  }
  // a seed pushed into a stump (or into the ground where a wild plant died)
  function plantTree(o) { const s = ensureSt(o); if (s.felled == null || s.planted != null) return false; s.planted = S.time; S.felledVer++; return true; }
  function replant(o) { const s = ensureSt(o); if (s.dead == null) return false; s.tended = true; return true; }
  function felledList() {
    const out = [];
    for (const [id, s] of S.plants) if (s.felled != null) out.push({ id, stage: s.planted != null && (S.time - s.planted) / YEAR > 2 ? 'sapling' : s.burnt ? 'burnt' : 'stump' });
    return out;
  }
  function pickedIds() {
    const out = [];
    for (const [id, s] of S.plants) if (s.next > S.time || s.dead != null) out.push(s.dead != null ? '!' + id : id);
    return out;
  }

  // ───────── fire ─────────
  function makeFire(px, pz, fuel, wild = false, extra = {}) {
    const f = { id: S.nextId++, x: px, z: pz, fuel, wild, ...extra };
    S.fires.push(f);
    return f;
  }
  function igniteTree(o) {
    if (o.felled || o.burning || S.fires.filter(f => f.wild).length > 70) return null;
    o.burning = true;
    return makeFire(o.x, o.z, 30 + rnd() * 15, true, { obj: o.id });
  }
  function igniteStruct(s) {
    if (!BURNABLE[s.k] || s.burning) return null;
    s.burning = true;
    return makeFire(s.x, s.z, 35 + rnd() * 15, true, { struct: s.id });
  }
  function treesNear(px, pz, r, fn) {
    for (let cz = Math.floor((pz - r) / CH); cz <= Math.floor((pz + r) / CH); cz++)
      for (let cx = Math.floor((px - r) / CH); cx <= Math.floor((px + r) / CH); cx++)
        for (const o of world.chunkData(cx, cz).objs)
          if ((o.t === 'tree' || o.t === 'pine' || o.t === 'twig') && !o.felled && Math.abs(o.x - px) < r && Math.abs(o.z - pz) < r) fn(o, Math.hypot(o.x - px, o.z - pz));
  }
  let spreadT = 0;
  function fires(dt) {
    const wet = S.weather.rain;
    for (let i = S.fires.length - 1; i >= 0; i--) {
      const f = S.fires[i];
      f.fuel -= dt * (f.wild ? 1 : 1 + wet * 2.5);
      if (f.fuel > 0) continue;
      S.fires.splice(i, 1);
      if (f.obj) { const o = objById(f.obj); if (o) { o.burning = false; fell(o, true); } }
      if (f.struct) {
        const s = S.structs.find(t => t.id === f.struct);
        if (s) { x.destroyStruct(s, 'fire'); }
      }
    }
    if ((spreadT += dt) < 1) return;
    spreadT -= 1;
    const dry = (season() === 1 ? 2 : season() === 3 ? .4 : 1) * (1 - wet * .95);
    if (dry <= .02) return;
    for (const f of S.fires.slice()) {
      if (f.fuel <= 0) continue;
      if (f.wild) {
        treesNear(f.x, f.z, 36, (o, d) => { if (d < 36 && rnd() < .1 * dry) igniteTree(o); });
        for (const s of S.structs) if (BURNABLE[s.k] && !s.burning && Math.hypot(s.x - f.x, s.z - f.z) < 32 && rnd() < .14 * dry) igniteStruct(s);
        x.burnNear(f.x, f.z, 16);
      } else if (f.fuel > 90) treesNear(f.x, f.z, 20, (o, d) => { if (d < 20 && rnd() < .0008 * dry) igniteTree(o); });
    }
  }
  function lightning() {
    if (!S.weather.storm || rnd() > .015 || !S.people.length) return;
    const p = pick(S.people), cands = [];
    treesNear(p.x, p.z, 420, o => cands.push(o));
    if (!cands.length) return;
    const o = pick(cands);
    if (igniteTree(o)) {
      x.fx({ kind: 'lightning', x: o.x, z: o.z });
      if (!S.firsts.has('lightning')) { S.firsts.add('lightning'); x.log('fire', `⚡ Lightning set a tree ablaze near ${p.name}`); }
    }
  }
  // warmth bonus from fires at a spot
  function fireWarmth(px, pz) {
    let t = 0;
    for (const f of S.fires) {
      if (f.fuel <= 0) continue;
      const R = f.wild ? 95 : 75, d = Math.hypot(f.x - px, f.z - pz);
      if (d < R) t += (f.wild ? .75 : .55) * (1 - d / R);
    }
    return Math.min(t, .8);
  }

  // ───────── the dead, the stench, and disease ─────────
  const rotOf = c => (S.time - c.t0) / (c.k === 'person' ? ROT_PERSON : ROT_ANIMAL);
  function smellAt(px, pz) {
    let s = 0;
    for (const c of S.corpses) {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > 110) continue;
      const r = rotOf(c);
      s += Math.min(1, r) * (r > 1.6 ? .25 : 1) * (1 - d / 110) * (c.k === 'person' ? 1 : .7);
    }
    return Math.min(1.5, s);
  }
  function newStrain(from) {
    const used = new Set([...S.strains.values()].filter(s => s.cases > 0 && s.active).map(s => s.name));
    const st = {
      id: S.nextId++, name: pick(STRAIN_NAMES.filter(n => !used.has(n)).concat(STRAIN_NAMES).slice(0, 12)),
      grow: .012 + rnd() * .03, lethal: .15 + rnd() * .9, contagion: .002 + rnd() * .01, from, year: S.year, cases: 0, active: true,
    };
    S.strains.set(st.id, st);
    return st;
  }
  // about half of all rotting bodies breed something nasty
  function corpseStrain(c) {
    if (c.strain == null) c.strain = rnd() < (c.k === 'person' ? .5 : .2) ? newStrain(c.k === 'person' ? 'a rotting body' : 'a rotting carcass').id : 0;
    return c.strain;
  }
  function infect(e, strainId) {
    if (!strainId || e.strain || e.immune.includes(strainId)) return false;
    const st = S.strains.get(strainId);
    if (!st) return false;
    e.strain = strainId; e.dis = Math.max(e.dis, .05); e.imm = 0;
    st.cases++; st.active = true;
    return true;
  }
  // breathing near rotting bodies; drinking water that bodies lie beside
  function exposure(e) {
    for (const c of S.corpses) {
      const r = rotOf(c);
      if (r < .3 || Math.abs(c.x - e.x) > 35 || Math.abs(c.z - e.z) > 35) continue;
      if (rnd() < .0025 * Math.min(r, 1.5)) infect(e, corpseStrain(c));
    }
  }
  function waterGerm(px, pz) {
    for (const c of S.corpses) if (rotOf(c) > .2 && Math.hypot(c.x - px, c.z - pz) < 90 && rnd() < .25) return corpseStrain(c);
    return 0;
  }
  function corpses() {
    for (let i = S.corpses.length - 1; i >= 0; i--) if (rotOf(S.corpses[i]) > 3) S.corpses.splice(i, 1);
  }

  // ───────── buildings and crops ─────────
  function shelterAt(px, pz) {
    let b = 0;
    for (const s of S.structs) {
      if ((s.k !== 'hut' && s.k !== 'house' && s.k !== 'hall') || (s.prog ?? 1) < 1) continue;
      const r = s.k === 'hall' ? 28 : 18;
      if (Math.abs(s.x - px) < r && Math.abs(s.z - pz) < r) b = Math.max(b, s.k === 'hall' ? .55 : s.k === 'house' ? .45 : .32);
    }
    return b;
  }
  const damNear = (px, pz) => S.structs.some(s => s.k === 'dam' && (s.prog ?? 1) >= 1 && Math.hypot(s.x - px, s.z - pz) < 160);
  const cropRipe = c => growing() && S.time >= c.next;

  function tick(dt) {
    weather(dt);
    fires(dt);
  }
  function perSecond() {
    lightning();
    corpses();
    for (const st of S.strains.values()) if (st.active && !S.people.some(p => p.strain === st.id)) st.active = false;
  }

  return {
    season, seasonTemp, night, airTemp, frozenAt, growing, nearestShore, ripe, harvest, sticksLeft, takeStick, fell,
    oreLeft, takeOre, objById, regrowYearly, plantTree, replant, felledList, pickedIds, makeFire, igniteTree, igniteStruct, treesNear, fireWarmth,
    rotOf, smellAt, newStrain, corpseStrain, infect, exposure, waterGerm, shelterAt, damNear, cropRipe, tick, perSecond,
  };
}
