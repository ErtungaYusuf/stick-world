// Boot, input, game loop and frame composition.
import { clamp, lerp, damp, frac } from '/shared/core.js';
import { createWorld } from '/shared/world.js';
import { G, cv, ctx, dark, resize, proj } from './state.js';
import { api, connect } from './net.js';
import { viewBounds, visibleChunks, pruneTextures, drawGround, drawDecals, COL } from './terrain.js';
import { drawObject, drawShadow, drawFire, drawStock, drawGrave, fireStrength, SHADOW } from './objects.js';
import { drawFigure } from './figure.js';
import { P, updatePlayer, applySnapshot, updateVillagers, updateEffects, handleFx } from './entities.js';
import { lighting, drawHearts, drawBubbles, drawCompass, pickHover, drawTooltip, startStatsPolling, setOnline } from './hud.js';

// ───────── input ─────────
let fastForward = false;
const setTime = on => { if (on !== fastForward) { fastForward = on; api('/time', { scale: on ? 40 : 1 }).catch(() => {}); } };
addEventListener('keydown', e => {
  if (!G.keys[e.code] && e.code === 'Space') P.jumpBuf = .14;
  G.keys[e.code] = true;
  if (e.code === 'KeyT') setTime(true);
  if (e.code === 'KeyH') { const h = document.getElementById('help'); h.style.opacity = h.style.opacity === '0' ? '.92' : '0'; }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') G.cam.tz = clamp(G.cam.tz * 1.25, .55, 3.4);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') G.cam.tz = clamp(G.cam.tz / 1.25, .55, 3.4);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { G.keys[e.code] = false; if (e.code === 'KeyT') setTime(false); });
addEventListener('blur', () => { for (const k in G.keys) G.keys[k] = false; setTime(false); });
addEventListener('wheel', e => { e.preventDefault(); G.cam.tz = clamp(G.cam.tz * Math.exp(-e.deltaY * .0012), .55, 3.4); }, { passive: false });
addEventListener('mousemove', e => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; });
cv.addEventListener('click', () => { G.follow = G.hovered; });
addEventListener('resize', resize);

// ───────── frame ─────────
function render() {
  const { W, H } = G;
  if (!W || !H || !dark.width) return;   // minimised / zero-size window
  ctx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
  const b = viewBounds();
  const vis = visibleChunks(b, 260, 4);
  drawGround(vis);
  drawDecals(vis, b, P);

  const list = [], flies = [];
  const zMax = b.z1 + 200, t = G.time;
  for (const { data } of vis) {
    for (const o of data.objs) if (o.x > b.x0 - 40 && o.x < b.x1 + 40 && o.z > b.z0 - 20 && o.z < zMax) list.push(o);
    for (const f of data.flies) {
      const [sx, sy] = proj(f.x + Math.sin(t * .5 + f.p) * 25, 14 + Math.sin(t * .9 + f.p) * 7, f.z + Math.cos(t * .4 + f.p * 2) * 18);
      if (sx > -50 && sx < W + 50 && sy > -50 && sy < H + 50) flies.push({ sx, sy, a: clamp(.35 + .65 * Math.sin(t * 2.4 + f.p), 0, 1) });
    }
  }
  ctx.fillStyle = 'rgba(25,45,25,.22)';
  for (const o of list) if (SHADOW[o.t]) drawShadow(o.x, o.z, SHADOW[o.t] * o.s);
  for (const p of G.particles) {
    const k = p.life / p.max, [x, y] = proj(p.x, p.y, p.z);
    ctx.fillStyle = `rgba(${p.col},${(1 - k) * .7})`;
    ctx.beginPath(); ctx.arc(x, y, p.r * (1 + k * .8) * G.cam.zoom, 0, 7); ctx.fill();
  }

  // depth-sorted billboards: world objects, village props, people
  const inView = (x, z) => x > b.x0 - 30 && x < b.x1 + 30 && z > b.z0 - 20 && z < b.z1 + 80;
  for (const v of G.people.values()) if (inView(v.x, v.z)) list.push({ t: 'person', z: v.z + (v.held ? 1 : 0), v });
  for (const v of G.others.values()) if (inView(v.x, v.z)) list.push({ t: 'other', z: v.z, v });
  for (const g of G.ghosts) list.push({ t: 'ghost', z: g.e.z, g });
  for (const g of G.graves) if (inView(g.x, g.z)) list.push({ ...g, t: 'grave' });
  const vil = G.village;
  if (vil) {
    if (inView(vil.x, vil.z)) list.push({ t: 'fire', x: vil.x, z: vil.z });
    for (const [kind, p] of [['food', vil.foodPos], ['wood', vil.woodPos], ['water', vil.waterPos]])
      if (inView(p.x, p.z)) list.push({ t: 'stock', kind, x: p.x, z: p.z });
  }
  list.push({ t: 'player', z: P.z });
  list.sort((a, c) => a.z - c.z);
  for (const o of list) {
    switch (o.t) {
      case 'player': drawFigure(P, { ink: COL.ink, marker: true }); break;
      case 'person': drawFigure(o.v, { ink: o.v.ink, female: o.v.net.sex === 'F', preg: !!o.v.net.preg }); break;
      case 'other': drawFigure(o.v, { ink: [70, 74, 90] }); break;
      case 'ghost': drawFigure(o.g.e, { ink: [235, 240, 255], female: o.g.female, alpha: .55 * (1 - o.g.t / 2) }); break;
      case 'grave': drawGrave(o); break;
      case 'fire': drawFire(o); break;
      case 'stock': drawStock(o); break;
      default: drawObject(o, P);
    }
  }
  drawHearts();
  drawBubbles(b);

  const lights = [];
  if (vil) {
    const [sx, sy] = proj(vil.x, 10, vil.z);
    lights.push({ sx, sy, r: (120 + 80 * fireStrength() + Math.sin(t * 9) * 6 + Math.sin(t * 23) * 4) * G.cam.zoom, a: .95 });
  }
  lighting(flies, lights, P);
  pickHover();
  drawTooltip();
  drawCompass(P);
  pruneTextures();
}

let net = null, sendT = 0, last = performance.now(), started = false;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now; G.lastDt = dt; G.time += dt;
  if (updatePlayer(dt) && !started) {
    started = true;
    setTimeout(() => { document.getElementById('help').style.opacity = '0'; }, 9000);
  }
  updateVillagers(dt);
  updateEffects(dt);
  // send our position to the server ~10×/s (villagers make room for us; other players see us)
  if ((sendT += dt) > .1 && net) { sendT = 0; net.send({ t: 'player', x: P.x, z: P.z, h: P.heading, y: P.y, vx: P.vx, vz: P.vz }); }

  const c = G.cam, ct = G.follow && G.people.has(G.follow.id) ? G.follow : (G.follow = null, P);
  c.x += (ct.x + ct.vx * .3 - c.x) * damp(4.5, dt);
  c.z += (ct.z + ct.vz * .3 - c.z) * damp(4.5, dt);
  c.zoom = Math.exp(lerp(Math.log(c.zoom), Math.log(c.tz), damp(9, dt)));
  render();
  requestAnimationFrame(frame);
}

async function boot() {
  resize();
  const info = await api('/world');
  G.world = createWorld(info.seed);
  Object.assign(P, info.spawn);
  G.cam.x = P.x; G.cam.z = P.z;
  applySnapshot(await api('/state'));
  net = connect({
    hello: m => { G.myId = m.id; if (G.world.seed !== m.seed) location.reload(); },   // world was reset meanwhile
    state: applySnapshot,
    fx: handleFx,
    reset: () => location.reload(),
    open: () => setOnline(true),
    close: () => setOnline(false),
  });
  startStatsPolling();
  visibleChunks(viewBounds(), 260, 400);   // bake the starting area up front
  requestAnimationFrame(frame);
}
boot().catch(err => {
  setOnline(false);
  document.getElementById('status').textContent = `Could not reach the server (${err.message}). Start it with "npm start".`;
  console.error(err);
});
