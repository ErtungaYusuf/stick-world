// Ground textures (baked per chunk) and flat ground decals.
import { TAU, frac, h2, hex, rgb } from '/shared/core.js';
import { CH } from '/shared/world.js';
import { G, ctx, proj, TILT } from './state.js';
import { RES, TEX, T2, COL, bakePixels } from './ground.js';

export { COL } from './ground.js';

// Ground textures are baked in a worker; until a chunk arrives its area is filled with a plain colour.
const textures = new Map(), pending = new Set();
let frameNo = 0, worker = null, fallback = false;
export function startBaker(seed) {
  try {
    worker = new Worker(new URL('./bake-worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ t: 'init', seed });
    worker.onmessage = ({ data }) => {
      pending.delete(data.k);
      const cvs = document.createElement('canvas'); cvs.width = cvs.height = T2;
      cvs.getContext('2d').putImageData(new ImageData(data.px, T2, T2), 0, 0);
      textures.set(data.k, { cvs, used: frameNo });
    };
    worker.onerror = () => { fallback = true; };
  } catch { fallback = true; }
}
// main-thread baking: only if workers are unavailable, or for the very first screen
function bakeHere(cx, cz) {
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = T2;
  cvs.getContext('2d').putImageData(new ImageData(bakePixels(G.world, cx, cz), T2, T2), 0, 0);
  return { cvs, used: frameNo };
}

export function viewBounds() {
  const { cam, W, H } = G, Z = cam.zoom;
  return {
    x0: cam.x - W / 2 / Z - 30, x1: cam.x + W / 2 / Z + 30,
    z0: cam.z - H / 2 / (Z * TILT) - 30, z1: cam.z + H / 2 / (Z * TILT) + 30,
  };
}

// chunks overlapping the view (extra rows to the south so tall trees can poke up into view)
// New chunks (objects + texture) are prepared a few per frame, nearest first, so zooming out never stalls a frame.
export function visibleChunks(b, zExtra, genBudget) {
  frameNo++;
  let budget = genBudget, newData = genBudget < 50 ? 3 : 1e9;
  const out = [], ccx = G.cam.x / CH, ccz = G.cam.z / CH;
  const cells = [];
  for (let cz = Math.floor(b.z0 / CH); cz <= Math.floor((b.z1 + zExtra) / CH); cz++)
    for (let cx = Math.floor(b.x0 / CH); cx <= Math.floor(b.x1 / CH); cx++) cells.push([cx, cz, (cx + .5 - ccx) ** 2 + (cz + .5 - ccz) ** 2]);
  cells.sort((p, q) => p[2] - q[2]);
  for (const [cx, cz] of cells) {
    const k = cx + ',' + cz;
    let t = textures.get(k);
    if (!t) {
      if (worker && !fallback && genBudget < 50) { if (!pending.has(k)) { pending.add(k); worker.postMessage({ t: 'bake', k, cx, cz }); } }
      else if (budget > 0) { t = bakeHere(cx, cz); textures.set(k, t); budget--; }
    }
    if (t) t.used = frameNo;
    let data = G.world.peek(cx, cz) || null;
    if (!data && newData-- > 0) data = G.world.chunkData(cx, cz);
    out.push({ cx, cz, tex: t, data });
  }
  return out;
}
export function pruneTextures() {
  if (textures.size < 500) return;
  for (const [k, t] of textures) if (frameNo - t.used > 300) textures.delete(k);
}

export function drawGround(vis) {
  const Z = G.cam.zoom;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';   // cached sprites come in several resolutions, so plain bilinear is enough
  for (const { cx, cz, tex } of vis) {
    const [sx, sy] = proj(cx * CH, 0, cz * CH);
    if (sy > G.H || sy + CH * Z * TILT < 0) continue;
    if (tex) ctx.drawImage(tex.cvs, .5, .5, TEX + 1, TEX + 1, sx - RES * .5 * Z, sy - RES * .5 * Z * TILT, (CH + RES) * Z, (CH + RES) * Z * TILT);
    else { ctx.fillStyle = rgb(COL.meadow); ctx.fillRect(sx, sy, CH * Z + 1, CH * Z * TILT + 1); }
  }
}

const FL = [hex('#f6d55c'), hex('#f28aa8'), hex('#ffffff'), hex('#b38ff3')];
export function drawDecals(vis, b, player) {
  const Z = G.cam.zoom, t0 = G.time;
  const inB = d => d.x >= b.x0 && d.x <= b.x1 && d.z >= b.z0 && d.z <= b.z1;
  ctx.lineCap = 'round';
  // grass tufts bend in the wind and around the player only up close; further out they are baked into the chunk layer
  const liveTufts = Z > 2;
  if (liveTufts) {
    ctx.strokeStyle = 'rgba(35,70,25,.38)'; ctx.lineWidth = 1.5 * Z;
    ctx.beginPath();
    for (const { data } of vis) if (data) for (const d of data.decals) {
      if (d.t !== 'tuft' || !inB(d)) continue;
      const [sx, sy] = proj(d.x, 0, d.z);
      const dx = d.x - player.x, dz = d.z - player.z, near = Math.exp(-(dx * dx + dz * dz) / 220) * (player.y < 8 ? 1 : .2);
      const bend = Math.sin(t0 * 2 + d.x * .05) * 1.2 + near * Math.sign(dx || 1) * 5;
      const h = 7 * d.s * Z;
      for (const o of [-3, 0, 3]) {
        ctx.moveTo(sx + o * Z, sy);
        ctx.quadraticCurveTo(sx + o * 1.2 * Z, sy - h * .5, sx + (o * 1.8 + bend) * Z, sy - h * (o ? .8 : 1));
      }
    }
    ctx.stroke();
  }
  if (Z < .65) return;   // far out: ripples, flowers, pebbles and tufts are smaller than a pixel or two
  // flowers and pebbles never move: each chunk's are painted once into a transparent layer
  const winter = G.season === 3;
  for (const { cx, cz, data } of vis) {
    if (!data) continue;
    const [sx, sy] = proj(cx * CH, 0, cz * CH);
    if (sx > G.W || sy > G.H || sx + CH * Z < 0 || sy + CH * Z * TILT < 0) continue;
    ctx.drawImage(decalLayer(cx, cz, data, winter, !liveTufts), sx, sy - TUFT_PAD * Z, CH * Z, (CH * TILT + TUFT_PAD) * Z);
  }
  // ripples fade in and out, so they stay live
  ctx.lineWidth = 1.6 * Z;
  for (const { data } of vis) {
    if (!data) continue;
    for (const w of data.waves) {
      if (!inB(w)) continue;
      const t = frac(t0 * .25 + w.p / TAU);
      const [sx, sy] = proj(w.x, 0, w.z);
      ctx.strokeStyle = `rgba(255,255,255,${Math.sin(t * Math.PI) * .55})`;
      const r = (6 + t * 10) * w.s * Z;
      ctx.beginPath(); ctx.ellipse(sx, sy, r, r * TILT * .7, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
  }
}
// one chunk's flowers (not in winter) and pebbles, in ground space (1.5 px per world unit; z is stretched by
// 1/TILT so the dots come out round once the layer is squashed onto the tilted ground)
const decals = new Map(), DR = 1.5, TUFT_PAD = 10;   // room above the chunk for tufts sticking up
function decalLayer(cx, cz, data, winter, tufts) {
  const k = `${cx},${cz},${winter ? 1 : 0}${tufts ? 't' : ''}`;
  let c = decals.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = CH * DR; c.height = (CH + TUFT_PAD / TILT) * DR;
  const g = c.getContext('2d');
  g.setTransform(DR, 0, 0, DR, -cx * CH * DR, (-cz * CH + TUFT_PAD / TILT) * DR);
  const zs = 1 / TILT;
  if (tufts) {   // still grass: the same strokes as the live ones, stretched so they stand upright once squashed
    g.strokeStyle = 'rgba(35,70,25,.38)'; g.lineWidth = 1.5; g.lineCap = 'round';
    g.beginPath();
    for (const d of data.decals) {
      if (d.t !== 'tuft') continue;
      const h = 7 * d.s * zs, bend = Math.sin(d.x * .05) * 1.2;
      for (const o of [-3, 0, 3]) { g.moveTo(d.x + o, d.z); g.quadraticCurveTo(d.x + o * 1.2, d.z - h * .5, d.x + o * 1.8 + bend, d.z - h * (o ? .8 : 1)); }
    }
    g.stroke();
  }
  for (const d of data.decals) {
    if (d.t === 'flower' && !winter) {
      g.fillStyle = rgb(FL[d.k]);
      g.beginPath();
      const r = 1.9 * d.s;
      for (let q = 0; q < 4; q++) {
        const x = d.x + (h2(d.x, q, 1) - .5) * 14, z = d.z + (h2(d.z, q, 2) - .5) * 14 - 2 * zs;
        g.moveTo(x + r, z); g.ellipse(x, z, r, r * zs, 0, 0, TAU);
      }
      g.fill();
    } else if (d.t === 'pebble') {
      g.fillStyle = 'rgba(120,112,98,.55)';
      g.beginPath();
      g.ellipse(d.x, d.z, 3.2 * d.s, 2 * d.s * zs, 0, 0, TAU);
      g.moveTo(d.x + 7 * d.s, d.z + 2 * zs); g.ellipse(d.x + 5, d.z + 2 * zs, 2 * d.s, 1.3 * d.s * zs, 0, 0, TAU);
      g.fill();
    }
  }
  decals.set(k, c);
  if (decals.size > 150) decals.delete(decals.keys().next().value);
  return c;
}
