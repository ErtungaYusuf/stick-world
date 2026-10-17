// Stick World, the life simulation. Authoritative on the server; clients only draw what it reports.
//
// Each person: a body that hurts (hunger, thirst, cold, wounds, sickness, loneliness, fear, grief…), a few
// possessions nobody else controls, a purpose in life, and a mind that learns from experience:
//   · it predicts what each action will change (learned from doing it, watching others, being told),
//   · it scores every option it can see by the pain it expects to relieve, its purpose, how it feels about
//     the people and things involved, and what it simply likes doing,
//   · it picks with some noise (more for dull minds) and learns from what actually happened.
// No behaviour beyond that is written down: theft, gifts, worship, burial, war and leadership happen or don't.
import { TAU, clamp, smooth, frac, damp, angDiff } from '../../shared/core.js';
import { WATER as SEA, CH } from '../../shared/world.js';
import { steer, moveCollide } from '../../shared/motion.js';
import { DAY, YEAR, rnd, pick, dist, gumbel, createGrid, findPath } from './util.js';
import { ITEMS, label, edible, TOOLS, best as bestItem, resolveRecipe, ingredients, USED_IN, worn } from './items.js';
import * as M from './mind.js';
import { createEnv, conceptOfObj, SEASON_NAMES, STRUCT_SOLID } from './env.js';
import { createAnimals, KINDS } from './animals.js';
import { createActions, BUILD, BUILD_T } from './actions.js';
import { createPlayers } from './players.js';
import { createSociety } from './society.js';

export { YEAR, DAY };
const NAMES_M = ['Liam', 'Noah', 'Oliver', 'James', 'Elijah', 'William', 'Henry', 'Lucas', 'Benjamin', 'Theo', 'Jack', 'Leo', 'Samuel', 'Owen', 'Daniel', 'Ethan', 'Caleb', 'Isaac', 'Hudson', 'Adam', 'Miles', 'Felix', 'Arthur', 'Ezra', 'Jonah', 'Simon', 'Max', 'Eli', 'Oscar', 'Hugo', 'Finn', 'Gabriel', 'Nathan', 'Ryan', 'Thomas', 'Victor', 'Wesley', 'Aaron', 'Colin', 'Dylan', 'Grant', 'Ian', 'Kai', 'Luke', 'Mark', 'Paul', 'Reid', 'Seth', 'Tyler', 'Vince', 'Abel', 'Bram', 'Cyrus', 'Dorian', 'Emil', 'Gideon', 'Ivo', 'Jasper', 'Knut', 'Lev'];
const NAMES_F = ['Olivia', 'Emma', 'Charlotte', 'Amelia', 'Sophia', 'Mia', 'Isabella', 'Ava', 'Evelyn', 'Luna', 'Harper', 'Ella', 'Grace', 'Chloe', 'Nora', 'Lily', 'Hazel', 'Zoe', 'Ruby', 'Ivy', 'Alice', 'Clara', 'Stella', 'Violet', 'Aurora', 'Hannah', 'Lucy', 'Anna', 'Sadie', 'Eva', 'Maya', 'Iris', 'Rose', 'Jade', 'Leah', 'Julia', 'Ellie', 'Freya', 'Nina', 'Tessa', 'Vera', 'Wren', 'Faith', 'Gemma', 'Holly', 'Kate', 'Mabel', 'Naomi', 'Pearl', 'Sara', 'Ada', 'Bea', 'Cora', 'Dina', 'Edda', 'Greta', 'Hilde', 'Inga', 'Juno', 'Lena'];
const SURNAMES = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Miller', 'Wilson', 'Moore', 'Clark', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Hill', 'Green', 'Baker', 'Carter', 'Turner', 'Parker', 'Evans'];
const SPOIL = { meat: 420, fish: 320, flesh: 420, milk: 160, cooked: 900 };
const SPOILS = Object.keys(SPOIL);
const HEAVY = new Set(['chop', 'gather', 'dig', 'build', 'hunt', 'attack', 'bury']);
const RITUAL_POSES = ['pray', 'worship', 'dance', 'chant'];
const STAT_KEYS = ['kills', 'thefts', 'gifts', 'tends', 'sickTends', 'hunted', 'fish', 'picks', 'chops', 'ores', 'crafted', 'built', 'planted', 'harvests', 'fed', 'tamed', 'venerated', 'taught', 'buried', 'cannibal', 'attacks', 'mates'];
const REMEMBER_ANY = ['rock', 'shrub', 'pine', 'fire', 'hut', 'house', 'hall', 'store', 'totem', 'grave', 'furnace', 'well', 'stele'];
const REMEMBER_RIPE = ['bush', 'tree', 'mushroom', 'herb'];

export function lifeStage(age) { return age < 1 ? 'Baby' : age < 4 ? 'Toddler' : age < 13 ? 'Child' : age < 18 ? 'Teen' : age < 60 ? 'Adult' : 'Elder'; }
// Gompertz–Makeham mortality per year: background risk + risk doubling roughly every 8 years, plus infancy
const hazard = age => .0006 + .0001 * Math.exp(.085 * age) + (age < 1 ? .01 : age < 5 ? .002 : 0);
const fertile = e => e.sex === 'F' ? smooth(16, 20, e.age) * (1 - smooth(34, 46, e.age)) : smooth(16, 19, e.age) * (1 - smooth(55, 75, e.age) * .7);

export function createSim(world, hooks) {
  const S = {
    time: 0, dayT: .3, year: 0, nextId: 1, births: 0, deaths: 0, timeScale: 1, speed: 1, fertility: 1, cap: 400,
    people: [], byId: new Map(), names: new Map(), animals: [], corpses: [], fires: [], structs: [], crops: [],
    plants: new Map(), strains: new Map(), weather: { rain: 0, storm: false, t: 30 }, plantVer: 1, felledVer: 1,
    firsts: new Set(), techs: new Map(), bands: new Map(), faiths: new Map(), towns: [], hostility: new Map(),
    followers: new Map(), believers: new Map(), bandSeq: 0, faithSeq: 0,
    killings: 0, attacks: 0, thefts: 0, gifts: 0, crafted: 0, explosions: 0, players: new Map(), avatars: new Map(), bombs: [], home: null,
    winterSev: 0, winterYear: -1, chronicle: [],
  };
  const log = (type, text) => hooks.event(type, text, S.year);
  const fx = m => hooks.fx(m);
  function story(e, text, big = false) {
    if (!e.story) e.story = [];
    e.story.push({ y: Math.floor(S.year), t: text });
    if (e.story.length > 18) e.story.splice(1, 1);   // keep the first line (birth) and the latest
    if (big) chron(`${e.name} ${e.sur || ""}`.trim() + ": " + text);
  }
  function chron(text) {
    S.chronicle.push({ y: Math.round(S.year * 10) / 10, t: text });
    if (S.chronicle.length > 4000) S.chronicle.splice(0, S.chronicle.length - 4000);
  }
  function first(key, type, text) { if (S.firsts.has(key)) return false; S.firsts.add(key); log(type, text); return true; }

  const pgrid = createGrid(64), agrid = createGrid(96);
  let agridT = 1;
  const peopleNear = (px, pz, r, fn) => pgrid.near(px, pz, r, fn);
  const x = {
    S, world, log, fx, first, peopleNear, night: () => env.night(),
    byId: id => S.byId.get(id) || [...S.avatars.values()].find(a => a.id === id && a.alive),
    hurtPerson: (...a) => hurtPerson(...a), hurtAvatar: (...a) => players.hurt(...a), stepTo: (...a) => stepTo(...a), destroyStruct: (...a) => destroyStruct(...a), burnNear: (...a) => burnNear(...a),
  };
  const env = createEnv(world, S, x);
  x.env = env;
  const zoo = createAnimals(world, S, x);
  x.zoo = zoo;
  const soc = createSociety(S, x);

  // ───────── belongings ─────────
  const has = (e, k, n = 1) => (e.inv[k] || 0) >= n;
  const hasAll = (e, req) => Object.entries(req).every(([k, n]) => has(e, k, n));
  const add = (e, k, n = 1) => { e.inv[k] = (e.inv[k] || 0) + n; };
  function take(e, k, n = 1) {
    const got = Math.min(n, e.inv[k] || 0);
    if (got) { e.inv[k] -= got; if (e.inv[k] <= 0) delete e.inv[k]; }
    return got;
  }
  const invTotal = e => { let s = 0; for (const k in e.inv) s += e.inv[k]; return s; };
  // what a thing is worth to someone: how much it has gone along with feeling better
  const worth = (e, k) => clamp(M.like(e, k) / 100, 0, 1) + .03;
  function wealthOf(e) { let s = 0; for (const k in e.inv) s += e.inv[k] * worth(e, k); return s; }
  const catOf = p => p.age < 14 ? 'child' : 'person';
  const kin = (a, b) => a.motherId === b.id || a.fatherId === b.id || b.motherId === a.id || b.fatherId === a.id ||
    (a.motherId && a.motherId === b.motherId) || (a.fatherId && a.fatherId === b.fatherId);
  const busy = p => !!p.task && !['idle', 'wander', 'warm', 'follow'].includes(p.task.A.id);

  // ───────── people ─────────
  function freshName(sex) {
    const pool = sex === 'M' ? NAMES_M : NAMES_F, used = new Set(S.people.map(p => p.name));
    const free = pool.filter(n => !used.has(n));
    return pick(free.length ? free : pool);
  }
  function makePerson(o) {
    const e = Object.assign({
      id: S.nextId++, name: '', sur: '', sex: 'M', age: 0, bornYear: S.year, alive: true,
      x: 0, z: 0, y: 0, vx: 0, vz: 0, heading: rnd() * TAU, turn: 8, hue: rnd() * 360, tall: .94 + rnd() * .12, seed: rnd() * 100,
      motherId: null, fatherId: null, kids: [], partnerId: null,
      tr: M.randomTraits(), goal: { k: 'survive', c: null }, goalVal: 0, sacred: null,
      food: .85, water: .85, warmth: .8, energy: .9, health: 1, bleed: 0, dis: 0, tox: 0, strain: null, imm: 0, immune: [],
      social: .7, fear: 0, distress: 0, grief: 0, desire: 0, disgust: 0, wealth: 0,
      inv: {}, M: new Map(), W: new Map(), EL: new Map(), Vprev: 0, R: new Map(), mem: new Map(), ven: {},
      exp: { hurt: 0, starved: 0, gifts: 0, robbed: 0, beaten: 0, kinKilled: 0, orphaned: 0, oppressed: 0, trauma: 0 },
      story: [], trauma: 0, chaos: 0, obeyed: 0, avenge: null,
      stats: Object.fromEntries(STAT_KEYS.map(k => [k, 0])),
      preg: 0, pregFather: null, lastBirth: -99,
      task: null, act: null, carry: null, bubble: null, label: 'Idle', asleep: false, held: false, sneaking: false,
      seen: null, lookT: rnd(), thinkT: rnd(), sv: new Array(M.NV).fill(0), Pnow: 0, dP: 0, Gprev: 0, wealthPrev: 0, sick0: 0, health0: 1,
      recent: [], following: null, followUntil: 0, feltT: .6, huddle: 0, lastHurt: null, band: null, role: 'child', feared: 0, home: null,
      lastBday: 0, followPeak: 0,
    }, o);
    for (const k of ['M', 'W', 'EL', 'R', 'mem']) if (!(e[k] instanceof Map)) e[k] = new Map(e[k] || []);
    e.seen = e.seen && e.seen.things ? e.seen : { people: [], animals: [], things: new Map(), shore: null, sacred: [], threats: [] };
    S.people.push(e); S.byId.set(e.id, e); S.names.set(e.id, e.name);
    return e;
  }

  // ───────── perception ─────────
  function look(e) {
    const night = env.night(), lit = night > .6 && (bestItem(e.inv, 'light') || fireNear(e, 60));
    const R = e.age < 6 ? 110 : 190 * (night > .6 && !lit ? .75 : 1);
    const P = { people: [], animals: [], things: new Map(), shore: null, sacred: [], threats: [] };
    const put = (c, o, d, src) => { let a = P.things.get(c); if (!a) P.things.set(c, a = []); a.push({ o, d, src }); };
    pgrid.near(e.x, e.z, R, (p, d) => {
      if (p === e) return;
      P.people.push({ p, d });
      // small children stir something in everyone (more in the kind-hearted): not learned, it's biology
      if (p.age < 6 && !e.W.has('p:' + p.id)) M.setLike(e, 'p:' + p.id, 30 * e.tr.empathy);
    });
    P.people.sort((a, b) => a.d - b.d);
    if (P.people.length > 10) P.people.length = 10;
    agrid.near(e.x, e.z, R, (a, d) => P.animals.push({ a, d }));
    P.animals.sort((a, b) => a.d - b.d);
    if (P.animals.length > 6) P.animals.length = 6;
    for (let cz = Math.floor((e.z - R) / CH); cz <= Math.floor((e.z + R) / CH); cz++)
      for (let cx = Math.floor((e.x - R) / CH); cx <= Math.floor((e.x + R) / CH); cx++)
        for (const o of world.chunkData(cx, cz).objs) {
          if (Math.abs(o.x - e.x) > R || Math.abs(o.z - e.z) > R) continue;
          const d = Math.hypot(o.x - e.x, o.z - e.z);
          if (d > R) continue;
          if (o.felled) { if ((o.t === 'tree' || o.t === 'pine') && d < 120) put('stump', o, d, 'obj'); continue; }
          if (o.dead) { if (d < 120) put('withered', o, d, 'obj'); continue; }
          const c = conceptOfObj(o);
          if (c) put(c, o, d, 'obj');
        }
    for (const c of S.corpses) { const d = Math.hypot(c.x - e.x, c.z - e.z); if (d < R) put(env.rotOf(c) > 1 ? 'bones' : c.k === 'person' ? 'corpse' : 'carcass', c, d, 'corpse'); }
    for (const f of S.fires) { const d = Math.hypot(f.x - e.x, f.z - e.z); if (d < R) put('fire', f, d, 'fire'); }
    for (const s of S.structs) { const d = Math.hypot(s.x - e.x, s.z - e.z); if (d < R) put(s.k === 'granary' ? 'store' : s.k, s, d, 'struct'); }
    for (const c of S.crops) { const d = Math.hypot(c.x - e.x, c.z - e.z); if (d < R) put('crop', c, d, 'crop'); }
    let novel = 0;
    for (const [c, a] of P.things) {
      a.sort((p, q) => p.d - q.d);
      if (a.length > 3) a.length = 3;
      if (!e.W.has(c)) { novel++; e.W.set(c, 0); }   // a new kind of thing: curiosity is rewarded
    }
    P.shore = env.nearestShore(e.x, e.z, Math.min(R, 170));
    // remembering where things are
    if (P.shore) e.mem.set('river', { x: P.shore.x, z: P.shore.z, t: S.time });
    for (const c of REMEMBER_ANY) { const a = P.things.get(c); if (a) e.mem.set(c, { x: a[0].o.x, z: a[0].o.z, t: S.time }); }
    // places where food grows are remembered even when bare (with a note to check back later)
    for (const c of REMEMBER_RIPE) {
      const a = P.things.get(c);
      if (!a) continue;
      const r = a.find(t => env.ripe(t.o));
      if (r) e.mem.set(c, { x: r.o.x, z: r.o.z, t: S.time });
      else if (!e.mem.has(c)) e.mem.set(c, { x: a[0].o.x, z: a[0].o.z, t: S.time, empty: S.time });
    }
    // things out there one might come to revere, sky included
    P.sacred.push({ c: night > .5 ? 'moon' : 'sun', x: e.x, z: e.z, sky: true });
    if (S.weather.rain > .2) P.sacred.push({ c: S.weather.storm ? 'storm' : 'rain', x: e.x, z: e.z, sky: true });
    if (env.season() === 3 && env.frozenAt(e.x, e.z)) P.sacred.push({ c: 'snow', x: e.x, z: e.z, sky: true });
    if (P.shore) P.sacred.push({ c: 'river', x: P.shore.x, z: P.shore.z });
    for (const [c, a] of P.things) if (M.SACRED.has(c) && c !== 'river') P.sacred.push({ c, x: a[0].o.x, z: a[0].o.z });
    for (const t of P.things.get('grave') || []) if (M.like(e, t.o.c) > 15) P.sacred.push({ c: t.o.c, x: t.o.x, z: t.o.z });
    for (const { a } of P.animals) if (!P.sacred.some(s => s.c === a.k)) P.sacred.push({ c: a.k, x: a.x, z: a.z });
    // danger
    for (const { p, d } of P.people) {
      if (d > 90) break;
      const T = p.task;
      if (!T) continue;
      if ((T.A.id === 'attack' || T.A.id === 'bomb') && (T.tgt === e || d < 50)) P.threats.push({ c: 'person', o: p });
    }
    for (const { a, d } of P.animals) if (!a.owner && d < 90 && ((a.k === 'wolf' && d < 75) || (a.k === 'bear' && a.act !== 'sleep') || (a.state === 'fight' && a.threat === e))) P.threats.push({ c: a.k, o: a });
    for (const f of P.things.get('fire') || []) if (f.o.wild && f.d < 70) { P.threats.push({ c: 'fire', o: f.o }); break; }
    P.strangers = [];
    for (const a of S.avatars.values()) {
      if (!players.here(a)) continue;
      const d = Math.hypot(a.x - e.x, a.z - e.z);
      if (d > R) continue;
      P.strangers.push({ p: a, d });
      if (d < 80) M.notice(e, 'p:' + a.id, .25);
      if (a.aggroT > S.time && d < 90 && P.threats.length < 2) P.threats.unshift({ c: 'person', o: a });
    }
    if (P.threats.length > 2) P.threats.length = 2;
    e.seen = P;
    e.novel = novel;
    // the body notices too
    e.disgust = env.smellAt(e.x, e.z);
    env.exposure(e);
    let huddle = 0;
    for (const { d } of P.people) if (d < 14) huddle++; else break;
    e.huddle = huddle;
    const shelter = env.shelterAt(e.x, e.z);
    e.feltT = env.airTemp(e.x, e.z) + env.fireWarmth(e.x, e.z) + shelter + (shelter ? S.weather.rain * .07 : 0)
      + worn(e.inv, 'warm') + Math.min(3, huddle) * .04;
  }

  // what grabs attention this second (dull minds notice more of the background, and credit it)
  function salience(e) {
    const sal = [], P = e.seen, dull = 1.6 - e.tr.iq, T = e.task;
    if (T) {
      sal.push(['do:' + T.A.id, 1]);
      if (T.k && T.k !== 'rest' && T.k !== 'land' && T.k !== 'unknown' && T.k !== 'ground') sal.push([T.k, 1]);
      if (T.item) sal.push([T.item, .6]);
    }
    for (let i = 0; i < Math.min(4, P.people.length); i++) {
      const { p, d } = P.people[i];
      sal.push(['p:' + p.id, d < 40 ? .5 : .15]);
      if (p.band) sal.push(['b:' + p.band, .1]);
      if (d < 70 && p.task && p.task.stage === 'do') sal.push(['do:' + p.task.A.id, .3]);
    }
    let n = 0;
    for (const [c, a] of P.things) { if (n++ >= 6) break; sal.push([c, (a[0].d < 30 ? .35 : .1) * dull]); }
    for (let i = 0; i < Math.min(2, P.animals.length); i++) sal.push([P.animals[i].a.k, .2 * dull]);
    for (const s of P.sacred) if (s.sky) sal.push([s.c, .04 * dull]);
    if (P.shore && P.shore.d < 60) sal.push(['river', .25 * dull]);
    let k1 = null, k2 = null;
    for (const k in e.inv) { if (!k1 || e.inv[k] > e.inv[k1]) { k2 = k1; k1 = k; } else if (!k2 || e.inv[k] > e.inv[k2]) k2 = k; }
    if (k1) sal.push([k1, .15]);
    if (k2) sal.push([k2, .1]);
    return sal;
  }

  // how much someone's suffering matters to me: love makes it hurt, hatred makes it sweet (if I'm that way)
  function rho(e, p) {
    const w = M.like(e, 'p:' + p.id) / 100;
    return w >= 0 ? e.tr.empathy * w * 1.2 : e.tr.agg * w * .9;
  }

  // ───────── purpose ─────────
  function lovedBy(e) { let s = 0; const k = 'p:' + e.id; for (const p of S.people) if (p !== e) s += M.like(p, k); return s / 100; }
  function descendants(e) {
    let n = 0;
    for (const id of e.kids) { const c = S.byId.get(id); if (c) n++; const cc = c || null; if (cc) for (const g of cc.kids) if (S.byId.has(g)) n += .5; }
    return n;
  }
  function goalValue(e) {
    switch (e.goal.k) {
      case 'better': {
        let s = -e.Pnow, n = 1, t = 0;
        for (const { p, d } of e.seen.people) if (d < 150) { s -= p.Pnow; n++; }
        for (const c of e.seen.things.keys()) t += M.like(e, c);
        return s / n + t / 100 * .05;
      }
      case 'wealth': return e.wealth + S.structs.filter(s => s.owner === e.id).length * 1.5;
      case 'power': return (S.followers.get(e.id) || 0) + e.feared * .5 + e.obeyed * .5;
      case 'cruelty': { let s = 0, n = 0; for (const { p, d } of e.seen.people) if (d < 150) { s += p.Pnow; n++; } return n ? s / n : 0; }
      case 'kill': return e.stats.kills;
      case 'love': return lovedBy(e);
      case 'family': return descendants(e);
      case 'knowledge': { let n = 0; for (const r of e.R.values()) if (r.ok) n += .5; for (const m of e.M.values()) if (m.n >= 2) n += .03; return n; }
      case 'devotion': return (S.believers.get(e.goal.c) || 0) + Math.min(5, e.ven[e.goal.c] || 0) * .2;
      case 'builder': return S.structs.filter(s => s.builder === e.id).length;
      case 'revenge': { const t = e.goal.c && S.byId.get(Number(e.goal.c.slice(2))); return t ? 1 - t.health : 2; }
      case 'order': return (S.followers.get(e.id) || 0) * .4 + e.obeyed * .2 - e.chaos * .4;
    }
    return 0;
  }

  // ───────── every second: perceive, feel, learn ─────────
  function think(e) {
    look(e);
    e.wealth = wealthOf(e);
    const P = M.painNow(e), G = goalValue(e);
    let r = e.Pnow - P;                                             // relief is good, suffering is bad
    r += M.GOALS[e.goal.k].drive * (G - e.Gprev);                  // so is getting closer to what you live for
    r += e.tr.greed * .12 * (e.wealth - e.wealthPrev);             // and having more
    for (const { p, d } of e.seen.people) { if (d > 120) break; const k = rho(e, p); if (k) r -= k * p.dP; }   // and others' pain, as you feel about them
    r += e.novel * e.tr.curious * .03;
    M.tdStep(e, r, salience(e));
    e.dP = P - e.Pnow; e.Pnow = P; e.Gprev = G; e.goalVal = G; e.wealthPrev = e.wealth;
    // delayed consequences (a stomach ache an hour after the mushrooms) are pinned on what was done before
    for (const ep of e.recent) {
      if (ep.done || S.time - ep.end < 20) continue;
      ep.done = true;
      const d = ep.delta.slice();
      d[M.SICK] += Math.min(1, e.dis + e.tox) - ep.s1[M.SICK];
      d[M.HEALTH] += e.health - ep.s1[M.HEALTH];
      M.learn(e, ep.key, d, ep.T, .5, [M.SICK, M.HEALTH]);
    }
    if (e.recent.length && e.recent[0].done) e.recent.shift();
    if (e.food < .05 && e.age > 10) e.exp.starved += .02;
    // bubbles
    if (!e.bubble) {
      if (e.grief > .5 && rnd() < .05) e.bubble = { ch: '😢', t: 2 };
      else if (e.dis > .4 && rnd() < .08) e.bubble = { ch: '🤢', t: 1.6 };
      else if (P > 1.2 && rnd() < .05) e.bubble = { ch: '💢', t: 1.4 };
    }
  }

  // ───────── choosing what to do ─────────
  const sbuf = new Array(M.NV).fill(0), s1 = new Array(M.NV).fill(0), s2 = new Array(M.NV).fill(0);
  // choices are weighed against how the body will be a little while from now, not just this instant
  // (you drink before you are parched, because getting to the water takes time)
  const HORIZON = 25;
  function ahead(e) {
    const s = M.stateOf(e, sbuf);
    s[M.FOOD] = Math.max(0, s[M.FOOD] - HORIZON / 140);
    s[M.WATER] = Math.max(0, s[M.WATER] - HORIZON / 100);
    s[M.ENERGY] = Math.max(0, s[M.ENERGY] - HORIZON / 75);
    return s;
  }
  const magicOf = e => .05 + .35 * (1 - e.tr.iq);
  // what getting a thing is worth right now: the relief of using it, by this person's own model (one step of looking ahead)
  // What one more (or one less) of a thing is worth:
  //  · later: the relief it will bring the next time they're in need, discounted by patience (the clever plan
  //    further ahead) and by how many they already hold
  //  · now: the extra relief of using it right away, which only matters if they hold none
  const NOVAL = { now: 0, later: 0 };
  function itemValue(e, k, s0, p0, memo) {
    if (memo.has(k)) return memo.get(k);
    let v = NOVAL;
    const it = ITEMS[k], use = it && (it.food ? 'eat' : it.drink ? 'drink' : null);
    if (use) {
      const m = M.predict(e, use + ':' + k, use + ':*');
      if (m) {
        const d = m.d.slice(), have = e.inv[k] || 0;
        for (let i = 0; i < M.NV; i++) s2[i] = i < M.FELT ? clamp(s0[i] + d[i], 0, 1) : s0[i];
        const now = Math.max(0, p0 - M.painOf(e, s2));
        for (let i = 0; i < M.NV; i++) s2[i] = s0[i];
        s2[use === 'eat' ? M.FOOD : M.WATER] = .3;   // how it will be next time
        const pNeed = M.painOf(e, s2);
        for (let i = 0; i < M.FELT; i++) s2[i] = clamp(s2[i] + d[i], 0, 1);
        const later = Math.max(0, pNeed - M.painOf(e, s2)) * (.3 + .4 * e.tr.iq) / (1 + have / 4);
        v = { now: have > 0 ? 0 : Math.max(0, now - later), later };
      }
    }
    else if (it) {
      memo.set(k, NOVAL);   // (guards against loops through recipes)
      const have = e.inv[k] || 0;
      let later = 0;
      const t = M.predict(e, 'tool:' + k, 'tool:*');
      if (t && t.n > 0) later = Math.max(later, t.d[M.WEALTH] * .8);
      for (const rk of USED_IN.get(k) || []) {
        const r = e.R.get(rk);
        if (!r || !r.ok || !r.res || r.res === 'FIRE') continue;
        const g = ingredients(rk), rv = itemValue(e, r.res, s0, p0, memo);
        later = Math.max(later, (rv.later + rv.now) * .7 / g.items.length);
      }
      later = Math.max(later, clamp(M.like(e, k) / 100, 0, 1) * .15);
      // what might be done with a thing never put to the test: the value of finding out (curiosity, more in the young)
      if (USED_IN.has(k)) {
        let tried = 0;
        for (const [rk, r] of e.R) if (rk.includes(k)) tried += r.tries;
        later = Math.max(later, e.tr.curious * .08 * (1 + 1.5 * (1 - smooth(8, 24, e.age))) / (1 + tried / 2));
      }
      v = later > 0 ? { now: 0, later: later / (1 + have / 2) } : NOVAL;
    }
    memo.set(k, v);
    return v;
  }
  function score(e, c, s0, p0, magic, memo) {
    const m = M.predict(e, c.key, c.A.id + ':*');
    let u = 0, n = 0;
    if (m) {
      for (let i = 0; i < M.NV; i++) s1[i] = i < M.FELT ? clamp(s0[i] + m.d[i], 0, 1) : s0[i];
      u = p0 - M.painOf(e, s1);                                    // expected relief
      u += e.tr.greed * .12 * m.d[M.WEALTH];                       // expected gain
      u += M.GOALS[e.goal.k].drive * m.d[M.GOAL];                  // expected progress toward the purpose
      if (c.p) u -= rho(e, c.p) * m.d[M.TPAIN];                    // what it does to them, as I feel about them
      n = m.n;
      const g = m.g;                                               // (m is a shared buffer: read it before predicting again)
      if (g) for (const k in g) {                                  // what I'll get to keep, or give up
        const n = clamp(g[k], -3, 3);
        if (Math.abs(n) < .05) continue;
        const v = itemValue(e, k, s0, p0, memo);
        u += n > 0 ? .8 * (n * v.later + Math.min(1, n) * v.now) : n * v.later;
      }
    }
    u += magic * M.like(e, c.k) / 100 * c.A.val;                   // associative pull: tend what you love, strike what you hate
    u += .3 * M.like(e, 'do:' + c.A.id) / 100;                     // people want to do what they have come to love doing
    if (c.p) u += .12 * c.A.val * M.like(e, 'p:' + c.p.id) / 100;
    // the untried is tempting, more so in misery, and far more in the young (play is how children learn the world)
    u += e.tr.curious * .14 / Math.sqrt(1 + n) * (1 + .8 * Math.min(1, p0)) * (1 + 2 * (1 - smooth(8, 24, e.age)));
    u -= c.d * .00015 * (c.mem ? 1.5 : 1);                         // walking there costs a little (its real cost is already in what was learned)
    return u;
  }
  function choose(e) {
    const cands = [];
    for (const A of acts.LIST) if (!A.joinOnly && e.age >= A.minAge) A.cands(e, e.seen, cands);
    if (!cands.length) return;
    const s0 = ahead(e), p0 = M.painOf(e, s0), tau = .01 + .05 * (1 - e.tr.iq), magic = magicOf(e), memo = new Map();
    let bestC = null, bu = -Infinity;
    for (const c of cands) {
      const u = score(e, c, s0, p0, magic, memo) + tau * gumbel();
      if (u > bu) { bu = u; bestC = c; }
    }
    start(e, bestC);
  }
  // the options someone is weighing right now, best first (for curious onlookers and debugging)
  function explain(e, n = 8) {
    const cands = [];
    for (const A of acts.LIST) if (!A.joinOnly && e.age >= A.minAge) A.cands(e, e.seen, cands);
    const s0 = ahead(e).slice(), p0 = M.painOf(e, s0), magic = magicOf(e), memo = new Map();
    return cands.map(c => {
      const m = M.predict(e, c.key, c.A.id + ':*');
      return { what: c.key, u: Math.round(score(e, c, s0, p0, magic, memo) * 1000) / 1000, n: m ? Math.round(m.n * 10) / 10 : 0, d: Math.round(c.d), mem: !!c.mem };
    }).sort((a, b) => b.u - a.u).slice(0, n);
  }
  // Halfway through something, while it hurts, they look up: is there something much better to do now?
  // (what's left of the current task keeps the worth it had; switching has to be clearly better)
  function reconsider(e) {
    const T = e.task;
    if (!T || T.joined || T.A.id === 'attack' || T.A.id === 'flee' || T.A.id === 'mate') return;
    const cands = [];
    for (const A of acts.LIST) if (!A.joinOnly && e.age >= A.minAge) A.cands(e, e.seen, cands);
    const s0 = ahead(e), p0 = M.painOf(e, s0), magic = magicOf(e), memo = new Map();
    const cur = score(e, { A: T.A, k: T.k, key: T.key, p: T.p, d: Math.hypot(T.x - e.x, T.z - e.z), mem: T.mem }, s0, p0, magic, memo);
    let bestC = null, bu = -Infinity;
    for (const c of cands) { if (c.key === T.key) continue; const u = score(e, c, s0, p0, magic, memo); if (u > bu) { bu = u; bestC = c; } }
    if (bestC && bu > cur + .12) { abort(e); start(e, bestC); }
  }
  function start(e, c) {
    const A = c.A;
    e.task = {
      A, k: c.k, key: c.key, tgt: c.tgt || null, p: c.p || null, item: c.item, rk: c.rk, own: c.own, crop: c.crop, mem: c.mem, from: c.from,
      x: c.here ? e.x : c.x, z: c.here ? e.z : c.z, stage: 'go', t: 0, go: 0, dur: 0, best: Infinity, stuck: 0,
      s0: M.stateOf(e, new Array(M.NV)), tp0: c.p ? c.p.Pnow : 0, start: S.time, inv0: { ...e.inv },
    };
    if (A.id === 'flee' && c.from && c.from.feared != null) c.from.feared++;
    if (A.id === 'attack') { S.attacks++; e.stats.attacks++; }
    for (const k in c) if (!(k in e.task) && k !== "here" && k !== "d" && k !== "cat") e.task[k] = c[k];   // whatever else the action noted down (what to trade, where the well is…)
    e.label = A.label(e, e.task);
  }
  // someone else's action pulls this person in (a conversation, a lesson, an embrace)
  function join(p, e, id, dur, force) {
    if (!p.alive || p.held || p.asleep || (!force && busy(p)) || M.like(p, 'p:' + e.id) < -30) return false;
    abort(p);
    const A = acts.A[id];
    p.task = {
      A, k: 'p:' + e.id, key: id + ':' + catOf(e), tgt: e, p: e, stage: 'do', t: 0, dur, joined: true, x: e.x, z: e.z, inv0: { ...p.inv },
      s0: M.stateOf(p, new Array(M.NV)), tp0: e.Pnow, start: S.time, best: 0, stuck: 0, go: 0,
    };
    p.label = A.label(p, p.task);
    if (id === 'mate') { p.x = e.x + Math.cos(e.heading + 1.6) * 5; p.z = e.z + Math.sin(e.heading + 1.6) * 5; p.heading = e.heading; }
    return true;
  }
  // would p agree to make love with e? the same weighing as any other choice of theirs
  function consents(p, e) {
    if (!p.alive || p.age < 16 || p.asleep || p.held || busy(p)) return false;
    const c = { A: acts.A.mate, k: 'p:' + e.id, key: 'mate:person', p: e, d: 0 };
    const s0 = ahead(p);
    return score(p, c, s0, M.painOf(p, s0), magicOf(p), new Map()) > 0;
  }

  // ───────── doing it ─────────
  function speedOf(e, mode) {
    const base = 42 * (e.age < 13 ? .65 + e.age / 13 * .35 : 1) * (1 - smooth(60, 90, e.age) * .4) * (.55 + e.health * .45) * (e.energy < .12 ? .7 : 1);
    return mode === 'run' ? base * 1.95 : mode === 'sneak' ? base * .5 : base;
  }
  // with a boat the water is a road (slower: paddling)
  const afloat = { ...world, blocked: () => false };
  const terrainOf = e => e.inv && e.inv.boat ? afloat : world;
  function moveToward(e, tx, tz, sp, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
    let ux = dx / d, uz = dz / d;
    const W = terrainOf(e);
    e.sailing = W === afloat && world.blocked(e.x, e.z);
    if (e.sailing) {
      sp *= .65;
      if (!e.sailed) { e.sailed = true; first('sail', 'discovery', `⛵ ${e.name} pushed a boat out onto the water`); }
    }
    sp = Math.min(sp, d / dt * .9);   // don't overshoot on long (fast-forward) steps
    const ahead = 16;
    if (W.blocked(e.x + ux * ahead, e.z + uz * ahead)) {   // water ahead: swing around it, always to the same side
      const side = e.detour || (e.detour = rnd() < .5 ? 1 : -1);
      for (const a of [.5, 1, 1.5, 2.1, 2.7]) {
        const c = Math.cos(a * side), s = Math.sin(a * side), vx = ux * c - uz * s, vz = ux * s + uz * c;
        if (!world.blocked(e.x + vx * ahead, e.z + vz * ahead)) { ux = vx; uz = vz; break; }
      }
    } else e.detour = 0;
    steer(e, dt, ux * sp, uz * sp, 600);
    moveCollide(W, e, dt, 4, wallsNear(e));
  }
  const stepTo = (e, tx, tz, mode, dt) => moveToward(e, tx, tz, speedOf(e, mode), dt);
  function halt(e, dt) {
    steer(e, dt, 0, 0, 900);
    moveCollide(terrainOf(e), e, dt, 4, wallsNear(e));
  }
  let walls = [];
  const refreshWalls = () => { walls = S.structs.filter(s => STRUCT_SOLID[s.k] && (s.prog ?? 1) >= 1).map(s => ({ x: s.x, z: s.z, solid: STRUCT_SOLID[s.k] })); };
  const wallsNear = e => walls.length ? walls.filter(s => Math.abs(s.x - e.x) < 30 && Math.abs(s.z - e.z) < 30) : walls;
  const face = (e, t) => { e.heading = Math.atan2(t.z - e.z, t.x - e.x); };

  function runTask(e, dt) {
    const T = e.task, A = T.A;
    // short things, once started, get finished
    if (!T.joined && (T.reT = (T.reT ?? 2.5) - dt) <= 0) {
      T.reT = 2.5;
      if (e.Pnow > .2 && (T.stage === 'go' || T.dur - T.t > 6)) { reconsider(e); if (e.task !== T) return; }
    }
    if (T.joined) {   // the other half of a shared activity ends when the first half does
      e.act = A.anim(e, T); T.t += dt; halt(e, dt);
      if (T.tgt) face(e, T.tgt);
      const partner = T.tgt;
      if (!partner.alive || !partner.task || partner.task.tgt !== e || T.t >= T.dur + 1) return end(e, true);
      return;
    }
    if (T.stage === 'go') {
      const mobile = typeof A.mobile === 'function' ? A.mobile(T) : A.mobile;
      if (mobile && T.tgt) { T.x = T.tgt.x; T.z = T.tgt.z; }
      const reach = typeof A.reach === 'function' ? A.reach(e, T) : A.reach;
      const d = Math.hypot(T.x - e.x, T.z - e.z);
      if (mobile && d > 170) return end(e, false);   // lost sight of them
      if (d <= reach + .5) {
        const b = A.begin ? A.begin(e, T) : true;
        if (b === 'go') { T.best = Infinity; T.stuck = 0; return; }
        if (!b) return end(e, false);
        T.stage = 'do'; T.t = 0; T.dur = A.dur(e, T); e.sneaking = false;
        if (T.dur <= 0) return end(e, true);
        return;
      }
      const mode = A.speed ? A.speed(e, T) : 'walk';
      e.sneaking = mode === 'sneak';
      // following a route around the water, if one was needed
      if (T.path && T.path.length) {
        const w = T.path[0];
        if (Math.hypot(w.x - e.x, w.z - e.z) < 10) { T.path.shift(); T.stuck = 0; T.best = Infinity; }
        if (T.path.length) moveToward(e, T.path[0].x, T.path[0].z, speedOf(e, mode), dt);
        else moveToward(e, T.x, T.z, speedOf(e, mode), dt);
      } else moveToward(e, T.x, T.z, speedOf(e, mode), dt);
      T.go += dt;
      if (d < T.best - 2) { T.best = d; T.stuck = 0; }
      else if ((T.stuck += dt) > 3 && !T.path && !mobile && !e.inv.boat) {
        // walking straight doesn't get there: plan a way around
        T.path = findPath(world.blocked, e.x, e.z, T.x, T.z) || [];
        T.stuck = 0;
        if (!T.path.length) { if (T.k && e.mem.get(T.k) && Math.hypot(e.mem.get(T.k).x - T.x, e.mem.get(T.k).z - T.z) < 5) e.mem.delete(T.k); return end(e, false); }
      } else if (T.stuck > 10) return end(e, false);
      if (T.go > 90) return end(e, false);
      return;
    }
    halt(e, dt);
    if (T.tgt && T.tgt.x != null && T.tgt !== e && A.id !== 'flee') e.heading += angDiff(e.heading, Math.atan2(T.tgt.z - e.z, T.tgt.x - e.x)) * damp(6, dt);
    e.act = A.anim(e, T);
    T.t += dt;
    const r = A.work ? A.work(e, T, dt) : null;
    if (!e.task) return;   // died or was interrupted inside work()
    if (r === 'fail') return end(e, false);
    if (r === 'chase') { T.stage = 'go'; T.best = Infinity; T.stuck = 0; return; }
    if (r === 'done' || T.t >= T.dur) return end(e, true);
  }
  function end(e, ok) {
    const T = e.task;
    if (!T) return;
    e.task = null; e.act = null; e.asleep = false; e.sneaking = false; e.label = 'Idle';
    let res = ok;
    if (ok && !T.joined && T.A.finish) { const r = T.A.finish(e, T); if (r === false) res = false; }
    if (e.alive) episode(e, T, res);
    e.thinkT = .1 + rnd() * .3;
  }
  // stop what they're doing; a half-done action says nothing about what it does, so nothing is learned from it
  function abort(e) {
    const T = e.task;
    if (!T) return;
    e.task = null; e.act = null; e.asleep = false; e.sneaking = false; e.label = 'Idle';
  }
  // the end of one go at something: what changed is what this action does, as far as this mind can tell
  function episode(e, T, ok) {
    // never got there (blocked, target gone, changed their mind on the way): that says nothing about the action itself
    if (T.stage === 'go' && !ok) return;
    e.wealth = wealthOf(e);
    e.goalVal = goalValue(e);
    const s1 = M.stateOf(e, new Array(M.NV)), delta = s1.map((v, i) => v - T.s0[i]);
    if (T.p) delta[M.TPAIN] = (T.p.alive ? M.painNow(T.p) : 2) - T.tp0;
    const dur = Math.max(.5, S.time - T.start);
    // what the action itself did, not what time would have done anyway: hunger, thirst and tiredness creep up
    // while doing anything (choices already weigh that through ahead()), so only the difference is the action's
    if (T.s0[M.FOOD] > 0) delta[M.FOOD] += Math.min(T.s0[M.FOOD], dur / 140 * (e.age < 14 ? .75 : 1));
    if (T.s0[M.WATER] > 0) delta[M.WATER] += Math.min(T.s0[M.WATER], dur / 100 * (env.seasonTemp() > .05 ? 1.2 : 1));
    if (T.s0[M.ENERGY] > 0) delta[M.ENERGY] += Math.min(T.s0[M.ENERGY], dur / 75);
    const gain = {};
    if (T.inv0) for (const k of new Set([...Object.keys(e.inv), ...Object.keys(T.inv0)])) { const g = (e.inv[k] || 0) - (T.inv0[k] || 0); if (g) gain[k] = g; }
    M.learn(e, T.key, delta, dur, 1, null, gain);
    M.learn(e, T.A.id + ':*', delta, dur, .5);
    const tool = ok && TOOL_FOR[T.A.id] && bestItem(e.inv, TOOL_FOR[T.A.id]);
    if (tool) {
      let got = 0;
      for (const k in gain) if (gain[k] > 0 && k !== tool) got += gain[k] * worth(e, k);
      if (T.killed) got += .3;
      if (got > 0) { credit(e, 'tool:' + tool, got); credit(e, 'tool:*', got * .5); }
    }
    e.recent.push({ key: T.key, end: S.time, s1, delta, T: dur, done: false });
    if (e.recent.length > 6) e.recent.shift();
    // everyone watching learns from it too, the young most of all
    if (T.joined || T.A.id === 'idle') return;
    const watch = o => {
      if (o === e || o.asleep) return;
      const trust = clamp(.3 + M.like(o, 'p:' + e.id) / 100, .05, 1) * (o.age < 16 ? 1.6 : 1);
      M.learn(o, T.key, delta, dur, .3 * trust, OBSERVED, gain);
      M.notice(o, 'do:' + T.A.id, .35);
    };
    pgrid.near(e.x, e.z, 100, watch);
    // babies in arms watch everything too (they aren't in the grid while carried)
    for (const id of e.kids) { const b = S.byId.get(id); if (b && b.held) watch(b); }
  }
  const OBSERVED = [...M.VISIBLE, M.TPAIN];
  const TOOL_FOR = { chop: 'chop', gather: 'dig', dig: 'dig', fish: 'fish', butcher: 'cut', hunt: 'power', attack: 'power' };

  // ───────── the body ─────────
  function body(e, dt) {
    const T = e.task, moving = Math.hypot(e.vx, e.vz);
    const effort = moving > 60 ? 1.8 : T && T.stage === 'do' && HEAVY.has(T.A.id) ? 1.4 : e.asleep ? .7 : 1;
    const kid = e.age < 14 ? .75 : 1;
    e.food = Math.max(0, e.food - dt / 140 * effort * kid * (e.warmth < .4 ? 1.25 : 1) * (e.preg > 0 ? 1.25 : 1));
    e.water = Math.max(0, e.water - dt / 100 * effort * (env.seasonTemp() > .05 ? 1.2 : 1));
    e.energy = clamp(e.energy + (e.asleep ? dt / 16 * (env.shelterAt(e.x, e.z) ? 1.3 : 1) : -dt / 75 * effort), 0, 1);
    if (e.age >= 15) e.desire = Math.min(1, e.desire + dt * e.tr.libido / 90);
    e.social = clamp(e.social - dt / 260 + Math.min(3, e.huddle) * dt * .0015, 0, 1);
    if (e.trauma > .01) { e.trauma *= Math.exp(-dt / (YEAR * 4)); if (e.distress < e.trauma * .35) e.distress = e.trauma * .35; }
    e.chaos *= Math.exp(-dt / 120); e.obeyed *= Math.exp(-dt / (YEAR * 2));
    e.fear *= Math.exp(-dt / 12); e.distress *= Math.exp(-dt / 45); e.grief *= Math.exp(-dt / 240); e.tox *= Math.exp(-dt / 30);
    e.warmth = clamp(e.warmth + (Math.min(1, e.feltT + .35) - e.warmth) * dt / 25, 0, 1);
    let cause = null;
    if (e.bleed > 0) { e.health -= e.bleed * dt * .6; e.bleed = Math.max(0, e.bleed - dt * .02); cause = e.lastHurt ? e.lastHurt.cause : 'wounds'; }
    if (e.food <= 0) { e.health -= dt / 110; cause = 'starvation'; }
    if (e.water <= 0) { e.health -= dt / 55; cause = 'thirst'; }
    if (e.warmth < .15) { e.health -= (.15 - e.warmth) * dt / 12; cause = 'cold'; }
    if (e.strain) {
      const st = S.strains.get(e.strain);
      if (!st) e.strain = null;
      else {
        e.dis = clamp(e.dis + dt * (st.grow * (1 - e.imm) - e.imm * .035), 0, 1);
        e.imm = Math.min(1, e.imm + dt * (.005 + (e.food > .4 && e.water > .4 ? .004 : 0) + (e.asleep ? .004 : 0)));
        e.health -= st.lethal * e.dis * dt / 120;
        if (e.dis > .2) cause = 'disease';
        if (e.imm > .9 || (e.dis < .01 && e.imm > .3)) { e.immune.push(e.strain); if (e.immune.length > 12) e.immune.shift(); e.strain = null; e.dis = 0; e.imm = 0; }
      }
    }
    if (e.tox > .3) { e.health -= (e.tox - .3) * dt / 40; cause = cause || 'poison'; }
    if (e.food > .3 && e.water > .3 && e.bleed < .01 && e.dis < .1 && e.tox < .2 && e.warmth > .3) e.health = Math.min(1, e.health + dt / (e.asleep ? 70 : 160));
    for (const k of SPOILS) if (e.inv[k] && rnd() < dt * e.inv[k] / SPOIL[k]) { take(e, k); if (k !== 'milk') add(e, 'rotten meat'); }
    e.age += dt / YEAR * S.timeScale;
    if (e.health <= 0) return die(e, cause || 'wounds', e.lastHurt && S.time - e.lastHurt.t < 30 ? e.lastHurt.by : null);
    if (rnd() < hazard(e.age) * dt / YEAR * S.timeScale) return die(e, 'age');
    if (e.preg > 0) { e.preg += dt / (YEAR * .75) * S.timeScale; if (e.preg >= 1) giveBirth(e); }
    if (e.bubble && (e.bubble.t -= dt) <= 0) e.bubble = null;
  }
  // babies are carried and nursed by their mother (biology, not a decision); without her they depend on
  // whoever chooses to take them in
  const carerOf = c => S.byId.get(c.motherId) || (c.carer && S.byId.get(c.carer)) || null;
  function adopt(e, c) {
    c.carer = e.id;
    if (!e.kids.includes(c.id)) e.kids.push(c.id);
    M.setLike(e, 'p:' + c.id, Math.max(M.like(e, 'p:' + c.id), 50));
    M.setLike(c, 'p:' + e.id, Math.max(M.like(c, 'p:' + e.id), 50));
    first('adopt', 'family', `🤱 ${e.name} took in ${c.name}, whose mother is gone`);
  }
  function infant(e, dt) {
    const m = carerOf(e);
    if (m && e.age < 2) {
      e.held = true;
      e.x = m.x + Math.cos(m.heading + 1.2) * 4; e.z = m.z + Math.sin(m.heading + 1.2) * 4; e.y = 16; e.heading = m.heading;
      e.vx = m.vx; e.vz = m.vz;
      if (m.food > .12) { const need = Math.min(1 - e.food, dt / 50); e.food += need; m.food -= need * .5; }
      if (m.water > .12) { const need = Math.min(1 - e.water, dt / 45); e.water += need; m.water -= need * .4; }
      e.feltT = m.feltT;
    } else {
      if (e.held) { e.held = false; e.y = 0; }
      if (e.food < .5) for (const k in e.inv) if (edible(k)) { eat(e, k); break; }
      if (e.water < .5 && has(e, 'waterpot')) { take(e, 'waterpot'); add(e, 'pot'); e.water = Math.min(1, e.water + .5); }
      if (!e.bubble && (e.food < .3 || e.water < .3) && rnd() < dt * .5) e.bubble = { ch: '😭', t: 1.5 };
    }
  }

  // ───────── harm and death ─────────
  // edged: blades and spears open wounds that keep bleeding; fists and teeth mostly bruise
  function hurtPerson(p, dmg, by, cause, edged = !!(by && by.name && bestItem(by.inv, 'power')) || (by && by.k === 'wolf')) {
    if (!p.alive) return false;
    // someone fighting back (or just awake and facing it) can block or dodge; the sleeping and the downed can't
    const downed = p.downUntil > S.time;
    const defending = p.task && p.task.A.id === 'attack' && p.task.tgt === by;
    const guard = p.asleep || downed || p.held ? 0 : defending ? .28 + p.tr.brave * .1 : .1;
    if (by && by.name && rnd() < guard) {
      fx({ kind: 'block', id: p.id, x: p.x, z: p.z, bx: r1(by.x), bz: r1(by.z) });
      M.notice(p, 'p:' + by.id, .5);
      if (!p.task || !['attack', 'flee'].includes(p.task.A.id)) { abort(p); p.thinkT = 0; p.lookT = 0; }
      return false;
    }
    const arm = Math.min(.8, worn(p.inv, 'armor'));
    dmg *= 1 - arm;
    p.health -= dmg;
    p.bleed = Math.min(1, p.bleed + dmg * (edged ? .6 : .15) * (1 - arm * .6));
    p.fear = Math.min(1, p.fear + dmg * 3);
    p.distress = Math.min(1, p.distress + dmg);
    p.exp.hurt++;
    pgrid.near(p.x, p.z, 140, o => { o.chaos = Math.min(5, (o.chaos || 0) + .3); });
    // several at once on someone who leads others: a revolt
    if (by && by.name && (S.followers.get(p.id) || 0) >= 3) {
      p.foes = (p.foes || []).filter(f => S.time - f.t < 25 && f.id !== by.id);
      p.foes.push({ id: by.id, t: S.time });
      if (p.foes.length >= 3 && !(p.revoltAt > S.time - 120)) {
        p.revoltAt = S.time;
        const names = p.foes.map(f => S.byId.get(f.id)).filter(Boolean).map(q => q.name);
        log('revolt', `🔥 Revolt! ${names.slice(0, 4).join(', ')}${names.length > 4 ? ' and others' : ''} rose against ${p.name}`);
        chron(`Revolt against ${p.name} (${names.join(', ')})`);
        for (const f of p.foes) { const q = S.byId.get(f.id); if (q) story(q, `Rose up against ${p.name}`); }
        story(p, 'Faced a revolt');
      }
    }
    p.lastHurt = { by: by && by.name ? by : null, cause: by && by.k && KINDS[by.k] ? by.k : cause, t: S.time };
    fx({ kind: 'hit', id: p.id, x: p.x, z: p.z, blood: true, big: dmg > .2, ...(by ? { bx: r1(by.x), bz: r1(by.z) } : {}) });
    p.bubble = { ch: '💢', t: 1 };
    if (by) {
      M.notice(p, by.name ? 'p:' + by.id : by.k, 1.5);
      if (by.name) {
        // everyone around who cares about the victim takes note of who did it
        pgrid.near(p.x, p.z, 90, o => { if (o !== by && o !== p && !o.asleep && M.like(o, 'p:' + p.id) > 15) M.notice(o, 'p:' + by.id, .6); });
        p.exp.beaten += .2;
      }
    }
    const killed = p.health <= 0;
    if (by && by.name) soc.hit(by, p, killed);
    if (killed) { die(p, cause, by && by.name ? by : null, by && !by.name ? by.k : null); return true; }
    // beaten to the ground: they lie there a while, unable to do anything, before they can get up again
    if (p.health < .25 && !downed) {
      abort(p);
      p.downUntil = S.time + 4 + rnd() * 5;
      fx({ kind: 'knockdown', id: p.id, x: p.x, z: p.z });
      return false;
    }
    if (p.asleep || !p.task || !['attack', 'flee', 'hunt'].includes(p.task.A.id)) { abort(p); p.thinkT = 0; p.lookT = 0; }
    return false;
  }
  const DEATH_TEXT = {
    starvation: e => `💀 ${full(e)} starved to death`, thirst: e => `💀 ${full(e)} died of thirst`, cold: e => `❄ ${full(e)} froze to death`,
    wounds: e => `🩸 ${full(e)} bled to death`, poison: e => `☠ ${full(e)} was poisoned by something ${his(e)} ate`,
    fire: e => `🔥 ${full(e)} burned to death`, explosion: e => `💥 ${full(e)} was blown apart`, childbirth: e => `🩸 ${full(e)} died giving birth`,
  };
  const full = e => e.sur ? `${e.name} ${e.sur}` : e.name;
  const his = e => e.sex === 'M' ? 'his' : 'her';
  function die(e, cause, killer, beast) {
    if (!e.alive) return;
    abort(e);
    e.alive = false; e.cause = beast || cause;
    S.people.splice(S.people.indexOf(e), 1); S.byId.delete(e.id);
    S.deaths++;
    const violent = !!killer || !!beast || ['wounds', 'explosion', 'fire'].includes(cause);
    S.corpses.push({
      id: e.id, k: 'person', pid: e.id, name: e.name, sex: e.sex, hue: e.hue, tall: e.tall, age: e.age, x: e.x, z: e.z, h: e.heading,
      t0: S.time, meat: e.age < 14 ? 3 : 6, fur: 0, inv: e.inv, strain: e.strain || null, killer: killer ? killer.id : null, violent,
    });
    // what they owned goes to whoever they loved most (if anyone); otherwise it stays on the body for anyone to take
    let heir = null, hw = 15;
    for (const [c, w] of e.W) if (c.startsWith('p:') && w > hw) { const p = S.byId.get(Number(c.slice(2))); if (p && p.age >= 6) { hw = w; heir = p; } }
    if (heir) {
      const corpse = S.corpses[S.corpses.length - 1];
      let n = 0;
      for (const k in corpse.inv) { add(heir, k, corpse.inv[k]); n += corpse.inv[k]; }
      corpse.inv = {};
      let built = 0;
      for (const s of S.structs) if (s.owner === e.id) { s.owner = heir.id; built++; }
      if (!heir.home && e.home) heir.home = e.home;
      if (n >= 6 || built) log('inheritance', `📜 ${heir.name} inherited ${[n ? `${n} things` : '', built ? `${built} building${built > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')} from ${e.name}`);
    } else for (const s of S.structs) if (s.owner === e.id) s.owner = null;
    e.inv = {};
    hooks.death(e);
    fx({ kind: 'death', id: e.id, violent });
    if (killer && e.revoltAt > S.time - 120) {
      log('revolt', `👑 ${e.name} was overthrown and killed by ${killer.name}`);
      chron(`${e.name} was overthrown by ${killer.name}`);
      story(killer, `Overthrew ${e.name}`, true);
    }
    if (killer) {
      killer.stats.kills++; S.killings++;
      log('killing', `⚔ ${full(e)} was killed by ${full(killer)}${killer.stats.kills > 1 ? ` (${killer.stats.kills} killed so far)` : ''}`);
    } else if (beast) log('death', `🐺 ${full(e)} was killed by a ${beast}`);
    else if (cause === 'disease') log('death', `🦠 ${full(e)} died of ${e.strain ? (S.strains.get(e.strain) || {}).name || 'a sickness' : 'a sickness'}`);
    else log('death', (DEATH_TEXT[cause] || (p => `✝ ${full(p)} died at the age of ${Math.floor(p.age)}`))(e));
    // grief for those who loved them, terror for those who saw it
    for (const p of S.people) {
      const w = M.like(p, 'p:' + e.id);
      if (w > 10) {
        p.grief = Math.min(1.2, p.grief + w / 100 * .9);
        p.bubble = { ch: '😢', t: 2.5 };
        if (killer && p !== killer) { M.notice(p, 'p:' + killer.id, 1.5 * w / 100); if (kin(p, e) || p.partnerId === e.id) p.exp.kinKilled++; }
      }
      if (violent && Math.abs(p.x - e.x) < 120 && Math.abs(p.z - e.z) < 120) {
        p.fear = Math.min(1, p.fear + .3); p.distress = Math.min(1, p.distress + .2);
        if (killer && p !== killer) M.notice(p, 'p:' + killer.id, .8);
        // seeing someone you love killed leaves a mark that doesn't fade for years
        if (w > 30) { p.trauma = Math.min(1, (p.trauma || 0) + .45); p.exp.trauma = (p.exp.trauma || 0) + 1; }
      }
      // a loved one murdered: a grudge against the killer, and sometimes a life given over to revenge
      if (killer && killer !== p && killer.alive !== false && (kin(p, e) || p.partnerId === e.id || w > 55) && p.age >= 6) {
        p.avenge = killer.id;
        story(p, `Saw ${e.name} killed by ${killer.name}`);
        if (rnd() < .35 + p.tr.agg * .5) {
          p.goal = { k: 'revenge', c: 'p:' + killer.id }; p.Gprev = goalValue(p);
          story(p, `Swore revenge on ${killer.name}`, true);
          log('purpose', `🗡 ${p.name} swore revenge on ${killer.name} for ${e.name}`);
        }
      }
    }
    // children left with no parent at all
    for (const id of e.kids) {
      const c = S.byId.get(id);
      if (!c || c.age >= 16) continue;
      const other = S.byId.get(c.motherId === e.id ? c.fatherId : c.motherId);
      if (other) { story(c, `Lost ${e.sex === 'M' ? 'their father' : 'their mother'}, ${e.name}`); continue; }
      c.exp.orphaned = 1; c.trauma = Math.min(1, (c.trauma || 0) + .5);
      story(c, `Orphaned at ${Math.floor(c.age)} when ${e.name} died`);
      if (c.age >= 4) log('story', `💔 ${c.name}, ${Math.floor(c.age)}, has no parents left`);
    }
    if (killer && killer.avenge === e.id) killer.avenge = null;
    for (const p of S.people) if (p.goal.k === 'revenge' && p.goal.c === 'p:' + e.id) {
      if (killer === p) { story(p, `Took revenge: killed ${e.name}`, true); log('killing', `🗡 ${p.name} has had ${p.sex === 'M' ? 'his' : 'her'} revenge on ${e.name}`); }
      else story(p, `${e.name}, whom ${p.sex === 'M' ? 'he' : 'she'} hated, died`);
      p.avenge = null; p.goal = M.rollGoal(p); p.Gprev = goalValue(p);
    }
    if (e.age >= 12) story(e, `Died (${cause === 'age' ? 'old age' : beast ? 'a ' + beast : killer ? 'killed by ' + killer.name : cause})`);
    if ((S.followers.get(e.id) || 0) >= 3 || e.ruler) chron(`${e.name}, followed by ${S.followers.get(e.id) || 0}, died${killer ? ' at the hands of ' + killer.name : ''}`);
  }

  // ───────── drink, trade, music, writing ─────────
  function drinkItem(e, k) {
    if (!take(e, k)) return;
    const it = ITEMS[k];
    if (it.back) add(e, it.back); else if (k === 'waterpot') add(e, 'pot');
    e.water = Math.min(1, e.water + (it.drink || .5));
    if (it.food) e.food = Math.min(1, e.food + it.food);
    if (it.brew) {   // drunk: cheerful, sociable, careless, sleepy
      e.distress *= 1 - it.brew * .6; e.grief *= 1 - it.brew * .3; e.fear *= .5;
      e.social = Math.min(1, e.social + it.brew * .25); e.energy = Math.max(0, e.energy - it.brew * .12);
      e.tox = Math.min(1, e.tox + it.brew * .18); e.drunkT = S.time + 40;
      e.bubble = { ch: '🍺', t: 2 };
      first('drunk:' + k, 'discovery', `🍺 ${e.name} got drunk on ${label(k)}`);
    }
  }
  // how much a thing is worth to someone, all told (what it does, what it makes, how much they like it)
  function valueOf(e, k) {
    const s0 = ahead(e), p0 = M.painOf(e, s0), v = itemValue(e, k, s0, p0, new Map());
    return v.now + v.later + worth(e, k) * .1;
  }
  function dealWith(e, p) {
    const mine = Object.keys(e.inv).filter(k => e.inv[k] > 0), theirs = Object.keys(p.inv).filter(k => p.inv[k] > 0);
    if (!mine.length || !theirs.length) return null;
    const want = theirs.slice(0, 6).map(k => ({ k, v: valueOf(e, k) })).sort((a, b) => b.v - a.v)[0];
    const spare = mine.slice(0, 6).filter(k => k !== want.k).map(k => ({ k, v: valueOf(e, k) / Math.max(1, e.inv[k] / 2) })).sort((a, b) => a.v - b.v)[0];
    if (!want || !spare || want.v <= spare.v * 1.15 + .005) return null;
    return { give: spare.k, get: want.k };
  }
  // the other side weighs it with their own values (and how they feel about the one offering)
  const acceptsDeal = (p, e, giveUp, receive) => M.like(p, 'p:' + e.id) > -25 && valueOf(p, receive) + M.like(p, 'p:' + e.id) / 2000 > valueOf(p, giveUp);
  function swap(e, p, give, get) {
    if (!has(e, give) || !has(p, get)) return false;
    take(e, give); add(p, give); take(p, get); add(e, get);
    e.stats.trades = (e.stats.trades || 0) + 1; S.trades = (S.trades || 0) + 1;
    M.notice(p, 'p:' + e.id, .6);
    first('trade', 'trade', `🤝 ${e.name} traded ${label(give)} for ${p.name}'s ${label(get)}`);
    if (give === 'coins' || get === 'coins') first('trade:coins', 'trade', `🪙 Coins changed hands for the first time: ${e.name} and ${p.name}`);
    return true;
  }
  function music(e, k) {
    e.social = Math.min(1, e.social + .1);
    let n = 0;
    pgrid.near(e.x, e.z, 100, o => {
      if (o === e || o.asleep) return;
      o.social = Math.min(1, o.social + ITEMS[k].music * .15); o.distress *= .85; o.grief *= .95;
      M.notice(o, 'p:' + e.id, .3); M.notice(o, 'music', .5);
      n++;
    });
    fx({ kind: 'music', x: e.x, z: e.z, item: k });
    if (n >= 3) first('music', 'culture', `🥁 ${e.name} played the ${k} and ${n} people gathered round`);
  }
  function inscribe(e, st, rk) {
    if (!st.lore) st.lore = [];
    if (st.lore.includes(rk) || !(e.R.get(rk) || {}).ok) return false;
    st.lore.push(rk);
    const r = e.R.get(rk), what = r.res === 'FIRE' ? 'fire' : label(r.res);
    if (first('write', 'culture', `📜 ${e.name} carved how to make ${what} into a standing stone — the first writing`)) chron(`${e.name} invented writing`);
    if (st.lore.length === 10) log('culture', `📜 The carved stone near ${e.name}'s people holds ten secrets now`);
    story(e, `Carved the making of ${what} into stone`);
  }
  function study(e, st) {
    const unknown = (st.lore || []).filter(k => !(e.R.get(k) || {}).ok);
    if (!unknown.length) return false;
    if (rnd() > .35 + e.tr.iq * .45) return false;
    const rk = pick(unknown), res = resolveRecipe(rk);
    e.R.set(rk, { ok: 1, tries: 0, res: res ? res.result : null });
    first('read', 'culture', `📖 ${e.name} learned something from the carved stone`);
    return true;
  }
  // snares catch small game by themselves, now and then
  function snares() {
    for (const st of S.structs) {
      if (st.k !== 'snare' || !done(st) || rnd() > .006) continue;
      const prey = S.animals.find(a => KINDS[a.k].small && !a.owner && Math.abs(a.x - st.x) < 160 && Math.abs(a.z - st.z) < 160);
      if (!prey) continue;
      prey.x = st.x; prey.z = st.z;
      zoo.die(prey, 'snared');
      const c = S.corpses[S.corpses.length - 1];
      if (c) c.owner = st.owner;
      const o = S.byId.get(st.owner);
      if (o) first('snare', 'work', `🪤 ${o.name}'s snare caught a ${prey.k}`);
    }
  }

  // ───────── tribute ─────────
  // The one asked decides like any other choice: what giving in has cost them before, what refusing has
  // brought down on them (a beating that came after is pinned on the refusal), and how they feel about the asker.
  function decideYield(t, e) {
    const s0 = ahead(t), p0 = M.painOf(t, s0), magic = magicOf(t), memo = new Map(), cat = catOf(e);
    const yes = score(t, { A: acts.A.yield, k: 'p:' + e.id, key: 'yield:' + cat, p: e, d: 0 }, s0, p0, magic, memo) + .02 * gumbel();
    const no = score(t, { A: acts.A.refuse, k: 'p:' + e.id, key: 'refuse:' + cat, p: e, d: 0 }, s0, p0, magic, memo) + .02 * gumbel();
    return yes >= no ? 'yield' : 'refuse';
  }
  function tribute(e, t) {
    // what they hand over: whatever the asker wants most of what they carry
    const got = [];
    for (let n = 0; n < 2; n++) {
      let k = null, bw = -1;
      for (const it in t.inv) if (t.inv[it] > 0) { const w = worth(e, it) + (edible(it) ? .02 : 0) + rnd() * .02; if (w > bw) { bw = w; k = it; } }
      if (!k) break;
      const c = Math.min(t.inv[k], edible(k) ? 2 : 1);
      take(t, k, c); add(e, k, c); got.push(`${c} ${label(k)}`);
    }
    e.obeyed = (e.obeyed || 0) + 1; e.stats.tribute = (e.stats.tribute || 0) + 1;
    t.exp.oppressed = (t.exp.oppressed || 0) + 1;
    M.notice(t, 'p:' + e.id, 1.2);
    if (e.stats.tribute === 3) { story(e, 'Began taking tribute'); }
    if (e.stats.tribute === 8 && !e.ruler) {
      e.ruler = true;
      const n = S.followers.get(e.id) || 0;
      log('leader', `👑 ${e.name} rules by fear now: ${n ? n + ' follow, and ' : ''}others hand over what ${e.sex === 'M' ? 'he' : 'she'} demands`);
      story(e, 'Became a ruler who takes what they want', true);
    }
    if (t.exp.oppressed === 4) story(t, `Kept being made to give to ${e.name}`);
    return got;
  }
  function refused(e, t) {
    e.distress = Math.min(1, e.distress + .12);
    M.notice(e, 'p:' + t.id, 1.4);   // defiance stings, and is remembered
    t.bubble = { ch: '✋', t: 1.4 };
    if ((t.stats.defied = (t.stats.defied || 0) + 1) === 3) story(t, `Stood up to ${e.name}`);
  }

  // ───────── birth ─────────
  function loveDone(e, p) {
    for (const q of [e, p]) { q.desire = 0; q.social = Math.min(1, q.social + .3); q.stats.mates++; }
    e.partnerId = p.id; p.partnerId = e.id;
    fx({ kind: 'hearts', x: (e.x + p.x) / 2, z: (e.z + p.z) / 2 });
    const f = e.sex === 'F' ? e : p, m = f === e ? p : e;
    first('love', 'love', `💞 ${e.name} and ${p.name} made love for the first time in this world`);
    if (f.preg > 0 || fertile(f) <= 0 || fertile(m) <= 0) return;
    const nursing = f.kids.some(id => { const c = S.byId.get(id); return c && c.age < 1; });
    const p0 = .4 * S.fertility * fertile(f) * fertile(m) * (nursing ? .35 : 1) * (S.people.length > S.cap ? .05 : 1);
    if (rnd() < p0) {
      f.preg = .001;
      f.pregFather = { id: m.id, name: m.name, sur: m.sur, hue: m.hue, tall: m.tall, tr: m.tr };
      log('pregnancy', `🤰 ${f.name} is expecting ${m.name}'s child`);
    }
  }
  function giveBirth(m) {
    const f = m.pregFather, fa = f && S.byId.get(f.id);
    m.preg = 0; m.pregFather = null; m.lastBirth = S.year;
    const n = rnd() < .015 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const sex = rnd() < .512 ? 'M' : 'F';
      const b = makePerson({
        sex, name: freshName(sex), sur: f ? f.sur : m.sur, age: 0, x: m.x, z: m.z, motherId: m.id, fatherId: f ? f.id : null,
        hue: (f ? m.hue + ((((f.hue - m.hue) % 360) + 540) % 360 - 180) / 2 : m.hue) + (rnd() - .5) * 30,
        tall: (m.tall + (f ? f.tall : m.tall)) / 2 + (rnd() - .5) * .05,
        tr: M.inheritTraits(m.tr, f ? f.tr : null), food: .9, water: .9,
      });
      b.goal = M.rollGoal(b);   // a purpose from birth, out of temperament; life may change it later
      // a parent's love for a newborn is not learned
      for (const p of [m, fa]) if (p) { M.setLike(p, 'p:' + b.id, 75); M.setLike(b, 'p:' + p.id, 60); p.kids.push(b.id); }
      for (const id of m.kids) { const s = S.byId.get(id); if (s && s !== b) { M.setLike(s, 'p:' + b.id, 30); M.setLike(b, 'p:' + s.id, 30); } }
      S.births++;
      story(b, `Born to ${m.name}${f ? ' and ' + f.name : ''}`);
      if (fa) story(fa, `${b.name} was born`);
      story(m, `Gave birth to ${b.name}`);
      hooks.birth(b);
      log('birth', `👶 ${full(b)} was born · mother ${m.name}, father ${f ? f.name : '?'}`);
    }
    fx({ kind: 'sparkle', x: m.x, z: m.z });
    if (rnd() < .012) die(m, 'childbirth');
  }

  // ───────── what the actions need from the world ─────────
  function landAround(px, pz, r0, r1) {
    for (let k = 0; k < 12; k++) {
      const a = rnd() * TAU, r = r0 + rnd() * (r1 - r0), qx = px + Math.cos(a) * r, qz = pz + Math.sin(a) * r;
      if (world.elev(qx, qz) > SEA + .015) return { x: qx, z: qz };
    }
    return null;
  }
  function findObj(px, pz, r, concept, ok) {
    let best = null, bd = r;
    for (let cz = Math.floor((pz - r) / CH); cz <= Math.floor((pz + r) / CH); cz++)
      for (let cx = Math.floor((px - r) / CH); cx <= Math.floor((px + r) / CH); cx++)
        for (const o of world.chunkData(cx, cz).objs) {
          if (o.felled || conceptOfObj(o) !== concept || !ok(o)) continue;
          const d = Math.hypot(o.x - px, o.z - pz);
          if (d < bd) { bd = d; best = o; }
        }
    return best;
  }
  function eat(e, k) {
    take(e, k);
    const it = ITEMS[k];
    if (it.back) add(e, it.back);
    e.food = Math.min(1, e.food + it.food * (e.age < 8 ? 1.4 : 1));
    if (it.poison) e.tox = Math.min(1, e.tox + it.poison);
    if (it.germ && rnd() < it.germ * 4) e.tox = Math.min(1, e.tox + .35);
    if (it.cure) { e.imm = Math.min(1, e.imm + it.cure); e.tox *= .6; }
    if (it.vision) vision(e);
    if (it.seed && rnd() < it.seed) add(e, 'seed');
    if (it.human) {
      e.stats.cannibal++;
      first('cannibal', 'cannibal', `🍖 ${e.name} ate human flesh`);
      harm(e, 'corpse', .6, e);
    }
  }
  // red mushrooms: sickness, and a rush of meaning pinned on whatever is in sight
  function vision(e) {
    const opts = e.seen.sacred.length ? e.seen.sacred : [{ c: 'sun' }];
    const s = pick(opts);
    M.setLike(e, s.c, M.like(e, s.c) + 25 + rnd() * 20);
    M.notice(e, s.c, 2);
    e.distress *= .3; e.grief *= .5;
    e.bubble = { ch: '✨', t: 3 };
    fx({ kind: 'vision', x: e.x, z: e.z, symbol: '✨' });
    first('vision:' + s.c, 'vision', `✨ ${e.name} ate red mushrooms and saw ${M.conceptName(s.c, S.names)} in a vision`);
  }
  function steal(e, v) {
    let k = null, bw = -1;
    for (const it in v.inv) if (v.inv[it] > 0) { const w = worth(e, it) + rnd() * .05; if (w > bw) { bw = w; k = it; } }
    if (!k) return false;
    const n = Math.min(v.inv[k], edible(k) ? 2 : 1);
    take(v, k, n); add(e, k, n);
    e.stats.thefts++; S.thefts++;
    pgrid.near(e.x, e.z, 120, o => { if (o !== e) o.chaos = Math.min(5, (o.chaos || 0) + .25); });
    const caught = rnd() < (v.asleep ? .12 : .55);
    if (caught) {
      v.distress = Math.min(1, v.distress + .15 + worth(v, k) * n * .3);
      M.notice(v, 'p:' + e.id, 1.6); v.exp.robbed++;
      v.bubble = { ch: '!', t: 1.5 };
      if (!busy(v)) { abort(v); v.thinkT = 0; }
    }
    let witnesses = 0;
    pgrid.near(e.x, e.z, 70, o => { if (o === e || o === v || o.asleep || rnd() > .35) return; witnesses++; M.notice(o, 'p:' + e.id, .6); M.notice(o, 'do:take', .3); });
    if ([1, 5, 15, 40].includes(e.stats.thefts)) log('theft', `🦹 ${e.name} stole ${label(k)} from ${v.name}${caught ? ' and was caught' : witnesses ? ' (someone saw)' : ''}${e.stats.thefts > 1 ? ` — ${e.stats.thefts} thefts so far` : ''}`);
    return true;
  }
  function stealStore(e, s) {
    let n = 0;
    for (const k of Object.keys(s.inv).sort((a, b) => worth(e, b) - worth(e, a))) { while (s.inv[k] > 0 && n < 3) { s.inv[k]--; add(e, k); n++; } if (!s.inv[k]) delete s.inv[k]; }
    if (!n) return false;
    e.stats.thefts++; S.thefts++;
    const o = S.byId.get(s.owner);
    const seen = o && dist(o, s) < 120 && !o.asleep;
    if (seen) { o.distress = Math.min(1, o.distress + .3); M.notice(o, 'p:' + e.id, 1.5); o.exp.robbed++; }
    if ([1, 5, 15, 40].includes(e.stats.thefts)) log('theft', `🦹 ${e.name} raided ${o ? `${o.name}'s` : 'an abandoned'} store${seen ? ' and was seen' : ''}${e.stats.thefts > 1 ? ` — ${e.stats.thefts} thefts so far` : ''}`);
    return true;
  }
  function loot(e, c) {
    let n = 0;
    for (const k in c.inv) { add(e, k, c.inv[k]); n += c.inv[k]; }
    c.inv = {};
    if (n && c.k === 'person') harm(e, 'p:' + c.pid, .3, c);
    return n > 0;
  }
  function withdraw(e, s) {
    let n = 0;
    for (const k of Object.keys(s.inv)) { const want = edible(k) ? 3 : 2; const got = Math.min(want, s.inv[k]); s.inv[k] -= got; if (!s.inv[k]) delete s.inv[k]; add(e, k, got); n += got; if (n >= 6) break; }
    return n > 0;
  }
  function deposit(e, s) {
    for (const k of Object.keys(e.inv)) {
      const keep = TOOLS.has(k) ? 1 : edible(k) ? 2 : 0, n = e.inv[k] - keep;
      if (n > 0) { take(e, k, n); s.inv[k] = (s.inv[k] || 0) + n; }
    }
  }
  function giftFor(e, p) {
    if (p.food < .45) { let k = null; for (const it in e.inv) if (edible(it) && !ITEMS[it].poison && (!k || ITEMS[it].food > ITEMS[k].food)) k = it; if (k) return k; }
    if (p.water < .45 && has(e, 'waterpot')) return 'waterpot';
    if (p.warmth < .35 && has(e, 'cloak', 2)) return 'cloak';
    let k = null, n = 2;
    for (const it in e.inv) if (e.inv[it] > n) { n = e.inv[it]; k = it; }
    return k;
  }
  function giveItem(e, p, k) {
    const n = edible(k) && e.inv[k] >= 2 ? 2 : 1;
    take(e, k, n); add(p, k, n);
    e.stats.gifts++; S.gifts++;
    M.notice(p, 'p:' + e.id, 1);
    p.exp.gifts++;
    first('gift', 'gift', `🎁 ${e.name} gave ${label(k)} to ${p.name}`);
  }
  function chat(e, p) {
    for (const [a, b] of [[e, p], [p, e]]) {
      b.social = Math.min(1, b.social + .28);
      const trust = clamp(.3 + M.like(b, 'p:' + a.id) / 100, .05, 1);
      // a story about something they did or saw…
      const keys = [...a.M.keys()].filter(k => !k.endsWith(':*') && a.M.get(k).n >= 1);
      if (keys.length) { const k = pick(keys), m = a.M.get(k); M.learn(b, k, m.d, m.T, .25 * trust, OBSERVED); }
      // …and how they feel about something
      let c = null, cw = 25;
      for (const [k, w] of a.W) if (Math.abs(w) > cw && k !== 'p:' + b.id && k !== '~' && !k.startsWith('do:') && rnd() < .5) { cw = Math.abs(w); c = k; }
      if (c) M.setLike(b, c, M.like(b, c) + (M.like(a, c) - M.like(b, c)) * .1 * trust);
    }
    e.bubble = { ch: pick(['…', '!', '?', '☺', '♪']), t: 1.4 };
  }
  function teach(e, p) {
    const trust = clamp(.35 + M.like(p, 'p:' + e.id) / 100, .05, 1) * (p.age < 16 ? 1.5 : 1);
    const top = [...e.M.entries()].filter(([k, m]) => !k.endsWith(':*') && m.n >= 1.5)
      .sort((a, b) => b[1].n * (Math.abs(b[1].d[M.FOOD]) + Math.abs(b[1].d[M.WATER]) + Math.abs(b[1].d[M.WEALTH]) * .3 + .05) - a[1].n * (Math.abs(a[1].d[M.FOOD]) + Math.abs(a[1].d[M.WATER]) + Math.abs(a[1].d[M.WEALTH]) * .3 + .05))
      .slice(0, 3);
    for (const [k, m] of top) M.learn(p, k, m.d, m.T, .6 * trust);
    const likes = [...e.W.entries()].filter(([k]) => k !== 'p:' + p.id && k !== '~').sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2);
    for (const [c, w] of likes) M.setLike(p, c, M.like(p, c) + (w - M.like(p, c)) * .25 * trust);
    const recipes = [...e.R.entries()].filter(([rk, r]) => r.ok && !(p.R.get(rk) || {}).ok);
    if (recipes.length) {
      const [rk, r] = pick(recipes);
      p.R.set(rk, { ok: 1, tries: 1, res: r.res });
      first(`teach:${r.res}`, 'knowledge', `🎓 ${e.name} taught ${p.name} how to make ${r.res === 'FIRE' ? 'fire' : label(r.res)}`);
    }
    e.stats.taught++;
    M.notice(p, 'p:' + e.id, .6);
    fx({ kind: 'learn', x: p.x, z: p.z });
  }
  function recordFollow(e, p) { e.following = p.id; e.followUntil = S.time + 40; }
  function tend(e, p) {
    if (has(e, 'bandage')) { take(e, 'bandage'); p.bleed *= .03; } else if (has(e, 'poultice')) { take(e, 'poultice'); p.bleed *= .1; p.imm = Math.min(1, p.imm + .2); } else p.bleed *= .15;
    if (has(e, 'splint') && p.health < .6) { take(e, 'splint'); p.health = Math.min(1, p.health + .25); }
    if (has(e, 'medicine')) { take(e, 'medicine'); p.imm = Math.min(1, p.imm + .6); p.tox *= .3; }
    else if (has(e, 'herb')) { take(e, 'herb'); p.imm = Math.min(1, p.imm + .3); p.tox *= .6; }
    p.social = Math.min(1, p.social + .15);
    e.stats.tends++;
    if (p.dis > .1) {
      e.stats.sickTends++;
      const st = S.strains.get(p.strain);
      if (st && rnd() < st.contagion * 10) env.infect(e, st.id);
      if (e.stats.sickTends === 4) log('healer', `⚕ ${e.name} keeps nursing the sick, plague or no plague`);
    }
    M.notice(p, 'p:' + e.id, .8);
    first('tend', 'healer', `🩹 ${e.name} tended to ${p.name}'s ${p.bleed > .01 ? 'wounds' : 'sickness'}`);
  }
  const fireNear = (e, r) => S.fires.find(f => !f.wild && f.fuel > 0 && Math.abs(f.x - e.x) < r && Math.abs(f.z - e.z) < r) || null;
  const furnaceNear = (e, r) => S.structs.find(s => s.k === 'furnace' && (s.prog ?? 1) >= 1 && Math.abs(s.x - e.x) < r && Math.abs(s.z - e.z) < r) || null;
  // a furnace burns hot enough for anything a campfire does too
  const stationNear = (e, where) => where === 'furnace' ? !!furnaceNear(e, 45) : where === 'fire' ? !!(fireNear(e, 40) || furnaceNear(e, 45)) : true;
  const sandy = (px, pz) => world.elev(px, pz) < SEA + .028;
  function canCraft(e, rk) {
    const g = ingredients(rk);
    for (const k in g.need) if (!has(e, k, g.need[k])) return false;
    return stationNear(e, g.where);
  }
  // bandage on a wound, medicine or herbs against sickness
  function treat(e, p, k) {
    if (!take(e, k)) return false;
    const it = ITEMS[k];
    if (it.stanch) p.bleed *= 1 - it.stanch;
    if (it.cure) { p.imm = Math.min(1, (p.imm || 0) + it.cure); p.tox = (p.tox || 0) * .4; }
    if (it.detox) p.tox = (p.tox || 0) * (1 - it.detox);
    if (it.heal) p.health = Math.min(1, p.health + it.heal);
    if (p !== e && M.notice) M.notice(p, 'p:' + e.id, .8);
    return true;
  }
  function craft(e, rk) {
    const g = ingredients(rk), r = resolveRecipe(rk), rec = e.R.get(rk) || { ok: 0, tries: 0, res: null };
    rec.tries++;
    e.R.set(rk, rec);
    // a failed try still burns what went into a fire or furnace, sometimes
    if (!r || rnd() > r.p) { if (g.where && rnd() < .3) take(e, g.items[0]); return false; }
    for (const k in g.need) take(e, k, g.need[k]);
    rec.ok++; rec.res = r.result;
    // whoever stands watching can pick it up: a recipe seen made is half learned
    pgrid.near(e.x, e.z, 80, o => {
      if (o === e || o.asleep || o.age < 6 || (o.R.get(rk) || {}).ok) return;
      if (rnd() < .15 + .45 * o.tr.iq) o.R.set(rk, { ok: 1, tries: 0, res: r.result });
    });
    players.watch(e, rk, r.result);
    e.stats.crafted++; S.crafted++;
    const what = r.result === 'FIRE' ? 'fire' : label(r.result);
    if (r.result === 'FIRE') { env.makeFire(e.x + Math.cos(e.heading) * 10, e.z + Math.sin(e.heading) * 10, 150); fx({ kind: 'kindle', x: e.x, z: e.z }); }
    for (const k in r.out) add(e, k, r.out[k]);
    e.bubble = { ch: '💡', t: 1.6 };
    if (!S.techs.has(r.result)) {
      S.techs.set(r.result, { key: r.result, name: what, by: full(e), year: S.year, how: rk });
      log('invention', `💡 ${e.name} discovered ${r.result === 'FIRE' ? 'how to make fire' : `how to make ${what}`} (${rk.split('+').map(k => k === 'fire' ? 'fire' : label(k)).join(' + ')})`);
      fx({ kind: 'idea', x: e.x, z: e.z });
    }
    return true;
  }
  const sacredOf = e => e.sacred;
  function spotFree(px, pz, k) {
    if (world.elev(px, pz) < SEA + .02) return false;
    if (world.nearbySolids(px, pz).some(o => Math.hypot(o.x - px, o.z - pz) < 16)) return false;
    return !S.structs.some(s => Math.hypot(s.x - px, s.z - pz) < (k === 'wall' ? 12 : 24));
  }
  function buildSpot(e, k) {
    const h = e.home || e;
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU, r = 20 + rnd() * 50, px = h.x + Math.cos(a) * r, pz = h.z + Math.sin(a) * r;
      if (spotFree(px, pz, k)) return { x: px, z: pz };
    }
    return null;
  }
  // A building goes up in stages: the materials are laid down as a site, then work raises it (anyone can lend a hand).
  function layFoundation(e, k, px, pz) {
    for (const [m, n] of Object.entries(BUILD[k])) take(e, m, n);
    const s = { id: S.nextId++, k, x: px, z: pz, owner: e.id, builder: e.id, year: S.year, inv: {}, c: k === 'totem' ? e.sacred : null, prog: 0, helpers: [] };
    S.structs.push(s);
    return s;
  }
  function raiseSite(e, s, amount) {
    if (s.prog >= 1) return true;
    s.prog = Math.min(1, s.prog + amount);
    if (s.owner !== e.id && !s.helpers.includes(e.id)) { s.helpers.push(e.id); const o = S.byId.get(s.owner); if (o) M.notice(o, 'p:' + e.id, .5); }
    if (s.prog < 1) return false;
    refreshWalls();
    const b = S.byId.get(s.owner) || e;
    b.stats.built++;
    for (const id of s.helpers) { const h = S.byId.get(id); if (h) h.stats.built += .5; }
    if ((s.k === 'hut' || s.k === 'house') && !b.home) b.home = { x: s.x, z: s.z };
    const words = { hut: 'a hut', house: 'a stone house', store: 'a storehouse', wall: 'a wall', totem: `a totem to ${M.conceptName(s.c || 'sun', S.names)}`, pen: 'an animal pen', dam: 'a dam across the water', furnace: 'a smelting furnace' };
    const crew = s.helpers.map(id => S.byId.get(id)).filter(Boolean).map(h => h.name);
    first('build:' + s.k, 'build', `🏗 ${b.name} built ${words[s.k]}${crew.length ? ` with help from ${crew.slice(0, 3).join(', ')}` : ''}`);
    if (crew.length >= 2) first('build:together', 'build', `🤝 ${crew.length + 1} people built ${words[s.k]} together`);
    if (s.k === 'dam') harm(e, 'river', 1, s);
    return true;
  }
  const done = s => (s.prog ?? 1) >= 1;
  function destroyStruct(s, how) {
    const i = S.structs.indexOf(s);
    if (i < 0) return;
    S.structs.splice(i, 1);
    refreshWalls();
    const o = S.byId.get(s.owner);
    if (o) o.distress = Math.min(1, o.distress + (s.k === 'house' || s.k === 'hut' ? .5 : .25));
    if (o && (s.k === 'hut' || s.k === 'house' || s.k === 'store')) log('destruction', `${how === 'fire' ? '🔥' : '💥'} ${o.name}'s ${s.k} was ${how === 'fire' ? 'burned down' : 'blown apart'}`);
    if (o && o.home && Math.hypot(o.home.x - s.x, o.home.z - s.z) < 5) o.home = null;
  }
  function plantSpot(e) {
    const h = e.home || e;
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU, r = 10 + rnd() * 40, px = h.x + Math.cos(a) * r, pz = h.z + Math.sin(a) * r;
      if (world.elev(px, pz) < SEA + .02 || world.temp(px, pz) < world.SNOW) continue;
      if (S.crops.some(c => Math.hypot(c.x - px, c.z - pz) < 10) || S.structs.some(s => Math.hypot(s.x - px, s.z - pz) < 14)) continue;
      return { x: px, z: pz };
    }
    return null;
  }
  function plant(e, item, px, pz) {
    take(e, item);
    S.crops.push({ id: S.nextId++, k: item === 'grain' ? 'grain' : 'bush', x: px, z: pz, owner: e.id, planted: S.time, next: S.time + 80 });
    e.stats.planted++;
    first('plant', 'farming', `🌱 ${e.name} pushed ${label(item)} into the ground`);
  }
  // recognising your own work: the harvest is credited to the planting, the meat to the feeding
  function credit(e, key, gain) {
    const d = new Array(M.NV).fill(0);
    d[M.WEALTH] = gain;
    M.learn(e, key, d, 4, .6, [M.WEALTH]);
  }
  // a lasting benefit traced back to the work that made it possible (a warm night in the hut one built)
  function learnBody(e, key, eff, w = .4) {
    const d = new Array(M.NV).fill(0), mask = [];
    for (const [v, n] of Object.entries(eff)) { const i = M.VARS.indexOf(v); d[i] = n; mask.push(i); }
    M.learn(e, key, d, 4, w, mask);
  }
  function harvestCrop(e, c) {
    const tool = bestItem(e.inv, 'farm'), item = c.k === 'flax' ? 'fiber' : c.k === 'grain' ? 'grain' : 'berry';
    const n = Math.round((c.k === 'grain' ? 7 : 6) * (1 + (tool ? ITEMS[tool].farm : 0)));   // tended plants bear far more than wild ones
    add(e, item, n);
    e.stats.harvests++;
    if (c.k === 'grain') S.crops.splice(S.crops.indexOf(c), 1); else c.next = S.time + 45;
    if (c.owner === e.id) { credit(e, 'plant:' + (c.k === 'grain' ? 'grain' : 'seed'), n * worth(e, item)); first('harvest', 'farming', `🌾 ${e.name} harvested what ${e.sex === 'M' ? 'he' : 'she'} had planted`); }
    else { const o = S.byId.get(c.owner); if (o && dist(o, c) < 100 && !o.asleep) { o.distress = Math.min(1, o.distress + .2); M.notice(o, 'p:' + e.id, 1); } }
  }
  function feedFor(e, a) {
    const meat = KINDS[a.k].diet === 'meat';
    let k = null;
    for (const it in e.inv) if (ITEMS[it] && (meat ? ITEMS[it].eat === 'wolf' : ITEMS[it].eat === 'animal') && (!k || e.inv[it] > e.inv[k])) k = it;
    return k;
  }
  function feedAnimal(e, a, item) {
    const r = zoo.feed(a, e);
    if (!r) return false;
    take(e, item);
    e.stats.fed++;
    M.notice(e, a.k, .3);
    if (r === 'tamed') { e.stats.tamed++; first('tame:' + a.k, 'herding', `🐾 ${e.name} tamed a ${a.k}: it follows ${e.sex === 'M' ? 'him' : 'her'} now`); }
    return true;
  }
  function butcher(e, c) {
    const n = Math.min(3, c.meat);
    c.meat -= n;
    add(e, c.k === 'person' ? 'flesh' : 'meat', n);
    if (c.k !== 'person' && c.fur > 0) { c.fur--; add(e, 'fur'); }
    if (rnd() < .4) add(e, 'bone');
    if (c.k !== 'person' && rnd() < .5) add(e, 'fat');
    if (c.k === 'person') {
      harm(e, 'p:' + c.pid, 1.2, c); harm(e, 'corpse', .6, c);
      first('butcher:person', 'cannibal', `🔪 ${e.name} cut meat from ${c.name}'s body`);
    } else if (c.owner === e.id && c.cause === 'snared') credit(e, 'build:snare', n * worth(e, 'meat'));
    else if (c.owner === e.id) credit(e, 'feed:' + c.k, n * worth(e, 'meat'));
  }
  function bury(e, c) {
    S.corpses.splice(S.corpses.indexOf(c), 1);
    e.stats.buried++;
    if (c.k === 'person') {
      S.structs.push({ id: S.nextId++, k: 'grave', x: c.x, z: c.z, owner: null, builder: e.id, year: S.year, inv: {}, c: 'p:' + c.pid, name: c.name });
      first('bury', 'burial', `⚱ ${e.name} buried ${c.name} — the first grave`);
    }
  }
  const ritualPose = (e, k) => RITUAL_POSES[Math.abs(((e.id * 31) + [...k].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 4)];
  function ritualDone(e, k) {
    e.ven[k] = (e.ven[k] || 0) + 1;
    e.stats.venerated++;
    let n = 0;
    pgrid.near(e.x, e.z, 80, o => { if (o !== e && o.task && o.task.A.id === 'venerate' && o.task.k === k) { n++; M.notice(o, 'p:' + e.id, .3); } });
    e.social = Math.min(1, e.social + .08 * n);   // praying together binds people; praying alone does nothing
    if (first('venerate:' + k, 'ritual', `🙏 ${e.name} ${k.startsWith('p:') ? `knelt at ${M.conceptName(k, S.names)}'s grave` : `began to pray to ${M.conceptName(k, S.names)}`}`)) e.bubble = { ch: '🙏', t: 2 };
  }
  function arson(e, tgt, k) {
    take(e, 'torch');
    if (k === 'tree') { env.igniteTree(tgt); harm(e, 'tree', .8, tgt); first('arson:tree', 'fire', `🔥 ${e.name} set a tree on fire`); return; }
    env.igniteStruct(tgt);
    harm(e, k, 1.2, tgt);
    const o = S.byId.get(tgt.owner);
    if (o && dist(o, tgt) < 250) { M.notice(o, 'p:' + e.id, 1.8); o.distress = Math.min(1, o.distress + .4); }
    log('fire', `🔥 ${e.name} set ${o ? `${o.name}'s` : 'a'} ${k} on fire`);
  }
  function explode(px, pz, by) {
    S.explosions++;
    fx({ kind: 'explosion', x: px, z: pz });
    let killed = 0;
    for (const p of S.people.slice()) {
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < 60 && hurtPerson(p, 1.2 * (1 - d / 60), by, 'explosion')) killed++;
    }
    for (const a of S.animals.slice()) { const d = Math.hypot(a.x - px, a.z - pz); if (d < 60) zoo.hurt(a, 1.5 * (1 - d / 60), by); }
    for (const a of S.avatars.values()) { const d = Math.hypot(a.x - px, a.z - pz); if (d < 60) players.hurt(a, 1.2 * (1 - d / 60), by); }
    for (const s of S.structs.slice()) if (s.k !== 'grave' && Math.hypot(s.x - px, s.z - pz) < 40) destroyStruct(s, 'explosion');
    env.treesNear(px, pz, 40, (o, d) => { if (d < 40) env.igniteTree(o); });
    log('explosion', `💥 ${by.name}'s bomb went off${killed ? `, killing ${killed}` : ''}`);
  }
  function burnNear(px, pz, r) {
    pgrid.near(px, pz, r, p => { if (rnd() < .3) hurtPerson(p, .04, null, 'fire'); });
  }
  // harming something people love: they feel it, and they remember who did it
  function harm(actor, c, amount, at) {
    pgrid.near(at.x, at.z, 140, o => {
      if (o === actor || o.asleep || o.age < 4) return;
      const w = M.like(o, c);
      if (w <= 10) return;
      o.distress = Math.min(1, o.distress + w / 100 * amount * .6);
      M.notice(o, 'p:' + actor.id, w / 100 * amount * 1.5);
    });
  }
  const reachOf = e => { const k = bestItem(e.inv, 'reach'); return k ? ITEMS[k].reach : 10; };
  const weaponOf = e => { const k = bestItem(e.inv, 'power'); return k ? (k.includes('spear') ? 'spear' : k.includes('axe') ? 'axe' : 'blade') : null; };
  function strikePower(e) {
    const k = bestItem(e.inv, 'power');
    if (k && ITEMS[k].ammo) { take(e, ITEMS[k].ammo); fx({ kind: 'arrow', x: e.x, z: e.z, h: r2(e.heading) }); }
    return (k ? ITEMS[k].power : .075) * (e.age < 16 ? .6 : e.age > 60 ? .7 : 1) * (e.sex === 'M' ? 1.1 : .95) * (.5 + e.health / 2);
  }

  Object.assign(x, {
    has, hasAll, add, take, invTotal, best: (e, prop) => bestItem(e.inv, prop), catOf, kin, busy, landAround, findObj, eat, carerOf, adopt,
    steal, stealStore, loot, withdraw, deposit, giftFor, giveItem, join, consents, chat, teach, loveDone, recordFollow, tend,
    fireNear, furnaceNear, sandy, canCraft, treat, craft, sacredOf, story, chron, decideYield, tribute, refused,
    drinkItem, dealWith, acceptsDeal, swap, music, inscribe, study, valueOf, buildSpot, spotFree, layFoundation, raiseSite, done, learnBody, plantSpot, plant, harvestCrop, feedFor, feedAnimal, butcher, bury,
    ritualPose, ritualDone, arson, explode, harm, reachOf, strikePower, weaponOf, face, notice: M.notice,
  });
  const acts = createActions(x);
  const players = createPlayers(world, S, x, BUILD, BUILD_T);

  // ───────── the start of the world ─────────
  // what a person raised in these lands already believes when the story starts (they can be wrong later)
  const UPBRINGING = [
    ['drink:river', { water: .5 }, 4], ['eat:berry', { food: .15 }, 3], ['eat:fruit', { food: .2 }, 3], ['eat:fish', { food: .26 }, 3],
    ['eat:meat', { food: .28 }, 3], ['eat:mushroom', { food: .1 }, 3], ['pick:bush', { wealth: .2 }, 4, { berry: 2.5 }], ['pick:tree', { wealth: .2 }, 4, { fruit: 2.5 }],
    ['pick:mushroom', { wealth: .05 }, 4, { mushroom: .9 }],
    ['sleep:ground', { energy: .45 }, 20], ['warm:fire', { warmth: .2 }, 8], ['talk:person', { social: .3 }, 5], ['talk:child', { social: .25 }, 5],
    ['mate:person', { desire: -.7, social: .25 }, 8], ['flee:person', { fear: -.3 }, 6], ['flee:wolf', { fear: -.35 }, 6],
    ['attack:person', { fear: .12, health: -.05, distress: .06, tpain: .3 }, 8], ['take:person', { wealth: .25, fear: .15, health: -.04, distress: .05, tpain: .1 }, 3],
    ['gather:shrub', { wealth: .05 }, 4, { stick: 1 }],
    ['kindle:fire', { warmth: .04 }, 3, { stick: -1 }], ['fish:river', { wealth: .08 }, 8, { fish: .2 }],
    ['hunt:rabbit', { energy: -.08 }, 15, { meat: .5 }], ['hunt:deer', { energy: -.1, fear: .03 }, 20, { meat: .7 }],
    ['butcher:carcass', { wealth: .2 }, 6, { meat: 2.5, fur: .5 }], ['eat:berry', { food: .15 }, 3, { berry: -1 }],
    ['adopt:child', { social: .15, tpain: -.4 }, 4], ['give:child', { tpain: -.15 }, 3],
  ];
  function raise(e) {
    for (const [key, eff, T, gain] of UPBRINGING) {
      const d = new Array(M.NV).fill(0);
      for (const [v, n] of Object.entries(eff)) d[M.VARS.indexOf(v)] = n + (rnd() - .5) * Math.abs(n) * .4;
      M.learn(e, key, d, T, 1.5 + rnd(), null, gain || null);
    }
    for (const [c, w] of [['berry', 30], ['fruit', 30], ['fish', 25], ['meat', 25], ['cooked', 30], ['river', 25], ['fire', 30], ['stick', 8]])
      M.setLike(e, c, w + (rnd() - .5) * 20);
  }
  // a good place for a camp: dry, open, mild, with water in reach
  const campable = (px, pz) => world.elev(px, pz) > SEA + .06 && world.temp(px, pz) > .45 &&
    world.nearbySolids(px, pz).every(o => Math.hypot(o.x - px, o.z - pz) > 40) && !!env.nearestShore(px, pz, 260);
  function campSite(cx, cz, r0, r1, avoid) {
    for (let r = r0; r < r1; r += 25) for (let a = rnd() * TAU, k = 0; k < 16; k++, a += TAU / 16) {
      const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
      if (avoid.every(c => Math.hypot(c.x - px, c.z - pz) > 520) && campable(px, pz)) return { x: px, z: pz };
    }
    return null;
  }
  // Three bands of twelve, each around its own fire, far apart and strangers to one another.
  // ancestors: optional heritage from the survivors of an earlier world (see evolve.js) — each founder then
  // carries one ancestor's genes (with mutation) and what they believed, liked and knew how to make.
  // ───────── newcomers ─────────
  // The world does not end at the edge of what we simulate: when the land around has emptied, a family from
  // beyond the hills drifts in, now and then, with its own ways and some of the crafts known out there.
  function migrants() {
    if (S.people.length >= 8 || S.time - (S.lastMigrants ?? -1e9) < YEAR * 4 || rnd() > .5) return;
    S.lastMigrants = S.time;
    const c0 = S.people.length ? pick(S.people) : S.home || world.findSpawn();
    const camp = campSite(c0.x, c0.z, 450, 1300, []) || landAround(c0.x, c0.z, 400, 900);
    if (!camp) return;
    const sur = pick(SURNAMES), n = 6 + Math.floor(rnd() * 4), band = [];
    const lore = [...S.techs.values()].map(t => t.how).filter(Boolean);
    for (let i = 0; i < n; i++) {
      const sex = i % 2 ? 'F' : 'M', adult = i < n - 2, age = adult ? 16 + rnd() * 24 : 3 + rnd() * 9, p = world.landNear(camp.x, camp.z, 20, 110);
      const e = makePerson({ sex, name: freshName(sex), sur, age, bornYear: S.year - age, x: p.x, z: p.z });
      raise(e); e.goal = M.rollGoal(e);
      e.inv = { berry: 2 + Math.floor(rnd() * 3), stick: 1 + Math.floor(rnd() * 2) };
      if (adult && rnd() < .6) e.R.set('stick+stick', { ok: 1, tries: 1, res: 'FIRE' });
      if (adult && rnd() < .5) e.R.set('stone+stone', { ok: 1, tries: 1, res: 'blade' });
      if (adult && lore.length) for (let k = 0; k < 2; k++) if (rnd() < .35) { const rk = pick(lore), r = resolveRecipe(rk); if (r) e.R.set(rk, { ok: 1, tries: 1, res: r.result }); }
      story(e, `Came from beyond the hills with the ${sur} family`);
      band.push(e);
    }
    for (const a of band) for (const b of band) if (a !== b) M.setLike(a, 'p:' + b.id, 25 + rnd() * 30);
    const shore = env.nearestShore(camp.x, camp.z, 400);
    for (const e of band) { if (shore) e.mem.set('river', { x: shore.x, z: shore.z, t: S.time }); e.mem.set('fire', { x: camp.x, z: camp.z, t: S.time }); hooks.birth(e); }
    env.makeFire(camp.x, camp.z, 300);
    log('arrival', `🚶 Strangers came from beyond the hills: the ${sur} family, ${n} of them`);
    chron(`The ${sur} family arrived from beyond the hills (${n} people)`);
  }
  function found({ ancestors = null } = {}) {
    const sp = world.findSpawn(), camps = [];
    const heirs = ancestors && ancestors.length ? { M: ancestors.filter(a => a.sex === 'M'), F: ancestors.filter(a => a.sex === 'F') } : null;
    const inherit = (e, a) => {
      e.tr = M.inheritTraits(a.tr, null);
      for (const [k, m] of a.M) e.M.set(k, { n: m.n, T: m.T, d: m.d.slice(), g: { ...(m.g || {}) } });
      for (const [c, w] of a.W) if (!c.startsWith('p:') && !c.startsWith('b:')) e.W.set(c, w);
      for (const [rk, r] of a.R) e.R.set(rk, { ...r });
      e.goal = { ...a.goal };
      if (a.goal.k === 'devotion' && !a.W.some(([c]) => c === a.goal.c)) e.goal = M.rollGoal(e);
    };
    camps.push(campSite(sp.x + 60, sp.z - 40, 0, 700, []) || { x: sp.x, z: sp.z });
    for (let i = 0; i < 2; i++) { const c = campSite(camps[0].x, camps[0].z, 550, 1400, camps); if (c) camps.push(c); }
    S.home = camps[0];
    const surs = SURNAMES.slice().sort(() => rnd() - .5);
    camps.forEach((camp, ci) => {
      env.makeFire(camp.x, camp.z, 400);
      const band = [];
      for (let i = 0; i < 12; i++) {
        const sex = i % 2 ? 'F' : 'M', p = world.landNear(camp.x, camp.z, 30, 140), age = 16 + rnd() * 22;
        const e = makePerson({ sex, name: freshName(sex), sur: surs[(ci * 4 + i % 4) % surs.length], age, bornYear: -age, x: p.x, z: p.z });
        const pool = heirs && (heirs[sex].length ? heirs[sex] : heirs[sex === 'M' ? 'F' : 'M']);
        if (pool && pool.length) inherit(e, pool[Math.floor(rnd() * pool.length)]);
        else { raise(e); e.goal = M.rollGoal(e); }
        e.inv = { berry: 2 + Math.floor(rnd() * 3), stick: Math.floor(rnd() * 3) };
        band.push(e);
      }
      // they know each other and the land around their fire; a few know old crafts
      for (const a of band) for (const b of band) if (a !== b) M.setLike(a, 'p:' + b.id, 15 + rnd() * 30);
      const shore = env.nearestShore(camp.x, camp.z, 400);
      for (const e of band) {
        if (shore) e.mem.set('river', { x: shore.x, z: shore.z, t: 0 });
        e.mem.set('fire', { x: camp.x, z: camp.z, t: 0 });
        for (const c of ['bush', 'tree', 'shrub', 'rock', 'pine', 'mushroom']) {
          const o = findObj(camp.x + (rnd() - .5) * 200, camp.z + (rnd() - .5) * 200, 450, c, () => true);
          if (o) e.mem.set(c, { x: o.x, z: o.z, t: 0 });
        }
      }
      if (!heirs) {
        const crafty = band.slice().sort(() => rnd() - .5);
        for (const e of crafty.slice(0, 2)) e.R.set('stick+stick', { ok: 1, tries: 1, res: 'FIRE' });
        crafty[2].R.set('stone+stone', { ok: 1, tries: 1, res: 'blade' });
        // one old woman or man in each band remembers that seeds pushed into the ground come back as food
        const d = new Array(M.NV).fill(0); d[M.WEALTH] = .4;
        M.learn(crafty[3], 'plant:seed', d, 4, 2);
      }
      for (const e of band) hooks.birth(e);
      zoo.populate(camp.x, camp.z, .6);
    });
    // what the ancestors already knew how to make
    const known = new Map();
    for (const e of S.people) for (const [rk, r] of e.R) if (r.ok && !known.has(r.res)) known.set(r.res, rk);
    for (const [res, rk] of known) S.techs.set(res, { key: res, name: res === 'FIRE' ? 'fire' : label(res), by: 'the ancestors', year: 0, how: rk });
    log('found', `🔥 ${['One band', 'Two bands', 'Three bands'][camps.length - 1]} of twelve, each around its own fire, far from the others.${heirs ? ' They carry the blood and the beliefs of a people that survived before them.' : ''} Nobody told them what to do.`);
  }
  // the living, as heritage for a new world: genes, purpose, beliefs, likes and recipes (no memories of places or people)
  function heritage(minAge = 14) {
    return S.people.filter(e => e.age >= minAge).map(e => ({
      sex: e.sex, tr: e.tr, goal: e.goal,
      M: [...e.M.entries()].filter(([, m]) => m.n >= .5).map(([k, m]) => [k, { n: Math.min(m.n, 6), T: m.T, d: m.d.map(v => Math.round(v * 1e3) / 1e3), g: m.g }]),
      W: [...e.W.entries()].filter(([c, w]) => !c.startsWith('p:') && !c.startsWith('b:') && Math.abs(w) > 3),
      R: [...e.R.entries()],
    }));
  }

  // ───────── the clock ─────────
  let secT = 0, socT = 0;
  function tick(dt) {
    S.time += dt;
    S.dayT = frac(S.time / DAY + .3);
    S.year = S.time / YEAR;
    pgrid.clear(); for (const p of S.people) if (!p.held) pgrid.add(p);
    if ((agridT += dt) >= .25) { agridT = 0; agrid.clear(); for (const a of S.animals) agrid.add(a); }
    env.tick(dt);
    zoo.tick(dt);
    for (const e of S.people.slice()) {
      if (!e.alive) continue;
      if (e.age < 2) infant(e, dt);
      else if (e.held) { e.held = false; e.y = 0; }   // walking on their own now
      body(e, dt);
      if (!e.alive) continue;
      if ((e.lookT -= dt) <= 0) { e.lookT += 1; think(e); }
      if (e.held) continue;
      if (e.downUntil > S.time) { e.act = 'down'; e.label = 'Lying beaten on the ground'; halt(e, dt); continue; }
      if (e.act === 'down') { e.act = null; e.label = 'Idle'; }
      if (e.task) runTask(e, dt);
      else if ((e.thinkT -= dt) <= 0 && e.age >= 2) choose(e);
      else halt(e, dt);
    }
    players.tick(dt);
    separate();
    if ((secT += dt) >= 1) { secT -= 1; perSecond(); }
    if ((socT += dt) >= 5) { socT = 0; soc.update(); }
  }
  // bodies don't overlap (but never get pushed into the water)
  function separate() {
    for (const e of S.people) {
      if (e.held || (e.task && e.task.A.id === 'mate')) continue;
      pgrid.near(e.x, e.z, 7, (o, d) => {
        if (o === e || o.held || d < .01) return;
        const push = (7 - d) * .15, nx = e.x + (e.x - o.x) / d * push, nz = e.z + (e.z - o.z) / d * push;
        if (!world.blocked(nx, nz)) { e.x = nx; e.z = nz; }
      });
    }
  }
  function perSecond() {
    env.perSecond();
    snares();
    // contagion: the sick breathe on those around them
    for (const e of S.people) {
      if (!e.strain || e.dis < .1) continue;
      const st = S.strains.get(e.strain);
      if (!st) continue;
      pgrid.near(e.x, e.z, 26, o => { if (o !== e && rnd() < st.contagion * e.dis * 3) env.infect(o, st.id); });
    }
    for (const e of S.people) {
      // purpose arrives at twelve, and may change with every birthday
      const yr = Math.floor(e.age);
      if (yr !== e.lastBday) {
        e.lastBday = yr;
        // puberty: the urge comes with its own instinct for what relieves it (not something you can learn by watching)
        if (yr === 15) {
          const m = e.M.get('mate:person');
          if (m) m.d[M.DESIRE] = Math.min(m.d[M.DESIRE], -.7);   // watching others taught them nothing about the urge itself
          else { const d = new Array(M.NV).fill(0); d[M.DESIRE] = -.7; d[M.SOCIAL] = .2; M.learn(e, 'mate:person', d, 8, 1.5); }
        }
        else if (yr > 12) maybeNewGoal(e);
        e.feared *= .5;
      }
    }
    if (Math.floor(S.year) !== Math.floor(S.year - 1 / YEAR)) { env.regrowYearly(); migrants(); }
  }
  function maybeNewGoal(e) {
    let admired = null, aw = 50;
    for (const [c, w] of e.W) if (c.startsWith('p:') && w > aw) { const p = S.byId.get(Number(c.slice(2))); if (p && p.goal.k !== e.goal.k && p.goal.k !== 'survive') { aw = w; admired = p; } }
    const old = e.goal;
    if (admired && rnd() < e.tr.open * .3) e.goal = { ...admired.goal };
    else if (rnd() < e.tr.open * .15) e.goal = M.rollGoal(e);
    else return;
    if (e.goal.k === old.k && e.goal.c === old.c) return;
    e.Gprev = goalValue(e);
    if (['kill', 'cruelty', 'devotion', 'power'].includes(e.goal.k)) log('purpose', `🜂 ${e.name} now lives ${M.goalText(e.goal, S.names)}${admired && e.goal.k === admired.goal.k ? `, like ${admired.name}` : ''}`);
  }

  // ───────── reports ─────────
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const WEAR = e => (has(e, 'cloak') ? 'c' : '') + (has(e, 'necklace') ? 'n' : '');
  let lastPlantVer = -1, pickedCache = [], sentVer = -1;
  function snapshot(full = false) {
    const working = [];
    for (const e of S.people) if (e.task && e.task.stage === 'do' && (e.task.A.id === 'chop' || e.task.A.id === 'gather') && e.task.tgt && e.task.tgt.id) working.push(e.task.tgt.id);
    // what has been picked changes rarely: sent when it changes, and every couple of seconds (regrowth isn't an event)
    if (S.plantVer !== lastPlantVer || full) { lastPlantVer = S.plantVer; pickedCache = env.pickedIds(); }
    const sendPicked = full || sentVer !== lastPlantVer;
    sentVer = lastPlantVer;
    const chiefs = [...S.bands.values()].map(b => b.chief).filter(Boolean);
    return {
      t: 'state', time: r2(S.time), dayT: S.dayT, year: r2(S.year), ts: S.timeScale, season: env.season(), sf: frac(S.year) * 4 % 1,
      rain: r2(S.weather.rain), storm: S.weather.storm ? 1 : 0, speed: S.speed, ws: r2(S.winterSev || 0),
      people: S.people.map(e => ({
        id: e.id, x: r1(e.x), z: r1(e.z), y: r1(e.y), h: r2(e.heading), vx: r1(e.vx), vz: r1(e.vz), held: e.held ? 1 : 0,
        act: e.act, carry: e.task && e.task.stage === 'go' && e.task.item ? e.task.item : null, tool: e.task && e.task.A.tool ? e.task.A.tool(e, e.task) : null,
        sex: e.sex, age: r2(e.age), hue: r1(e.hue), tall: r2(e.tall), preg: e.preg > 0 ? 1 : 0,
        bub: e.bubble ? e.bubble.ch : null, bubT: e.bubble ? r1(e.bubble.t) : 0, seed: r1(e.seed), hp: r2(e.health),
        sail: e.sailing ? 1 : 0, drunk: e.drunkT > S.time ? 1 : 0, ...(full ? { n: e.name } : {}), cold: e.warmth < .35 ? 1 : 0, sick: e.dis + e.tox > .3 ? 1 : 0, bleed: e.bleed > .05 ? 1 : 0, grp: e.band,
        it: WEAR(e), fol: S.followers.get(e.id) || 0, load: invTotal(e), run: e.task && e.task.stage === 'go' && e.task.A.speed && e.task.A.speed(e, e.task) === 'run' ? 1 : 0,
      })),
      animals: S.animals.map(a => ({ id: a.id, k: a.k, x: r1(a.x), z: r1(a.z), h: r2(a.h), vx: r1(a.vx), vz: r1(a.vz), act: a.act, tame: a.owner ? 1 : 0, young: a.age < 1 ? 1 : 0, hp: r2(Math.max(0, a.hp) / KINDS[a.k].hp) })),
      corpses: S.corpses.map(c => ({ id: c.id, k: c.k, x: r1(c.x), z: r1(c.z), h: r2(c.h || 0), rot: r2(env.rotOf(c)), sex: c.sex, hue: c.hue, tall: c.tall, age: c.age, meat: c.meat, v: c.violent ? 1 : 0 })),
      fires: S.fires.map(f => ({ id: f.id, x: r1(f.x), z: r1(f.z), f: r2(Math.min(1, f.fuel / 200)), wild: f.wild ? 1 : 0 })),
      structs: S.structs.map(s => ({ id: s.id, k: s.k, x: r1(s.x), z: r1(s.z), own: s.owner, burn: s.burning ? 1 : 0, c: s.c ? M.conceptName(s.c, S.names) : null, sym: s.c && S.faiths.get(s.c) ? S.faiths.get(s.c).symbol : null, n: s.k === 'store' || s.k === 'granary' ? invTotal(s) : 0, ...(s.lore ? { lore: s.lore.length } : {}), p: s.prog != null && s.prog < 1 ? Math.round(s.prog * 100) / 100 : 1 })),
      crops: S.crops.map(c => ({ id: c.id, k: c.k, x: r1(c.x), z: r1(c.z), ripe: env.cropRipe(c) ? 1 : 0, g: r2(Math.min(1, (S.time - c.planted) / 100)) })),
      ...(sendPicked ? { picked: pickedCache } : {}),
      working, felledVer: S.felledVer,
      bands: Object.fromEntries([...S.bands.values()].map(b => [b.id, b.color])), chiefs,
    };
  }
  function stats() {
    const m = S.people.filter(e => e.sex === 'M').length;
    const sick = S.people.filter(e => e.strain).length;
    let worst = null, wn = 0;
    const per = new Map();
    for (const e of S.people) if (e.strain) per.set(e.strain, (per.get(e.strain) || 0) + 1);
    for (const [id, n] of per) if (n > wn) { wn = n; worst = S.strains.get(id); }
    const topChief = [...S.bands.values()].filter(b => b.chief).map(b => ({ b, n: S.followers.get(b.chief) || 0 })).sort((a, b) => b.n - a.n)[0];
    return {
      year: Math.floor(S.year), season: SEASON_NAMES[env.season()], population: S.people.length, men: m, women: S.people.length - m,
      minors: S.people.filter(e => e.age < 16).length, births: S.births, deaths: S.deaths, killings: S.killings, fights: S.attacks,
      thefts: S.thefts, gifts: S.gifts, crafted: S.crafted, inventions: S.techs.size, explosions: S.explosions,
      buildings: S.structs.filter(s => s.k !== 'grave').length, graves: S.structs.filter(s => s.k === 'grave').length, corpses: S.corpses.length,
      fires: S.fires.filter(f => !f.wild).length, wildfires: S.fires.filter(f => f.wild).length, crops: S.crops.length,
      animals: S.animals.length, tame: S.animals.filter(a => a.owner).length,
      sick, plague: worst ? { name: worst.name, sick: wn } : null,
      bands: S.bands.size, faiths: [...S.faiths.values()].filter(f => f.active).length, settlements: S.towns.length,
      wars: [...S.hostility.values()].filter(h => h.war).length,
      chief: topChief ? { name: S.byId.get(topChief.b.chief).name, followers: topChief.n, band: topChief.b.name } : null,
      hungry: S.people.filter(e => e.food < .25).length, thirsty: S.people.filter(e => e.water < .25).length, freezing: S.people.filter(e => e.warmth < .3).length,
      rain: S.weather.rain > .2, storm: S.weather.storm, night: env.night() > .55,
      speed: S.speed, timeScale: S.timeScale, fertility: S.fertility, capacity: S.cap,
    };
  }
  // in words: what someone believes their actions do
  const VERB = { drink: 'drinking from', eat: 'eating', pick: 'picking', gather: 'gathering from', chop: 'felling', dig: 'digging', fish: 'fishing', fill: 'filling pots at',
    hunt: 'hunting', butcher: 'butchering', feed: 'feeding', attack: 'attacking', flee: 'fleeing from', take: 'taking from', give: 'giving to', talk: 'talking to',
    teach: 'teaching', listen: 'listening to', mate: 'making love with', follow: 'following', tend: 'tending', sleep: 'sleeping on', warm: 'warming at', kindle: 'feeding',
    craft: 'combining', build: 'building', store: 'storing in', plant: 'planting', bury: 'burying', venerate: 'praying to', burn: 'burning', bomb: 'bombing', wander: 'wandering', idle: 'resting' };
  const EFFECT = { food: ['fills the belly', 'leaves you hungry'], water: ['quenches thirst', 'makes you thirsty'], warmth: ['warms you', 'chills you'], energy: ['rests you', 'tires you'],
    health: ['heals', 'hurts'], sick: ['makes you sick', 'cures sickness'], social: ['cheers you up', 'is lonely'], fear: ['is frightening', 'calms fear'],
    distress: ['is upsetting', 'soothes'], grief: ['brings grief', 'eases grief'], desire: ['arouses', 'satisfies desire'], wealth: ['brings riches', 'costs you'],
    goal: ['serves my purpose', 'goes against my purpose'], tpain: ['hurts them', 'helps them'] };
  const GERUND = { idle: 'resting', wander: 'wandering', sleep: 'sleeping', drink: 'drinking', eat: 'eating', pick: 'picking', gather: 'gathering',
    chop: 'felling trees', dig: 'digging', fish: 'fishing', fill: 'fetching water', hunt: 'hunting', butcher: 'butchering', feed: 'feeding animals',
    attack: 'fighting', flee: 'running away', take: 'taking', give: 'giving', talk: 'talking', teach: 'teaching', listen: 'listening', mate: 'making love',
    follow: 'following', adopt: 'adopting', tend: 'tending the sick', warm: 'sitting by the fire', kindle: 'keeping the fire', craft: 'making things',
    build: 'building', store: 'storing', plant: 'planting', bury: 'burying the dead', venerate: 'praying', burn: 'setting fires', bomb: 'bombing' };
  function beliefs(e, n = 6) {
    const out = [];
    for (const [k, m] of e.M) {
      if (k.endsWith(':*') || m.n < 1) continue;
      let bi = -1, bv = 0;
      m.d.forEach((v, i) => { const s = Math.abs(v) * (i === M.WEALTH ? .3 : i === M.GOAL ? .5 : 1); if (s > bv && !(i === M.FOOD && v < 0) && !(i === M.WATER && v < 0) && !(i === M.ENERGY && v < 0)) { bv = s; bi = i; } });
      if (bi < 0 || bv < .04) continue;
      const [a, t] = k.split(':', 2), rest = k.slice(a.length + 1);
      const what = a === 'craft' ? rest.split('+').map(s => s === 'fire' ? 'fire' : label(s)).join(' + ') : M.conceptName(rest, S.names);
      out.push({ s: bv * Math.log(1 + m.n), text: `${VERB[a] || a} ${what} ${EFFECT[M.VARS[bi]][m.d[bi] > 0 ? 0 : 1]}` });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, n).map(o => o.text);
  }
  function live(id) {
    const e = S.byId.get(id);
    if (!e) return null;
    const pains = Object.entries(M.painParts(e)).filter(([, v]) => v > .05).sort((a, b) => b[1] - a[1]);
    const likes = [...e.W.entries()].filter(([c]) => !c.startsWith('b:') && c !== '~').sort((a, b) => b[1] - a[1]);
    const name = c => c.startsWith('do:') ? (GERUND[c.slice(3)] || c.slice(3)) : M.conceptName(c, S.names);
    const pct = v => Math.round(v * 100);
    const band = e.band && S.bands.get(e.band);
    const partner = e.partnerId && S.byId.get(e.partnerId);
    const st = e.strain && S.strains.get(e.strain);
    return {
      age: Math.floor(e.age), stage: lifeStage(e.age), doing: e.label, goal: M.goalText(e.goal, S.names), story: (e.story || []).slice(-5),
      mood: pains.length ? `suffering from ${pains.slice(0, 2).map(p => p[0]).join(' and ')}` : 'at ease', pain: r2(e.Pnow),
      needs: { food: pct(e.food), water: pct(e.water), warmth: pct(e.warmth), energy: pct(e.energy), health: pct(e.health) },
      loves: likes.filter(([, w]) => w > 15).slice(0, 6).map(([c]) => name(c)), hates: likes.filter(([, w]) => w < -15).slice(-5).reverse().map(([c]) => name(c)),
      beliefs: beliefs(e), recipes: [...e.R.entries()].filter(([, r]) => r.ok).map(([rk, r]) => `${r.res === 'FIRE' ? 'fire' : label(r.res)} (${rk.split('+').map(s => s === 'fire' ? 'fire' : label(s)).join(' + ')})`),
      carrying: Object.fromEntries(Object.entries(e.inv).map(([k, n]) => [label(k), n])), role: e.role, band: band ? band.name : null,
      faith: e.sacred && S.faiths.get(e.sacred) && S.faiths.get(e.sacred).active ? S.faiths.get(e.sacred).name : null, sacred: e.sacred ? M.conceptName(e.sacred, S.names) : null,
      kills: e.stats.kills, thefts: e.stats.thefts, partner: partner ? partner.name : null, followers: S.followers.get(e.id) || 0,
      follows: e.following && e.followUntil > S.time && S.byId.get(e.following) ? S.byId.get(e.following).name : null,
      sick: st ? st.name : e.tox > .3 ? 'poisoned' : null, bleeding: e.bleed > .05, pregnant: e.preg > 0 ? Math.ceil(e.preg * 9) : null,
      traits: { iq: pct(e.tr.iq), curious: pct(e.tr.curious), social: pct(e.tr.soc), empathy: pct(e.tr.empathy), temper: pct(e.tr.agg), greed: pct(e.tr.greed) },
      health: pct(e.health),
    };
  }
  function society() {
    const goals = {}, roles = {};
    for (const e of S.people) { const g = M.goalText(e.goal, S.names); goals[g] = (goals[g] || 0) + 1; roles[e.role] = (roles[e.role] || 0) + 1; }
    const knowers = k => S.people.filter(p => [...p.R.values()].some(r => r.ok && r.res === k)).length;
    return {
      bands: [...S.bands.values()].map(b => ({ name: b.name, color: b.color, members: b.size, chief: b.chief && S.byId.get(b.chief) ? S.byId.get(b.chief).name : null, followers: b.chief ? S.followers.get(b.chief) || 0 : 0, year: Math.floor(b.year) })).sort((a, b) => b.members - a.members),
      faiths: [...S.faiths.values()].map(f => ({ name: f.name, symbol: f.symbol, color: f.color, of: M.conceptName(f.c, S.names), faithful: f.count || 0, believers: S.believers.get(f.c) || 0, founder: f.founder, year: Math.floor(f.year), active: f.active })),
      knowledge: [...S.techs.values()].map(t => ({ name: t.name, by: t.by, year: Math.floor(t.year), how: t.how.split('+').map(s => s === 'fire' ? 'fire' : label(s)).join(' + '), knowers: knowers(t.key), of: S.people.length })),
      goals: Object.entries(goals).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      roles: Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      strains: [...S.strains.values()].filter(s => s.cases > 0).map(s => ({ name: s.name, sick: S.people.filter(p => p.strain === s.id).length, cases: s.cases, deadly: Math.round(s.lethal * 50), year: Math.floor(s.year) })).sort((a, b) => b.sick - a.sick || b.cases - a.cases).slice(0, 8),
      wars: [...S.hostility.entries()].filter(([, h]) => h.war).map(([k, h]) => { const [a, b] = k.split('|').map(Number); return { a: (S.bands.get(a) || {}).name, b: (S.bands.get(b) || {}).name, since: Math.floor(h.since), deaths: Math.round(h.deaths) }; }),
      settlements: S.towns.map(t => ({ name: t.name, buildings: t.buildings, houses: t.houses, pop: t.pop, year: Math.floor(t.year) })),
      animals: Object.fromEntries(Object.keys(KINDS).map(k => [k, { wild: S.animals.filter(a => a.k === k && !a.owner).length, tame: S.animals.filter(a => a.k === k && a.owner).length }])),
      buildings: S.structs.reduce((o, s) => (o[s.k] = (o[s.k] || 0) + 1, o), {}),
      killings: S.killings, fights: S.attacks, thefts: S.thefts, gifts: S.gifts,
      needs: S.people.length ? { food: Math.round(100 * S.people.reduce((a, p) => a + p.food, 0) / S.people.length), water: Math.round(100 * S.people.reduce((a, p) => a + p.water, 0) / S.people.length), warmth: Math.round(100 * S.people.reduce((a, p) => a + p.warmth, 0) / S.people.length) } : { food: 0, water: 0, warmth: 0 },
    };
  }
  function economy() {
    const w = e => Math.round(invTotal(e) + S.structs.filter(s => s.owner === e.id).reduce((a, s) => a + invTotal(s), 0));
    const ranked = (f, n = 8) => S.people.filter(p => f(p) > 0).sort((a, b) => f(b) - f(a)).slice(0, n);
    return {
      richest: ranked(w).map(p => ({ name: full(p), wealth: w(p), carrying: invTotal(p), role: p.role })),
      thieves: ranked(p => p.stats.thefts).map(p => ({ name: full(p), thefts: p.stats.thefts, caught: p.exp.robbed })),
      givers: ranked(p => p.stats.gifts).map(p => ({ name: full(p), gifts: p.stats.gifts })),
      leaders: ranked(p => S.followers.get(p.id) || 0).map(p => ({ name: full(p), followers: S.followers.get(p.id), band: p.band && S.bands.get(p.band) ? S.bands.get(p.band).name : null, goal: M.goalText(p.goal, S.names) })),
      killers: ranked(p => p.stats.kills).map(p => ({ name: full(p), kills: p.stats.kills, goal: M.goalText(p.goal, S.names) })),
      totals: { thefts: S.thefts, gifts: S.gifts, crafted: S.crafted, killings: S.killings },
    };
  }
  const settlements = () => ({ towns: society().settlements });
  const felled = () => ({ ver: S.felledVer, trees: env.felledList() });

  // ───────── saving and loading ─────────
  const mapOut = m => [...m.entries()];
  function serializePerson(e) {
    const o = {};
    for (const k in e) {
      if (['task', 'seen', 'sv', 'recent', 'EL', 'bubble', 'act', 'lastHurt'].includes(k)) continue;
      const v = e[k];
      o[k] = v instanceof Map ? (k === 'M' ? [...v.entries()].map(([kk, m]) => [kk, { n: m.n, T: m.T, d: m.d.map(r => Math.round(r * 1e4) / 1e4) }]) : mapOut(v)) : v;
    }
    o.pregFather = e.pregFather ? { ...e.pregFather } : null;
    return o;
  }
  function serialize() {
    const ppl = S.people.map(serializePerson);
    return {
      meta: { year: S.year },
      state: {
        time: S.time, nextId: S.nextId, births: S.births, deaths: S.deaths, timeScale: S.timeScale, speed: S.speed, fertility: S.fertility, cap: S.cap,
        killings: S.killings, attacks: S.attacks, thefts: S.thefts, gifts: S.gifts, crafted: S.crafted, explosions: S.explosions, bandSeq: S.bandSeq, faithSeq: S.faithSeq,
        winterSev: S.winterSev || 0, winterYear: S.winterYear ?? -1, chronicle: S.chronicle, lastMigrants: S.lastMigrants ?? null, trades: S.trades || 0,
        people: ppl, animals: S.animals.map(a => ({ ...a, threat: null, prey: null })), corpses: S.corpses, fires: S.fires, structs: S.structs, crops: S.crops,
        plants: mapOut(S.plants), strains: mapOut(S.strains), weather: S.weather, firsts: [...S.firsts], techs: mapOut(S.techs),
        bands: mapOut(S.bands), faiths: mapOut(S.faiths), towns: S.towns, hostility: mapOut(S.hostility), home: S.home,
        names: [...S.names.entries()].slice(-3000), avatars: players.serialize(),
      },
      people: S.people,
    };
  }
  function restore(st) {
    for (const k of ['time', 'nextId', 'births', 'deaths', 'timeScale', 'speed', 'fertility', 'cap', 'killings', 'attacks', 'thefts', 'gifts', 'crafted', 'explosions', 'bandSeq', 'faithSeq', 'home', 'winterSev', 'winterYear', 'chronicle', 'lastMigrants', 'trades'])
      if (st[k] !== undefined) S[k] = st[k];
    S.year = S.time / YEAR; S.dayT = frac(S.time / DAY + .3);
    S.names = new Map(st.names || []);
    S.plants = new Map(st.plants || []); S.strains = new Map(st.strains || []); S.techs = new Map(st.techs || []);
    S.bands = new Map(st.bands || []); S.faiths = new Map(st.faiths || []); S.hostility = new Map(st.hostility || []);
    S.firsts = new Set(st.firsts || []); S.towns = st.towns || []; S.weather = st.weather || S.weather;
    S.animals = st.animals || []; S.corpses = st.corpses || []; S.fires = st.fires || []; S.structs = st.structs || []; S.crops = st.crops || [];
    S.people = []; S.byId = new Map();
    for (const o of st.people || []) makePerson({ ...o, task: null, seen: null });
    // re-apply what happened to the shared world objects (felled, burning, mined out)
    for (const [id, s] of S.plants) {
      const o = env.objById(id);
      if (!o) continue;
      if (s.felled != null) o.felled = true;
      if (s.spent) o.ore = null;
      if (s.dead != null) o.dead = true;
    }
    for (const f of S.fires) if (f.obj) { const o = env.objById(f.obj); if (o) o.burning = true; }
    players.restore(st.avatars);
    refreshWalls();
  }

  return {
    S, x, tick, found, heritage, snapshot, stats, live, society, economy, settlements, felled, serialize, restore, explain: (id, n) => S.byId.has(id) ? explain(S.byId.get(id), n) : null,
    setSpeed: v => { S.speed = clamp(v, 0, 200); }, setFertility: v => { S.fertility = clamp(v, 0, 20); }, setCapacity: v => { S.cap = clamp(Math.round(v), 10, 2000); },
    setTimeScale: v => { S.timeScale = clamp(v, 1, 40); },
    setPlayer: (id, p) => S.players.set(id, p), removePlayer: id => S.players.delete(id),
    join: players.join, leave: players.leave, move: players.move, act: players.act, view: players.view, others: players.others,
  };
}
