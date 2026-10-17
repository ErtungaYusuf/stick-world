// Billboard sprites: trees, rocks, bushes… plus everything people make: fires, huts, houses, totems, graves, crops.
// Nature sprites are rendered once per (kind, shape variant, season look) into a small bitmap and stamped from then on;
// swaying is a cheap skew of that stamp. Up close (or for grass bending around the player) they are drawn as vectors.
import { TAU, smooth, h2, mixc, rgb, hex } from '/shared/core.js';
import { G, ctx, proj, TILT, seasonTemp } from './state.js';
import { CH as CH_ } from '/shared/world.js';

export const C = {
  trunk: '#6b4d36', leafD: '#3f7a3e', leafM: '#529247', leafL: '#6dab55',
  pineD: '#2f5f3c', pineL: '#3f7a48', twig: '#7a5a3d', bush: '#4c8a43', bushL: '#62a352',
  berry: '#d8344a', rockD: '#8a8475', rockL: '#aaa392', reed: '#6c8f45', cat: '#7a5233',
  tall: '#b7b45c', tallD: '#9a9a48', mushCap: '#a8743f', redcap: '#d9453b', stem: '#efe6d2',
};
export const SHADOW = { tree: 20, pine: 18, twig: 12, bush: 11, boulder: 13, mush: 4, redcap: 4, herb: 4, tall: 8, reed: 0 };
const ORE = { copper: ['#b8713e', '#d99a63'], iron: ['#6e4a3c', '#9a6a55'], gold: ['#c9a227', '#f2d36b'], sulfur: ['#c8c13a', '#ece27a'], tin: ['#4a4a55', '#80808c'], saltpeter: ['#d9d5c8', '#f7f4ea'] };
const SHADOW_COL = 'rgba(25,45,25,.22)';

// draw in sprite space: origin at the object's foot, 1 unit = 1 world unit
function sprite(x, z) {
  const [bx, by] = proj(x, 0, z), Z = G.cam.zoom, D = G.DPR;
  ctx.setTransform(D * Z, 0, 0, D * Z, D * bx, D * by);
}
const screen = () => ctx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);

export function drawShadow(x, z, r) {
  const [sx, sy] = proj(x, 0, z), Z = G.cam.zoom;
  ctx.beginPath(); ctx.ellipse(sx, sy, r * Z, r * Z * TILT, 0, 0, TAU); ctx.fill();
}
// all the ground shadows of a frame in one path
export function drawShadows(list) {
  const Z = G.cam.zoom;
  ctx.fillStyle = SHADOW_COL;
  ctx.beginPath();
  for (const o of list) {
    const r0 = SHADOW[o.t];
    if (!r0 || o.felled) continue;
    if (Z < .7 && r0 < 9) continue;
    const [sx, sy] = proj(o.x, 0, o.z), r = r0 * o.s * Z;
    ctx.moveTo(sx + r, sy); ctx.ellipse(sx, sy, r, r * TILT, 0, 0, TAU);
  }
  ctx.fill();
}

// X is where nature sprites are drawn: the screen, or an offscreen bitmap while it is being cached
let X = ctx;
function branch(x, y, len, ang, depth, seed) {
  const x2 = x + Math.sin(ang) * len, y2 = y - Math.cos(ang) * len;
  X.moveTo(x, y); X.lineTo(x2, y2);
  if (depth > 0) {
    branch(x2, y2, len * .7, ang - .5 - h2(seed, depth, 1) * .3, depth - 1, seed + 1.3);
    branch(x2, y2, len * .65, ang + .45 + h2(seed, depth, 2) * .3, depth - 1, seed + 2.7);
  }
}
// is it snowing on this spot right now (winter in the cold), or always snowy (the far north)?
const snowyAt = o => o.snow || (G.season === 3 && G.world.temp(o.x, o.z) + seasonTemp() < G.world.SNOW + .06);
const inSeason = (o, seasons) => seasons.includes(G.season) && !G.picked.has(o.id);

// leaf colours through the year: fresh green, deep green, gold and red, then bare (sf: how far into the season)
function leafColors(sf) {
  if (G.season === 2) {
    const k = smooth(0, .7, sf);
    return [rgb(mixc(hex(C.leafD), [168, 84, 32], k)), rgb(mixc(hex(C.leafM), [214, 128, 40], k)), rgb(mixc(hex(C.leafL), [236, 186, 70], k)), 1 - smooth(.75, 1, sf) * .6];
  }
  if (G.season === 3) return [C.leafD, C.leafM, C.leafL, 0];
  if (G.season === 0) return [C.leafD, rgb(mixc(hex(C.leafM), [140, 200, 110], .3)), rgb(mixc(hex(C.leafL), [170, 220, 130], .4)), smooth(0, .4, sf)];
  return [C.leafD, C.leafM, C.leafL, 1];
}
// how far into the season, in four steps (only spring and autumn change the look as they go on)
const sfStep = () => (G.season === 0 || G.season === 2) ? Math.min(3, Math.floor(G.sf * 4)) / 4 + .125 : .5;

// the stump of a felled tree (charred if it burned), which years later sprouts a sapling
function stumpShape(o, stage, sway) {
  const s = o.s;
  if (stage === 'sapling') {
    X.strokeStyle = C.trunk; X.lineWidth = 1.8 * s; X.lineCap = 'round';
    X.beginPath(); X.moveTo(0, 0); X.lineTo(sway * .5, -16 * s); X.stroke();
    X.fillStyle = o.t === 'pine' ? C.pineL : C.leafM;
    X.beginPath(); X.arc(sway * .5, -18 * s, 6 * s, 0, TAU); X.arc(sway * .5 - 4 * s, -14 * s, 4 * s, 0, TAU); X.fill();
  } else {
    const burnt = stage === 'burnt';
    X.fillStyle = burnt ? '#2e2620' : C.trunk; X.fillRect(-4.5 * s, -5 * s, 9 * s, 5 * s);
    X.fillStyle = burnt ? '#1c1714' : '#c9a477'; X.beginPath(); X.ellipse(0, -5 * s, 4.5 * s, 1.8 * s, 0, 0, TAU); X.fill();
    if (!burnt) { X.strokeStyle = '#a07e57'; X.lineWidth = .6; X.beginPath(); X.ellipse(0, -5 * s, 2.2 * s, .9 * s, 0, 0, TAU); X.stroke(); }
    else { X.fillStyle = 'rgba(40,36,34,.35)'; X.beginPath(); X.ellipse(0, 0, 16 * s, 6 * s, 0, 0, TAU); X.fill(); }
  }
}

// one nature sprite in sprite space (origin at the foot)
function shape(o, sway, snowy, player, sf) {
  const s = o.s, t = G.time;
  X.lineCap = 'round'; X.lineJoin = 'round';
  switch (o.t) {
    case 'tree': {
      X.strokeStyle = C.trunk; X.lineWidth = 5.5 * s;
      X.beginPath(); X.moveTo(0, 0); X.quadraticCurveTo(0, -24 * s, sway * .5, -44 * s); X.stroke();
      const cx = sway, cy = -62 * s, [d, m, l, full] = leafColors(sf);
      if (full < .99) {   // bare branches show through as the leaves fall
        X.strokeStyle = C.trunk; X.lineWidth = 2 * s;
        X.beginPath(); branch(sway * .5, -44 * s, 14 * s, -.4, 2, o.seed * 7); branch(sway * .5, -44 * s, 14 * s, .5, 2, o.seed * 9); X.stroke();
      }
      if (full > .01) {
        const a0 = X.globalAlpha;
        X.globalAlpha = a0 * full;
        X.fillStyle = d;
        X.beginPath(); X.arc(cx - 15 * s, cy + 8 * s, 17 * s, 0, TAU); X.arc(cx + 15 * s, cy + 7 * s, 16 * s, 0, TAU); X.arc(cx, cy - 6 * s, 20 * s, 0, TAU); X.fill();
        X.fillStyle = m;
        X.beginPath(); X.arc(cx - 6 * s, cy - 6 * s, 16 * s, 0, TAU); X.arc(cx - 15 * s, cy + 4 * s, 11 * s, 0, TAU); X.fill();
        X.fillStyle = l;
        X.beginPath(); X.arc(cx - 9 * s, cy - 12 * s, 8 * s, 0, TAU); X.fill();
        if (G.season === 0 && sf < .5) {   // blossom
          X.fillStyle = '#f7d4e2';
          for (let k = 0; k < 9; k++) { X.beginPath(); X.arc(cx + (h2(o.seed, k, 1) - .5) * 40 * s, cy + (h2(o.seed, k, 2) - .5) * 30 * s, 1.8 * s, 0, TAU); X.fill(); }
        }
        if (inSeason(o, [1, 2])) {   // fruit
          X.fillStyle = G.season === 1 ? '#e8b53a' : '#d8462e';
          for (let k = 0; k < 6; k++) { X.beginPath(); X.arc(cx + (h2(o.seed, k, 3) - .5) * 34 * s, cy + (h2(o.seed, k, 4) - .2) * 22 * s, 2.3 * s, 0, TAU); X.fill(); }
        }
        X.globalAlpha = a0;
      }
      if (snowy && full < .5) { X.fillStyle = '#f2f6fa'; X.beginPath(); X.ellipse(sway * .5, -45 * s, 6 * s, 2 * s, 0, 0, TAU); X.fill(); }
      break;
    }
    case 'pine': {
      X.strokeStyle = C.trunk; X.lineWidth = 4.5 * s;
      X.beginPath(); X.moveTo(0, 0); X.lineTo(0, -16 * s); X.stroke();
      for (let k = 0; k < 4; k++) {
        const base = -12 * s - k * 19 * s, w = (25 - k * 5) * s, top = base - 30 * s, sw = sway * (k + 1) * .35;
        X.fillStyle = C.pineD;
        X.beginPath(); X.moveTo(-w + sw * .3, base); X.lineTo(sw, top); X.lineTo(w + sw * .3, base); X.closePath(); X.fill();
        X.fillStyle = C.pineL;
        X.beginPath(); X.moveTo(-w + sw * .3, base); X.lineTo(sw, top); X.lineTo(sw * .6 - w * .15, base); X.closePath(); X.fill();
        if (snowy) {   // snow resting on each tier
          X.fillStyle = '#f2f6fa';
          X.beginPath(); X.moveTo(sw, top); X.lineTo(sw - w * .45, top + 14 * s); X.lineTo(sw - w * .1, top + 11 * s); X.lineTo(sw + w * .15, top + 15 * s); X.lineTo(sw + w * .45, top + 13 * s); X.closePath(); X.fill();
        }
      }
      break;
    }
    case 'twig':
      X.strokeStyle = C.twig; X.lineWidth = 3 * s;
      X.beginPath(); branch(0, 0, 24 * s, sway * .02, 3, o.seed * 10); X.stroke();
      break;
    case 'bush': {
      const bare = G.season === 3;
      X.fillStyle = bare ? '#5f6f48' : C.bush;
      X.beginPath(); X.arc(-7 * s, -7 * s, 9 * s, 0, TAU); X.arc(6 * s, -8 * s, 10 * s, 0, TAU); X.arc(0, -15 * s, 9 * s, 0, TAU); X.fill();
      X.fillStyle = bare ? '#73825a' : G.season === 2 ? '#8a9a45' : C.bushL;
      X.beginPath(); X.arc(-3 * s, -16 * s, 6 * s, 0, TAU); X.fill();
      if (o.berry && inSeason(o, [0, 1, 2])) {   // berries vanish while a picked bush regrows (server state)
        X.fillStyle = C.berry;
        for (const [x, y] of [[-8, -9], [5, -13], [8, -5], [-2, -6], [1, -18]]) { X.beginPath(); X.arc(x * s, y * s, 2 * s, 0, TAU); X.fill(); }
      }
      if (snowy) { X.fillStyle = '#f2f6fa'; X.beginPath(); X.ellipse(0, -21 * s, 9 * s, 3 * s, 0, 0, TAU); X.fill(); }
      break;
    }
    case 'boulder': {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI + k / 8 * Math.PI, r = (13 + h2(o.seed * 99, k, 3) * 5) * s;
        pts.push([Math.cos(a) * r, Math.sin(a) * r * .95 + 2 * s]);
      }
      X.fillStyle = C.rockD;
      X.beginPath(); pts.forEach((p, i) => X[i ? 'lineTo' : 'moveTo'](p[0], p[1])); X.closePath(); X.fill();
      X.fillStyle = snowy ? '#eef3f7' : C.rockL;
      X.beginPath(); pts.forEach((p, i) => X[i ? 'lineTo' : 'moveTo'](p[0] * .72 - 2 * s, p[1] * .72 - 3 * s)); X.closePath(); X.fill();
      if (o.ore && ORE[o.ore]) {   // a vein of colour in the rock
        const [od, ol] = ORE[o.ore];
        for (let k = 0; k < 5; k++) {
          X.fillStyle = k % 2 ? ol : od;
          X.beginPath(); X.ellipse((h2(o.seed, k, 5) - .5) * 16 * s, -4 * s - h2(o.seed, k, 6) * 9 * s, 2.6 * s, 1.6 * s, h2(o.seed, k, 7) * 3, 0, TAU); X.fill();
        }
        if (o.ore === 'gold') { X.fillStyle = 'rgba(255,250,200,.8)'; X.beginPath(); X.arc(-3 * s, -9 * s, 1 * s, 0, TAU); X.fill(); }
      }
      break;
    }
    case 'reed': {
      X.strokeStyle = G.season === 3 ? '#9a9060' : C.reed; X.lineWidth = 1.8 * s;
      X.beginPath();
      for (const [ox, h] of [[-4, 20], [0, 26], [4, 22], [7, 16]]) { X.moveTo(ox * s, 0); X.quadraticCurveTo(ox * s, -h * .5 * s, ox * s + sway * .6, -h * s); }
      X.stroke();
      X.fillStyle = C.cat;
      for (const [ox, h] of [[0, 26], [4, 22]]) { X.beginPath(); X.ellipse(ox * s + sway * .6, -h * s + 2 * s, 1.8 * s, 4 * s, 0, 0, TAU); X.fill(); }
      break;
    }
    case 'tall': {
      const dx = o.x - player.x, dz = o.z - player.z, near = player.x == null ? 0 : Math.exp(-(dx * dx + dz * dz) / 300) * (player.y < 10 ? 1 : .2);
      const bend = sway + near * Math.sign(dx || 1) * 9;
      X.lineWidth = 2 * s;
      for (let pass = 0; pass < 2; pass++) {
        X.strokeStyle = G.season === 3 ? (pass ? '#c2b48a' : '#a89a72') : pass ? C.tall : C.tallD;
        X.beginPath();
        for (let k = pass; k < 7; k += 2) {
          const ox = (k - 3) * 2.4 * s, h = (14 + h2((o.seed ?? h2(o.x, o.z, 9)) * 50, k, 4) * 10) * s;
          X.moveTo(ox, 0); X.quadraticCurveTo(ox, -h * .55, ox + bend * (.6 + k * .06) + (k - 3) * 1.5, -h);
        }
        X.stroke();
      }
      break;
    }
    case 'mush': case 'redcap': {
      if (!inSeason(o, [0, 1, 2])) break;
      X.fillStyle = C.stem; X.fillRect(-1.6 * s, -6 * s, 3.2 * s, 6 * s);
      X.fillStyle = o.t === 'redcap' ? C.redcap : C.mushCap; X.beginPath(); X.ellipse(0, -6 * s, 5.5 * s, 4.5 * s, 0, Math.PI, 0); X.fill();
      if (o.t === 'redcap') { X.fillStyle = '#fff'; X.beginPath(); X.arc(-2 * s, -8 * s, .9 * s, 0, TAU); X.arc(2 * s, -7.5 * s, .7 * s, 0, TAU); X.arc(0, -9.5 * s, .6 * s, 0, TAU); X.fill(); }
      break;
    }
    case 'herb': {
      X.strokeStyle = '#4f8a46'; X.lineWidth = 1.2 * s;
      X.beginPath();
      for (let k = -2; k <= 2; k++) { X.moveTo(k * 1.5 * s, 0); X.quadraticCurveTo(k * 2 * s, -5 * s, k * 3 * s + sway * .3, -9 * s); }
      X.stroke();
      if (inSeason(o, [0, 1, 2])) { X.fillStyle = '#9b6fd6'; for (let k = -2; k <= 2; k += 2) { X.beginPath(); X.arc(k * 3 * s + sway * .3, -9.5 * s, 1.6 * s, 0, TAU); X.fill(); } }
      break;
    }
  }
  void t;
}

// ───────── the sprite cache ─────────
// bounds of each kind in sprite space at scale 1 (x0, y0, x1, y1), how tall it is (for the sway skew), and shape variants
const BOX = {
  tree: [-40, -94, 40, 6, 80], pine: [-31, -106, 31, 6, 90], twig: [-42, -62, 42, 4, 50], bush: [-20, -28, 20, 6, 22],
  boulder: [-21, -21, 21, 6, 0], reed: [-9, -31, 15, 4, 26], tall: [-16, -27, 18, 3, 24], mush: [-7, -12, 7, 2, 0], redcap: [-7, -12, 7, 2, 0],
  herb: [-10, -13, 10, 2, 10], stump: [-10, -27, 10, 3, 18], struct: [-34, -62, 34, 12, 0],
};
const VARIANTS = 6, LEVELS = [.75, 1.5, 3];   // shape variants per kind · bitmap resolutions (pixels per world unit), like mipmaps
const sprites = new Map();
function cached(key, kind, draw, RES) {
  key += "@" + RES;
  let c = sprites.get(key);
  if (c) return c;
  const b = BOX[kind], cvs = document.createElement('canvas');
  cvs.width = Math.ceil((b[2] - b[0]) * RES); cvs.height = Math.ceil((b[3] - b[1]) * RES);
  const g = cvs.getContext('2d');
  g.setTransform(RES, 0, 0, RES, -b[0] * RES, -b[1] * RES);
  const prev = X;
  X = g; draw(); X = prev;
  c = { cvs, b, res: RES };
  sprites.set(key, c);
  if (sprites.size > 1500) sprites.delete(sprites.keys().next().value);   // forget the oldest looks (e.g. last season's)
  return c;
}
// the smallest cached resolution that is still at least as sharp as the screen
const levelFor = px => LEVELS.find(l => l >= px * .9) || LEVELS[LEVELS.length - 1];
function stamp(c, x, z, s, sway, height, shake = 0) {
  const RES = c.res, [bx, by] = proj(x, 0, z), D = G.DPR, k = D * G.cam.zoom * s / RES;
  const skew = height ? -sway / height : 0;
  ctx.setTransform(k, 0, skew * k, k, D * bx + shake * D * G.cam.zoom, D * by);
  ctx.drawImage(c.cvs, c.b[0] * RES, c.b[1] * RES);
}

// the cached look of a nature object at a given sharpness (null when there is nothing to see, e.g. mushrooms in winter)
function witheredShape(t) {
  X.strokeStyle = '#7b6448'; X.lineCap = 'round';
  const n = t === 'bush' ? 7 : 4, h = t === 'bush' ? 16 : 9;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k - (n - 1) / 2) * .32, l = h * (.6 + ((k * 37) % 10) / 25);
    X.lineWidth = k % 2 ? 1.1 : 1.5;
    X.beginPath(); X.moveTo(0, 0); X.lineTo(Math.cos(a) * l * .7, Math.sin(a) * l); X.stroke();
  }
}
function spriteOf(o, pxPerUnit, snowy, sf) {
  if (o.dead) return cached(`withered|${o.t}`, o.t === 'bush' ? 'bush' : 'herb', () => witheredShape(o.t), levelFor(pxPerUnit));
  if ((o.t === 'tree' || o.t === 'pine' || o.t === 'twig') && o.felled) {
    const stage = G.felled.get(o.id) || 'stump';
    return cached(`stump|${o.t === 'pine' ? 'p' : 't'}|${stage}`, 'stump', () => stumpShape({ t: o.t, s: 1 }, stage, 0), levelFor(pxPerUnit));
  }
  const v = Math.floor(((o.seed ?? h2(o.x, o.z, 9)) % 1) * VARIANTS);
  const look = o.t === 'tree' ? `${G.season}${sf.toFixed(2)}${inSeason(o, [1, 2]) ? 'f' : ''}`
    : o.t === 'bush' ? `${G.season}${o.berry && inSeason(o, [0, 1, 2]) ? 'b' : ''}`
    : o.t === 'mush' || o.t === 'redcap' || o.t === 'herb' ? (inSeason(o, [0, 1, 2]) ? 'y' : 'n')
    : o.t === 'boulder' ? o.ore || '' : o.t === 'reed' || o.t === 'tall' ? (G.season === 3 ? 'w' : '') : '';
  if ((o.t === 'mush' || o.t === 'redcap') && look === 'n') return null;
  return cached(`${o.t}|${v}|${look}|${snowy ? 's' : ''}`, o.t, () =>
    shape({ t: o.t, s: 1, seed: (v + .5) / VARIANTS, x: o.x, z: o.z, id: o.id, berry: o.berry, ore: o.ore }, 0, snowy, { x: null }, sf), levelFor(pxPerUnit));
}

// ───────── far away: a whole chunk of nature (and its shadows) as one image ─────────
// Rebuilt only when the season's look changes or trees in it are felled; a few per frame, so zooming out never stalls.
const PAD = [46, 150, 46, 12];   // room around the chunk for tree crowns poking up and out (screen units at zoom 1)
const layers = new Map();
const SMALL = new Set(['mush', 'redcap', 'herb', 'reed', 'tall']);
export function drawNatureLayers(vis) {
  const Z = G.cam.zoom, px = Z * G.DPR, res = px < .45 ? .5 : px < .7 ? .75 : 1, sf = sfStep();
  let budget = 10;
  const rows = vis.filter(v => v.data).sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  for (const { cx, cz, data } of rows) {
    const [sx, sy] = proj(cx * CH_, 0, cz * CH_);
    const w = CH_ + PAD[0] + PAD[2], h = CH_ * TILT + PAD[1] + PAD[3];
    if (sx - PAD[0] * Z > G.W || sy - PAD[1] * Z > G.H || sx + (w - PAD[0]) * Z < 0 || sy + (h - PAD[1]) * Z < 0) continue;
    let felled = 0;
    for (const o of data.objs) if (o.felled || o.dead) felled++;
    const sig = `${G.season}|${sf}|${felled}|${res}`, k = cx + ',' + cz;
    let L = layers.get(k);
    if ((!L || L.sig !== sig) && budget-- > 0) {
      L = { sig, cvs: L && L.cvs.width === Math.ceil(w * res) ? L.cvs : document.createElement('canvas') };
      L.cvs.width = Math.ceil(w * res); L.cvs.height = Math.ceil(h * res);
      const g = L.cvs.getContext('2d'), ox = cx * CH_, oz = cz * CH_;
      const objs = data.objs.filter(o => !SMALL.has(o.t)).sort((a, b) => a.z - b.z);
      g.setTransform(res, 0, 0, res, PAD[0] * res, PAD[1] * res);
      g.fillStyle = SHADOW_COL;
      g.beginPath();
      for (const o of objs) {
        if (!SHADOW[o.t] || o.felled) continue;
        const r = SHADOW[o.t] * o.s, x = o.x - ox, y = (o.z - oz) * TILT;
        g.moveTo(x + r, y); g.ellipse(x, y, r, r * TILT, 0, 0, TAU);
      }
      g.fill();
      for (const o of objs) {
        const c = spriteOf(o, res * o.s, snowyAt(o), sf);
        if (!c) continue;
        const k2 = res * o.s / c.res;
        g.setTransform(k2, 0, 0, k2, (PAD[0] + o.x - ox) * res, (PAD[1] + (o.z - oz) * TILT) * res);
        g.drawImage(c.cvs, c.b[0] * c.res, c.b[1] * c.res);
      }
      layers.set(k, L);
      if (layers.size > 320) layers.delete(layers.keys().next().value);
    }
    if (L) ctx.drawImage(L.cvs, sx - PAD[0] * Z, sy - PAD[1] * Z, w * Z, h * Z);
  }
}
export const FAR_ZOOM = .72;   // below this the world's plants and rocks are drawn chunk by chunk

// a freshly cut tree: tips over slowly, then faster, slams down with a bounce and a cloud of dust,
// lies there a while (it's being cut up into sticks) and fades
function drawFalling(o, f, pxPerUnit) {
  const age = G.time - f.t0, FALL = 1.7, GONE = 22;
  if (age > GONE) { G.falling.delete(o.id); return; }
  const u = Math.min(1, age / FALL);
  let a = (Math.PI / 2 - .12) * u * u * u;   // starts creaking, ends crashing
  if (u >= 1) {
    const b = age - FALL;
    a -= Math.abs(Math.sin(b * 9)) * .16 * Math.exp(-b * 4);   // bounces off the ground
    if (!f.dust) {
      f.dust = true;
      const h = (o.t === 'pine' ? 90 : o.t === 'twig' ? 50 : 75) * o.s;
      for (let k = 0; k < 6; k++) puffAt(o.x + f.dir * h * (k + 1) / 7, o.z, 5, 70, 18, 3);
      G.shake.set(o.id, G.time);
    }
  }
  const c = spriteOf({ ...o, felled: false }, pxPerUnit, snowyAt(o), sfStep());
  if (!c) return;
  const [bx, by] = proj(o.x, 0, o.z), D = G.DPR, k = D * G.cam.zoom * o.s / c.res;
  const ang = f.dir * a, cos = Math.cos(ang), sin = Math.sin(ang);
  const lift = 6 * G.cam.zoom * o.s * D;   // pivots at the cut, a little above the ground
  ctx.globalAlpha = 1 - smooth(GONE - 6, GONE, age);
  ctx.setTransform(k * cos, k * sin, -k * sin, k * cos, D * bx, D * by - lift * (1 - u * .8));
  ctx.drawImage(c.cvs, c.b[0] * c.res, c.b[1] * c.res);
  ctx.globalAlpha = 1;
  screen();
}
function puffAt(x, z, n, spread, up, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = Math.random() * spread;
    G.particles.push({ x: x + (Math.random() - .5) * 8, y: 2, z: z + (Math.random() - .5) * 8, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp * .5, vy: Math.random() * up + 6,
      life: 0, max: .7 + Math.random() * .7, r: size * (.6 + Math.random() * .7), col: '170,150,115' });
  }
}

export function drawObject(o, player) {
  const s = o.s, t = G.time;
  const isTree = o.t === 'tree' || o.t === 'pine' || o.t === 'twig';
  const pxPerUnit = G.cam.zoom * G.DPR * s;
  let sway = Math.sin(t * 1.1 + o.x * .02 + o.z * .013) * 1.8 * (G.rain > .5 ? 1.8 : 1);
  const hit = G.shake.get(o.id);   // trees and rocks shudder right after each axe / pickaxe strike
  let shake = 0;
  if (hit !== undefined && t - hit < .22) {
    const j = Math.sin(t * 60) * 2.5 * (1 - (t - hit) / .22);
    if (isTree) sway += j; else shake = j * .4;
  }
  if (isTree && o.felled) {
    const stage = G.felled.get(o.id) || 'stump', v = Math.floor((o.seed || 0) * VARIANTS);
    const c = cached(`stump|${o.t === 'pine' ? 'p' : 't'}|${stage}`, 'stump', () => stumpShape({ t: o.t, s: 1 }, stage, 0), levelFor(pxPerUnit));
    stamp(c, o.x, o.z, s, stage === 'sapling' ? Math.sin(t * 1.6 + o.x) * 1.2 : 0, 18);
    screen();
    void v;
    const fall = G.falling.get(o.id);
    if (fall) drawFalling(o, fall, pxPerUnit);
    return;
  }
  const fade = isTree && o.z > player.z && (o.z - player.z) * TILT < 95 * s && Math.abs(o.x - player.x) < 30 * s + 8 ? .38 : 1;
  const snowy = snowyAt(o);
  const sf = sfStep();
  // grass bends around the player up close, and very close-up views are drawn as crisp vectors
  const nearPlayer = o.t === 'tall' && Math.abs(o.x - player.x) < 40 && Math.abs(o.z - player.z) < 40;
  if (pxPerUnit > LEVELS[LEVELS.length - 1] * 1.1 || nearPlayer) {
    ctx.globalAlpha = fade;
    sprite(o.x, o.z);
    X = ctx;
    shape(o, sway, snowy, player, sf);
    ctx.globalAlpha = 1;
    screen();
    return;
  }
  const c = spriteOf(o, pxPerUnit, snowy, sf);
  if (!c) return;
  ctx.globalAlpha = fade;
  stamp(c, o.x, o.z, s, sway, BOX[o.t][4], shake);
  ctx.globalAlpha = 1;
  screen();
}

// ───────── fire ─────────
function flame(w, h, col, ph, f) {
  const t = G.time, k = (1 + Math.sin(t * 11 + ph) * .12 + Math.sin(t * 17 + ph * 2) * .08) * f, tip = Math.sin(t * 7 + ph) * 2;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(-w, -1);
  ctx.quadraticCurveTo(-w * .8, -h * .6 * k, tip, -h * k);
  ctx.quadraticCurveTo(w * .8, -h * .6 * k, w, -1); ctx.closePath(); ctx.fill();
}
export const fireStrength = f => f.wild ? 1.6 : .45 + .55 * f.f;
export function drawCampfire(o) {
  const t = G.time, f = Math.min(1, o.f * 2.5);
  sprite(o.x, o.z);
  ctx.fillStyle = '#8a8475';
  for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; ctx.beginPath(); ctx.ellipse(Math.cos(a) * 12, Math.sin(a) * 12 * TILT, 3.4, 2.5, 0, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = '#6b4d36'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, 1); ctx.lineTo(8, -3); ctx.moveTo(-7, -3); ctx.lineTo(8, 2); ctx.stroke();
  if (f < .08) {   // embers dying out: ash and a wisp of smoke
    ctx.fillStyle = '#5a5550'; ctx.beginPath(); ctx.ellipse(0, -1, 7, 2.5, 0, 0, TAU); ctx.fill();
    for (let k = 0; k < 3; k++) {
      const u = (t * .25 + k / 3) % 1;
      ctx.fillStyle = `rgba(200,200,205,${(1 - u) * .35})`;
      ctx.beginPath(); ctx.arc(Math.sin(t + k * 2) * 3 + u * 6, -6 - u * 34, 2.5 + u * 5, 0, TAU); ctx.fill();
    }
  } else { flame(7, 21, '#f2762e', 0, .5 + f * .6); flame(5, 15, '#ffb340', 1.7, .5 + f * .6); flame(2.8, 9, '#fff0a0', 3.1, .5 + f * .6); }
  screen();
}
// a tree or a building on fire
export function drawWildfire(o) {
  const t = G.time;
  sprite(o.x, o.z);
  for (let k = 0; k < 3; k++) {
    ctx.save(); ctx.translate((k - 1) * 9, -18 - k % 2 * 8);
    flame(9, 38, '#e8541e', k * 2.1, 1); flame(6, 28, '#ff9a2e', k * 2.1 + 1, 1); flame(3, 16, '#ffe48a', k * 2.1 + 2, 1);
    ctx.restore();
  }
  for (let k = 0; k < 5; k++) {
    const u = (t * .35 + k / 5) % 1;
    ctx.fillStyle = `rgba(60,55,52,${(1 - u) * .45})`;
    ctx.beginPath(); ctx.arc(Math.sin(t * .7 + k * 2) * 8 + u * 14, -50 - u * 70, 5 + u * 12, 0, TAU); ctx.fill();
  }
  screen();
}

// ───────── things people build ─────────
const STRUCT_H = { well: 16, hall: 40, granary: 30, stele: 26, snare: 5, furnace: 30, hut: 31, house: 33, store: 20, wall: 13, totem: 50, pen: 10, dam: 10, grave: 14 };
const STRUCT_W = { well: 11, hall: 30, granary: 15, stele: 6, snare: 6, furnace: 12, hut: 16, house: 23, store: 11, wall: 15, totem: 8, pen: 26, dam: 23, grave: 11 };
// under construction: the finished shape shows faintly as the plan, the built part rises from the ground up,
// with scaffold poles, a lashed crossbar at the working height and a heap of material at the foot
// finished buildings that don't move are drawn once per look and zoom level, then stamped like trees
const STILL = new Set(['hut', 'house', 'store', 'wall', 'pen', 'dam', 'grave', 'well', 'granary', 'stele', 'snare', 'totem']);
function stampStruct(o) {
  ctx.fillStyle = SHADOW_COL; drawShadow(o.x, o.z, o.k === 'house' ? 22 : o.k === 'pen' ? 26 : o.k === 'grave' ? 9 : o.k === 'snare' ? 5 : 15);
  const res = levelFor(G.cam.zoom * G.DPR), words = G.cam.zoom > 1.4 && o.c ? o.c : '';
  const n = o.k === 'store' || o.k === 'granary' ? Math.min(10, o.n || 0) : 0;
  const c = cached(`S|${o.k}|${n}|${o.lore || 0}|${o.sym || ''}|${words}`, 'struct', () => drawStructBody({ ...o, n, c: words || null }, false, X), res);
  stamp(c, o.x, o.z, 1, 0, 0);
  screen();
}
export function drawStruct(o) {
  const p = o.p ?? 1;
  if (p >= 1 && STILL.has(o.k) && !o.burn && G.cam.zoom * G.DPR < 3.3) return stampStruct(o);
  if (p >= 1) return drawStructBody(o);
  const h = STRUCT_H[o.k] || 20, w = STRUCT_W[o.k] || 15, Z = G.cam.zoom;
  ctx.globalAlpha = .16; drawStructBody(o, true); ctx.globalAlpha = 1;
  const [bx, by] = proj(o.x, 0, o.z), y = h * Math.max(.06, p);
  ctx.save(); screen();
  ctx.beginPath(); ctx.rect(bx - (w + 12) * Z, by - y * Z, (w + 12) * 2 * Z, (y + 10) * Z); ctx.clip();
  drawStructBody(o, true);
  ctx.restore();
  sprite(o.x, o.z);
  ctx.lineCap = 'round'; ctx.strokeStyle = '#5e4630'; ctx.lineWidth = 1.4;
  const top = -(y + 6);
  ctx.beginPath();
  for (const sx of [-w - 3, w + 3]) { ctx.moveTo(sx, 1); ctx.lineTo(sx + (sx < 0 ? 1.5 : -1.5), top); }
  ctx.moveTo(-w - 4, -y); ctx.lineTo(w + 4, -y);
  ctx.moveTo(-w - 3, -y * .45); ctx.lineTo(-w + 6, -y * .05 - 1);
  ctx.stroke();
  ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = .8;   // rope lashings
  for (const sx of [-w - 2.5, w + 2.5]) { ctx.beginPath(); ctx.arc(sx, -y, 1.4, 0, TAU); ctx.stroke(); }
  const left = 1 - p;   // what's still to be used lies in a heap
  for (let k = 0; k < Math.ceil(left * 5); k++) {
    ctx.strokeStyle = '#7a5838'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(w + 6, 2 - k * 1.6); ctx.lineTo(w + 15, 1 - k * 1.6 - (k % 2)); ctx.stroke();
  }
  if (Z > 1.2) {
    ctx.font = '600 6px "Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(Math.round(p * 100) + '%', 0, 7);
  }
  screen();
}
function drawStructBody(o, building = false, g = ctx) {
  const t = G.time, burnt = o.burn;
  if (!building && g === ctx) { ctx.fillStyle = SHADOW_COL; drawShadow(o.x, o.z, o.k === 'house' ? 22 : o.k === 'pen' ? 26 : o.k === 'grave' ? 9 : 15); }
  if (g === ctx) sprite(o.x, o.z);
  const wood = burnt ? '#3b2e26' : '#7a5838', woodL = burnt ? '#4a3a30' : '#9a7650';
  g.lineCap = 'round'; g.lineJoin = 'round';
  switch (o.k) {
    case 'hut': {   // a cone of leaning poles with a dark doorway
      g.fillStyle = wood;
      g.beginPath(); g.moveTo(-15, 0); g.lineTo(0, -28); g.lineTo(15, 0); g.closePath(); g.fill();
      g.strokeStyle = woodL; g.lineWidth = 1.3;
      for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(k * 4.5, 0); g.lineTo(k * .6, -30); g.stroke(); }
      g.fillStyle = '#1e1a16'; g.beginPath(); g.moveTo(-4, 0); g.quadraticCurveTo(0, -14, 4, 0); g.closePath(); g.fill();
      break;
    }
    case 'house': {
      g.fillStyle = '#8f8a80'; g.fillRect(-18, -16, 36, 16);
      g.fillStyle = '#a8a397';
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) g.fillRect(-18 + c * 6 + (r % 2) * 3, -16 + r * 5.3, 5, 4.4);
      g.fillStyle = burnt ? '#2e2620' : '#6b4d36';
      g.beginPath(); g.moveTo(-22, -15); g.lineTo(0, -32); g.lineTo(22, -15); g.closePath(); g.fill();
      g.fillStyle = '#1e1a16'; g.fillRect(-3.5, -10, 7, 10);
      g.fillStyle = 'rgba(255,200,120,.65)'; g.fillRect(9, -12, 4, 4);
      break;
    }
    case 'store': {
      g.fillStyle = wood; g.fillRect(-10, -12, 20, 12);
      g.strokeStyle = woodL; g.lineWidth = 1;
      for (const y of [-8, -4]) { g.beginPath(); g.moveTo(-10, y); g.lineTo(10, y); g.stroke(); }
      const n = Math.min(10, o.n || 0);
      for (let k = 0; k < n; k++) { g.fillStyle = k % 3 ? '#b38a52' : '#d8344a'; g.beginPath(); g.arc(-7 + (k % 5) * 3.5, -13 - Math.floor(k / 5) * 2.6, 1.8, 0, TAU); g.fill(); }
      break;
    }
    case 'wall': {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
        g.fillStyle = (r + c) % 2 ? '#8f8a80' : '#a39d92';
        g.fillRect(-14 + c * 5.6 + (r % 2) * 2.8 - 1.4, -12 + r * 4, 5.2, 3.6);
      }
      break;
    }
    case 'totem': {
      g.strokeStyle = wood; g.lineWidth = 4.5;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -36); g.stroke();
      g.fillStyle = woodL;
      for (const y of [-12, -22]) { g.beginPath(); g.ellipse(0, y, 4.6, 2.6, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#e8c35a'; g.beginPath(); g.moveTo(-7, -34); g.lineTo(0, -40 + Math.sin(t * 2) * .5); g.lineTo(7, -34); g.closePath(); g.fill();
      g.font = '700 10px "Segoe UI Symbol","Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.fillText(o.sym || '✦', 0, -47);
      if (o.c && G.cam.zoom > 1.4) { g.font = '600 6px "Segoe UI",sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(o.c, 0, 6); }
      break;
    }
    case 'pen': {
      g.strokeStyle = wood; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(0, -6, 24, 24 * TILT, 0, 0, TAU); g.stroke();
      g.beginPath(); g.ellipse(0, -2, 24, 24 * TILT, 0, 0, TAU); g.stroke();
      g.lineWidth = 2.2;
      for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; const x = Math.cos(a) * 24, y = Math.sin(a) * 24 * TILT; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 9); g.stroke(); }
      break;
    }
    case 'dam': {
      for (let k = 0; k < 9; k++) { g.fillStyle = k % 2 ? '#8f8a80' : '#a39d92'; g.beginPath(); g.ellipse(-20 + k * 5, -2 - (k % 2) * 2, 3.6, 2.8, 0, 0, TAU); g.fill(); }
      g.strokeStyle = wood; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(-22, -6); g.lineTo(22, -7); g.stroke();
      break;
    }
    case 'furnace': {   // a tapering clay-daubed stone shaft, glowing at the mouth, smoking at the top
      g.fillStyle = '#8a5a3c';
      g.beginPath(); g.moveTo(-11, 0); g.lineTo(-7, -26); g.lineTo(7, -26); g.lineTo(11, 0); g.closePath(); g.fill();
      g.fillStyle = '#9b9488';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(-9 + r * .6 + c * 6.2 - (r % 2) * 2, -6 - r * 6, 4.6, 3.6);
      g.fillStyle = '#6b4530'; g.fillRect(-8, -28, 16, 3);
      if (!building) {
        const g = .6 + Math.sin(t * 7) * .2 + Math.sin(t * 13.1) * .1;
        g.fillStyle = `rgba(255,${120 + g * 80 | 0},40,${.75 + g * .2})`;
        g.beginPath(); g.moveTo(-4, 0); g.quadraticCurveTo(0, -11, 4, 0); g.closePath(); g.fill();
        for (let k = 0; k < 3; k++) {
          const u = (t * .35 + k / 3) % 1;
          g.fillStyle = `rgba(120,115,110,${.35 * (1 - u)})`;
          g.beginPath(); g.arc(Math.sin(u * 5 + k) * 3 * u, -30 - u * 34, 3 + u * 7, 0, TAU); g.fill();
        }
      }
      break;
    }
    case 'well': {   // a ring of stones, a crossbar and a bucket on a rope
      g.fillStyle = '#8f8a80'; g.beginPath(); g.ellipse(0, -3, 11, 6, 0, 0, TAU); g.fill();
      g.fillStyle = '#2a3a48'; g.beginPath(); g.ellipse(0, -4, 7, 3.6, 0, 0, TAU); g.fill();
      g.fillStyle = '#a39d92'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.fillRect(Math.cos(a) * 9.5 - 2, -3 + Math.sin(a) * 5 - 1.5, 4, 3); }
      g.strokeStyle = wood; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(-9, -3); g.lineTo(-9, -17); g.moveTo(9, -3); g.lineTo(9, -17); g.moveTo(-10, -16); g.lineTo(10, -16); g.stroke();
      g.strokeStyle = '#c9b48a'; g.lineWidth = .8; g.beginPath(); g.moveTo(1, -16); g.lineTo(1, -9); g.stroke();
      g.fillStyle = wood; g.fillRect(-1.5, -9, 5, 3.5);
      break;
    }
    case 'hall': {   // a long brick hall under a big roof, smoke from the hearth inside
      g.fillStyle = '#9c5a3f'; g.fillRect(-28, -20, 56, 20);
      g.fillStyle = '#b5694b';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) g.fillRect(-28 + c * 6.2 + (r % 2) * 3, -20 + r * 5, 5.4, 4.2);
      g.fillStyle = burnt ? '#2e2620' : '#5c4030';
      g.beginPath(); g.moveTo(-32, -19); g.lineTo(-20, -38); g.lineTo(20, -38); g.lineTo(32, -19); g.closePath(); g.fill();
      g.fillStyle = '#1e1a16'; g.fillRect(-5, -13, 10, 13);
      g.fillStyle = 'rgba(255,200,120,.6)'; g.fillRect(-20, -14, 5, 5); g.fillRect(15, -14, 5, 5);
      if (!building) for (let k = 0; k < 2; k++) { const u = (t * .3 + k / 2) % 1; g.fillStyle = `rgba(120,115,110,${.3 * (1 - u)})`; g.beginPath(); g.arc(10, -40 - u * 26, 2.5 + u * 6, 0, TAU); g.fill(); }
      break;
    }
    case 'granary': {   // a raised brick store with a thatched cap
      g.strokeStyle = wood; g.lineWidth = 2;
      for (const x of [-10, 10]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, -6); g.stroke(); }
      g.fillStyle = '#b5694b'; g.fillRect(-13, -22, 26, 16);
      g.fillStyle = '#9c5a3f'; for (let r = 0; r < 3; r++) g.fillRect(-13, -20 + r * 5, 26, .9);
      g.fillStyle = '#c9a35a'; g.beginPath(); g.moveTo(-16, -21); g.lineTo(0, -32); g.lineTo(16, -21); g.closePath(); g.fill();
      break;
    }
    case 'stele': {   // a standing stone covered in carved signs
      g.fillStyle = '#8f8a80';
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(-5, -24); g.lineTo(0, -27); g.lineTo(5, -24); g.lineTo(6, 0); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,36,30,.75)'; g.lineWidth = .7;
      const n = Math.min(8, (o.lore || 0) + 1);
      for (let k = 0; k < n; k++) { const y = -21 + k * 2.6; g.beginPath(); g.moveTo(-3.5, y); g.lineTo(-1.5, y - 1); g.lineTo(.5, y); g.lineTo(3.5, y - .8); g.stroke(); }
      break;
    }
    case 'snare': {   // a bent sapling and a loop of rope in the grass
      g.strokeStyle = wood; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(-5, 0); g.quadraticCurveTo(-6, -9, 2, -10); g.stroke();
      g.strokeStyle = '#c9b48a'; g.lineWidth = .9;
      g.beginPath(); g.moveTo(2, -10); g.lineTo(3, -3); g.stroke(); g.beginPath(); g.ellipse(3, -1.5, 3, 1.4, 0, 0, TAU); g.stroke();
      break;
    }
    case 'grave': {
      g.fillStyle = '#6f5a44'; g.beginPath(); g.ellipse(0, -1.5, 11, 4.5, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#8f9196';
      g.beginPath(); g.moveTo(-4, -2); g.lineTo(-4, -11); g.arc(0, -11, 4, Math.PI, 0); g.lineTo(4, -2); g.closePath(); g.fill();
      if (o.c && G.cam.zoom > 1.5) { g.font = '600 5.5px "Segoe UI",sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(o.c, 0, 6); }
      break;
    }
  }
  if (g === ctx) screen();
}

export function drawCrop(o) {
  sprite(o.x, o.z);
  const g = Math.max(.2, o.g || 0);
  ctx.fillStyle = 'rgba(95,70,45,.55)'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, TAU); ctx.fill();
  if (o.k === 'grain') {
    ctx.strokeStyle = o.ripe ? '#d8b44a' : '#7fae4f'; ctx.lineWidth = 1.2;
    ctx.beginPath(); for (let k = -3; k <= 3; k++) { ctx.moveTo(k * 2, 0); ctx.lineTo(k * 2.4, -14 * g); } ctx.stroke();
    if (o.ripe) { ctx.fillStyle = '#e8c35a'; for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.ellipse(k * 2.4, -14 * g, 1, 2.4, 0, 0, TAU); ctx.fill(); } }
  } else {
    ctx.fillStyle = C.bush; ctx.beginPath(); ctx.arc(0, -6 * g, 7 * g, 0, TAU); ctx.fill();
    if (o.ripe) { ctx.fillStyle = C.berry; for (const [x, y] of [[-3, -7], [3, -5], [0, -10]]) { ctx.beginPath(); ctx.arc(x * g, y * g, 1.8, 0, TAU); ctx.fill(); } }
  }
  screen();
}

// pools of blood where people and animals were hurt or killed (they fade over a few minutes)
export function drawBlood() {
  const Z = G.cam.zoom;
  for (const b of G.blood) {
    const [sx, sy] = proj(b.x, 0, b.z);
    if (sx < -60 || sy < -60 || sx > G.W + 60 || sy > G.H + 60) continue;
    const a = .75 * (1 - smooth(150, 240, b.t)), grow = Math.min(1, .3 + b.t * 1.5);
    ctx.fillStyle = `rgba(${b.t > 40 ? 85 : 115},8,12,${a})`;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const ox = (h2(b.seed, k, 1) - .5) * b.r, oz = (h2(b.seed, k, 2) - .5) * b.r, r = b.r * (.45 + h2(b.seed, k, 3) * .4) * grow;
      ctx.moveTo(sx + ox * Z + r * Z, sy + oz * Z * TILT);
      ctx.ellipse(sx + ox * Z, sy + oz * Z * TILT, r * Z, r * Z * TILT, 0, 0, TAU);
    }
    ctx.fill();
  }
}
