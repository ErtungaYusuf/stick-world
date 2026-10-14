// Everything that moves: the local player (simulated here), villagers and other players
// (simulated on the server, interpolated + animated here), and purely visual effects.
import { TAU, clamp, smooth, frac, damp, angDiff, mixc } from '/shared/core.js';
import { steer, moveCollide } from '/shared/motion.js';

import { G } from './state.js';
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
  if (il) { ix /= il; iz /= il; G.follow = null; }
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
  moveCollide(G.world, P, dt, PR, G.village ? [{ x: G.village.x, z: G.village.z, solid: 9 }] : []);
  animate(P, dt, tx, tz);
  for (let i = 0; i < 2; i++) {
    const t = frac(P.phase + i * .5);
    if (P.ground && t < P.prevT[i] - .5 && P.runA > .35) puff(P.x - Math.cos(P.heading) * 6, P.z - Math.sin(P.heading) * 6, 3, 25, 14, 1.8 * P.runA);
    P.prevT[i] = t;
  }
  return il > 0;
}

// ───────── villagers & other players (server-driven) ─────────
function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function growth(age) { const a = Math.min(age, 18) / 18; return .36 + .64 * (1 - Math.pow(1 - a, 1.7)); }
// body proportions & colour follow age / genes reported by the server
function refreshLook(v) {
  const n = v.net, g = growth(n.age);
  v.kid = (1 - g) / .64;
  v.scale = g * n.tall * (n.sex === 'F' ? .95 : 1) * (1 - Math.max(0, n.age - 70) * .004);
  v.hunch = smooth(60, 88, n.age) * .28;
  v.ink = mixc(hsl(n.hue, .32, .24), [150, 150, 150], smooth(55, 85, n.age) * .45);
}

function sync(map, list, isPerson) {
  const now = performance.now(), seen = new Set();
  for (const n of list) {
    let v = map.get(n.id);
    if (!v) { v = newBody({ id: n.id, x: n.x, z: n.z, y: n.y || 0, heading: n.h, seed: n.seed ?? Math.random() * 100, lastU: 0 }); map.set(n.id, v); }
    v.net = n; v.netAt = now; seen.add(n.id);
    if (isPerson) refreshLook(v);
  }
  for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
}

export function applySnapshot(s) {
  G.dayT = s.dayT; G.year = s.year; G.timeScale = s.ts; G.village = s.village;
  G.graves = s.graves; G.picked = new Set(s.picked); G.chopping = new Set(s.chopping);
  sync(G.people, s.people, true);
  if (s.players) sync(G.others, s.players.filter(p => p.id !== G.myId), false);
}

const CROUCH = { pick: .55, kneel: .75, sit: 1, fish: 1 };
function follow(v, dt) {
  const n = v.net, lag = Math.min((performance.now() - v.netAt) / 1000, .25);
  const tx = n.x + n.vx * lag, tz = n.z + n.vz * lag;   // extrapolate a little, then ease toward it
  if (Math.hypot(tx - v.x, tz - v.z) > 80) { v.x = tx; v.z = tz; }
  else { v.x += (tx - v.x) * damp(10, dt); v.z += (tz - v.z) * damp(10, dt); }
  v.y += ((n.y || 0) - v.y) * damp(14, dt);
  v.vx = n.vx; v.vz = n.vz;
  v.heading += angDiff(v.heading, n.h) * damp(12, dt);
}

export function updateVillagers(dt) {
  for (const v of G.people.values()) {
    const n = v.net;
    follow(v, dt);
    v.held = !!n.held;
    if (v.held) { v.vx = v.vz = 0; }
    animate(v, dt, v.vx, v.vz);
    v.actA += ((n.act ? 1 : 0) - v.actA) * damp(7, dt);
    if (n.act) v.actMode = n.act;
    v.crouch += ((CROUCH[n.act] || 0) - v.crouch) * damp(6, dt);
    if (n.carry) v.carryKind = n.carry;
    v.carryA += ((n.carry ? 1 : 0) - v.carryA) * damp(9, dt);
    // wood chips fly (and the tree shudders) on each axe strike
    if (v.actMode === 'chop' && v.actA > .5) {
      const u = chopCycle(G.time + v.seed);
      if (v.lastU < .97 && u >= .97) {
        const hx = v.x + Math.cos(v.heading) * 9, hz = v.z + Math.sin(v.heading) * 9;
        puff(hx, hz, 4, 40, 30, 1.3, '150,105,65', 10);
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
  for (const v of G.others.values()) {
    follow(v, dt);
    v.vy = 0; v.ground = (v.net.y || 0) < 1;
    animate(v, dt, v.vx, v.vz);
  }
}

// ───────── effects ─────────
export function handleFx(m) {
  if (m.kind === 'hearts' || m.kind === 'sparkle') {
    const heart = m.kind === 'hearts';
    for (let k = 0; k < 6; k++) G.hearts.push({
      x: m.x + (Math.random() - .5) * (heart ? 14 : 16), z: m.z, y: 28 + Math.random() * 10, t: -k * .12,
      ch: heart ? '♥' : '✦', c: heart ? '255,105,140' : '255,240,170',
    });
  } else if (m.kind === 'death') {
    const v = G.people.get(m.id);
    if (v) G.ghosts.push({ e: { ...v, held: true, actA: 0, crouch: 0, carryA: 0 }, female: v.net.sex === 'F', t: 0 });
  }
}

export function updateEffects(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i]; p.life += dt;
    if (p.life > p.max) { G.particles.splice(i, 1); continue; }
    const k = Math.exp(-4 * dt); p.vx *= k; p.vz *= k; p.vy = p.vy * Math.exp(-3 * dt) - 20 * dt;
    p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.max(0, p.y + p.vy * dt);
  }
  for (let i = G.ghosts.length - 1; i >= 0; i--) { const g = G.ghosts[i]; g.t += dt; g.e.y += 16 * dt; if (g.t > 2) G.ghosts.splice(i, 1); }
  for (let i = G.hearts.length - 1; i >= 0; i--) { const h = G.hearts[i]; h.t += dt; if (h.t > 0) h.y += 14 * dt; if (h.t > 1.6) G.hearts.splice(i, 1); }
}

