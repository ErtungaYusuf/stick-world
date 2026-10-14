// Deterministic procedural world. Given the same seed, the browser and the server
// generate identical terrain and identical objects (with stable ids).
import { TAU, h2, fbm2 } from './core.js';

export const WATER = 0.37;
export const CH = 256;           // chunk size in world units
export const CO = 32;            // object cell size
const CPC = CH / CO;             // cells per chunk side

export function createWorld(seed) {
  const elev = (x, z) => fbm2(x / 900, z / 900, seed, 4);
  const moist = (x, z) => fbm2(x / 1300 + 50, z / 1300 - 80, seed + 9, 3);
  const rocky = (x, z) => fbm2(x / 650 - 30, z / 650 + 20, seed + 21, 3);
  const blocked = (x, z) => elev(x, z) < WATER + .004;

  function generate(cx, cz) {
    const objs = [], decals = [], waves = [], flies = [];
    const obj = o => { o.id = `${cx}:${cz}:${objs.length}`; objs.push(o); };
    for (let gj = 0; gj < CPC; gj++) for (let gi = 0; gi < CPC; gi++) {
      const ci = cx * CPC + gi, cj = cz * CPC + gj;
      const r = h2(ci, cj, seed + 1), r2 = h2(ci, cj, seed + 2), r3 = h2(ci, cj, seed + 3);
      const x = (ci + h2(ci, cj, seed + 4)) * CO, z = (cj + h2(ci, cj, seed + 5)) * CO;
      const e = elev(x, z), s = .8 + r2 * .5;
      if (e < WATER) {
        if (e < WATER - .025 && r < .3) waves.push({ x, z, p: r2 * TAU, s });
        else if (e > WATER - .02 && r < .35) obj({ t: 'reed', x, z, s });
        continue;
      }
      const m = moist(x, z), k = rocky(x, z);
      const tuft = n => {
        for (let q = 0; q < n; q++) decals.push({ t: 'tuft', x: (ci + h2(ci, cj, seed + 10 + q)) * CO, z: (cj + h2(ci, cj, seed + 20 + q)) * CO, s: .7 + h2(ci, cj, seed + 30 + q) * .6 });
      };
      if (e < WATER + .02) { if (r < .2) decals.push({ t: 'pebble', x, z, s }); continue; }
      if (k > .64) {
        if (r < .16) obj({ t: 'boulder', x, z, s: s * 1.1, solid: 11 * s, seed: r3 });
        else if (r < .45) decals.push({ t: 'pebble', x, z, s });
        continue;
      }
      if (m > .58) {            // forest
        if (r < .27) obj({ t: r3 < .68 ? 'pine' : 'tree', x, z, s, solid: 5 * s, seed: r3 });
        else if (r < .32) obj({ t: 'mush', x, z, s });
        else if (r < .38) obj({ t: 'bush', x, z, s, berry: r3 < .6 });
        else tuft(1);
      } else if (m < .42) {     // savanna
        if (r < .045) obj({ t: 'twig', x, z, s, solid: 3.5, seed: r3 });
        else if (r < .2) obj({ t: 'tall', x, z, s });
        else if (r < .225) obj({ t: 'boulder', x, z, s: s * .8, solid: 8 * s, seed: r3 });
        else if (r < .24) obj({ t: 'bush', x, z, s, berry: r3 < .6 });
        else tuft(2);
      } else {                  // meadow
        if (r < .07) obj({ t: 'tree', x, z, s, solid: 5 * s, seed: r3 });
        else if (r < .12) obj({ t: 'bush', x, z, s, berry: r3 < .6 });
        else if (r < .26) decals.push({ t: 'flower', x, z, s, k: Math.floor(r3 * 4) });
        else if (r < .27) obj({ t: 'boulder', x, z, s: s * .7, solid: 7 * s, seed: r3 });
        tuft(2);
      }
      if (m > .45 && r3 > .985) flies.push({ x, z, p: r2 * 50 });
    }
    for (let q = 0; q < 3; q++) {
      const x = cx * CH + h2(cx, cz, seed + 40 + q) * CH, z = cz * CH + h2(cx, cz, seed + 50 + q) * CH;
      if (elev(x, z) > WATER + .02 && moist(x, z) > .45) flies.push({ x, z, p: h2(cx, cz, q) * 50 });
    }
    for (const o of objs) if (o.t === 'bush') o.canBerry = o.berry;
    return { objs, decals, waves, flies };
  }

  const cache = new Map();
  function chunkData(cx, cz) {
    const k = cx + ',' + cz;
    let c = cache.get(k);
    if (!c) { c = generate(cx, cz); cache.set(k, c); }
    return c;
  }
  function nearbySolids(x, z) {
    const out = [], cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++)
      for (const o of chunkData(cx + i, cz + j).objs) if (o.solid && Math.abs(o.x - x) < 40 && Math.abs(o.z - z) < 40) out.push(o);
    return out;
  }
  // first dry, open spot spiralling out from the origin
  function findSpawn() {
    for (let r = 0; r < 4000; r += 24) for (let a = 0; a < TAU; a += .5) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (elev(x, z) > WATER + .05 && rocky(x, z) < .6 && moist(x, z) < .58) return { x, z };
    }
    return { x: 0, z: 0 };
  }
  function landNear(x, z, r0, r1) {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * TAU, r = r0 + Math.random() * (r1 - r0);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (elev(px, pz) > WATER + .02) return { x: px, z: pz };
    }
    return { x, z };
  }
  return { seed, elev, moist, rocky, blocked, chunkData, nearbySolids, findSpawn, landNear, cache };
}
