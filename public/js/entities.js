// Everything that moves: the local player (simulated here), people, animals and other players
// (simulated on the server, interpolated + animated here), and purely visual effects.
import { TAU, clamp, smooth, frac, damp, angDiff, mixc } from '/shared/core.js';
import { steer, moveCollide } from '/shared/motion.js';

import { G } from './state.js';
import { sfx } from './sound.js';
import { newBody, animate, chopCycle, WALK, RUN, JUMP_V } from './figure.js';

// ───────── local player ─────────
const GRAV = 1500, PR = 5;
export const P = newBody({ heading: Math.PI / 2, jumpBuf: 0, coyote: 0, prevT: [0, .5] });

export function puff(x, z, n, spread, up, size, col = '235,228,205', y = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = Math.random() * spread;
    G.particles.push({
      x: x + (Math.random() - .5) * 5, y, z: z + (Math.random() - .5) * 5,
      vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: Math.random() * up + 6,
      life: 0, max: .45 + Math.random() * .45, r: size * (.6 + Math.random() * .7), col,
    });
  }
}

export function updatePlayer(dt) {
  const k = G.keys;
  let ix = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
  let iz = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
  const il = Math.hypot(ix, iz);
  if (il) { ix /= il; iz /= il; G.follow = null; G.director = false; }
  const spd = il ? (k.ShiftLeft || k.ShiftRight ? RUN : WALK) : 0;
  const tx = ix * spd, tz = iz * spd;
  steer(P, dt, tx, tz, P.ground ? (il ? 1100 : 1400) : 450);

  P.jumpBuf -= dt; P.coyote -= dt;
  if (P.jumpBuf > 0 && (P.ground || P.coyote > 0)) {
    P.vy = JUMP_V; P.ground = false; P.jumpBuf = 0; P.coyote = 0; P.sq = -.2; P.sqv = 0;
    puff(P.x, P.z, 7, 50, 25, 2.4);
  }
  if (!P.ground) {
    P.vy -= GRAV * dt * (P.vy > 0 && !k.Space ? 2.2 : 1);
    P.y += P.vy * dt;
    if (P.y <= 0) {
      const impact = -P.vy;
      P.y = 0; P.vy = 0; P.ground = true;
      P.sq = clamp(impact / 1600, .08, .36); P.sqv = 0;
      puff(P.x, P.z, Math.round(clamp(impact / 60, 5, 13)), 70, 22, 2.6);
    }
  }
  moveCollide(G.world, P, dt, PR, G.structs.filter(s => s.k === 'wall').map(s => ({ x: s.x, z: s.z, solid: 10 })));
  animate(P, dt, tx, tz);
  const me = G.me, work = me && me.task ? MY_ANIM[me.task.kind] : null;
  if (P.strikeT > 0) P.strikeT -= dt;
  const act = work || (P.strikeT > 0 ? 'fight' : null);
  P.actA = (P.actA || 0) + ((act ? 1 : 0) - (P.actA || 0)) * damp(9, dt);
  if (act) P.actMode = act;
  P.crouch = (P.crouch || 0) + ((CROUCH[act] || 0) - (P.crouch || 0)) * damp(6, dt);
  P.tool = me && me.weapon ? (me.weapon.includes('spear') ? 'spear' : me.weapon.includes('axe') ? 'axe' : me.weapon.includes('pick') ? 'pick' : 'blade') : null;
  if (act === 'chop' || act === 'mine') P.tool = act === 'chop' ? 'axe' : 'pick';
  if (P.hitT > 0) { P.hitT -= dt; P.sq = -.12; }
  for (let i = 0; i < 2; i++) {
    const t = frac(P.phase + i * .5);
    if (P.ground && t < P.prevT[i] - .5 && P.runA > .35) puff(P.x - Math.cos(P.heading) * 6, P.z - Math.sin(P.heading) * 6, 3, 25, 14, 1.8 * P.runA);
    P.prevT[i] = t;
  }
  return il > 0;
}

// ───────── people, animals & other players (server-driven) ─────────
export function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
export function growth(age) { const a = Math.min(age, 18) / 18; return .36 + .64 * (1 - Math.pow(1 - a, 1.7)); }
// body proportions & colour follow age / genes reported by the server; sickness greys the face
function refreshLook(v) {
  const n = v.net, g = growth(n.age);
  v.kid = (1 - g) / .64;
  v.scale = g * n.tall * (n.sex === 'F' ? .95 : 1) * (1 - Math.max(0, n.age - 70) * .004);
  v.hunch = smooth(60, 88, n.age) * .28;
  v.ink = mixc(hsl(n.hue, .32, .24), [150, 150, 150], smooth(55, 85, n.age) * .45);
  if (n.sick) v.ink = mixc(v.ink, [95, 125, 70], .45);
}

function sync(map, list, kind) {
  const now = performance.now(), seen = new Set();
  for (const n of list) {
    let v = map.get(n.id);
    if (!v) { v = newBody({ id: n.id, x: n.x, z: n.z, y: n.y || 0, heading: n.h, seed: n.seed ?? Math.random() * 100, lastU: 0, legs: 0 }); map.set(n.id, v); }
    v.net = n; v.netAt = now; seen.add(n.id);
    if (kind === 'person') refreshLook(v);
  }
  for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
}

export function applySnapshot(s) {
  G.dayT = s.dayT; G.year = s.year; G.timeScale = s.ts; G.season = s.season ?? 0; G.sf = s.sf ?? 0;
  G.rain = s.rain || 0; G.storm = s.storm || 0;
  G.corpses = s.corpses || []; G.fires = s.fires || []; G.structs = s.structs || []; G.crops = s.crops || [];
  if (s.picked) G.picked = new Set(s.picked);
  G.chopping = new Set(s.working || []);
  G.serverFelledVer = s.felledVer || 0;
  G.speed = s.speed ?? 1; G.chiefs = new Set(s.chiefs || []); G.bands = s.bands || {};
  sync(G.people, s.people, 'person');
  sync(G.animals, s.animals || [], 'animal');
  if (s.players) sync(G.others, s.players.filter(p => p.id !== G.myId), 'player');
}

const CROUCH = { pick: .55, kneel: .75, sit: 1, fish: 1, pray: .75, mourn: .75, craft: .7, eat: .9, drink: .75, warm: .7, cry: 1, worship: .8, heal: .75, kindle: .75, plant: .7, sneak: .3, beg: .8, grab: .35, mine: .2, hug: .3 };
const LIE = { sleep: 'sleep', down: 'down', love: 'love' };
function follow(v, dt) {
  const n = v.net, lag = Math.min((performance.now() - v.netAt) / 1000, .25);
  const sp = Math.min(G.speed ?? 1, 4), fast = (G.speed ?? 1) > 4;
  const tx = n.x + n.vx * sp * lag, tz = n.z + n.vz * sp * lag;   // extrapolate a little, then ease toward it
  if (Math.hypot(tx - v.x, tz - v.z) > (fast ? 400 : 80)) { v.x = tx; v.z = tz; }
  else { v.x += (tx - v.x) * damp(10, dt); v.z += (tz - v.z) * damp(10, dt); }
  v.y += ((n.y || 0) - v.y) * damp(14, dt);
  v.vx = n.vx * sp; v.vz = n.vz * sp;
  v.heading += angDiff(v.heading, n.h) * damp(12, dt);
}

export function updatePeople(dt) {
  for (const v of G.people.values()) {
    const n = v.net;
    follow(v, dt);
    v.held = !!n.held;
    if (v.held) { v.vx = v.vz = 0; }
    animate(v, dt, v.vx, v.vz);
    const lying = LIE[n.act];
    v.actA += ((n.act && !lying ? 1 : 0) - v.actA) * damp(7, dt);
    if (n.act && !lying) v.actMode = n.act;
    v.crouch += ((CROUCH[n.act] || 0) - v.crouch) * damp(6, dt);
    if (lying) v.lieKind = lying;
    v.lieA = (v.lieA || 0) + ((lying ? 1 : 0) - (v.lieA || 0)) * damp(lying === 'down' ? 9 : 3, dt);
    v.coldA = (v.coldA || 0) + ((n.cold && !n.act ? 1 : 0) - (v.coldA || 0)) * damp(4, dt);
    const carry = CARRY[n.carry] || null;
    if (carry) v.carryKind = carry;
    v.carryA += ((carry ? 1 : 0) - v.carryA) * damp(9, dt);
    v.tool = n.tool;
    v.items = n.it || '';
    v.fol = n.fol || 0; v.load = n.load || 0;
    if (v.hitT > 0) { v.hitT -= dt; v.sq = -.12; }   // recoil from a blow
    // breath fogs in the cold; open wounds drip
    if (n.cold && Math.random() < dt * 1.2) puff(v.x + Math.cos(v.heading) * 4, v.z + Math.sin(v.heading) * 4, 1, 8, 6, 1.4, '235,240,250', 34 * v.scale);
    if (n.bleed && Math.random() < dt * 2.5) {
      puff(v.x, v.z, 1, 6, 2, 1.3, '150,15,20', 14 * v.scale);
      if (Math.random() < .35) G.blood.push({ x: v.x + (Math.random() - .5) * 6, z: v.z + (Math.random() - .5) * 6, r: 2 + Math.random() * 2.5, t: 0, seed: Math.random() * 10 });
    }
    // chips fly (and the tree / rock shudders) on each axe or pickaxe strike
    if ((v.actMode === 'chop' || v.actMode === 'mine') && v.actA > .5) {
      const mine = v.actMode === 'mine';
      const u = chopCycle((G.time + v.seed) * (mine ? .9 : 1));
      if (v.lastU < .97 && u >= .97) {
        const hx = v.x + Math.cos(v.heading) * 9, hz = v.z + Math.sin(v.heading) * 9;
        puff(hx, hz, 4, 40, 30, 1.3, mine ? '170,165,155' : '150,105,65', mine ? 3 : 10);
        sfx('chop', hx, hz, mine, .7);
        let best = null, bd = 30;
        for (const id of G.chopping) {
          const [cx, cz, i] = id.split(':').map(Number);
          const o = G.world.chunkData(cx, cz).objs[i];
          const d = o ? Math.hypot(o.x - v.x, o.z - v.z) : 1e9;
          if (d < bd) { bd = d; best = id; }
        }
        if (best) G.shake.set(best, G.time);
      }
      v.lastU = u;
    }
  }
  for (const v of G.animals.values()) {
    follow(v, dt);
    const sp = Math.hypot(v.vx, v.vz);
    v.legs += sp * dt / 18;
    v.run = sp > 60 ? 1 : 0;
    if (v.hitT > 0) v.hitT -= dt;
  }
  for (const v of G.others.values()) {
    follow(v, dt);
    v.vy = 0; v.ground = (v.net.y || 0) < 1;
    animate(v, dt, v.vx, v.vz);
    const a = v.net.act;
    v.actA = (v.actA || 0) + ((a ? 1 : 0) - (v.actA || 0)) * damp(8, dt);
    if (a) v.actMode = a;
    v.crouch = (v.crouch || 0) + ((CROUCH[a] || 0) - (v.crouch || 0)) * damp(6, dt);
    v.tool = v.net.tool;
    if (v.hitT > 0) { v.hitT -= dt; v.sq = -.12; }
  }
}
const MY_ANIM = { pick: 'pick', sticks: 'pick', stone: 'mine', ore: 'mine', fell: 'chop', dig: 'mine', water: 'drink', butcher: 'pick', loot: 'grab', crop: 'pick', build: 'craft', craft: 'craft', feed: 'kindle' };
// what the figure visibly carries for an item kind
const CARRY = { berry: 'berries', fruit: 'berries', seed: 'berries', grain: 'berries', mushroom: 'berries', herb: 'berries', stick: 'log', waterpot: 'water', stone: 'stone', clay: 'stone', fish: 'fish', meat: 'fish', cooked: 'fish', flesh: 'fish' };

// ───────── effects ─────────
const bleed = (x, z, n, r) => { for (let k = 0; k < n; k++) G.blood.push({ x: x + (Math.random() - .5) * r, z: z + (Math.random() - .5) * r, r: 3 + Math.random() * 5, t: 0, seed: Math.random() * 10 }); };
// a blow shoves the body away from whoever struck it
function knock(v, m, d) {
  if (m.bx == null) return;
  const dx = v.x - m.bx, dz = v.z - m.bz, l = Math.hypot(dx, dz) || 1;
  v.x += dx / l * d; v.z += dz / l * d;
}
function nearestAnimal(x, z) {
  let best = null, bd = 30;
  for (const a of G.animals.values()) { const d = Math.hypot(a.x - x, a.z - z); if (d < bd) { bd = d; best = a; } }
  return best;
}
function objAt(id) {
  const [cx, cz, i] = String(id).split(':').map(Number);
  const d = G.world && G.world.chunkData(cx, cz);
  return d && d.objs[i];
}
export function handleFx(m) {
  if (m.kind === 'hearts' || m.kind === 'sparkle') {
    const heart = m.kind === 'hearts';
    for (let k = 0; k < 6; k++) G.hearts.push({
      x: m.x + (Math.random() - .5) * (heart ? 14 : 16), z: m.z, y: 28 + Math.random() * 10, t: -k * .12,
      ch: heart ? '♥' : '✦', c: heart ? '255,105,140' : '255,240,170',
    });
  } else if (m.kind === 'death') {
    const v = m.pid != null ? (m.pid === G.myId ? P : G.others.get(m.pid)) : G.people.get(m.id);
    if (v) sfx('death', v.x, v.z, null, m.violent ? 1 : .5);
    if (v && m.violent) { bleed(v.x + Math.cos(v.heading) * 6, v.z + Math.sin(v.heading) * 6, 1, 4); G.blood.push({ x: v.x, z: v.z, r: 15 + Math.random() * 6, t: 0, seed: Math.random() * 10 }); puff(v.x, v.z, 14, 70, 40, 2, '160,15,20', 14); }
  } else if (m.kind === 'hit') {
    const mine = m.pid != null && m.pid === G.myId;
    if (mine) { G.shakeT = Math.max(G.shakeT || 0, .25); G.hurtT = .5; }
    const v = m.animal ? G.animals.get(m.animal) : m.pid != null ? (mine ? P : G.others.get(m.pid)) : G.people.get(m.id);
    if (v) { v.hitT = .22; knock(v, m, 7); }
    sfx('hit', m.x, m.z, m.big);
    if (m.bx != null && !m.animal) { const a = nearestAnimal(m.bx, m.bz); if (a && a.net.k === 'wolf') sfx('bite', m.x, m.z); }
    if (m.blood) {
      puff(m.x, m.z, m.big ? 14 : 8, m.big ? 80 : 55, 35, 1.6, '170,20,25', 16);
      bleed(m.x, m.z, m.big ? 3 : 1, 12);
    } else puff(m.x, m.z, 3, 30, 22, 1.6, '255,255,255', 14);
    G.hearts.push({ x: m.x, z: m.z, y: 34, t: 0, ch: '✶', c: '255,220,120' });
  } else if (m.kind === 'block') {   // parried / dodged: a clack and a spark, no blood
    const v = G.people.get(m.id);
    if (v) knock(v, m, 3);
    sfx('block', m.x, m.z);
    puff(m.x, m.z, 4, 45, 30, 1.1, '255,250,225', 18);
    G.hearts.push({ x: m.x, z: m.z, y: 30, t: 0, ch: '⛨', c: '220,230,255' });
  } else if (m.kind === 'knockdown') {
    const v = G.people.get(m.id);
    if (v) { knock(v, m, 12); v.lieA = .4; }
    sfx('knockdown', m.x, m.z);
    puff(m.x, m.z, 12, 60, 18, 2.4, '170,150,120');
  } else if (m.kind === 'kindle') {
    for (let k = 0; k < 10; k++) puff(m.x, m.z, 1, 25, 45, 1.2, '255,190,90', 6);
    sfx('kindle', m.x, m.z);
  } else if (m.kind === 'fell') {   // the tree topples (drawn in objects.js), the stump stays
    puff(m.x, m.z, 8, 40, 20, 2.2, '150,120,80');
    sfx('fell', m.x, m.z);
    const o = objAt(m.id);
    if (o && !o.felled) { o.felled = true; G.falling.set(m.id, { t0: G.time, dir: m.dir || 1, dust: false }); }
    G.felledVer = -1;   // refetch stumps
  } else if (m.kind === 'learn') {
    G.hearts.push({ x: m.x, z: m.z, y: 40, t: 0, ch: '🎓', c: '255,255,255' });
    sfx('chime', m.x, m.z, null, .6);
  } else if (m.kind === 'vision' || m.kind === 'idea') {
    const ch = m.kind === 'idea' ? '💡' : m.symbol;
    for (let k = 0; k < 5; k++) G.hearts.push({ x: m.x + (Math.random() - .5) * 18, z: m.z, y: 36 + Math.random() * 10, t: -k * .15, ch, c: '255,236,150' });
  } else if (m.kind === 'explosion') {
    G.flashes.push({ x: m.x, z: m.z, t: 0, big: true });
    puff(m.x, m.z, 40, 260, 140, 4.5, '255,170,60', 6);
    puff(m.x, m.z, 30, 160, 90, 5.5, '70,65,60', 10);
    bleed(m.x, m.z, 4, 60);
    G.shakeT = .6;
    sfx('explosion', m.x, m.z, null, 1.6);
  } else if (m.kind === 'throw') {   // a bomb in flight, then a fuse fizzing where it lands
    G.throws.push({ x0: m.x0, z0: m.z0, x: m.x, z: m.z, fly: m.t || .9, t: 0 });
    sfx('chop', m.x0, m.z0, false, .4);
  } else if (m.kind === 'arrow') {
    const len = 90;
    for (let k = 1; k <= 6; k++) G.particles.push({ x: m.x + Math.cos(m.h) * len * k / 6, y: 14, z: m.z + Math.sin(m.h) * len * k / 6, vx: 0, vz: 0, vy: 0, life: k * .02, max: .25 + k * .02, r: .9, col: '90,70,50' });
    sfx('block', m.x, m.z, null, .5);
  } else if (m.kind === 'lightning') {
    G.flashes.push({ x: m.x, z: m.z, t: 0, bolt: true });
    sfx('thunder', null, null, null, .8);
  }
}

export function updateEffects(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i]; p.life += dt;
    if (p.life > p.max) { G.particles.splice(i, 1); continue; }
    const k = Math.exp(-4 * dt); p.vx *= k; p.vz *= k; p.vy = p.vy * Math.exp(-3 * dt) - 20 * dt;
    p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.max(0, p.y + p.vy * dt);
  }
  for (let i = G.blood.length - 1; i >= 0; i--) { const b = G.blood[i]; b.t += dt; if (b.t > 240) G.blood.splice(i, 1); }
  if (G.blood.length > 600) G.blood.splice(0, G.blood.length - 600);
  for (let i = G.hearts.length - 1; i >= 0; i--) { const h = G.hearts[i]; h.t += dt; if (h.t > 0) h.y += 14 * dt; if (h.t > 1.6) G.hearts.splice(i, 1); }
  for (let i = G.flashes.length - 1; i >= 0; i--) { const f = G.flashes[i]; f.t += dt; if (f.t > .8) G.flashes.splice(i, 1); }
  if (G.shakeT > 0) G.shakeT -= dt;
  if (G.hurtT > 0) G.hurtT -= dt;
  for (let i = G.throws.length - 1; i >= 0; i--) { const b = G.throws[i]; b.t += dt; if (b.t > b.fly + 1.7) G.throws.splice(i, 1); }
}
