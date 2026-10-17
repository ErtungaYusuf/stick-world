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
    case 'mine': {   // pickaxe: high swing, strike at the ground
      const u = chopCycle(tt * .9);
      const a = u < .7 ? lerp(.4, 2.75, smooth(0, .7, u)) : lerp(2.75, .15, (u - .7) / .3);
      return [a, a + .2];
    }
    case 'craft': return i === 0 ? [1 + Math.max(0, Math.sin(tt * 9)) * .9, 1.6] : [.9, 1.5];   // hammering
    case 'talk': { const g = i === 0 ? Math.max(0, Math.sin(tt * 2.3)) * .9 : 0; return [.15 + g, .95 + g * 1.4]; }
    case 'argue': { const g = Math.max(0, Math.sin(tt * 4.5 + i * 2.2)) * 1.25; return [.25 + g, 1.1 + g * 1.1]; }
    case 'fight': {   // a brawl: jab flurries, wound-up haymakers and overhead blows, the other hand kept up in guard
      const c = tt * 1.3, seg = Math.floor(c), u = c - seg, move = ((seg * 2654435761) >>> 0) % 4, lead = seg % 2;
      const guard = [1, 2.3];
      if (move === 0 || move === 3) {   // a flurry of jabs, both hands
        const k = Math.sin(u * TAU * 2.5 + i * Math.PI);
        return k > 0 ? [lerp(1, 1.62, k), lerp(2.3, 1.62, k)] : guard;
      }
      if (i !== lead) return guard;
      if (move === 1) {   // haymaker: pulled far back, then whipped round
        if (u < .55) { const w = smooth(0, .55, u); return [lerp(1, .25, w), lerp(2.3, 1.9, w)]; }
        const s = smooth(.55, .72, u); return u < .85 ? [lerp(.25, 1.75, s), lerp(1.9, 1.8, s)] : guard;
      }
      // overhead: raised high, brought down hard
      if (u < .5) { const w = smooth(0, .5, u); return [lerp(1, 2.8, w), lerp(2.3, 3.05, w)]; }
      const s = smooth(.5, .66, u); return u < .82 ? [lerp(2.8, 1.15, s), lerp(3.05, 1.25, s)] : guard;
    }
    case 'pray': { const w = Math.sin(tt * 1.6) * .08; return [2.7 + w, 2.9 + w]; }
    case 'dance': { const w = Math.sin(tt * 4 + i * Math.PI); return [2.3 + w * .45, 2.6 + w * .55]; }
    case 'chant': { const w = Math.sin(tt * 2 + i) * .1; return [1.85 + w, 2.05 + w]; }
    case 'mourn': return [.35, .85];
    case 'sit': return [.45, 1.25];
    case 'carry': return [.5, 1.6];
    case 'eat': { const u = (Math.sin(tt * 3) + 1) / 2; return i === 0 ? [.85, lerp(1.4, 3, u)] : [.6, 1.4]; }   // hand to mouth
    case 'drink': { const w = Math.sin(tt * 2) * .08; return [.95 + w, 2.75 + w]; }                           // cupped hands
    case 'warm': { const w = Math.sin(tt * 3 + i * 2) * .1; return [1.3 + w, 1.55 - w]; }                     // palms to the fire
    case 'cry': return [1.15 + Math.sin(tt * 9) * .03, 3];                                                     // face in hands
    case 'worship': return [2 + Math.sin(tt * 1.2) * .2, 1.9];                                                  // prostrate, arms forward
    case 'heal': { const w = Math.sin(tt * 2.5 + i) * .1; return [1.25 + w, 1.55]; }
    case 'kindle': { const w = Math.sin(tt * 16 + i * Math.PI) * .12; return [1.3 + w, 1.75 - w]; }           // twirling the fire drill
    case 'plant': { const w = Math.sin(tt * 5 + i) * .3; return [.7 + w, .9 + w * .5]; }
    case 'give': return i === 0 ? [1.5, 1.55] : [.1, .2];
    case 'cold': { const w = Math.sin(tt * 40) * .04; return [.6 + w, 2.3 + w]; }                              // hugging themselves
    case 'hug': return [1.3, 2.35];                                                                             // arms around the other
    case 'sneak': return [.35, .95];
    case 'grab': { const u = Math.max(0, Math.sin(tt * 8)); return i === 0 ? [1.1 + u * .5, 1.2 + u * .4] : [.3, .5]; }
    case 'beg': { const w = Math.sin(tt * 3) * .08; return [1.55 + w, 1.95 + w]; }                            // open palms raised
    case 'command': return i === 0 ? [2 + Math.sin(tt * 4) * .15, 2.05] : [.35, 1.9];                       // pointing, other hand on hip
    case 'wave': return i === 0 ? [2.6, 2.9 + Math.sin(tt * 11) * .45] : [.05, .15];
    case 'scratch': return i === 0 ? [2.25, 3.3 + Math.sin(tt * 14) * .08] : [.05, .15];                     // hand to the head
    case 'stretch': { const w = Math.sin(tt * 1.5) * .06; return [2.95 + w, 3.05 + w]; }                     // arms up after waking
    case 'look': return i === 0 ? [2.05, 3.25] : [.05, .15];                                                   // shading the eyes
    case 'laugh': return [.6 + Math.sin(tt * 18) * .05, 1.95];                                                 // holding the belly
    case 'throw': {
      const u = frac(tt * 1.4);
      const a = u < .6 ? lerp(.4, 3, u / .6) : lerp(3, 1.2, (u - .6) / .4);
      return i === 0 ? [a, a + .2] : [.6, .9];
    }
  }
  return [0, .12];
}
const ARMS_OUT = { dance: .45, pray: .3, chant: .55, fight: .08, chop: .05, mine: .05, warm: .25, worship: .25, heal: .1, cry: .02, eat: .1, hug: .02, sneak: .05, beg: .3, laugh: .1, stretch: .25 };
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

export function figurePose(e) {
  const th = e.heading, F = [Math.cos(th), 0, Math.sin(th)], S = [-Math.sin(th), 0, Math.cos(th)];
  const UP = [0, 1, 0], s = e.scale || 1, tt = G.time + (e.seed || 0);
  const wa = e.walkA, run = e.runA, air = e.airA, cr = e.crouch || 0;
  // shivering people hug themselves when they have nothing else to do
  const mode = e.actA > .01 ? e.actMode : e.coldA > .3 ? 'cold' : null;
  const modeA = e.actA > .01 ? e.actA : e.coldA || 0;
  // Stance length stays within leg reach; when running the stance gets shorter
  // (sf = fraction of the cycle a foot is planted), giving a real flight phase.
  const D = strideLen(run), SL = lerp(14, 13, run), sf = clamp(2 * SL / D, .2, .5), ph = e.phase;
  const c4 = Math.cos(ph * 4 * Math.PI), r4 = Math.cos((ph - sf / 2) * 4 * Math.PI);
  let off = 21;
  off -= wa * (1 - air) * ((1 - run) * 1.3 * c4 + run * (1.1 * r4 + 1.4));
  off -= (1 - wa) * Math.sin(tt * 2.2) * .35;
  off -= cr * 13;                                         // crouch / kneel / sit
  if (mode === 'chop') { const u = chopCycle(tt); off -= (u > .7 ? (u - .7) / .3 : 0) * 1.5 * e.actA; }
  if (mode === 'mine') { const u = chopCycle(tt * .9); off -= (u > .7 ? (u - .7) / .3 : 0) * 2.5 * e.actA; }
  if (mode === 'fight') off -= (1.5 + Math.abs(Math.sin(tt * 7)) * 1.2) * e.actA;   // crouched, bouncing stance
  if (mode === 'dance') off += Math.abs(Math.sin(tt * 4)) * 2 * e.actA;             // hopping

  const fy0 = e.held ? e.y : 0;   // carried babies / ghosts: feet hang from the body, not the ground
  const feet = [], offs = [];
  const rising = clamp(e.vy / JUMP_V, -1, 1);
  for (let i = 0; i < 2; i++) {
    const t = frac(ph + i * .5), side = i ? -1 : 1;
    let offx, lift;
    if (t < sf) { offx = lerp(SL, -SL, t / sf); lift = 0; }
    else { const u = (t - sf) / (1 - sf), q = u * u * (3 - 2 * u); offx = lerp(-SL, SL, q); lift = Math.sin(Math.PI * u) * lerp(5, 9, run); }
    offs.push(offx / SL);
    const stance = mode === 'chop' || mode === 'mine' || mode === 'fight' ? (i ? -4 : 4) * e.actA : 0;
    const fwd = offx * wa + cr * cr * 10 + stance;
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
  if (mode === 'mine') lean += (chopCycle(tt * .9) > .7 ? .45 : 0) * e.actA;
  if (mode === 'sit' || mode === 'fish') lean -= .05 * e.actA;
  if (mode === 'mourn') lean += .55 * e.actA;
  if (mode === 'craft') lean += .35 * e.actA;
  if (mode === 'fight') {   // weight thrown behind the big blows, rocked back when struck
    const c = tt * 1.3, seg = Math.floor(c), u = c - seg, move = ((seg * 2654435761) >>> 0) % 4;
    const big = move === 1 || move === 2 ? (u < .5 ? -.12 * smooth(0, .5, u) : .38 * (1 - smooth(.66, .9, u)) * smooth(.5, .62, u)) : Math.max(0, Math.sin(tt * 8)) * .1;
    lean += (.18 + big) * e.actA;
  }
  if (e.hitT > 0) lean -= .35 * Math.min(1, e.hitT / .22);
  if (mode === 'pray' || mode === 'chant') lean -= .12 * e.actA;
  if (mode === 'dance') lean += Math.sin(tt * 2) * .15 * e.actA;
  const BOW = { eat: .12, drink: .6, warm: .15, heal: .5, kindle: .45, plant: .55, give: .12 };
  if (mode in BOW) lean += BOW[mode] * modeA;
  if (mode === 'cry') lean += (.45 + Math.sin(tt * 9) * .04) * modeA;                    // shoulders shaking
  if (mode === 'worship') lean += (.7 + (Math.sin(tt * 1.2) + 1) * .3) * modeA;          // bowing to the ground, again and again
  if (mode === 'cold') lean += .1 * modeA;
  const LEAN = { sneak: .38, grab: .3, beg: .25, hug: .12, command: -.05, stretch: -.2, look: .05, scratch: .05 };
  if (mode in LEAN) lean += LEAN[mode] * modeA;
  if (mode === 'laugh') lean += (Math.sin(tt * 18) * .06 - .1) * modeA;
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
    if (mode) { const [b1, b2] = actArms(mode, i, tt); a1 = lerp(a1, b1, modeA); a2 = lerp(a2, b2, modeA); }
    const s0 = add(sh, S, side * 2.4);
    const out = (mode ? lerp(.14, ARMS_OUT[mode] ?? .14, modeA) : .14) + air * .25;
    const inward = mode === 'chop' || mode === 'mine' || e.carryA > .5 ? side * .25 : mode === 'cold' || mode === 'cry' || mode === 'hug' || mode === 'laugh' ? side * .55 * modeA : 0;
    const d1 = norm(add(add([0, -Math.cos(a1), 0], F, Math.sin(a1)), S, side * out));
    const elbow = add(s0, d1, ARM_U);
    const d2 = norm(add(add([0, -Math.cos(a2), 0], F, Math.sin(a2)), S, side * out * .6 - inward));
    arms.push([s0, elbow, add(elbow, d2, ARM_F)]);
  }
  // lying down (sleep, knocked down, dead): blend the whole skeleton toward a body stretched on the ground
  let P = { hip, neck, head, legs, arms, tdir };
  const k = e.lieA || 0;
  if (k > .01) {
    const pt = (a, b, h) => [e.x + F[0] * a + S[0] * b, e.y + h, e.z + F[2] * a + S[2] * b];
    const love = e.lieKind === 'love';
    const curl = e.lieKind === 'sleep' || love ? 1 : 0, breathe = curl ? Math.sin(tt * (love ? 2.2 : 1.3)) * .35 : 0;
    const flung = !curl;
    const L = {
      hip: pt(-2, 0, 1.6), neck: pt(12, 0, 1.6 + breathe), head: pt(14.2 + hr, 0, hr * .75),
      legs: [1, -1].map(sd => [pt(-2, sd * 2, 1.6), pt(-10 + curl * 4, sd * (2.6 + curl * 2), 1.6 + curl * 6), pt(-21 + curl * 9, sd * (3.5 + (flung ? 2 : 0)), 1.2)]),
      arms: [1, -1].map(sd => flung
        ? [pt(10.5, sd * 2.4, 1.6), pt(12, sd * 10, 1.2), pt(16, sd * 16, 1)]
        : love && sd > 0   // an arm wrapped over the one lying beside them
          ? [pt(10.5, sd * 2.4, 2), pt(8, sd * 9, 5), pt(4, sd * 14, 3)]
          : [pt(10.5, sd * 2.4, 1.6), pt(4, sd * 4.5, 2), pt(-1 + curl * 9, sd * 4, 2.2)]),
    };
    P = {
      hip: lerp3(hip, L.hip, k), neck: lerp3(neck, L.neck, k), head: lerp3(head, L.head, k),
      legs: legs.map((l, i) => l.map((p, j) => lerp3(p, L.legs[i][j], k))),
      arms: arms.map((a, i) => a.map((p, j) => lerp3(p, L.arms[i][j], k))),
      tdir: norm(lerp3(tdir, F, k)),
    };
  }
  // scale the whole pose about the body origin (children are smaller)
  const sc = p => [e.x + (p[0] - e.x) * s, e.y + (p[1] - e.y) * s, e.z + (p[2] - e.z) * s];
  return {
    hip: sc(P.hip), neck: sc(P.neck), head: sc(P.head), legs: P.legs.map(l => l.map(sc)), arms: P.arms.map(a => a.map(sc)),
    hr: hr * s, s, F, S, tdir: P.tdir, mode, lie: k,
  };
}

// tools in hand and carried goods
function drawHeld(e, pose) {
  const Z = G.cam.zoom, s = pose.s, k = s * Z;
  const hand = pose.arms[0][2];
  // tools only appear once the village has invented and crafted them
  const holding = (len, head) => {
    const dir = norm(sub(hand, pose.arms[0][1]));
    const [ax, ay] = proj(...hand), [bx, by] = proj(...add(hand, dir, len * s));
    ctx.strokeStyle = '#7a5838'; ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    head(bx, by, dir);
  };
  if (e.actA > .3 && pose.mode === 'chop' && e.tool === 'axe') holding(9, (bx, by) => {
    ctx.fillStyle = '#9aa0a8'; ctx.beginPath(); ctx.arc(bx, by, 2.6 * k, 0, TAU); ctx.fill();
  });
  if (e.actA > .3 && pose.mode === 'mine' && e.tool === 'pick') holding(10, (bx, by, dir) => {
    const [px, py] = proj(...add(add(hand, dir, 10 * s), pose.F, 4 * s)), [qx, qy] = proj(...add(add(hand, dir, 10 * s), pose.F, -4 * s));
    ctx.strokeStyle = '#8d939b'; ctx.lineWidth = 2.2 * k;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(bx, by - 2 * k, qx, qy); ctx.stroke();
  });
  if (e.actA > .3 && pose.mode === 'craft') holding(5, (bx, by) => {   // stone hammer
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(bx - 2.2 * k, by - 1.6 * k, 4.4 * k, 3.2 * k);
  });
  if (e.actA > .3 && pose.mode === 'fight' && e.tool === 'spear') holding(16, (bx, by) => {
    ctx.fillStyle = '#b8bec6'; ctx.beginPath(); ctx.arc(bx, by, 1.8 * k, 0, TAU); ctx.fill();
  });
  if (e.actA > .3 && pose.mode === 'fight' && e.tool === 'blade') holding(4, (bx, by) => {
    ctx.fillStyle = '#c8ccd2'; ctx.beginPath(); ctx.ellipse(bx, by, 1.2 * k, 3 * k, 0, 0, TAU); ctx.fill();
  });
  if (e.actA > .3 && pose.mode === 'fight' && e.tool === 'axe') holding(9, (bx, by) => {
    ctx.fillStyle = '#9aa0a8'; ctx.beginPath(); ctx.arc(bx, by, 2.6 * k, 0, TAU); ctx.fill();
  });
  if (e.actA > .3 && pose.mode === 'mine' && e.tool !== 'pick') holding(5, (bx, by) => {   // digging with a stick
    ctx.fillStyle = '#7a5838'; ctx.beginPath(); ctx.arc(bx, by, 1.2 * k, 0, TAU); ctx.fill();
  });
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
    } else if (e.carryKind === 'stone') {
      ctx.fillStyle = '#9a958c';
      ctx.beginPath(); ctx.moveTo(x - 4.5 * k, y + 3 * k); ctx.lineTo(x - 3.5 * k, y - 2 * k); ctx.lineTo(x + 1 * k, y - 3.5 * k); ctx.lineTo(x + 4.5 * k, y - 1 * k); ctx.lineTo(x + 4 * k, y + 3 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b6b1a7'; ctx.beginPath(); ctx.arc(x - 1 * k, y - 1 * k, 1.6 * k, 0, TAU); ctx.fill();
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
  const lw = LW * Math.max(s, .55) * (look.thin || 1);
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
  const items = look.items || '';
  if (look.load >= 4 && pose.lie < .5) {   // a bundle on the back of anyone carrying a lot
    const back = add(add(add(pose.hip, sub(pose.neck, pose.hip), .65), pose.F, -3.6 * s), [0, 1, 0], 0);
    parts.push({ z: back[2] - .01, f: () => {
      const [bx, by] = proj(...back), r = (2.6 + Math.min(look.load, 8) * .25) * s * Z;
      ctx.fillStyle = '#8a6a45'; ctx.beginPath(); ctx.ellipse(bx, by, r, r * 1.2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#6e5234'; ctx.lineWidth = .8 * Z; ctx.beginPath(); ctx.moveTo(bx - r, by); ctx.lineTo(bx + r, by); ctx.stroke();
    } });
  }
  parts.push({ z: tz, f: () => {
    if (items.includes('c')) {   // woven cloak draped from the shoulders
      const top = add(pose.hip, sub(pose.neck, pose.hip), .9), bot = add(pose.hip, [0, -1, 0], 2 * s * (1 - pose.lie));
      const q = [add(top, pose.S, 4.6 * s), add(top, pose.S, -4.6 * s), add(bot, pose.S, -7 * s), add(bot, pose.S, 7 * s)].map(p => proj(...p));
      ctx.fillStyle = '#8a6a45';
      ctx.beginPath(); q.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#6e5234'; ctx.lineWidth = .8 * Z;
      ctx.beginPath(); ctx.moveTo((q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2); ctx.lineTo((q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2); ctx.stroke();
    }
    ctx.strokeStyle = rgb(ink); ctx.fillStyle = rgb(ink); ctx.lineWidth = lw * 1.08 * Z;
    const [a, b] = [proj(...pose.hip), proj(...pose.neck)];
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    if (look.female && pose.lie < .5 && !look.bones) {
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
    if (look.band) {   // clan colours: a sash across the shoulders
      const top = add(pose.hip, sub(pose.neck, pose.hip), .82);
      const [ax, ay] = proj(...add(top, pose.S, 3.4 * s)), [bx, by] = proj(...add(top, pose.S, -3.4 * s));
      ctx.strokeStyle = look.band; ctx.lineWidth = 2.6 * Math.max(s, .6) * Z;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = rgb(ink);
    }
    const [hx, hy] = proj(...pose.head);
    ctx.beginPath(); ctx.arc(hx, hy, pose.hr * Z, 0, TAU); ctx.fill();
    if (look.bones) {   // a skull: dark eye sockets
      ctx.fillStyle = 'rgba(40,35,30,.8)';
      for (const o of [-1.6, 1.6]) { const [ex, ey] = proj(...add(pose.head, pose.S, o * pose.s)); ctx.beginPath(); ctx.arc(ex, ey - .5 * Z, 1 * pose.s * Z, 0, TAU); ctx.fill(); }
      ctx.fillStyle = rgb(ink);
    }
    if (items.includes('n')) {   // stone-bead necklace at the throat
      const nk = add(add(pose.neck, pose.F, 1.6 * s), [0, -1, 0], 1.2 * s);
      ctx.fillStyle = '#e8c35a';
      for (const o of [-2.2, 0, 2.2]) { const [x, y] = proj(...add(nk, pose.S, o * s)); ctx.beginPath(); ctx.arc(x, y, 1.1 * s * Z, 0, TAU); ctx.fill(); }
      ctx.fillStyle = rgb(ink);
    }
    // whom people follow shows: a crown for the most followed, a star for anyone with a following
    if (look.chief || look.fol >= 2) {
      const cy = hy - (pose.hr + 3.5) * Z, w = (look.chief ? 4.5 : 2.6) * Math.max(s, .7) * Z;
      ctx.fillStyle = '#f2c53d';
      ctx.beginPath();
      if (look.chief) { ctx.moveTo(hx - w, cy); ctx.lineTo(hx - w, cy - w * .9); ctx.lineTo(hx - w * .45, cy - w * .4); ctx.lineTo(hx, cy - w * 1.1); ctx.lineTo(hx + w * .45, cy - w * .4); ctx.lineTo(hx + w, cy - w * .9); ctx.lineTo(hx + w, cy); }
      else for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? w * .45 : w; ctx[k ? 'lineTo' : 'moveTo'](hx + Math.cos(a) * r, cy - w + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(ink);
    }
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
