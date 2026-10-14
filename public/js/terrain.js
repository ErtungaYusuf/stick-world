// Ground textures (baked per chunk) and flat ground decals.
import { TAU, smooth, frac, h2, hex, mixc, rgb } from '/shared/core.js';
import { WATER, CH } from '/shared/world.js';
import { G, ctx, proj, TILT } from './state.js';

const RES = 4, TEX = CH / RES;
export const COL = {
  deep: hex('#3a86b8'), shallow: hex('#64bfd6'), foam: hex('#bfe8ee'), sand: hex('#dccb93'),
  savanna: hex('#c3c46c'), meadow: hex('#8cc063'), forest: hex('#5e9a50'), rock: hex('#b3a98f'),
  ink: hex('#1c1f2b'),
};
function groundColor(x, z, jitter) {
  const w = G.world, e = w.elev(x, z);
  let c;
  if (e < WATER) {
    c = mixc(COL.shallow, COL.deep, smooth(WATER - .01, WATER - .09, e));
    c = mixc(c, COL.foam, smooth(WATER - .012, WATER - .002, e) * .7);
  } else {
    const m = w.moist(x, z), k = w.rocky(x, z);
    c = mixc(COL.savanna, COL.meadow, smooth(.38, .47, m));
    c = mixc(c, COL.forest, smooth(.55, .64, m));
    c = mixc(c, COL.rock, smooth(.6, .68, k) * .9);
    c = mixc(c, COL.sand, 1 - smooth(WATER + .006, WATER + .022, e));
  }
  const j = 1 + (jitter - .5) * .07;
  return [c[0] * j, c[1] * j, c[2] * j];
}

const textures = new Map();
let frameNo = 0, budget = 0;
function bake(cx, cz) {
  // 1-texel border shared with neighbours so bilinear filtering leaves no seams
  const T2 = TEX + 2;
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = T2;
  const c2 = cvs.getContext('2d'), img = c2.createImageData(T2, T2), d = img.data;
  for (let j = 0; j < T2; j++) for (let i = 0; i < T2; i++) {
    const x = cx * CH + (i - .5) * RES, z = cz * CH + (j - .5) * RES;
    const c = groundColor(x, z, h2(x, z, 9)), k = (j * T2 + i) * 4;
    d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
  }
  c2.putImageData(img, 0, 0);
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
export function visibleChunks(b, zExtra, genBudget) {
  frameNo++; budget = genBudget;
  const out = [];
  for (let cz = Math.floor(b.z0 / CH); cz <= Math.floor((b.z1 + zExtra) / CH); cz++)
    for (let cx = Math.floor(b.x0 / CH); cx <= Math.floor(b.x1 / CH); cx++) {
      const k = cx + ',' + cz;
      let t = textures.get(k);
      if (!t && budget > 0) { t = bake(cx, cz); textures.set(k, t); budget--; }
      if (t) t.used = frameNo;
      out.push({ cx, cz, tex: t, data: G.world.chunkData(cx, cz) });
    }
  return out;
}
export function pruneTextures() {
  if (textures.size < 500) return;
  for (const [k, t] of textures) if (frameNo - t.used > 300) textures.delete(k);
}

export function drawGround(vis) {
  const Z = G.cam.zoom;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
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
  // all grass tufts in one batched path (translucent so they tint any biome)
  if (Z > .8) {
    ctx.strokeStyle = 'rgba(35,70,25,.38)'; ctx.lineWidth = 1.5 * Z;
    ctx.beginPath();
    for (const { data } of vis) for (const d of data.decals) {
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
  for (const { data } of vis) {
    for (const w of data.waves) {
      if (!inB(w)) continue;
      const t = frac(t0 * .25 + w.p / TAU);
      const [sx, sy] = proj(w.x, 0, w.z);
      ctx.strokeStyle = `rgba(255,255,255,${Math.sin(t * Math.PI) * .55})`;
      ctx.lineWidth = 1.6 * Z;
      const r = (6 + t * 10) * w.s * Z;
      ctx.beginPath(); ctx.ellipse(sx, sy, r, r * TILT * .7, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
    for (const d of data.decals) {
      if (d.t === 'tuft' || !inB(d)) continue;
      const [sx, sy] = proj(d.x, 0, d.z);
      if (d.t === 'flower') {
        ctx.fillStyle = rgb(FL[d.k]);
        for (let q = 0; q < 4; q++) {
          const ox = (h2(d.x, q, 1) - .5) * 14, oz = (h2(d.z, q, 2) - .5) * 14;
          ctx.beginPath(); ctx.arc(sx + ox * Z, sy + oz * Z * TILT - 2 * Z, 1.9 * Z * d.s, 0, TAU); ctx.fill();
        }
      } else if (d.t === 'pebble') {
        ctx.fillStyle = 'rgba(120,112,98,.55)';
        ctx.beginPath(); ctx.ellipse(sx, sy, 3.2 * Z * d.s, 2 * Z * d.s, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(sx + 5 * Z, sy + 2 * Z, 2 * Z * d.s, 1.3 * Z * d.s, 0, 0, TAU); ctx.fill();
      }
    }
  }
}
