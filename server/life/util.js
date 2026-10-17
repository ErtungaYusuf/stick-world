// Small shared helpers for the life simulation: time constants, randomness, a spatial hash.
import { TAU } from '../../shared/core.js';

// Units: world units (~10 cm) and seconds of simulated time. The game speed only changes how many
// simulated seconds pass per real second; everything inside the simulation runs on this one clock.
export const DAY = 60;     // one day and night
export const YEAR = 360;   // six days; spring, summer, autumn and winter last 90 s each

export const rnd = Math.random;
export const pick = a => a[Math.floor(rnd() * a.length)];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// standard normal sample (Box–Muller)
export const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(TAU * rnd());
// Gumbel noise: argmax(u + τ·g) samples the softmax distribution with temperature τ
export const gumbel = () => -Math.log(-Math.log(1 - rnd() * .999999));

// A* around water on a coarse grid (cell 16 units). blocked(x, z) is the world's water test.
// Returns waypoints [{x, z}, …] ending at the goal, or null if there is no way (or it's too far to plan).
export function findPath(blocked, sx, sz, tx, tz) {
  const C = 16, pad = 260;
  const x0 = Math.min(sx, tx) - pad, z0 = Math.min(sz, tz) - pad;
  const W = Math.ceil((Math.max(sx, tx) + pad - x0) / C), H = Math.ceil((Math.max(sz, tz) + pad - z0) / C);
  if (W * H > 40000) return null;
  const cell = new Int8Array(W * H);                      // 0 unknown, 1 land, 2 water
  const free = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const k = j * W + i;
    if (!cell[k]) cell[k] = blocked(x0 + (i + .5) * C, z0 + (j + .5) * C) ? 2 : 1;
    return cell[k] === 1;
  };
  const ci = x => Math.floor((x - x0) / C), cj = z => Math.floor((z - z0) / C);
  let si = ci(sx), sj = cj(sz), gi = ci(tx), gj = cj(tz);
  // the goal is usually right at the water's edge: settle for the nearest dry cell
  if (!free(gi, gj)) {
    let best = null, bd = Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (free(gi + di, gj + dj) && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = [gi + di, gj + dj]; }
    if (!best) return null;
    [gi, gj] = best;
  }
  if (!free(si, sj)) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (free(si + di, sj + dj)) { si += di; sj += dj; break; }
  const N = W * H, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [], h = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return Math.max(dx, dz) + .414 * Math.min(dx, dz); };
  const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const s = sj * W + si, goal = gj * W + gi;
  g[s] = 0; push(s, h(si, sj));
  let expanded = 0;
  while (heap.length && expanded < 12000) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1; expanded++;
    if (k === goal) break;
    const i = k % W, j = (k / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!free(ni, nj) || (di && dj && (!free(i + di, j) || !free(i, j + dj)))) continue;   // no cutting corners across water
      const nk = nj * W + ni, ng = g[k] + (di && dj ? 1.414 : 1);
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(nk, ng + h(ni, nj)); }
    }
  }
  if (!closed[goal]) return null;
  const pts = [];
  for (let k = goal; k !== -1 && k !== s; k = from[k]) pts.push({ x: x0 + (k % W + .5) * C, z: z0 + (((k / W) | 0) + .5) * C });
  pts.reverse();
  return pts.filter((p, i) => i % 3 === 2 || i === pts.length - 1);
}

// uniform grid of moving things, rebuilt every tick
export function createGrid(cell = 64) {
  const cells = new Map();
  const key = (i, j) => (i + 32768) * 65536 + (j + 32768);
  return {
    clear() { cells.clear(); },
    add(o) {
      const k = key(Math.floor(o.x / cell), Math.floor(o.z / cell));
      let c = cells.get(k);
      if (!c) cells.set(k, c = []);
      c.push(o);
    },
    // fn(thing, distance) for everything within r of (x, z)
    near(x, z, r, fn) {
      const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell);
      const j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell), r2 = r * r;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = cells.get(key(i, j));
        if (!c) continue;
        for (const o of c) {
          const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(o, Math.sqrt(d2));
        }
      }
    },
  };
}
