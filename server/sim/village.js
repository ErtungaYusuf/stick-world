// Authoritative village simulation: life cycle, relationships, jobs, economy.
// Runs on the server at a fixed tick; clients only render what it reports.
import { TAU, clamp, smooth, frac, damp, angDiff } from '../../shared/core.js';
import { WATER, CH } from '../../shared/world.js';
import { steer, moveCollide } from '../../shared/motion.js';

export const YEAR = 12;      // real seconds per simulated year at 1× speed
export const CAP = 70;       // carrying capacity – fertility falls as the village fills up
const DAY = 300;             // real seconds per day/night cycle at 1× speed

const NAMES_M = ['Liam', 'Noah', 'Oliver', 'James', 'Elijah', 'William', 'Henry', 'Lucas', 'Benjamin', 'Theo', 'Jack', 'Leo', 'Samuel', 'Owen', 'Daniel', 'Ethan', 'Caleb', 'Isaac', 'Hudson', 'Adam', 'Miles', 'Felix', 'Arthur', 'Ezra', 'Jonah', 'Simon', 'Max', 'Eli', 'Oscar', 'Hugo', 'Finn', 'Gabriel', 'Nathan', 'Ryan', 'Thomas', 'Victor', 'Wesley', 'Aaron', 'Colin', 'Dylan', 'Grant', 'Ian', 'Kai', 'Luke', 'Mark', 'Paul', 'Reid', 'Seth', 'Tyler', 'Vince'];
const NAMES_F = ['Olivia', 'Emma', 'Charlotte', 'Amelia', 'Sophia', 'Mia', 'Isabella', 'Ava', 'Evelyn', 'Luna', 'Harper', 'Ella', 'Grace', 'Chloe', 'Nora', 'Lily', 'Hazel', 'Zoe', 'Ruby', 'Ivy', 'Alice', 'Clara', 'Stella', 'Violet', 'Aurora', 'Hannah', 'Lucy', 'Anna', 'Sadie', 'Eva', 'Maya', 'Iris', 'Rose', 'Jade', 'Leah', 'Julia', 'Ellie', 'Freya', 'Nina', 'Tessa', 'Vera', 'Wren', 'Faith', 'Gemma', 'Holly', 'Kate', 'Mabel', 'Naomi', 'Pearl', 'Sara'];
const SURNAMES = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Miller', 'Wilson', 'Moore', 'Clark', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Hill', 'Green', 'Baker', 'Carter', 'Turner', 'Parker', 'Evans'];
const ACT_LABEL = { wander: 'Strolling', forage: 'Gathering berries', chop: 'Chopping wood', water: 'Fetching water', fish: 'Fishing', talk: 'Chatting', sit: 'Resting by the fire', play: 'Playing tag', flee: 'Playing tag' };
const CARRY_TO = { berries: ['food', 3, 60], fish: ['food', 2, 60], log: ['wood', 1, 30], water: ['water', 1, 30] };
const BUBBLES = ['…', '!', '?', '☺', '♪', '☺', '…'];
const CROUCH = { pick: .55, kneel: .75, sit: 1, fish: 1 };

const pick = a => a[Math.floor(Math.random() * a.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const fullName = e => `${e.name} ${e.sur}`;
export function lifeStage(age) { return age < 1 ? 'Baby' : age < 4 ? 'Toddler' : age < 13 ? 'Child' : age < 18 ? 'Teen' : age < 60 ? 'Adult' : 'Elder'; }
function growth(age) { const a = Math.min(age, 18) / 18; return .36 + .64 * (1 - Math.pow(1 - a, 1.7)); }
// Gompertz–Makeham mortality: background risk + risk doubling roughly every 8 years, plus infant risk
const hazard = age => .0006 + .0001 * Math.exp(.085 * age) + (age < 1 ? .01 : age < 5 ? .002 : 0);
const fertility = e => e.sex === 'F'
  ? smooth(16, 20, e.age) * (1 - smooth(32, 46, e.age))
  : smooth(16, 19, e.age) * (1 - smooth(55, 75, e.age) * .7);
const circMix = (a, b) => a + ((((b - a) % 360) + 540) % 360 - 180) / 2;

/**
 * hooks: { event(type, text, year), birth(p), death(p), fx(msg) } – persistence & broadcast
 */
export function createSim(world, hooks) {
  const S = {
    time: 0, dayT: .12, year: 0, nextId: 1, births: 0, deaths: 0, timeScale: 1,
    village: null, people: [], byId: new Map(), graves: [], players: new Map(),
  };

  // ───────── people ─────────
  function refreshBody(e) { e.scale = growth(e.age) * e.tall * (e.sex === 'F' ? .95 : 1) * (1 - Math.max(0, e.age - 70) * .004); }
  function freshName(sex) {
    const pool = sex === 'M' ? NAMES_M : NAMES_F, used = new Set(S.people.map(p => p.name));
    const free = pool.filter(n => !used.has(n));
    return pick(free.length ? free : pool);
  }
  function makePerson(o) {
    const e = Object.assign({
      id: S.nextId++, name: '', sur: '', sex: 'M', age: 0, bornYear: S.year,
      x: 0, z: 0, y: 0, vx: 0, vz: 0, heading: Math.random() * TAU, turn: 8,
      hue: Math.random() * 360, tall: .94 + Math.random() * .12, seed: Math.random() * 100,
      motherId: null, fatherId: null, partner: null, seek: null,
      preg: 0, pregFather: null, lastBirth: -99, children: 0, alive: true,
      task: null, act: null, carry: null, bubble: null, label: 'Idle',
      wait: Math.random() * 2, think: Math.random() * .5, held: false, bestD: Infinity, stuckT: 0, crouch: 0,
    }, o);
    refreshBody(e);
    S.people.push(e); S.byId.set(e.id, e);
    return e;
  }
  const parentOf = e => S.byId.get(e.motherId) || S.byId.get(e.fatherId) || null;
  const related = (a, b) =>
    a.motherId === b.id || a.fatherId === b.id || b.motherId === a.id || b.fatherId === a.id ||
    (a.motherId && a.motherId === b.motherId) || (a.fatherId && a.fatherId === b.fatherId);
  const eligible = e => e.age >= 18 && e.age < 60 && !e.partner;
  const walkSpeed = e => 50 * (1 - smooth(60, 90, e.age) * .45) * (e.age < 13 ? .75 + e.scale * .25 : 1);
  const nightAmount = () => 1 - smooth(-.15, .25, Math.sin(S.dayT * TAU));
  // families sit together around the fire: a couple shares one spot, young children sit beside their parent
  function ringSpot(e) {
    const par = e.age < 13 ? parentOf(e) : null, anchor = par || e;
    const key = anchor.partner ? Math.min(anchor.id, anchor.partner.id) : anchor.id;
    const a = key * 2.39996, r = 40 + (key % 4) * 18;
    const side = par ? 10 + (e.id % 3) * 5 : anchor.partner ? (e.sex === 'M' ? 5 : -5) : 0;
    const ta = a + Math.PI / 2;
    return { x: S.village.x + Math.cos(a) * r + Math.cos(ta) * side, z: S.village.z + Math.sin(a) * r + Math.sin(ta) * side };
  }
  function face(e, x, z, dt, rate = 6) { e.heading += angDiff(e.heading, Math.atan2(z - e.z, x - e.x)) * damp(rate, dt); }
  const log = (type, text) => hooks.event(type, text, S.year);

  // ───────── village founding & resources ─────────
  function scanResources() {
    const R = 560, v = S.village;
    v.bushes = []; v.trees = []; v.shore = [];
    for (let cz = Math.floor((v.z - R) / CH); cz <= Math.floor((v.z + R) / CH); cz++)
      for (let cx = Math.floor((v.x - R) / CH); cx <= Math.floor((v.x + R) / CH); cx++)
        for (const o of world.chunkData(cx, cz).objs) {
          if (Math.hypot(o.x - v.x, o.z - v.z) > R) continue;
          if (o.t === 'bush' && o.canBerry) v.bushes.push(o);
          if (o.t === 'tree' || o.t === 'pine' || o.t === 'twig') v.trees.push(o);
        }
    for (let gz = -R; gz <= R; gz += 18) for (let gx = -R; gx <= R; gx += 18) {
      if (gx * gx + gz * gz > R * R) continue;
      const x = v.x + gx, z = v.z + gz;
      if (world.elev(x, z) < WATER + .012) continue;
      if (world.blocked(x + 16, z) || world.blocked(x - 16, z) || world.blocked(x, z + 16) || world.blocked(x, z - 16)) v.shore.push({ x, z });
    }
  }
  function placeVillage(x, z, stock) {
    S.village = {
      x, z, fire: { x, z, solid: 9 }, food: 6, wood: 4, water: 4, ...stock,
      foodPos: { x: x + 24, z: z + 12 }, woodPos: { x: x - 25, z: z + 10 }, waterPos: { x: x + 6, z: z - 22 },
    };
    scanResources();
  }
  function found() {
    const sp = world.findSpawn();
    let fx = sp.x + 60, fz = sp.z - 40;
    search: for (let r = 0; r < 700; r += 20) for (let a = 0; a < TAU; a += .4) {
      const x = sp.x + 60 + Math.cos(a) * r, z = sp.z - 40 + Math.sin(a) * r;
      if (world.elev(x, z) > WATER + .06 && world.nearbySolids(x, z).every(o => Math.hypot(o.x - x, o.z - z) > 40)) { fx = x; fz = z; break search; }
    }
    placeVillage(fx, fz);
    const surs = SURNAMES.slice().sort(() => Math.random() - .5);
    for (let i = 0; i < 14; i++) {
      const sex = i % 2 ? 'F' : 'M', p = world.landNear(fx, fz, 40, 170), age = 17 + Math.random() * 21;
      const e = makePerson({ sex, name: freshName(sex), sur: surs[i % surs.length], age, bornYear: -age, x: p.x, z: p.z });
      hooks.birth(e);
    }
    log('found', '🔥 A village was founded by 14 settlers');
  }

  // ───────── relationships, births, deaths ─────────
  function findMate(e) {
    let best = null, bd = 700;
    for (const o of S.people) {
      if (o === e || o.sex === e.sex || !eligible(o) || (o.seek && o.seek !== e) || related(e, o) || Math.abs(o.age - e.age) > 12) continue;
      const d = dist(e, o);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) { e.seek = best; best.seek = e; e.seekSince = best.seekSince = S.year; endTask(e, 0); endTask(best, 0); }
  }
  function bond(a, b) {
    a.partner = b; b.partner = a; a.seek = b.seek = null;
    hooks.fx({ kind: 'hearts', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    log('marriage', `💞 ${a.name} and ${b.name} got married`);
  }
  function giveBirth(m) {
    const f = m.pregFather;   // snapshot of the father taken at conception (he may have died since)
    const n = Math.random() < .015 ? 2 : 1;   // ~1.5% twins
    for (let k = 0; k < n; k++) {
      const sex = Math.random() < .512 ? 'M' : 'F';   // natural ~105:100 boy/girl ratio
      const b = makePerson({
        sex, name: freshName(sex), sur: f ? f.sur : m.sur, age: 0, x: m.x, z: m.z, motherId: m.id, fatherId: f ? f.id : null,
        hue: (f ? circMix(m.hue, f.hue) : m.hue) + (Math.random() - .5) * 30,
        tall: (m.tall + (f ? f.tall : m.tall)) / 2 + (Math.random() - .5) * .05,
      });
      S.births++; m.children++;
      const fa = f && S.byId.get(f.id); if (fa) fa.children++;
      hooks.birth(b);
      log('birth', `👶 ${fullName(b)} was born · mother ${m.name}, father ${f ? f.name : '?'}`);
    }
    hooks.fx({ kind: 'sparkle', x: m.x, z: m.z });
    m.lastBirth = S.year; m.pregFather = null;
  }
  function die(e) {
    endTask(e, 0);
    e.alive = false;
    S.people.splice(S.people.indexOf(e), 1); S.byId.delete(e.id);
    if (e.partner) e.partner.partner = null;
    if (e.seek) e.seek.seek = null;
    S.deaths++;
    S.graves.push({ id: e.id, x: e.x, z: e.z, year: S.year });
    hooks.death(e);
    hooks.fx({ kind: 'death', id: e.id });
    log('death', `✝ ${fullName(e)} died at age ${Math.floor(e.age)}`);
  }

  // ───────── jobs & activities ─────────
  function setTask(e, t) {
    endTask(e, 0);
    t.stage = t.stage || 'go';
    e.task = t; e.label = ACT_LABEL[t.type]; e.bestD = Infinity; e.stuckT = 0;
    return true;
  }
  function stage(e, s) { e.task.stage = s; e.bestD = Infinity; e.stuckT = 0; }
  function endTask(e, wait) {
    const t = e.task;
    if (t && t.obj && t.obj.res === e.id) t.obj.res = 0;
    // whatever was being carried still reaches the village (e.g. interrupted by nightfall)
    if (e.carry && S.village) { const [key, amount, cap] = CARRY_TO[e.carry]; S.village[key] = Math.min(cap, S.village[key] + amount); }
    e.task = null; e.carry = null; e.wait = wait;
  }
  function nearestFree(e, list, ok) {
    let best = null, bd = Infinity;
    for (const o of list) {
      if (o.res || (ok && !ok(o))) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z) * (.8 + Math.random() * .4);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  const claim = (e, list, type, ok) => { const o = nearestFree(e, list, ok); if (!o) return false; o.res = e.id; return setTask(e, { type, obj: o }); };
  const isFree = o => !o.held && !o.seek && (!o.task || o.task.type === 'wander' || o.task.type === 'sit');
  function talkTask(e) {
    let o = null;
    if (e.partner && isFree(e.partner) && Math.random() < .5) o = e.partner;
    if (!o) {
      const c = S.people.filter(p => p !== e && p.age >= 10 && isFree(p) && dist(p, e) < 320);
      if (c.length) o = pick(c);
    }
    return o ? setTask(e, { type: 'talk', other: o }) : false;
  }
  function wanderTask(e) {
    const c = (e.age < 13 && parentOf(e)) || e.partner || S.village, R = e.age < 13 ? 60 : e.partner ? 80 : 230;
    return setTask(e, { type: 'wander', ...world.landNear(c.x, c.z, 0, R) });
  }
  function startTask(e) {
    const r = Math.random(), v = S.village;
    if (e.age < 13) {
      if (r < .6) {
        const kids = S.people.filter(p => p !== e && p.age >= 4 && p.age < 13 && dist(p, e) < 260);
        if (kids.length) return setTask(e, { type: 'play', other: pick(kids), t: 6 + Math.random() * 6 });
      }
      return wanderTask(e);
    }
    if (e.age >= 60) {
      if (r < .4) return setTask(e, { type: 'sit', ...ringSpot(e), t: 10 + Math.random() * 14 });
      if (r < .75) return talkTask(e) || wanderTask(e);
      return wanderTask(e);
    }
    // adults pick the job the village needs most a bit more often
    const need = { food: v.food < 15 ? .1 : 0, wood: v.wood < 6 ? .08 : 0 };
    if (v.water < 6 && r > .9) return claim(e, v.shore, 'water') || wanderTask(e);
    if (r < .25 + need.food) return claim(e, v.bushes, 'forage', o => o.berry) || claim(e, v.shore, 'fish') || wanderTask(e);
    if (r < .38 + need.food * 2) return claim(e, v.shore, 'fish') || claim(e, v.bushes, 'forage', o => o.berry) || wanderTask(e);
    if (r < .56 + need.food * 2 + need.wood && !(e.preg > 0)) return claim(e, v.trees, 'chop') || wanderTask(e);
    if (r < .68 + need.food * 2 + need.wood) return claim(e, v.shore, 'water') || wanderTask(e);
    if (r < .9) return talkTask(e) || wanderTask(e);
    return wanderTask(e);
  }

  // returns a movement goal {x,z,arrive,sp} or null; sets e.act for the pose
  function runTask(e, dt) {
    const T = e.task, v = S.village;
    const near = (p, r) => Math.hypot(p.x - e.x, p.z - e.z) < r;
    // walk the carried goods to their stockpile; endTask() adds them to the village
    const deliver = pos => {
      if (near(pos, 12)) { endTask(e, 1 + Math.random() * 3); return null; }
      return { x: pos.x, z: pos.z, arrive: 8 };
    };
    switch (T.type) {
      case 'wander':
        if (near(T, 6)) { endTask(e, 1 + Math.random() * 4); return null; }
        return { x: T.x, z: T.z, arrive: 3 };

      case 'forage':
        if (T.stage === 'go') {
          if (!T.obj.berry) { endTask(e, .5); return null; }
          if (near(T.obj, 15)) { stage(e, 'work'); T.t = 3 + Math.random() * 1.5; }
          else return { x: T.obj.x, z: T.obj.z, arrive: 12 };
        }
        if (T.stage === 'work') {
          e.act = 'pick'; face(e, T.obj.x, T.obj.z, dt);
          if ((T.t -= dt) <= 0) {
            T.obj.berry = false; T.obj.regrow = S.time + 30 + Math.random() * 30; T.obj.res = 0;
            e.carry = 'berries'; stage(e, 'back');
          }
          return null;
        }
        return deliver(v.foodPos);

      case 'chop':
        if (T.stage === 'go') {
          const r = (T.obj.solid || 4) + 7;
          if (near(T.obj, r + 4)) { stage(e, 'work'); T.t = 4 + Math.random() * 2; }
          else return { x: T.obj.x, z: T.obj.z, arrive: r };
        }
        if (T.stage === 'work') {
          e.act = 'chop'; face(e, T.obj.x, T.obj.z, dt, 10);
          if ((T.t -= dt) <= 0) { T.obj.res = 0; e.carry = 'log'; stage(e, 'back'); }
          return null;
        }
        return deliver(v.woodPos);

      case 'water':
        if (T.stage === 'go') {
          if (near(T.obj, 6)) { stage(e, 'work'); T.t = 2.5 + Math.random(); }
          else return { x: T.obj.x, z: T.obj.z, arrive: 3 };
        }
        if (T.stage === 'work') {
          e.act = 'kneel';
          let wx = 0, wz = 0;   // face the water
          for (let a = 0; a < TAU; a += TAU / 8) if (world.blocked(e.x + Math.cos(a) * 18, e.z + Math.sin(a) * 18)) { wx += Math.cos(a); wz += Math.sin(a); }
          if (wx || wz) face(e, e.x + wx, e.z + wz, dt);
          if ((T.t -= dt) <= 0) { T.obj.res = 0; e.carry = 'water'; stage(e, 'back'); }
          return null;
        }
        return deliver(v.waterPos);

      case 'fish':
        if (T.stage === 'go') {
          if (near(T.obj, 6)) { stage(e, 'work'); T.t = 5 + Math.random() * 4; }
          else return { x: T.obj.x, z: T.obj.z, arrive: 3 };
        }
        if (T.stage === 'work') {
          e.act = 'fish';
          let wx = 0, wz = 0;
          for (let a = 0; a < TAU; a += TAU / 8) if (world.blocked(e.x + Math.cos(a) * 18, e.z + Math.sin(a) * 18)) { wx += Math.cos(a); wz += Math.sin(a); }
          if (wx || wz) face(e, e.x + wx, e.z + wz, dt);
          if ((T.t -= dt) <= 0) {
            T.obj.res = 0;
            if (Math.random() < .7) { e.carry = 'fish'; stage(e, 'back'); e.bubble = { ch: '!', t: 1.2 }; }
            else { endTask(e, 1); return null; }   // nothing biting today
          }
          return null;
        }
        return deliver(v.foodPos);

      case 'talk': {
        const o = T.other;
        if (!o.alive || o.held) { endTask(e, 1); return null; }
        if (T.stage === 'go') {
          if (o.task && o.task.type === 'talk' && o.task.other !== e) { endTask(e, 1); return null; }
          if (dist(e, o) < 17) {
            const dur = 4 + Math.random() * 4;
            stage(e, 'talk'); T.t = dur; T.cd = .3;
            setTask(o, { type: 'talk', other: e, stage: 'talk', t: dur, cd: 1 });
          } else return { x: o.x, z: o.z, arrive: 14 };
        }
        e.act = 'talk'; face(e, o.x, o.z, dt);
        if ((T.cd -= dt) <= 0) {
          T.cd = 1 + Math.random() * 1.4;
          if (Math.random() < .6) e.bubble = { ch: e.partner === o && Math.random() < .5 ? '♥' : pick(BUBBLES), t: 1.5 };
        }
        if ((T.t -= dt) <= 0) endTask(e, 2 + Math.random() * 3);
        return null;
      }

      case 'sit':
        if (T.stage === 'go') {
          if (near(T, 5)) stage(e, 'sit');
          else return { x: T.x, z: T.z, arrive: 3 };
        }
        e.act = 'sit'; face(e, v.x, v.z, dt, 3);
        if ((T.t -= dt) <= 0) endTask(e, 1 + Math.random() * 2);
        return null;

      case 'play': {   // tag: chase someone, tag them, then run away
        const o = T.other;
        T.t -= dt;
        if (!o.alive || o.held || o.age >= 13 || T.t <= 0) { endTask(e, 1 + Math.random() * 3); return null; }
        if (dist(e, o) < 9) {
          if (!o.task || ['wander', 'play', 'flee'].includes(o.task.type)) setTask(o, { type: 'play', other: e, t: T.t + 1 });
          const a = Math.atan2(e.z - o.z, e.x - o.x) + (Math.random() - .5);
          setTask(e, { type: 'flee', other: o, t: 1.6, ...world.landNear(e.x + Math.cos(a) * 50, e.z + Math.sin(a) * 50, 0, 10) });
          e.bubble = { ch: '!', t: 1 };
          return null;
        }
        return { x: o.x, z: o.z, arrive: 6, sp: 2.1 };
      }
      case 'flee':
        if ((T.t -= dt) <= 0 || near(T, 4)) { endTask(e, .3); return null; }
        return { x: T.x, z: T.z, arrive: 3, sp: 2.2 };
    }
    return null;
  }

  // ───────── main tick ─────────
  function tick(dt) {
    const v = S.village;
    if (!v) return;
    const dy = dt * S.timeScale / YEAR;
    S.time += dt;
    S.year += dy;
    S.dayT = frac(S.dayT + dt / DAY * S.timeScale);
    const night = nightAmount();

    // economy: everyone eats and drinks, the fire burns wood at night, bushes regrow
    v.food = Math.max(0, v.food - S.people.length * .012 * dt);
    v.water = Math.max(0, v.water - S.people.length * .006 * dt);
    v.wood = Math.max(0, v.wood - night * .05 * dt);
    for (const b of v.bushes) if (!b.berry && b.regrow && S.time > b.regrow) b.berry = true;

    for (const e of S.people.slice()) {
      if (!e.alive) continue;
      e.age += dy;
      if (Math.random() < hazard(e.age) * dy) { die(e); continue; }
      refreshBody(e);
      if (e.seek && (!e.seek.alive || e.seek.partner)) e.seek = null;
      // courtship lasts at most a season in game time: if they haven't walked to each other yet,
      // they meet at the campfire (keeps fast-forward from stalling marriages)
      if (e.seek && S.year - e.seekSince > .25) bond(e, e.seek);
      if (e.bubble && (e.bubble.t -= dt) <= 0) e.bubble = null;

      // pregnancy & conception: needs a living partner of the other sex, both fertile.
      // Couples share a household (they sleep side by side), so they need not stand together all day.
      if (e.preg > 0) { e.preg -= dy; if (e.preg <= 0) { e.preg = 0; giveBirth(e); } }
      else if (e.sex === 'F' && e.partner && S.year - e.lastBirth > 1.6) {
        const fed = v.food > 0 ? 1 : .8;   // an empty basket makes conception somewhat less likely
        const rate = 1.1 * fed * fertility(e) * fertility(e.partner) * Math.max(0, 1 - S.people.length / CAP);
        if (Math.random() < rate * dy) {
          const p = e.partner;
          e.preg = .75; e.pregFather = { id: p.id, name: p.name, sur: p.sur, hue: p.hue, tall: p.tall };
          log('pregnancy', `🤰 ${e.name} and ${p.name} are expecting a baby`);
        }
      }

      if ((e.think -= dt) <= 0) { e.think = .5 + Math.random() * .3; if (eligible(e) && !e.seek && night < .55) findMate(e); }

      // babies under one are carried by a parent
      const parent = parentOf(e);
      if (e.age < 1 && parent) {
        const ch = parent.heading, cs = parent.scale;
        e.held = true; e.heading = ch; e.label = 'Carried by ' + parent.name; e.act = null;
        e.x = parent.x + Math.cos(ch) * 4 * cs - Math.sin(ch) * 1.5 * cs;
        e.z = parent.z + Math.sin(ch) * 4 * cs + Math.cos(ch) * 1.5 * cs;
        e.y = (18 - parent.crouch * 11) * cs; e.vx = e.vz = 0;
        continue;
      }
      if (e.held) { e.held = false; e.y = 0; }

      e.act = null;
      let goal = null;
      if (night > .55) {
        if (e.task) endTask(e, 0);
        const s = ringSpot(e);
        if (Math.hypot(s.x - e.x, s.z - e.z) > 6) goal = { x: s.x, z: s.z, arrive: 4, sp: 1.1 };
        else { e.act = 'sit'; face(e, v.x, v.z, dt, 3); }
        e.label = 'Sleeping by the fire';
      } else if (e.seek) {
        goal = { x: e.seek.x, z: e.seek.z, arrive: 0, sp: 1.15 };
        e.label = 'Courting ' + e.seek.name;
        if (dist(e, e.seek) < 14) bond(e, e.seek);
      } else if (e.age < 4 && parent) {
        e.label = 'Toddling after ' + parent.name;
        if (dist(e, parent) > 22) goal = { x: parent.x, z: parent.z, arrive: 14, sp: 1.3 };
      } else {
        if (!e.task) { e.label = 'Idle'; if ((e.wait -= dt) <= 0) startTask(e); }
        if (e.task) goal = runTask(e, dt);
      }

      let tx = 0, tz = 0;
      if (goal) {
        const dx = goal.x - e.x, dz = goal.z - e.z, d = Math.hypot(dx, dz);
        if (d > goal.arrive) {
          const sp = walkSpeed(e) * (goal.sp || 1) * clamp((d - goal.arrive) / 20 + .35, .35, 1);
          tx = dx / d * sp; tz = dz / d * sp;
          if (d < e.bestD - .5) { e.bestD = d; e.stuckT = 0; }
          else if ((e.stuckT += dt) > 3 && e.task) endTask(e, .5);   // blocked by water/rocks: give up
        }
      }
      steer(e, dt, tx, tz, 420);
      moveCollide(world, e, dt, 2 + 3 * e.scale, [v.fire]);
      e.crouch += ((CROUCH[e.act] || 0) - e.crouch) * damp(6, dt);
    }

    // personal space between bodies; players push villagers but are never pushed
    const bodies = S.people.filter(e => !e.held);
    const players = [...S.players.values()];
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length + players.length; j++) {
        const b = j < bodies.length ? bodies[j] : players[j - bodies.length];
        const isP = j >= bodies.length;
        const dx = b.x - a.x, dz = b.z - a.z, min = 5 * a.scale + 5 * (isP ? 1 : b.scale);
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz) || .01;
        if (d >= min) continue;
        const k = (min - d) / d;
        if (isP) { a.x -= dx * k; a.z -= dz * k; }
        else { a.x -= dx * k * .5; a.z -= dz * k * .5; b.x += dx * k * .5; b.z += dz * k * .5; }
      }
    }
    for (let i = S.graves.length - 1; i >= 0; i--) if (S.year - S.graves[i].year > 8) S.graves.splice(i, 1);
  }

  // ───────── views for the API / network ─────────
  const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100;
  function snapshot() {
    const v = S.village;
    const chopping = [];
    for (const e of S.people) if (e.task && e.task.type === 'chop' && e.task.stage === 'work') chopping.push(e.task.obj.id);
    return {
      t: 'state', time: r2(S.time), dayT: S.dayT, year: r2(S.year), ts: S.timeScale,
      village: v && { x: v.x, z: v.z, food: r1(v.food), wood: r1(v.wood), water: r1(v.water), foodPos: v.foodPos, woodPos: v.woodPos, waterPos: v.waterPos },
      people: S.people.map(e => ({
        id: e.id, x: r1(e.x), z: r1(e.z), y: r1(e.y), h: r2(e.heading), vx: r1(e.vx), vz: r1(e.vz),
        held: e.held ? 1 : 0, act: e.act, carry: e.carry, sex: e.sex, age: r2(e.age), hue: r1(e.hue), tall: r2(e.tall),
        preg: e.preg > 0 ? 1 : 0, bub: e.bubble ? e.bubble.ch : null, bubT: e.bubble ? r1(e.bubble.t) : 0, seed: r1(e.seed),
      })),
      graves: S.graves.map(g => ({ id: g.id, x: r1(g.x), z: r1(g.z), age: r1(S.year - g.year) })),
      picked: v ? v.bushes.filter(b => !b.berry).map(b => b.id) : [],
      chopping,
    };
  }
  function stats() {
    const v = S.village, m = S.people.filter(e => e.sex === 'M').length;
    return {
      year: Math.floor(S.year), population: S.people.length, men: m, women: S.people.length - m,
      minors: S.people.filter(e => e.age < 18).length, couples: S.people.filter(e => e.partner && e.sex === 'F').length,
      births: S.births, deaths: S.deaths, timeScale: S.timeScale,
      food: Math.floor(v ? v.food : 0), wood: Math.floor(v ? v.wood : 0), water: Math.floor(v ? v.water : 0),
      night: nightAmount() > .55,
    };
  }
  // live part of a person's record (the API merges this with the database)
  function live(id) {
    const e = S.byId.get(id);
    if (!e) return null;
    return {
      id: e.id, alive: true, age: Math.floor(e.age), stage: lifeStage(e.age), doing: e.label,
      spouse: e.partner ? { id: e.partner.id, name: fullName(e.partner) } : null,
      courting: e.seek ? e.seek.name : null,
      pregnantMonth: e.preg > 0 ? Math.max(1, Math.round((.75 - e.preg) * 12)) : null, hue: e.hue,
    };
  }

  // ───────── persistence ─────────
  function serialize() {
    const v = S.village;
    return {
      meta: { time: S.time, dayT: S.dayT, year: S.year, nextId: S.nextId, births: S.births, deaths: S.deaths },
      village: v && { x: v.x, z: v.z, food: v.food, wood: v.wood, water: v.water },
      people: S.people,
      picked: v ? v.bushes.filter(b => !b.berry).map(b => ({ id: b.id, regrow: b.regrow || S.time })) : [],
    };
  }
  function restore(saved) {
    for (const [k, val] of Object.entries(saved.meta)) if (val !== undefined && val !== null) S[k] = val;
    placeVillage(saved.village.x, saved.village.z, { food: saved.village.food, wood: saved.village.wood, water: saved.village.water });
    const byObj = new Map(S.village.bushes.map(b => [b.id, b]));
    for (const p of saved.picked) { const b = byObj.get(p.id); if (b) { b.berry = false; b.regrow = p.regrow; } }
    for (const r of saved.people) makePerson(r);
    S.nextId = Math.max(S.nextId, ...S.people.map(p => p.id + 1));
    for (const r of saved.people) {
      const e = S.byId.get(r.id);
      e.partner = S.byId.get(r.partnerId) || null;
      if (r.pregFather) e.pregFather = r.pregFather;
    }
    S.graves = saved.graves || [];
  }

  return {
    S, tick, snapshot, stats, live, serialize, restore, found,
    setTimeScale: s => { S.timeScale = clamp(Math.round(s), 1, 40); },
    setPlayer: (id, p) => S.players.set(id, p),
    removePlayer: id => S.players.delete(id),
  };
}
