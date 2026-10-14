// Math, noise and colour helpers shared by the browser and the server.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const frac = x => x - Math.floor(x);
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export const angDiff = (a, b) => ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;

export function h2(i, j, s) { const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x); }
export function vn2(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h2(i, j, s), h2(i + 1, j, s), u), lerp(h2(i, j + 1, s), h2(i + 1, j + 1, s), u), v);
}
export function fbm2(x, y, s, o) {
  let a = 0, amp = 1, n = 0, f = 1;
  for (let k = 0; k < o; k++) { a += vn2(x * f, y * f, s + k * 13.1) * amp; n += amp; amp *= .5; f *= 2.07; }
  return a / n;
}

export const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
