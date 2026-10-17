// Ground colours and chunk texture baking. No DOM access: used both on the main thread and in bake-worker.js.
import { smooth, h2, hex, mixc } from '/shared/core.js';
import { WATER, CH } from '/shared/world.js';

export const RES = 4, TEX = CH / RES, T2 = TEX + 2;   // 1-texel border shared with neighbours: no seams when filtered
export const COL = {
  deep: hex('#3a86b8'), shallow: hex('#64bfd6'), foam: hex('#bfe8ee'), sand: hex('#dccb93'),
  savanna: hex('#c3c46c'), meadow: hex('#8cc063'), forest: hex('#5e9a50'), rock: hex('#b3a98f'),
  ink: hex('#1c1f2b'), snow: hex('#eef3f7'), frost: hex('#c9d6c4'), ice: hex('#cfe6ef'),
};

export function groundColor(w, x, z, jitter) {
  const e = w.elev(x, z), tp = w.temp(x, z);
  let c;
  if (e < WATER) {
    c = mixc(COL.shallow, COL.deep, smooth(WATER - .01, WATER - .09, e));
    c = mixc(c, COL.foam, smooth(WATER - .012, WATER - .002, e) * .7);
    c = mixc(c, COL.ice, smooth(w.SNOW - .04, w.SNOW - .12, tp) * .85);   // lakes freeze in the far north
  } else {
    const m = w.moist(x, z), k = w.rocky(x, z);
    c = mixc(COL.savanna, COL.meadow, smooth(.38, .47, m));
    c = mixc(c, COL.forest, smooth(.55, .64, m));
    c = mixc(c, COL.rock, smooth(.6, .68, k) * .9);
    c = mixc(c, COL.sand, 1 - smooth(WATER + .006, WATER + .022, e));
    c = mixc(c, COL.snow, smooth(w.SNOW + .04, w.SNOW - .02, tp));   // snowfields
    c = mixc(c, COL.frost, smooth(w.SNOW + .12, w.SNOW + .04, tp) * .35);
  }
  const j = 1 + (jitter - .5) * .07;
  return [c[0] * j, c[1] * j, c[2] * j];
}

// RGBA pixels of one chunk's ground texture
export function bakePixels(w, cx, cz) {
  const d = new Uint8ClampedArray(T2 * T2 * 4);
  for (let j = 0; j < T2; j++) for (let i = 0; i < T2; i++) {
    const x = cx * CH + (i - .5) * RES, z = cz * CH + (j - .5) * RES;
    const c = groundColor(w, x, z, h2(x, z, 9)), k = (j * T2 + i) * 4;
    d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
  }
  return d;
}
