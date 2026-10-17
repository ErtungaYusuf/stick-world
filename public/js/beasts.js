// Animals drawn like the people: thick ink strokes, as someone would sketch a wolf on paper — a spine, jointed legs,
// a neck, a pointed head, a tail. Each walking frame is drawn once and stamped (flipped to face where it goes).
import { TAU, smooth, mixc, rgb, h2 } from '/shared/core.js';
import { G, ctx, proj, TILT } from './state.js';

// body plan per kind (world units): hip height = thigh + shin, spine length, how the neck rises, line weight
const LOOK = {
  wolf:   { thigh: 5.5, shin: 5.5, spine: 19, rise: 1.5, neck: 6, neckA: -.5, lw: 3.4, ink: [62, 66, 74] },
  deer:   { thigh: 7, shin: 7.5, spine: 18, rise: 2.5, neck: 10, neckA: -1.05, lw: 3, ink: [110, 74, 44] },
  boar:   { thigh: 3.5, shin: 3.5, spine: 17, rise: 1, neck: 3, neckA: .1, lw: 3.6, ink: [52, 40, 32], heavy: 3.2 },
  rabbit: { thigh: 2.2, shin: 2.4, spine: 7, rise: 0, neck: 2, neckA: -.9, lw: 2.6, ink: [120, 104, 86], arch: 4 },
  goat:   { thigh: 5, shin: 5, spine: 15, rise: 1.5, neck: 6, neckA: -.95, lw: 2.8, ink: [128, 118, 104] },
  bear:   { thigh: 6.5, shin: 5.5, spine: 24, rise: 3, neck: 5, neckA: -.2, lw: 4.4, ink: [64, 46, 34], heavy: 2.6, arch: 5 },
  fox:    { thigh: 3.6, shin: 3.6, spine: 13, rise: 1, neck: 4, neckA: -.55, lw: 2.6, ink: [196, 104, 48] },
};
const screen = () => ctx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
const shadow = (x, z, r) => {
  const [sx, sy] = proj(x, 0, z), Z = G.cam.zoom;
  ctx.fillStyle = 'rgba(25,45,25,.22)';
  ctx.beginPath(); ctx.ellipse(sx, sy, r * Z, r * Z * TILT, 0, 0, TAU); ctx.fill();
};

const BOX = [-30, -40, 34, 4], frames = new Map();
let X = ctx;

export function drawAnimal(v) {
  const n = v.net, L = LOOK[n.k];
  if (!L) return;
  const s = n.young ? .6 : 1, face = Math.cos(v.heading) >= 0 ? 1 : -1, fs = Math.max(.45, Math.abs(Math.cos(v.heading)));
  if (G.cam.zoom < .7) {   // far away: a stroke for the back and one for the head is all you'd see
    const [sx, sy] = proj(v.x, (L.thigh + L.shin) * s, v.z), Z = G.cam.zoom * s, hl = L.spine / 2 * fs * Z;
    ctx.strokeStyle = rgb(L.ink); ctx.lineWidth = Math.max(1.2, L.lw * Z); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx - hl * face, sy); ctx.lineTo(sx + hl * face, sy - L.rise * Z); ctx.lineTo(sx + (hl + 4 * Z) * face, sy - (L.rise + 3) * Z); ctx.stroke();
    return;
  }
  shadow(v.x, v.z, L.spine * .5 * s);
  if (n.act === 'sleep') { drawSleeper(v, L, s); return; }
  const moving = Math.hypot(v.vx, v.vz) > 4 ? (v.run ? 2 : 1) : 0, frame = moving ? Math.floor((((v.legs % 1) + 1) % 1) * 8) : 0;
  const bite = n.act === 'bite' ? (Math.sin(G.time * 18) > 0 ? 1 : 0) : -1, hit = v.hitT > 0;
  const res = G.cam.zoom * G.DPR * s > 2.2 ? 3 : 1.5, antlers = n.k === 'deer' && n.id % 2 === 0 && !n.young;
  const key = `${n.k}|${frame}|${moving}|${n.act === 'eat' ? 'e' : ''}|${bite}|${n.tame ? 't' : ''}|${antlers ? 'a' : ''}|${hit ? 'h' : ''}|${res}`;
  let c = frames.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = (BOX[2] - BOX[0]) * res; c.height = (BOX[3] - BOX[1]) * res;
    const g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, -BOX[0] * res, -BOX[1] * res);
    X = g; animalShape(n.k, L, (frame + .5) / 8, moving, n.act === 'eat', bite, hit, n.tame, antlers); X = ctx;
    frames.set(key, c);
    if (frames.size > 800) frames.delete(frames.keys().next().value);
  }
  const [bx, by] = proj(v.x, 0, v.z), D = G.DPR, k = D * G.cam.zoom * s / res;
  ctx.setTransform(k * face * fs, 0, 0, k, D * bx, D * by);
  ctx.drawImage(c, BOX[0] * res, BOX[1] * res);
  screen();
}

function drawSleeper(v, L, s) {
  const [bx, by] = proj(v.x, 0, v.z), D = G.DPR, k = D * G.cam.zoom * s, breath = 1 + Math.sin(G.time * 1.3 + v.id) * .04;
  ctx.setTransform(k, 0, 0, k * breath, D * bx, D * by);
  ctx.strokeStyle = rgb(L.ink); ctx.lineCap = 'round'; ctx.lineWidth = L.lw * 2.2;
  ctx.beginPath(); ctx.moveTo(-L.spine / 2, -3); ctx.quadraticCurveTo(0, -11, L.spine / 2, -3); ctx.stroke();   // curled back
  ctx.lineWidth = L.lw; ctx.beginPath(); ctx.moveTo(L.spine / 2 - 2, -2); ctx.lineTo(L.spine / 2 + 4, -1); ctx.stroke();   // head on the paws
  ctx.font = '700 7px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.textAlign = 'center';
  ctx.fillText('z', L.spine / 2 + 4 + Math.sin(G.time) * 1.5, -12 - (G.time * 4 % 6));
  screen();
}

const line = pts => { X.beginPath(); X.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) X.lineTo(pts[i][0], pts[i][1]); X.stroke(); };
const fillPoly = pts => { X.beginPath(); X.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) X.lineTo(pts[i][0], pts[i][1]); X.closePath(); X.fill(); };

// one animal facing right, feet on y = 0
function animalShape(kind, L, phase, moving, eating, bite, hit, tame, antlers) {
  const ink = hit ? [190, 40, 40] : L.ink, far = mixc(ink, [255, 255, 255], .3);
  const H = L.thigh + L.shin, gallop = moving === 2;
  const bob = moving ? Math.abs(Math.sin(phase * TAU)) * (kind === 'rabbit' ? 3 : 1) : 0;
  const hip = [-L.spine / 2, -H - bob * .5], sh = [L.spine / 2, -H - L.rise - bob * .5];
  X.lineCap = 'round'; X.lineJoin = 'round';
  // a leg: thigh from the body, a knee (forward for front legs, a hock backward for hind legs), a shin to the ground
  const leg = (top, ph, front) => {
    const sw = moving ? Math.sin(phase * TAU + ph) * (gallop ? .8 : .5) : 0;
    const lift = moving ? Math.max(0, Math.cos(phase * TAU + ph)) * (gallop ? 1 : .6) : 0;
    const a1 = sw + (front ? .1 : -.15), bend = (front ? -1 : 1) * (.35 + lift * .9);
    const knee = [top[0] + Math.sin(a1) * L.thigh, top[1] + Math.cos(a1) * L.thigh];
    const a2 = a1 + bend, foot = [knee[0] + Math.sin(a2) * L.shin, Math.min(0, knee[1] + Math.cos(a2) * L.shin)];
    line([top, knee, foot]);
  };
  // far legs first, paler
  X.strokeStyle = rgb(far); X.lineWidth = L.lw * .85;
  leg(sh, Math.PI, true); leg(hip, 0, false);
  // tail
  X.strokeStyle = rgb(ink);
  if (kind === 'wolf') { X.lineWidth = L.lw * 1.25; X.beginPath(); X.moveTo(hip[0], hip[1]); X.quadraticCurveTo(hip[0] - 6, hip[1] + 1, hip[0] - 9, hip[1] + (gallop ? -1 : 5)); X.stroke(); }
  else if (kind === 'deer') { X.lineWidth = L.lw * .8; line([hip, [hip[0] - 2.5, hip[1] - 2.5]]); }
  else if (kind === 'boar') { X.lineWidth = 1.2; X.beginPath(); X.moveTo(hip[0], hip[1]); X.quadraticCurveTo(hip[0] - 3, hip[1] - 3, hip[0] - 2.5, hip[1] + 1); X.stroke(); }
  else if (kind === 'fox') {   // a big brush of a tail, white at the tip
    X.lineWidth = L.lw * 2.2; X.beginPath(); X.moveTo(hip[0], hip[1]); X.quadraticCurveTo(hip[0] - 7, hip[1] - 1, hip[0] - 11, hip[1] + (gallop ? -3 : 2)); X.stroke();
    X.strokeStyle = '#f2ede2'; X.lineWidth = L.lw * 1.6; X.beginPath(); X.moveTo(hip[0] - 9.5, hip[1] + (gallop ? -2.4 : 1.6)); X.lineTo(hip[0] - 11.5, hip[1] + (gallop ? -3.2 : 2.2)); X.stroke();
    X.strokeStyle = rgb(ink);
  } else if (kind === 'goat') { X.lineWidth = L.lw * .9; line([hip, [hip[0] - 1.5, hip[1] - 3]]); }
  else if (kind === 'bear') { X.lineWidth = L.lw; line([hip, [hip[0] - 2, hip[1] + .5]]); }
  else { X.fillStyle = '#efe8dc'; X.beginPath(); X.arc(hip[0] - 1.2, hip[1] - .6, 1.4, 0, TAU); X.fill(); }
  // spine: one bold stroke, arched for rabbits, heavy for boars
  X.lineWidth = L.lw * (L.heavy || 1.5);
  X.beginPath(); X.moveTo(hip[0], hip[1]);
  X.quadraticCurveTo(0, (hip[1] + sh[1]) / 2 - (L.arch || 1), sh[0], sh[1]);
  X.stroke();
  if (kind === 'boar') {   // bristles along the back
    X.lineWidth = 1;
    for (let k = -3; k <= 3; k++) line([[k * 2, -H - 3.2], [k * 2 - .8, -H - 5.2]]);
  }
  // near legs, full ink
  X.lineWidth = L.lw;
  leg(sh, 0, true); leg(hip, Math.PI, false);
  // neck and head (down to the grass when grazing, thrust out when biting)
  const neckA = eating ? 1.15 : bite >= 0 ? .05 : L.neckA;
  const nk = [sh[0] + Math.cos(neckA) * L.neck, sh[1] + Math.sin(neckA) * L.neck];
  X.lineWidth = L.lw * 1.2;
  line([sh, nk]);
  X.fillStyle = rgb(ink);
  const ha = eating ? 1.3 : neckA * .4;   // which way the head points
  const ux = Math.cos(ha), uy = Math.sin(ha), px = -uy, py = ux;   // along the head, and across it
  const at = (f, sdw) => [nk[0] + ux * f + px * sdw, nk[1] + uy * f + py * sdw];
  if (kind === 'wolf') {
    const open = bite === 1 ? 1.8 : 0;
    fillPoly([at(-1.5, -2.2), at(2.5, -2.4), at(7.5, -.6), at(7.5, .2), at(2.5, 1.6 + open * .3), at(-1, 1.8)]);   // long skull and snout
    if (open) { X.lineWidth = 1.2; line([at(2.5, 1.6), at(6.5, 2.2 + open)]); }   // lower jaw, open
    fillPoly([at(-.8, -2), at(.4, -5.6), at(1.8, -2)]);   // pricked ear
  } else if (kind === 'deer') {
    fillPoly([at(-1, -1.6), at(1.5, -1.8), at(5.5, -.4), at(5.5, .5), at(1, 1.4), at(-1, 1.2)]);
    X.lineWidth = 1.4; line([at(.2, -1.5), at(-1.2, -4.2)]);   // ear
    if (antlers) {
      X.strokeStyle = '#8a6a44'; X.lineWidth = 1.3;
      line([at(.6, -1.6), at(-1, -8)]); line([at(-.4, -5), at(-3.6, -7.2)]); line([at(-.8, -7), at(1.6, -10)]);
      X.strokeStyle = rgb(ink);
    }
  } else if (kind === 'boar') {
    fillPoly([at(-2, -3), at(2.5, -2.6), at(6.5, -.8), at(6.5, 1.4), at(1, 2.6), at(-2, 2.2)]);   // heavy wedge head
    X.strokeStyle = '#efe6cf'; X.lineWidth = 1.2;
    X.beginPath(); const t0 = at(5.2, 1.4), t1 = at(6.4, 3), t2 = at(7.2, 1.2); X.moveTo(t0[0], t0[1]); X.quadraticCurveTo(t1[0], t1[1], t2[0], t2[1]); X.stroke();   // tusk
    X.strokeStyle = rgb(ink); X.lineWidth = 1.2; line([at(-.5, -2.8), at(-1.6, -4.6)]);
  } else if (kind === 'goat') {   // narrow face, swept-back horns, a beard
    fillPoly([at(-1, -1.6), at(1.5, -1.6), at(5, -.2), at(4.8, .9), at(1, 1.4), at(-1, 1.2)]);
    X.strokeStyle = '#6b5f50'; X.lineWidth = 1.5;
    X.beginPath(); const h0 = at(.4, -1.5), h1 = at(-3.5, -5), h2 = at(-5, -2.5); X.moveTo(h0[0], h0[1]); X.quadraticCurveTo(h1[0], h1[1], h2[0], h2[1]); X.stroke();
    X.strokeStyle = rgb(ink); X.lineWidth = 1.1; line([at(3.5, 1), at(3, 3.6)]);   // beard
    line([at(-.5, -.6), at(-2.8, .6)]);   // ear, out to the side
  } else if (kind === 'bear') {   // a broad heavy head, short muzzle, small ears
    fillPoly([at(-2.5, -3.2), at(2.5, -3.4), at(6.5, -1.4), at(7, .8), at(3, 2.8), at(-2.5, 2.6)]);
    fillPoly([at(-1.8, -3), at(-1, -5.4), at(.4, -3.2)]);
  } else if (kind === 'fox') {   // a sharp narrow snout, tall pointed ears, a white chin
    fillPoly([at(-1.2, -1.8), at(2, -1.9), at(6.5, -.3), at(6.3, .4), at(2, 1.3), at(-1, 1.4)]);
    fillPoly([at(-.6, -1.6), at(.2, -5.4), at(1.4, -1.7)]);
    X.fillStyle = '#f2ede2'; fillPoly([at(2.2, .6), at(5.8, .4), at(2.4, 1.3)]); X.fillStyle = rgb(ink);
  } else {   // rabbit: a small pointed head and two long ears laid back
    fillPoly([at(-1, -1.4), at(1.5, -1.4), at(3.2, 0), at(1.5, 1.3), at(-1, 1.2)]);
    X.lineWidth = 1.5; line([at(0, -1.2), at(-4.5, -6.5)]); line([at(.8, -1.2), at(-2.6, -7.2)]);
  }
  // an eye: a tiny gap of paper
  X.fillStyle = 'rgba(245,240,225,.95)';
  const eye = kind === 'rabbit' ? at(1, -.4) : at(2, -.8);
  X.beginPath(); X.arc(eye[0], eye[1], .55, 0, TAU); X.fill();
  if (tame) { X.strokeStyle = '#d9b26a'; X.lineWidth = 1.4; line([[sh[0] + 1, sh[1] - 2.2], [sh[0] + 2.2, sh[1] + 1.6]]); }   // a rope collar
}

// a dead animal on its side: legs stiff and sticking out, the ink fading, then a little heap of bones
export function drawCarcass(c) {
  const L = LOOK[c.k];
  if (!L) return;
  const rot = c.rot, face = Math.cos(c.h) >= 0 ? 1 : -1;
  shadow(c.x, c.z, L.spine * .6);
  const [bx, by] = proj(c.x, 0, c.z), D = G.DPR, k = D * G.cam.zoom;
  ctx.setTransform(k * face, 0, 0, k, D * bx, D * by);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (rot < 1.1) {
    const ink = mixc(mixc(L.ink, [110, 105, 85], smooth(.1, .9, rot)), [70, 62, 55], smooth(.6, 1.1, rot) * .6);
    ctx.globalAlpha = 1 - smooth(.8, 1.1, rot) * .6;
    ctx.strokeStyle = rgb(ink);
    const y = -L.lw * .8, hl = L.spine / 2;
    ctx.lineWidth = L.lw;
    for (const [fx, a] of [[hl, -.9], [hl - 2, -.6], [-hl, -1.2], [-hl + 2, -.8]]) {   // stiff legs
      ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx + Math.sin(a) * (L.thigh + L.shin) * .9 * -1, y - Math.cos(a) * (L.thigh + L.shin) * .9); ctx.stroke();
    }
    ctx.lineWidth = L.lw * (L.heavy || 1.5);
    ctx.beginPath(); ctx.moveTo(-hl, y); ctx.lineTo(hl, y); ctx.stroke();
    ctx.lineWidth = L.lw * 1.2;
    ctx.beginPath(); ctx.moveTo(hl, y); ctx.lineTo(hl + L.neck * .7, y + .5); ctx.stroke();
    ctx.fillStyle = rgb(ink);
    ctx.beginPath(); ctx.moveTo(hl + L.neck * .7, y - 1.5); ctx.lineTo(hl + L.neck * .7 + 6, y + .5); ctx.lineTo(hl + L.neck * .7, y + 2); ctx.closePath(); ctx.fill();
    if (c.meat < (L.spine > 12 ? 4 : 1) && rot < .6) {   // butchered: an open red wound
      ctx.strokeStyle = 'rgba(150,20,25,.9)'; ctx.lineWidth = L.lw * 1.8;
      ctx.beginPath(); ctx.moveTo(-hl * .5, y); ctx.lineTo(hl * .4, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (rot > .8) {   // ribs
    ctx.globalAlpha = smooth(.8, 1.2, rot) * (1 - smooth(2.4, 3, rot));
    ctx.strokeStyle = '#e6dfcc'; ctx.lineWidth = 1.1;
    const hl = L.spine / 2;
    ctx.beginPath(); ctx.moveTo(-hl, -2); ctx.lineTo(hl + 3, -2); ctx.stroke();
    for (let q = -3; q <= 3; q++) { ctx.beginPath(); ctx.moveTo(q * hl / 4, -2); ctx.quadraticCurveTo(q * hl / 4 + 2, -6, q * hl / 4 + 3, -1); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(hl + 4, -2.5, 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  screen();
}

// flies over anything rotting
export function drawFlies(x, z, rot, seed) {
  if (rot < .15 || rot > 1.5) return;
  const n = Math.round(3 + Math.min(1, rot) * 6), Z = G.cam.zoom, t = G.time;
  ctx.fillStyle = 'rgba(15,15,15,.75)';
  for (let k = 0; k < n; k++) {
    const a = t * (3 + h2(seed, k, 1) * 3) + k * 2.1, r = 6 + h2(seed, k, 2) * 8;
    const [sx, sy] = proj(x + Math.cos(a) * r, 8 + Math.sin(a * 1.7) * 4 + h2(seed, k, 3) * 6, z + Math.sin(a) * r * .6);
    ctx.beginPath(); ctx.arc(sx, sy, .9 * Z, 0, TAU); ctx.fill();
  }
}
