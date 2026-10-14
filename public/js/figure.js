// The stick figure: procedural 3D pose (gait, IK legs, work poses) projected as a thick pictogram.
import { TAU, clamp, lerp, smooth, frac, damp, mixc, rgb } from '/shared/core.js';
import { G, ctx, proj, TILT } from './state.js';
import { C } from './objects.js';

export const LEG_T = 11, LEG_S = 11, LEG = LEG_T + LEG_S, TORSO = 14, HEAD_R = 5.6, ARM_U = 8.8, ARM_F = 8;
export const LW = 4.8;                       // pictogram-thick limbs
export const WALK = 92, RUN = 215, JUMP_V = 430;
export const strideLen = run => lerp(56, 96, run);   // distance covered per full gait cycle

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// gait state shared by every animated body (player, villagers, other players)
export function newBody(o = {}) {
  return Object.assign({
    x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, heading: 0, ground: true,
    phase: Math.random(), sq: 0, sqv: 0, airA: 0, walkA: 0, runA: 0, lean: 0, hipOff: 21,
    scale: 1, kid: 0, hunch: 0, seed: Math.random() * 100,
    actMode: null, actA: 0, crouch: 0, carryA: 0, carryKind: null,
  }, o);
}

// advance gait blend, phase, lean and squash from the body's current velocity
export function animate(e, dt, tx, tz) {
  e.sqv += (-e.sq * 280 - e.sqv * 17) * dt; e.sq += e.sqv * dt;
  const s = e.scale || 1, sp = Math.hypot(e.vx, e.vz) / s;   // gait is driven by body-relative speed
  e.walkA += (smooth(2, 40, sp) - e.walkA) * damp(12, dt);
  e.runA += (clamp((sp - WALK) / (RUN - WALK), 0, 1) - e.runA) * damp(8, dt);
  e.airA += ((e.ground ? 0 : 1) - e.airA) * damp(e.ground ? 18 : 10, dt);
  if (e.ground) {
    e.phase += sp * dt / strideLen(e.runA);
    if (sp < 6) { const t = Math.round(e.phase * 2) / 2; e.phase += (t - e.phase) * damp(6, dt); }
  }
  const fwdAcc = ((tx - e.vx) * Math.cos(e.heading) + (tz - e.vz) * Math.sin(e.heading)) / (3500 * s);
  e.lean += (clamp(sp / RUN * .24 + fwdAcc * (e.ground ? 1 : .3), -.35, .4) - e.lean) * damp(9, dt);
}

function ik3(h, f, a, b, bendDir) {
  let v = sub(f, h), d = len3(v);
  const max = a + b - .01;
  if (d > max) { v = [v[0] / d * max, v[1] / d * max, v[2] / d * max]; f = add(h, v); d = max; }
  d = Math.max(d, .5);
  const u = [v[0] / d, v[1] / d, v[2] / d];
  let p = sub(bendDir, [u[0] * dot(bendDir, u), u[1] * dot(bendDir, u), u[2] * dot(bendDir, u)]);
  p = len3(p) < 1e-3 ? [0, 1, 0] : norm(p);
  const ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
  return [add(add(h, u, a * ca), p, a * sa), f];
}

// arm angles [upper, fore] for work poses (0 = hanging down, +π/2 = straight forward)
export const chopCycle = tt => frac(tt * 1.1);
function actArms(mode, i, tt) {
  switch (mode) {
    case 'pick': { const w = Math.sin(tt * 6 + i * 2) * .25; return [1.05 + w, 1.35 + w]; }
    case 'kneel': return [.95, 1.45];
    case 'fish': return i === 0 ? [1.15 + Math.sin(tt * .9) * .05, 1.45] : [.9, 1.5];
    case 'chop': {
      const u = chopCycle(tt);
      const a = u < .7 ? lerp(.5, 2.85, smooth(0, .7, u)) : lerp(2.85, .45, (u - .7) / .3);
      return [a, a + .25];
    }
    case 'talk': { const g = i === 0 ? Math.max(0, Math.sin(tt * 2.3)) * .9 : 0; return [.15 + g, .95 + g * 1.4]; }
    case 'sit': return [.45, 1.25];
    case 'carry': return [.5, 1.6];
  }
  return [0, .12];
}

export function figurePose(e) {
  const th = e.heading, F = [Math.cos(th), 0, Math.sin(th)], S = [-Math.sin(th), 0, Math.cos(th)];
  const UP = [0, 1, 0], s = e.scale || 1, tt = G.time + (e.seed || 0);
  const wa = e.walkA, run = e.runA, air = e.airA, cr = e.crouch || 0;
  const mode = e.actA > .01 ? e.actMode : null;
  // Stance length stays within leg reach; when running the stance gets shorter
  // (sf = fraction of the cycle a foot is planted), giving a real flight phase.
  const D = strideLen(run), SL = lerp(14, 13, run), sf = clamp(2 * SL / D, .2, .5), ph = e.phase;
  const c4 = Math.cos(ph * 4 * Math.PI), r4 = Math.cos((ph - sf / 2) * 4 * Math.PI);
  let off = 21;
  off -= wa * (1 - air) * ((1 - run) * 1.3 * c4 + run * (1.1 * r4 + 1.4));
  off -= (1 - wa) * Math.sin(tt * 2.2) * .35;
  off -= cr * 13;                                         // crouch / kneel / sit
  if (mode === 'chop') { const u = chopCycle(tt); off -= (u > .7 ? (u - .7) / .3 : 0) * 1.5 * e.actA; }

  const fy0 = e.held ? e.y : 0;   // carried babies / ghosts: feet hang from the body, not the ground
  const feet = [], offs = [];
  const rising = clamp(e.vy / JUMP_V, -1, 1);
  for (let i = 0; i < 2; i++) {
    const t = frac(ph + i * .5), side = i ? -1 : 1;
    let offx, lift;
    if (t < sf) { offx = lerp(SL, -SL, t / sf); lift = 0; }
    else { const u = (t - sf) / (1 - sf), q = u * u * (3 - 2 * u); offx = lerp(-SL, SL, q); lift = Math.sin(Math.PI * u) * lerp(5, 9, run); }
    offs.push(offx / SL);
    const fwd = offx * wa + cr * cr * 10 + (mode === 'chop' ? (i ? -4 : 4) * e.actA : 0);
    const spread = 3.2 + cr * 1.5;
    let foot = [e.x + F[0] * fwd + S[0] * side * spread, fy0 + lift * wa, e.z + F[2] * fwd + S[2] * side * spread];
    const hip = [e.x, e.y + off, e.z];
    const airFoot = add(add(add(hip, F, i ? -5 - 2 * rising : 6 + 2 * rising), S, side * 3), UP, -(i ? 18 : 13 + (1 - rising) * 2.5));
    foot = [lerp(foot[0], airFoot[0], air), lerp(foot[1], airFoot[1], air), lerp(foot[2], airFoot[2], air)];
    feet.push(foot);
  }
  if (air < .5) for (const f of feet) {
    const hx = f[0] - e.x, hz = f[2] - e.z, hd2 = hx * hx + hz * hz, L = LEG * .985;
    if (hd2 < L * L) off = Math.min(off, f[1] - e.y + Math.sqrt(L * L - hd2));
  }
  // low-pass the hip height so it glides instead of snapping
  e.hipOff += (off - e.hipOff) * damp(24, G.lastDt);
  const hip = [e.x, e.y + e.hipOff - e.sq * 10, e.z];
  const legs = feet.map((f, i) => {
    const hp = add(hip, S, (i ? -1 : 1) * 2);
    const [knee, ff] = ik3(hp, f, LEG_T, LEG_S, F);
    return [hp, knee, ff];
  });

  let lean = e.lean + (e.hunch || 0);
  if (mode === 'pick' || mode === 'kneel') lean += .45 * e.actA;
  if (mode === 'chop') lean += (chopCycle(tt) > .7 ? .3 : -.05) * e.actA;
  if (mode === 'sit' || mode === 'fish') lean -= .05 * e.actA;
  const tdir = norm(add([0, Math.cos(lean), 0], F, Math.sin(lean)));
  const tl = TORSO - e.sq * 3 + (1 - wa) * Math.sin(tt * 2.2) * .15;
  const neck = add(hip, tdir, tl);
  const bob = wa * (1 - air) * Math.sin(ph * 4 * Math.PI) * .25;
  const hr = HEAD_R * (1 + (e.kid || 0) * .8);   // children have proportionally bigger heads
  const head = add(add(neck, tdir, hr + 2.2), F, bob + lean * 1.5);
  const sh = add(hip, tdir, tl * .9);

  const arms = [];
  for (let i = 0; i < 2; i++) {
    const side = i ? -1 : 1;
    const swing = -offs[i] * lerp(.45, .95, run) * wa;
    let a1 = swing + Math.sin(tt * 1.1 + i * 2) * .05 * (1 - wa) + lean * .4;
    let a2 = a1 + .12 + lerp(.25, 1.55, run) * wa;
    const airA1 = rising > 0 ? lerp(1.4, 2.5, rising) + (i ? -.35 : .2) : 1.7 + (i ? -.5 : .3) + Math.sin(tt * 13 + i * 3) * .18 * -rising;
    a1 = lerp(a1, airA1, air);
    a2 = lerp(a2, a1 + (rising > 0 ? .35 : .7), air);
    // carrying / working poses override the swing
    if (e.carryA > .01) { const [b1, b2] = actArms('carry', i, tt); a1 = lerp(a1, b1, e.carryA); a2 = lerp(a2, b2, e.carryA); }
    if (mode) { const [b1, b2] = actArms(mode, i, tt); a1 = lerp(a1, b1, e.actA); a2 = lerp(a2, b2, e.actA); }
    const s0 = add(sh, S, side * 2.4);
    const out = (mode === 'chop' ? .05 : .14) + air * .25;
    const inward = mode === 'chop' || e.carryA > .5 ? side * .25 : 0;
    const d1 = norm(add(add([0, -Math.cos(a1), 0], F, Math.sin(a1)), S, side * out));
    const elbow = add(s0, d1, ARM_U);
    const d2 = norm(add(add([0, -Math.cos(a2), 0], F, Math.sin(a2)), S, side * out * .6 - inward));
    arms.push([s0, elbow, add(elbow, d2, ARM_F)]);
  }
  // scale the whole pose about the body origin (children are smaller)
  const sc = p => [e.x + (p[0] - e.x) * s, e.y + (p[1] - e.y) * s, e.z + (p[2] - e.z) * s];
  return {
    hip: sc(hip), neck: sc(neck), head: sc(head), legs: legs.map(l => l.map(sc)), arms: arms.map(a => a.map(sc)),
    hr: hr * s, s, F, S, tdir, mode,
  };
}

// tools in hand and carried goods
function drawHeld(e, pose) {
  const Z = G.cam.zoom, s = pose.s, k = s * Z;
  const hand = pose.arms[0][2];
  if (pose.mode === 'chop' && e.actA > .3) {             // axe
    const dir = norm(sub(hand, pose.arms[0][1]));
    const [ax, ay] = proj(...hand), [bx, by] = proj(...add(hand, dir, 9 * s));
    ctx.strokeStyle = '#7a5838'; ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = '#9aa0a8'; ctx.beginPath(); ctx.arc(bx, by, 2.6 * k, 0, TAU); ctx.fill();
  }
  if (pose.mode === 'fish' && e.actA > .3) {             // rod + line bobbing on the water
    const tip = add(add(hand, pose.F, 20 * s), [0, 1, 0], 14 * s);
    const bob = add(add(hand, pose.F, 30 * s), [0, -1, 0], hand[1] - 0);
    bob[1] = Math.sin(G.time * 3 + e.seed) * .6;
    const [ax, ay] = proj(...hand), [tx, ty] = proj(...tip), [fx, fy] = proj(...bob);
    ctx.strokeStyle = '#7a5838'; ctx.lineWidth = 1.6 * k;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = .7 * Z;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + fx) / 2, (ty + fy) / 2 + 6 * Z, fx, fy); ctx.stroke();
    ctx.fillStyle = '#e8563f'; ctx.beginPath(); ctx.arc(fx, fy, 1.4 * Z, 0, TAU); ctx.fill();
  }
  if (e.carryA > .5 && e.carryKind) {
    const m = add(pose.arms[0][2], sub(pose.arms[1][2], pose.arms[0][2]), .5);
    const [x, y] = proj(...m);
    if (e.carryKind === 'berries') {
      ctx.fillStyle = '#8a5a32';
      ctx.beginPath(); ctx.ellipse(x, y, 5.5 * k, 4 * k, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = C.berry;
      for (const [ox, oy] of [[-2.5, -.5], [0, -1.5], [2.5, -.5], [-1, .5], [1.5, .5]]) { ctx.beginPath(); ctx.arc(x + ox * k, y + oy * k, 1.5 * k, 0, TAU); ctx.fill(); }
    } else if (e.carryKind === 'log') {
      const [ax, ay] = proj(...add(m, pose.S, 8 * s)), [bx, by] = proj(...add(m, pose.S, -8 * s));
      ctx.strokeStyle = '#6b4d36'; ctx.lineWidth = 4.5 * k;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#c9a477'; ctx.beginPath(); ctx.arc(ax, ay, 1.6 * k, 0, TAU); ctx.fill();
    } else if (e.carryKind === 'water') {
      ctx.fillStyle = '#7d828c'; ctx.fillRect(x - 3.6 * k, y - 2 * k, 7.2 * k, 7 * k);
      ctx.fillStyle = '#5fb8dc'; ctx.beginPath(); ctx.ellipse(x, y - 2 * k, 3.6 * k, 1.5 * k, 0, 0, TAU); ctx.fill();
    } else if (e.carryKind === 'fish') {
      ctx.fillStyle = '#9fb6c8';
      ctx.beginPath(); ctx.ellipse(x, y + 1 * k, 5 * k, 2.2 * k, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 4 * k, y + 1 * k); ctx.lineTo(x + 7.5 * k, y - 1.5 * k); ctx.lineTo(x + 7.5 * k, y + 3.5 * k); ctx.closePath(); ctx.fill();
    }
  }
}

// look: { ink, female, preg, alpha, marker }
export function drawFigure(e, look) {
  const Z = G.cam.zoom, pose = figurePose(e), s = pose.s;
  ctx.globalAlpha = look.alpha ?? 1;
  if (!e.held) {
    const k = clamp(1 - e.y / 90, .3, 1), r = (10 + e.sq * 6) * s * k;
    ctx.fillStyle = `rgba(20,35,20,${.28 * k})`;
    const [sx, sy] = proj(e.x, 0, e.z);
    ctx.beginPath(); ctx.ellipse(sx, sy, r * Z, r * Z * TILT, 0, 0, TAU); ctx.fill();
  }
  const parts = [], tz = pose.hip[2];
  const ink = look.ink, far = mixc(ink, [255, 255, 255], .28);
  const lw = LW * Math.max(s, .55);
  const limb = (pts, w) => {
    const mz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
    parts.push({ z: mz, f: () => {
      const t = clamp((tz - mz) / (2.5 * s), 0, 1);
      ctx.strokeStyle = rgb(mixc(ink, far, t)); ctx.lineWidth = w * Z;
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = proj(p[0], p[1], p[2]); ctx[i ? 'lineTo' : 'moveTo'](x, y); });
      ctx.stroke();
    } });
  };
  pose.legs.forEach(l => limb(l, lw));
  pose.arms.forEach(a => limb(a, lw * .92));
  parts.push({ z: tz, f: () => {
    ctx.strokeStyle = rgb(ink); ctx.fillStyle = rgb(ink); ctx.lineWidth = lw * 1.08 * Z;
    const [a, b] = [proj(...pose.hip), proj(...pose.neck)];
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    if (look.female) {
      // restroom-sign dress: cone from the chest down to an elliptical hem
      const apex = proj(...add(pose.hip, sub(pose.neck, pose.hip), .8));
      const c = add(pose.hip, [0, -1, 0], 3 * s * (1 - (e.crouch || 0) * .7)), ring = [];
      for (let k = 0; k < 12; k++) {
        const ang = k / 12 * TAU;
        ring.push(proj(...add(add(c, pose.S, Math.cos(ang) * 6.5 * s), pose.F, Math.sin(ang) * 5 * s)));
      }
      ctx.beginPath();
      for (let k = 0; k < 12; k++) { const p = ring[k], q = ring[(k + 1) % 12]; ctx.moveTo(apex[0], apex[1]); ctx.lineTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.closePath(); }
      ring.forEach((p, k) => ctx[k ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.closePath();
      ctx.fill();
    }
    if (look.preg) {
      const [bx, by] = proj(...add(add(pose.hip, pose.tdir, 6 * s), pose.F, 4 * s));
      ctx.beginPath(); ctx.arc(bx, by, 4 * s * Z, 0, TAU); ctx.fill();
    }
    const [hx, hy] = proj(...pose.head);
    ctx.beginPath(); ctx.arc(hx, hy, pose.hr * Z, 0, TAU); ctx.fill();
    if (look.marker) {   // little arrow over the player
      const my = hy - (pose.hr + 7 + Math.sin(G.time * 3) * 1.2) * Z;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath(); ctx.moveTo(hx - 3.5 * Z, my - 4 * Z); ctx.lineTo(hx + 3.5 * Z, my - 4 * Z); ctx.lineTo(hx, my); ctx.closePath(); ctx.fill();
    }
  } });
  parts.sort((a, b) => a.z - b.z);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of parts) p.f();
  drawHeld(e, pose);
  ctx.globalAlpha = 1;
  e.headTop = pose.head[1] + pose.hr;   // for speech bubbles
}
