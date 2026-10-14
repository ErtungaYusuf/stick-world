// Billboard sprites: trees, rocks, bushes… plus the village props (campfire, stockpiles, graves).
import { TAU, smooth, h2 } from '/shared/core.js';
import { G, ctx, proj, TILT } from './state.js';

export const C = {
  trunk: '#6b4d36', leafD: '#3f7a3e', leafM: '#529247', leafL: '#6dab55',
  pineD: '#2f5f3c', pineL: '#3f7a48', twig: '#7a5a3d', bush: '#4c8a43', bushL: '#62a352',
  berry: '#d8344a', rockD: '#8a8475', rockL: '#aaa392', reed: '#6c8f45', cat: '#7a5233',
  tall: '#b7b45c', tallD: '#9a9a48', mushCap: '#d9453b', stem: '#efe6d2',
};
export const SHADOW = { tree: 20, pine: 18, twig: 12, bush: 11, boulder: 13, mush: 4, tall: 8, reed: 0 };
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

function branch(x, y, len, ang, depth, seed) {
  const x2 = x + Math.sin(ang) * len, y2 = y - Math.cos(ang) * len;
  ctx.moveTo(x, y); ctx.lineTo(x2, y2);
  if (depth > 0) {
    branch(x2, y2, len * .7, ang - .5 - h2(seed, depth, 1) * .3, depth - 1, seed + 1.3);
    branch(x2, y2, len * .65, ang + .45 + h2(seed, depth, 2) * .3, depth - 1, seed + 2.7);
  }
}

export function drawObject(o, player) {
  const s = o.s, t = G.time;
  const isTree = o.t === 'tree' || o.t === 'pine' || o.t === 'twig';
  ctx.globalAlpha = isTree && o.z > player.z && (o.z - player.z) * TILT < 95 * s && Math.abs(o.x - player.x) < 30 * s + 8 ? .38 : 1;
  sprite(o.x, o.z);
  let sway = Math.sin(t * 1.1 + o.x * .02 + o.z * .013) * 1.8;
  const hit = isTree && G.shake.get(o.id);   // shudders right after each axe strike
  if (hit !== undefined && t - hit < .22) sway += Math.sin(t * 60) * 2.5 * (1 - (t - hit) / .22);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (o.t) {
    case 'tree': {
      ctx.strokeStyle = C.trunk; ctx.lineWidth = 5.5 * s;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0, -24 * s, sway * .5, -44 * s); ctx.stroke();
      const cx = sway, cy = -62 * s;
      ctx.fillStyle = C.leafD;
      ctx.beginPath(); ctx.arc(cx - 15 * s, cy + 8 * s, 17 * s, 0, TAU); ctx.arc(cx + 15 * s, cy + 7 * s, 16 * s, 0, TAU); ctx.arc(cx, cy - 6 * s, 20 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = C.leafM;
      ctx.beginPath(); ctx.arc(cx - 6 * s, cy - 6 * s, 16 * s, 0, TAU); ctx.arc(cx - 15 * s, cy + 4 * s, 11 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = C.leafL;
      ctx.beginPath(); ctx.arc(cx - 9 * s, cy - 12 * s, 8 * s, 0, TAU); ctx.fill();
      break;
    }
    case 'pine': {
      ctx.strokeStyle = C.trunk; ctx.lineWidth = 4.5 * s;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -16 * s); ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const base = -12 * s - k * 19 * s, w = (25 - k * 5) * s, top = base - 30 * s, sw = sway * (k + 1) * .35;
        ctx.fillStyle = C.pineD;
        ctx.beginPath(); ctx.moveTo(-w + sw * .3, base); ctx.lineTo(sw, top); ctx.lineTo(w + sw * .3, base); ctx.closePath(); ctx.fill();
        ctx.fillStyle = C.pineL;
        ctx.beginPath(); ctx.moveTo(-w + sw * .3, base); ctx.lineTo(sw, top); ctx.lineTo(sw * .6 - w * .15, base); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'twig':
      ctx.strokeStyle = C.twig; ctx.lineWidth = 3 * s;
      ctx.beginPath(); branch(0, 0, 24 * s, sway * .02, 3, o.seed * 10); ctx.stroke();
      break;
    case 'bush': {
      ctx.fillStyle = C.bush;
      ctx.beginPath(); ctx.arc(-7 * s, -7 * s, 9 * s, 0, TAU); ctx.arc(6 * s, -8 * s, 10 * s, 0, TAU); ctx.arc(0, -15 * s, 9 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = C.bushL;
      ctx.beginPath(); ctx.arc(-3 * s, -16 * s, 6 * s, 0, TAU); ctx.fill();
      if (o.berry && !G.picked.has(o.id)) {   // berries disappear while a picked bush regrows (server state)
        ctx.fillStyle = C.berry;
        for (const [x, y] of [[-8, -9], [5, -13], [8, -5], [-2, -6], [1, -18]]) { ctx.beginPath(); ctx.arc(x * s, y * s, 2 * s, 0, TAU); ctx.fill(); }
      }
      break;
    }
    case 'boulder': {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI + k / 8 * Math.PI, r = (13 + h2(o.seed * 99, k, 3) * 5) * s;
        pts.push([Math.cos(a) * r, Math.sin(a) * r * .95 + 2 * s]);
      }
      ctx.fillStyle = C.rockD;
      ctx.beginPath(); pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0], p[1])); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.rockL;
      ctx.beginPath(); pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p[0] * .72 - 2 * s, p[1] * .72 - 3 * s)); ctx.closePath(); ctx.fill();
      break;
    }
    case 'reed': {
      ctx.strokeStyle = C.reed; ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      for (const [ox, h] of [[-4, 20], [0, 26], [4, 22], [7, 16]]) { ctx.moveTo(ox * s, 0); ctx.quadraticCurveTo(ox * s, -h * .5 * s, ox * s + sway * .6, -h * s); }
      ctx.stroke();
      ctx.fillStyle = C.cat;
      for (const [ox, h] of [[0, 26], [4, 22]]) { ctx.beginPath(); ctx.ellipse(ox * s + sway * .6, -h * s + 2 * s, 1.8 * s, 4 * s, 0, 0, TAU); ctx.fill(); }
      break;
    }
    case 'tall': {
      const dx = o.x - player.x, dz = o.z - player.z, near = Math.exp(-(dx * dx + dz * dz) / 300) * (player.y < 10 ? 1 : .2);
      const bend = sway + near * Math.sign(dx || 1) * 9;
      ctx.lineWidth = 2 * s;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? C.tall : C.tallD;
        ctx.beginPath();
        for (let k = pass; k < 7; k += 2) {
          const ox = (k - 3) * 2.4 * s, h = (14 + h2(o.x, k, 4) * 10) * s;
          ctx.moveTo(ox, 0); ctx.quadraticCurveTo(ox, -h * .55, ox + bend * (.6 + k * .06) + (k - 3) * 1.5, -h);
        }
        ctx.stroke();
      }
      break;
    }
    case 'mush':
      ctx.fillStyle = C.stem; ctx.fillRect(-1.6 * s, -6 * s, 3.2 * s, 6 * s);
      ctx.fillStyle = C.mushCap; ctx.beginPath(); ctx.ellipse(0, -6 * s, 5.5 * s, 4.5 * s, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-2 * s, -8 * s, .9 * s, 0, TAU); ctx.arc(2 * s, -7.5 * s, .7 * s, 0, TAU); ctx.fill();
      break;
  }
  ctx.globalAlpha = 1;
  screen();
}

// ───────── village props ─────────
export const fireStrength = () => .55 + .45 * Math.min(1, (G.village ? G.village.wood : 0) / 6);

export function drawFire(o) {
  const f = fireStrength(), t = G.time;
  sprite(o.x, o.z);
  ctx.fillStyle = '#8a8475';
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * TAU;
    ctx.beginPath(); ctx.ellipse(Math.cos(a) * 12, Math.sin(a) * 12 * TILT, 3.4, 2.5, 0, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = '#6b4d36'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, 1); ctx.lineTo(8, -3); ctx.moveTo(-7, -3); ctx.lineTo(8, 2); ctx.stroke();
  const flame = (w, h, col, ph) => {
    const k = (1 + Math.sin(t * 11 + ph) * .12 + Math.sin(t * 17 + ph * 2) * .08) * f, tip = Math.sin(t * 7 + ph) * 2;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(-w, -1);
    ctx.quadraticCurveTo(-w * .8, -h * .6 * k, tip, -h * k);
    ctx.quadraticCurveTo(w * .8, -h * .6 * k, w, -1); ctx.closePath(); ctx.fill();
  };
  flame(7, 21, '#f2762e', 0); flame(5, 15, '#ffb340', 1.7); flame(2.8, 9, '#fff0a0', 3.1);
  screen();
}

export function drawStock(o) {
  const v = G.village;
  ctx.fillStyle = SHADOW_COL; drawShadow(o.x, o.z, 11);
  sprite(o.x, o.z);
  if (o.kind === 'food') {          // berry basket
    const n = Math.min(24, Math.ceil(v.food));
    ctx.fillStyle = C.berry;
    for (let k = 0; k < n; k++) { const a = h2(k, 1, 7) * TAU, r = h2(k, 2, 7) * 6.5; ctx.beginPath(); ctx.arc(Math.cos(a) * r, -9 + Math.sin(a) * r * .45 - n * .08, 1.7, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#8a5a32';
    ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, -9); ctx.lineTo(7, 0); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6e4626'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(8, -6); ctx.moveTo(-7.5, -3); ctx.lineTo(7.5, -3); ctx.stroke();
  } else if (o.kind === 'wood') {   // log pile
    const n = Math.min(15, Math.ceil(v.wood));
    let k = 0;
    for (let row = 0; row < 5 && k < n; row++) for (let c = 0; c < 5 - row && k < n; c++, k++) {
      const x = (c - (4 - row) / 2) * 4.6, y = -2.4 - row * 4;
      ctx.fillStyle = '#6b4d36'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9a477'; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, TAU); ctx.fill();
    }
  } else {                          // water pot
    ctx.fillStyle = '#b06a3e';
    ctx.beginPath(); ctx.ellipse(0, -7, 8, 8, 0, 0, TAU); ctx.fill();
    ctx.fillRect(-4.5, -17, 9, 4);
    ctx.fillStyle = v.water >= 1 ? '#5fb8dc' : '#7a4a2c';
    ctx.beginPath(); ctx.ellipse(0, -17, 4.5, 1.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(-3, -9, 2.2, 4, 0, 0, TAU); ctx.fill();
  }
  screen();
}

export function drawGrave(g) {
  ctx.globalAlpha = 1 - smooth(6.5, 8, g.age);
  ctx.fillStyle = SHADOW_COL; drawShadow(g.x, g.z, 9);
  sprite(g.x, g.z);
  ctx.fillStyle = '#8f9196';
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, -11); ctx.arc(0, -11, 6, Math.PI, 0); ctx.lineTo(6, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b0b2b7';
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, -11); ctx.arc(0, -11, 6, Math.PI, Math.PI * 1.5); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#6d6f74'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, -7); ctx.moveTo(-2.6, -12.5); ctx.lineTo(2.6, -12.5); ctx.stroke();
  screen();
  ctx.globalAlpha = 1;
}
