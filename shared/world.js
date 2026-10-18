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
  // water or land, remembered on a 2-unit grid (movement asks this many times a second for the same few places)
  const wet = new Map();
  const blocked = (x, z) => {
    const k = Math.round(x * .5) * 1048576 + Math.round(z * .5);
    let v = wet.get(k);
    if (v === undefined) { if (wet.size > 3e6) wet.clear(); v = elev(Math.round(x * .5) * 2, Math.round(z * .5) * 2) < WATER + .004; wet.set(k, v); }
    return v;
  };
  // climate: 0 = arctic … 1 = hot. The north (−z) is cold, the south warm, with wobbly borders.
  const temp = (x, z) => Math.max(0, Math.min(1, .66 + z / 2400 + (fbm2(x / 1500 + 9, z / 1500 - 4, seed + 77, 3) - .5) * .7));
  const SNOW = .3;   // below this temperature the ground is snow-covered
  // mineral veins: rich patches of ore show on the surface as coloured rocks
  const vein = (x, z, s) => fbm2(x / 420 + s * 7, z / 420 - s * 3, seed + 31 + s * 5, 3);
  function oreAt(x, z, r) {
    if (vein(x, z, 3) > .64 && r < .25) return 'gold';
    if (vein(x, z, 1) > .6) return 'copper';
    if (vein(x, z, 2) > .61) return 'iron';
    if (temp(x, z) > .72 && vein(x, z, 4) > .58) return 'sulfur';
    if (vein(x, z, 5) > .61) return 'tin';                              // dull grey-black cassiterite
    if (temp(x, z) > .55 && moist(x, z) < .5 && vein(x, z, 6) > .58) return 'saltpeter';   // white crust where it's warm and dry
    return null;
  }

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
      const m = moist(x, z), k = rocky(x, z), tp = temp(x, z);
      if (tp < SNOW) {          // snowfields: snowy pines, rocks, nothing to eat
        if (k > .6 && r < .15) obj({ t: 'boulder', x, z, s: s * 1.1, solid: 11 * s, seed: r3, snow: true });
        else if (r < .1 + Math.max(0, m - .45) * .9) obj({ t: 'pine', x, z, s, solid: 5 * s, seed: r3, snow: true });
        continue;
      }
      const tuft = n => {
        for (let q = 0; q < n; q++) decals.push({ t: 'tuft', x: (ci + h2(ci, cj, seed + 10 + q)) * CO, z: (cj + h2(ci, cj, seed + 20 + q)) * CO, s: .7 + h2(ci, cj, seed + 30 + q) * .6 });
      };
      if (e < WATER + .02) { if (r < .2) decals.push({ t: 'pebble', x, z, s }); continue; }
      if (k > .64) {
        if (r < .16) obj({ t: 'boulder', x, z, s: s * 1.1, solid: 11 * s, seed: r3, ore: k > .66 ? oreAt(x, z, r3) : null });
        else if (r < .45) decals.push({ t: 'pebble', x, z, s });
        continue;
      }
      if (m > .58) {            // forest
        if (r < .27) obj({ t: r3 < .68 ? 'pine' : 'tree', x, z, s, solid: 5 * s, seed: r3 });
        else if (r < .32) obj({ t: r3 < .3 ? 'redcap' : 'mush', x, z, s });
        else if (r < .38) obj({ t: 'bush', x, z, s, berry: r3 < .6 });
        else if (r < .395) obj({ t: 'herb', x, z, s });
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
        else if (r < .27) obj({ t: 'boulder', x, z, s: s * .7, solid: 7 * s, seed: r3, ore: oreAt(x, z, r3) });
        else if (r < .285) obj({ t: 'herb', x, z, s });
        tuft(2);
      }
      if (m > .45 && r3 > .985) flies.push({ x, z, p: r2 * 50 });
    }
    for (let q = 0; q < 3; q++) {
      const x = cx * CH + h2(cx, cz, seed + 40 + q) * CH, z = cz * CH + h2(cx, cz, seed + 50 + q) * CH;
      if (elev(x, z) > WATER + .02 && moist(x, z) > .45 && temp(x, z) > SNOW + .05) flies.push({ x, z, p: h2(cx, cz, q) * 50 });
    }
    for (const o of objs) if (o.t === 'bush') o.canBerry = o.berry;
    return { objs, decals, waves, flies, solids: objs.filter(o => o.solid) };
  }

  const cache = new Map();
  const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);   // numeric: no string building on every lookup
  function chunkData(cx, cz) {
    const k = ckey(cx, cz);
    let c = cache.get(k);
    if (!c) { c = generate(cx, cz); cache.set(k, c); }
    return c;
  }
  const peek = (cx, cz) => cache.get(ckey(cx, cz));   // only if already generated
  // trees and rocks within 40 units (only the one to four chunks that reach that far are looked at)
  function nearbySolids(x, z) {
    const out = [];
    for (let cz = Math.floor((z - 40) / CH), cz1 = Math.floor((z + 40) / CH); cz <= cz1; cz++)
      for (let cx = Math.floor((x - 40) / CH), cx1 = Math.floor((x + 40) / CH); cx <= cx1; cx++)
        for (const o of chunkData(cx, cz).solids) if (!o.felled && Math.abs(o.x - x) < 40 && Math.abs(o.z - z) < 40) out.push(o);
    return out;
  }
  // first dry, open spot spiralling out from the origin
  function findSpawn() {
    for (let r = 0; r < 4000; r += 24) for (let a = 0; a < TAU; a += .5) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (elev(x, z) > WATER + .05 && rocky(x, z) < .6 && moist(x, z) < .58 && temp(x, z) > .55) return { x, z };
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
  return { seed, elev, moist, rocky, temp, SNOW, blocked, chunkData, peek, nearbySolids, findSpawn, landNear, cache, oreAt };
}
