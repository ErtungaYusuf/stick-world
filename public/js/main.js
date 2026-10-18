// Boot, input, game loop and frame composition.
import { TAU, clamp, lerp, smooth, damp, mixc, rgb } from '/shared/core.js';
import { createWorld } from '/shared/world.js';
import { G, cv, ctx, dark, resize, proj, seasonTemp } from './state.js';
import { api, connect } from './net.js';
import { viewBounds, visibleChunks, pruneTextures, drawGround, drawDecals, COL, startBaker } from './terrain.js';
import { drawObject, drawShadows, drawNatureLayers, FAR_ZOOM, drawCampfire, drawWildfire, drawStruct, drawCrop, drawBlood, fireStrength } from './objects.js';
import { drawAnimal, drawCarcass, drawFlies } from './beasts.js';
import { drawFigure, newBody } from './figure.js';
import { puff, P, updatePlayer, applySnapshot, updatePeople, updateEffects, handleFx, hsl, growth } from './entities.js';
import { toggleTerminal, isTyping } from './terminal.js';
import { updateSound, toggleMute } from './sound.js';
import { onMe, attach, token, toggleBag, bagOpen, send, mouseGround, onClick, onRightClick, hotbarKey, updateHint, closeMenu } from './player.js';
import { nightAmount, lighting, drawHearts, drawBubbles, drawCompass, pickHover, drawTooltip, startStatsPolling, setOnline, toggleSociety } from './hud.js';

// ───────── input ─────────
let fastForward = false, speedBefore = 1;
const setFast = on => {
  if (on === fastForward) return;
  fastForward = on;
  if (on) speedBefore = G.speed;
  api('/speed', { speed: on ? Math.max(40, G.speed) : speedBefore }).catch(() => {});
};
addEventListener('keydown', e => {
  if (isTyping()) return;
  if (e.code === 'Backquote') { e.preventDefault(); toggleTerminal(); return; }
  if (!G.keys[e.code] && e.code === 'Space') P.jumpBuf = .14;
  G.keys[e.code] = true;
  if (e.code === 'KeyT') setFast(true);
  if (e.code === 'KeyH') { const h = document.getElementById('help'); h.style.opacity = h.style.opacity === '0' ? '.92' : '0'; }
  if (e.code === 'KeyG' && !e.repeat) toggleSociety();
  // you, in the world
  if (e.code === 'KeyE' && !e.repeat) send({ a: 'use' });
  if (e.code === 'KeyR' && !e.repeat) { send({ a: 'strike' }); P.strikeT = .4; }
  if (e.code === 'KeyQ' && !e.repeat) { const m = mouseGround(); send({ a: 'throw', x: m.x, z: m.z }); }
  if ((e.code === 'KeyI' || e.code === 'Tab') && !e.repeat) { e.preventDefault(); toggleBag(); }
  if (e.code === 'Escape') { if (bagOpen()) toggleBag(false); closeMenu(); G.held = null; }
  if (/^Digit[1-9]$/.test(e.code) && !e.repeat) hotbarKey(+e.code.slice(5) - 1);
  if (e.code === 'KeyF' && !e.repeat) { G.director = !G.director; G.dirT = 0; if (!G.director) G.follow = null; banner(G.director ? '🎥 Watching the action — F to stop' : ''); }
  if (e.code === 'KeyM' && !e.repeat) banner(toggleMute() ? '🔇 Sound off — M' : '🔊 Sound on — M', 1.6);
  if (e.code === 'Equal' || e.code === 'NumpadAdd') G.cam.tz = clamp(G.cam.tz * 1.25, .4, 3.4);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') G.cam.tz = clamp(G.cam.tz / 1.25, .4, 3.4);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { G.keys[e.code] = false; if (e.code === 'KeyT') setFast(false); });
addEventListener('blur', () => { for (const k in G.keys) G.keys[k] = false; setFast(false); });
addEventListener('wheel', e => { e.preventDefault(); G.cam.tz = clamp(G.cam.tz * Math.exp(-e.deltaY * .0012), .4, 3.4); }, { passive: false });
addEventListener('mousemove', e => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; });
// the mouse: click to walk / use / talk / give, right-click to strike (see player.js)
cv.addEventListener('click', ev => onClick(ev));
cv.addEventListener('contextmenu', ev => onRightClick(ev));
addEventListener('resize', resize);

// the dead lie where they fell: a body that pales, darkens and turns to bones
const deadBodies = new Map();
function corpseBody(c) {
  let b = deadBodies.get(c.id);
  if (!b) {
    // someone who just died is seen falling: knees buckle, the body drops and lies still
    const fresh = c.rot < .01;
    b = newBody({ x: c.x, z: c.z, heading: c.h, lieA: fresh ? 0 : 1, lieKind: 'down', seed: c.id, fallT: fresh ? 0 : 9 });
    b.scale = growth(c.age) * (c.tall || 1) * (c.sex === 'F' ? .95 : 1);
    b.kid = (1 - growth(c.age)) / .64;
    deadBodies.set(c.id, b);
  }
  return b;
}
function drawCorpse(c) {
  if (G.cam.zoom < .9 && c.rot > .05) {
    const [sx, sy] = proj(c.x, 1.5, c.z), Z = G.cam.zoom, s = growth(c.age) * (c.tall || 1), dx = Math.cos(c.h) * 11 * s * Z, dy = Math.sin(c.h) * 11 * s * Z * .62;
    ctx.strokeStyle = c.rot > 1 ? 'rgba(228,222,205,.8)' : rgb(mixc(hsl(c.hue, .32, .24), [90, 110, 80], smooth(.15, .7, c.rot) * .7));
    ctx.lineWidth = Math.max(1.2, 4.2 * s * Z); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx - dx, sy - dy); ctx.lineTo(sx + dx, sy + dy); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(sx + dx * 1.35, sy + dy * 1.35, 4.5 * s * Z, 0, 7); ctx.fill();
    return;
  }
  const b = corpseBody(c), r = c.rot;
  if (b.fallT < 1.2) {
    b.fallT += G.lastDt;
    const u = Math.min(1, b.fallT / .9);
    b.lieA = u < .35 ? u * .4 : .14 + .86 * ((u - .35) / .65) ** 2;   // sag first, then drop
    b.sq = u < .35 ? -u * .5 : u >= 1 ? 0 : -.18;
    if (u >= 1 && !b.landed) { b.landed = true; puff(c.x, c.z, 8, 40, 14, 2.2, '160,140,110'); }
  }
  if (r < 1.05) {
    const ink = mixc(mixc(hsl(c.hue, .32, .24), [90, 110, 80], smooth(.15, .7, r) * .7), [45, 40, 38], smooth(.6, 1.05, r) * .6);
    drawFigure(b, { ink, female: c.sex === 'F' });
  }
  if (r > .85) {   // bones show through, then remain alone
    const a = smooth(.85, 1.15, r) * (1 - smooth(2.5, 3, r));
    drawFigure(b, { ink: [228, 222, 205], thin: .45, bones: true, alpha: a });
  }
}

// ───────── the director: with F the camera goes wherever the most is happening ─────────
// fights first, then someone beaten down, hunts, births and burials, building, fire-making… and stays a while on each
const DRAMA = { fight: 10, down: 8, bite: 7, hunt: 6, flee: 5, grab: 4, mourn: 4, kindle: 3, worship: 3, love: 0, sleep: 0 };
function interest(v) {
  const n = v.net;
  let k = DRAMA[n.act] ?? (n.act ? 1 : 0);
  if (n.bleed) k += 2;
  if (n.hp < .5) k += 2;
  if (n.preg && n.act) k += .5;
  return k;
}
let wasDirecting = false;
function direct(dt) {
  if (wasDirecting && !G.director) banner('');   // walking takes the camera back
  wasDirecting = G.director;
  if (!G.director) return;
  if ((G.dirT -= dt) > 0) return;
  G.dirT = 1;
  const cur = G.follow && G.people.has(G.follow.id) ? G.follow : null;
  let best = cur, bs = cur ? interest(cur) + 2 + (G.dirHold > 0 ? 6 : 0) : -1;   // don't flit: the current one gets a bonus
  for (const v of G.people.values()) {
    if (v === cur) continue;
    const k = interest(v) - Math.hypot(v.x - G.cam.x, v.z - G.cam.z) / 3000;
    if (k > bs) { bs = k; best = v; }
  }
  if (best !== cur) { G.dirHold = 6; G.follow = best; } else G.dirHold -= 1;
}
let bannerEl = null, bannerT = 0;
function banner(text, secs = 0) {
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:14px;background:rgba(20,22,28,.72);color:#fff;font:600 13px "Segoe UI",sans-serif;pointer-events:none;transition:opacity .3s;z-index:20';
    document.body.appendChild(bannerEl);
  }
  bannerEl.textContent = text; bannerEl.style.opacity = text ? '1' : '0';
  clearTimeout(bannerT);
  if (secs) bannerT = setTimeout(() => { bannerEl.style.opacity = G.director ? '1' : '0'; if (G.director) bannerEl.textContent = '🎥 Watching the action — F to stop'; }, secs * 1000);
}

// ───────── frame ─────────
function render() {
  const { W, H } = G;
  if (!W || !H || !dark.width) return;   // minimised / zero-size window
  PROF.t = performance.now();
  ctx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
  const b = viewBounds();
  const vis = visibleChunks(b, 260, 4);
  mark("chunks");
  drawGround(vis);
  mark("ground");
  // the season on the ground: snow cover where it's cold enough, a russet tinge in autumn
  const snow = smooth(G.world.SNOW + .1, G.world.SNOW - .04, G.world.temp(G.cam.x, G.cam.z) + seasonTemp());
  if (snow > .01 && G.season === 3) { ctx.fillStyle = `rgba(240,245,250,${snow * .55})`; ctx.fillRect(0, 0, W, H); }
  else if (G.season === 2) { ctx.fillStyle = `rgba(190,120,40,${.06 * smooth(0, .5, G.sf)})`; ctx.fillRect(0, 0, W, H); }
  drawDecals(vis, b, P);
  mark("decals");

  const list = [], flies = [];
  const zMax = b.z1 + 200, t = G.time;
  const tiny = G.cam.zoom < .75;   // zoomed far out: little things aren't worth drawing
  const far = G.cam.zoom < FAR_ZOOM;   // further still: plants and rocks come pre-drawn a whole chunk at a time
  for (const { data } of vis) {
    if (!data) continue;   // not generated yet (it will be in a frame or two)
    if (!far) for (const o of data.objs) {
      if (o.x < b.x0 - 40 || o.x > b.x1 + 40 || o.z < b.z0 - 20 || o.z > zMax) continue;
      if (tiny && (o.t === 'mush' || o.t === 'redcap' || o.t === 'herb' || o.t === 'reed' || (o.t === 'tall' && G.cam.zoom < .55))) continue;
      list.push(o);
    }
    if (G.season === 3 || tiny) continue;   // no fireflies in winter (or too small to see)
    for (const f of data.flies) {
      const [sx, sy] = proj(f.x + Math.sin(t * .5 + f.p) * 25, 14 + Math.sin(t * .9 + f.p) * 7, f.z + Math.cos(t * .4 + f.p * 2) * 18);
      if (sx > -50 && sx < W + 50 && sy > -50 && sy < H + 50) flies.push({ sx, sy, a: clamp(.35 + .65 * Math.sin(t * 2.4 + f.p), 0, 1) });
    }
  }
  mark("list");
  drawBlood();
  drawShadows(list);
  if (far) drawNatureLayers(vis);
  mark("nature");
  for (const p of G.particles) {
    const k = p.life / p.max, [x, y] = proj(p.x, p.y, p.z);
    ctx.fillStyle = `rgba(${p.col},${(1 - k) * .7})`;
    ctx.beginPath(); ctx.arc(x, y, p.r * (1 + k * .8) * G.cam.zoom, 0, 7); ctx.fill();
  }
  if (G.clickMark && G.time - G.clickMark.t < .6) {
    const k = (G.time - G.clickMark.t) / .6, [mx, my] = proj(G.clickMark.x, 0, G.clickMark.z), Z = G.cam.zoom;
    ctx.strokeStyle = `rgba(255,240,200,${1 - k})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(mx, my, (6 + k * 10) * Z, (6 + k * 10) * Z * .62, 0, 0, 7); ctx.stroke();
  }
  // bombs: an arc through the air, then a fizzing fuse on the ground
  for (const bm of G.throws) {
    const u = Math.min(1, bm.t / bm.fly);
    const [x, y] = proj(lerp(bm.x0, bm.x, u), 4 + Math.sin(Math.PI * u) * 70, lerp(bm.z0, bm.z, u)), Z = G.cam.zoom;
    ctx.fillStyle = '#26221e'; ctx.beginPath(); ctx.arc(x, y, 4 * Z, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,${150 + Math.random() * 100 | 0},60,.95)`; ctx.beginPath(); ctx.arc(x + 2.5 * Z, y - 4 * Z, (1.2 + Math.random() * 1.6) * Z, 0, 7); ctx.fill();
    if (u >= 1 && Math.random() < .5) puff(bm.x, bm.z, 1, 15, 25, 1, '255,200,120', 6);
  }

  // depth-sorted billboards: world objects, buildings, fires, the living and the dead
  const inView = (x, z) => x > b.x0 - 30 && x < b.x1 + 30 && z > b.z0 - 20 && z < b.z1 + 80;
  for (const v of G.people.values()) if (inView(v.x, v.z)) list.push({ t: 'person', z: v.z + (v.held ? 1 : 0), v });
  for (const v of G.animals.values()) if (inView(v.x, v.z)) list.push({ t: 'animal', z: v.z, v });
  for (const v of G.others.values()) if (inView(v.x, v.z)) list.push({ t: 'other', z: v.z, v });
  for (const c of G.corpses) if (inView(c.x, c.z)) list.push({ t: 'corpse', z: c.z - .5, c });
  for (const s of G.structs) if (inView(s.x, s.z)) list.push({ t: 'struct', z: s.z, s });
  for (const c of G.crops) if (inView(c.x, c.z)) list.push({ t: 'crop', z: c.z, c });
  for (const f of G.fires) if (inView(f.x, f.z)) list.push({ t: f.wild ? 'wildfire' : 'fire', z: f.z + (f.wild ? 2 : 0), f });
  list.push({ t: 'player', z: P.z });
  list.sort((a, c) => a.z - c.z);
  mark("sort");
  for (const o of list) {
    switch (o.t) {
      case 'player': drawFigure(P, { ink: COL.ink, marker: true, boat: P.sailing }); break;
      case 'person': drawFigure(o.v, { boat: !!o.v.net.sail, ink: o.v.ink, female: o.v.net.sex === 'F', preg: !!o.v.net.preg, band: G.bands[o.v.net.grp], items: o.v.items, fol: o.v.fol, chief: G.chiefs.has(o.v.id), load: o.v.load }); break;
      case 'animal': drawAnimal(o.v); break;
      case 'corpse': if (o.c.k === 'person') drawCorpse(o.c); else drawCarcass(o.c); break;
      case 'struct': drawStruct(o.s); break;
      case 'crop': drawCrop(o.c); break;
      case 'fire': drawCampfire(o.f); break;
      case 'wildfire': drawWildfire(o.f); break;
      case 'other': drawFigure(o.v, { ink: [70, 74, 90] }); break;
      default: drawObject(o, P);
    }
  }
  mark("billboards");
  drawHealthBars(inView);
  for (const c of G.corpses) if (inView(c.x, c.z)) drawFlies(c.x, c.z, c.rot, c.id);
  drawHearts();
  drawBubbles(b);

  const lights = [];
  for (const f of G.fires) {
    if (!inView(f.x, f.z) && !f.wild) continue;
    const [sx, sy] = proj(f.x, 10, f.z);
    lights.push({ sx, sy, r: (f.wild ? 210 : 110 + 90 * fireStrength(f)) * (1 + Math.sin(t * 9 + f.id) * .04) * G.cam.zoom, a: .95 });
  }
  for (const fl of G.flashes) {
    const [sx, sy] = proj(fl.x, 20, fl.z);
    lights.push({ sx, sy, r: (fl.big ? 600 : 900) * (1 - fl.t / .8) * G.cam.zoom, a: 1 });
  }
  mark("hud1");
  drawWeather();
  mark("weather");
  lighting(flies, lights, P);
  mark("lighting");
  drawFlashes();
  if (G.hurtT > 0) {   // a red edge when you are hit
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .7);
    g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, `rgba(160,0,0,${G.hurtT * .8})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  pickHover();
  drawTooltip();
  drawCompass(P);
  pruneTextures();
  mark("hud2");
  if (deadBodies.size > 400) for (const id of deadBodies.keys()) if (!G.corpses.some(c => c.id === id)) deadBodies.delete(id);
}

const PROF = { t: 0 };
function mark(k) { const n = performance.now(); PROF[k] = (PROF[k] || 0) + n - PROF.t; PROF.t = n; }
G.prof = () => { const o = {}; for (const k in PROF) if (k !== "t") { o[k] = +PROF[k].toFixed(1); PROF[k] = 0; } return o; };

// a health bar over anyone hurt or in a fight (and wounded animals): green → yellow → red
const FIGHTS = new Set(['fight', 'attack', 'down', 'bite', 'hunt']);
function drawHealthBars(inView) {
  const Z = G.cam.zoom;
  if (Z < .55) return;
  const bar = (x, y, z, hp, wide) => {
    const [sx, sy] = proj(x, y, z), w = wide * Math.min(1.4, Z), h = Math.max(2, 2.6 * Math.min(1.3, Z));
    ctx.fillStyle = 'rgba(20,16,14,.65)'; ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, h + 2);
    const k = clamp(hp, 0, 1);
    ctx.fillStyle = `hsl(${Math.round(k * 120)},75%,48%)`; ctx.fillRect(sx - w / 2, sy, w * k, h);
  };
  for (const v of G.people.values()) {
    const n = v.net;
    if (!inView(v.x, v.z) || n.hp == null || (n.hp > .97 && !FIGHTS.has(n.act))) continue;
    bar(v.x, (v.lieA > .5 ? 16 : 64) * v.scale + 4, v.z, n.hp, 20);
  }
  for (const v of G.others.values()) if (inView(v.x, v.z) && v.net.hp != null && v.net.hp < .97) bar(v.x, 68, v.z, v.net.hp, 20);
  for (const v of G.animals.values()) {
    const n = v.net;
    if (!inView(v.x, v.z) || n.hp == null || n.hp > .97) continue;
    bar(v.x, n.k === 'rabbit' ? 18 : 40, v.z, n.hp, n.k === 'rabbit' ? 10 : 16);
  }
}

// rain streaks, and snow drifting down in a cold winter
const drops = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: .6 + Math.random() * 1.6, p: Math.random() * 7 }));
function drawWeather() {
  const { W, H } = G, t = G.time;
  const cold = smooth(.38, .22, G.world.temp(G.cam.x, G.cam.z) + (G.season === 3 ? seasonTemp() + .12 : 0));
  const snowing = cold > .01 && (G.season === 3 || G.world.temp(G.cam.x, G.cam.z) < G.world.SNOW);
  if (G.rain > .2 && !snowing) {
    const n = Math.floor(drops.length * G.rain);
    if (G.storm) { ctx.fillStyle = 'rgba(20,25,40,.18)'; ctx.fillRect(0, 0, W, H); }
    ctx.strokeStyle = 'rgba(200,215,235,.55)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      const x = ((d.x * W + t * 160 * d.s - G.cam.x * .3) % W + W) % W, y = ((d.y * H + t * 900 * d.s * .5) % H + H) % H;
      ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 13 * d.s);
    }
    ctx.stroke();
  }
  if (snowing) {
    const n = Math.floor(drops.length * Math.max(cold, G.rain) * .8);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < n; i++) {
      const f = drops[i];
      const x = ((f.x * W + Math.sin(t * .8 + f.p) * 20 - G.cam.x * .3) % W + W) % W;
      const y = ((f.y * H + t * 30 * f.s - G.cam.z * .2) % H + H) % H;
      ctx.beginPath(); ctx.arc(x, y, f.s * 1.3, 0, TAU); ctx.fill();
    }
  }
}
// lightning bolts and explosion flashes
function drawFlashes() {
  for (const f of G.flashes) {
    const a = 1 - f.t / .8;
    if (f.bolt) {
      ctx.fillStyle = `rgba(230,235,255,${a * .35})`; ctx.fillRect(0, 0, G.W, G.H);
      if (f.t < .25) {
        const [sx, sy] = proj(f.x, 0, f.z);
        ctx.strokeStyle = `rgba(250,250,255,${a})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx + 40, 0);
        for (let k = 1; k <= 8; k++) ctx.lineTo(sx + 40 - k * 5 + (Math.sin(k * 7.3 + f.x) * 22), sy * k / 8);
        ctx.stroke();
      }
    } else if (f.big) {
      const [sx, sy] = proj(f.x, 10, f.z), r = (30 + f.t * 220) * G.cam.zoom;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(255,250,210,${a})`); g.addColorStop(.4, `rgba(255,160,50,${a * .8})`); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    }
  }
}

// stumps / saplings change rarely: refetch them from the API only when the server's version moves on
let felledBusy = false, felledAt = 0;
async function syncFelled() {
  // at high speed trees fall every few frames: refetch at most every 1.5 s (immediately after a reset)
  if (felledBusy || G.serverFelledVer === G.felledVer || (G.felledVer >= 0 && performance.now() - felledAt < 1500)) return;
  felledBusy = true; felledAt = performance.now();
  try {
    const data = await api('/felled');
    for (const id of G.felled.keys()) { const o = objById(id); if (o) o.felled = false; }
    G.felled = new Map(data.trees.map(t => [t.id, t.stage]));
    for (const id of G.felled.keys()) { const o = objById(id); if (o) o.felled = true; }
    G.felledVer = data.ver;
  } catch { /* try again next frame */ }
  felledBusy = false;
}
function objById(id) {
  const [cx, cz, i] = id.split(':').map(Number);
  return G.world.chunkData(cx, cz).objs[i];
}

let net = null, sendT = 0, last = performance.now(), started = false;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now; G.lastDt = dt; G.time += dt;
  if (updatePlayer(dt) && !started) {
    started = true;
    setTimeout(() => { document.getElementById('help').style.opacity = '0'; }, 9000);
  }
  if (G.director && !G.follow) G.dirT = Math.min(G.dirT, 0);
  if (G.teleport) { P.x = G.teleport.x; P.z = G.teleport.z; G.cam.x = P.x; G.cam.z = P.z; G.teleport = null; }
  updatePeople(dt);
  updateEffects(dt);
  direct(dt);
  updateSound(dt, nightAmount() > .5);
  updateHint();
  syncFelled();
  // send our position to the server ~10×/s (other players see us)
  if ((sendT += dt) > .1 && net) {
    sendT = 0;
    // where the camera looks and how far it sees: the server sends only that part of the world
    const vr = Math.max(G.W, G.H) / G.cam.zoom * .75 + 300;
    net.send({ t: 'player', x: P.x, z: P.z, h: P.heading, y: P.y, vx: P.vx, vz: P.vz, cx: G.cam.x, cz: G.cam.z, vr });
  }

  const c = G.cam, ct = G.follow && G.people.has(G.follow.id) ? G.follow : (G.follow = null, P);
  c.x += (ct.x + ct.vx * .3 - c.x) * damp(4.5, dt);
  c.z += (ct.z + ct.vz * .3 - c.z) * damp(4.5, dt);
  c.zoom = Math.exp(lerp(Math.log(c.zoom), Math.log(c.tz), damp(9, dt)));
  const shake = G.shakeT > 0 ? G.shakeT * 14 : 0, sx = (Math.random() - .5) * shake, sz = (Math.random() - .5) * shake;
  c.x += sx; c.z += sz;
  render();
  adaptResolution(dt * 1000, now);
  c.x -= sx; c.z -= sz;
  requestAnimationFrame(frame);
}

// If frames come too slowly (CPU or graphics card), draw at a slightly lower resolution; go back up once there's headroom.
let costAvg = 8, lastAdapt = 0;
// for the terminal's "fps" / "bench" commands
G.perf = () => ({ frameMs: Math.round(costAvg * 10) / 10, renderScale: G.renderScale, canvas: `${cv.width}×${cv.height}` });
G.bench = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) render(); return (performance.now() - t0) / n; };
function adaptResolution(cost, now) {
  costAvg += (cost - costAvg) * .05;
  if (now - lastAdapt < 1500) return;
  const full = Math.min(window.devicePixelRatio || 1, 2);
  if (document.hidden) return;
  if (costAvg > 26 && G.renderScale > .55) { G.renderScale = Math.max(.55, G.renderScale - .15); lastAdapt = now; resize(); }
  else if (costAvg < 18 && G.renderScale < 1) { G.renderScale = Math.min(1, G.renderScale + .1); lastAdapt = now; resize(); }
  void full;
}

async function boot() {
  resize();
  const info = await api('/world');
  G.world = createWorld(info.seed);
  startBaker(info.seed);
  Object.assign(P, info.spawn);
  P.x += 40;
  G.cam.x = P.x; G.cam.z = P.z;
  applySnapshot(await api('/state'));
  net = connect({
    hello: m => { if (G.world.seed !== m.seed) location.reload(); },   // world was reset meanwhile
    me: onMe,
    state: applySnapshot,
    fx: handleFx,
    reset: () => location.reload(),
    open: () => { setOnline(true); net.send({ t: 'join', token: token() }); },
    close: () => setOnline(false),
  });
  attach(net);
  startStatsPolling();
  visibleChunks(viewBounds(), 260, 400);   // bake the starting area up front
  requestAnimationFrame(frame);
}
boot().catch(err => {
  setOnline(false);
  document.getElementById('status').textContent = `Could not reach the server (${err.message}). Start it with "npm start".`;
  console.error(err);
});
