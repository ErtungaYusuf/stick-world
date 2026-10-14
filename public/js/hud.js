// Lighting, compass, speech bubbles, tooltip (GET /api/people/:id) and stats panel (GET /api/stats, /api/events).
import { TAU, clamp, smooth, mixc, rgb } from '/shared/core.js';
import { G, ctx, dark, dctx, proj, TILT } from './state.js';
import { api } from './net.js';

export function nightAmount() { return 1 - smooth(-.15, .25, Math.sin(G.dayT * TAU)); }

export function lighting(flies, lights, player) {
  const { W, H, DPR } = G, Z = G.cam.zoom;
  const sunH = Math.sin(G.dayT * TAU), night = nightAmount(), dusk = Math.exp(-Math.pow(sunH / .25, 2));
  if (dusk > .02) { ctx.fillStyle = `rgba(255,140,70,${dusk * .13})`; ctx.fillRect(0, 0, W, H); }
  if (night > .02) {
    dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = `rgba(8,12,38,${night * .8})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => {
      const g = dctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g; dctx.beginPath(); dctx.arc(x, y, r, 0, TAU); dctx.fill();
    };
    const [px, py] = proj(player.x, 20, player.z);
    hole(px, py, 150 * Z, .75);
    for (const f of flies) hole(f.sx, f.sy, 34 * Z, .6 * f.a);
    for (const l of lights) hole(l.sx, l.sy, l.r, l.a);
    ctx.drawImage(dark, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';   // warm firelight tint
    for (const l of lights) {
      const g = ctx.createRadialGradient(l.sx, l.sy, 0, l.sx, l.sy, l.r * .8);
      g.addColorStop(0, `rgba(255,140,50,${.22 * night})`); g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.sx, l.sy, l.r * .8, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  if (night > .1) {   // firefly sparks
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) {
      const g = ctx.createRadialGradient(f.sx, f.sy, 0, f.sx, f.sy, 9 * Z);
      g.addColorStop(0, `rgba(220,255,140,${f.a * .7})`); g.addColorStop(1, 'rgba(220,255,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.sx, f.sy, 9 * Z, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

export function drawHearts() {
  const Z = G.cam.zoom;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(9 * Z)}px "Segoe UI Symbol","Segoe UI",sans-serif`;
  for (const h of G.hearts) {
    if (h.t < 0) continue;
    const [x, y] = proj(h.x + Math.sin(h.t * 5 + h.y) * 3, h.y, h.z);
    ctx.fillStyle = `rgba(${h.c},${1 - h.t / 1.6})`;
    ctx.fillText(h.ch, x, y);
  }
}

export function drawBubbles(b) {
  const k = clamp(G.cam.zoom, .8, 2.2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(10 * k)}px "Segoe UI Symbol","Segoe UI",sans-serif`;
  for (const v of G.people.values()) {
    const n = v.net;
    if (!n.bub || v.x < b.x0 || v.x > b.x1 || v.z < b.z0 || v.z > b.z1) continue;
    const a = Math.min(1, n.bubT / .3), pop = 1 + Math.max(0, n.bubT - 1.3) * 1.5;
    const [x, y0] = proj(v.x, (v.headTop || 45) + 6, v.z), y = y0 - 9 * k;
    const w = 20 * k * pop, h = 15 * k * pop;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,.93)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 5 * k); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 3 * k, y + h / 2 - 1); ctx.lineTo(x + 1 * k, y + h / 2 + 5 * k); ctx.lineTo(x + 3 * k, y + h / 2 - 1); ctx.fill();
    ctx.fillStyle = n.bub === '♥' ? '#e2456b' : '#2a2d3a';
    ctx.fillText(n.bub, x, y + .5);
  }
  ctx.globalAlpha = 1;
}

export function drawCompass(player) {
  const cx = G.W - 62, cy = 64, r = 38;
  ctx.fillStyle = 'rgba(20,25,35,.35)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, TAU); ctx.stroke();
  ctx.font = '700 12px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [l, a, col] of [['N', -Math.PI / 2, '#ff8a7a'], ['E', 0, '#fff'], ['S', Math.PI / 2, '#fff'], ['W', Math.PI, '#fff']]) {
    ctx.fillStyle = col; ctx.fillText(l, cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13));
  }
  const a = player.heading;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15);
  ctx.lineTo(cx + Math.cos(a + 2.5) * 6, cy + Math.sin(a + 2.5) * 6);
  ctx.lineTo(cx + Math.cos(a - 2.5) * 6, cy + Math.sin(a - 2.5) * 6);
  ctx.fill();
  const ns = Math.round(-player.z / 10), ew = Math.round(player.x / 10);
  const txt = `${Math.abs(ns)} m ${ns >= 0 ? 'North' : 'South'}  ·  ${Math.abs(ew)} m ${ew >= 0 ? 'East' : 'West'}`;
  ctx.font = '600 13px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillText(txt, G.W - 19, cy + r + 21);
  ctx.fillStyle = '#fff'; ctx.fillText(txt, G.W - 20, cy + r + 20);
}

// ───────── hover / follow card, backed by the REST API ─────────
const details = new Map();   // id -> { data, at, loading }
function detailsFor(id) {
  let d = details.get(id);
  const now = performance.now();
  if (!d) { d = { data: null, at: 0, loading: false }; details.set(id, d); }
  if (!d.loading && now - d.at > 1000) {
    d.loading = true;
    api(`/people/${id}`).then(data => { d.data = data; }).catch(() => {}).finally(() => { d.loading = false; d.at = performance.now(); });
  }
  return d.data;
}

export function pickHover() {
  G.hovered = null;
  let bd = 1e9;
  for (const v of G.people.values()) {
    const [sx, sy] = proj(v.x, v.y + 26 * v.scale, v.z);
    const d = Math.hypot(sx - G.mouse.x, sy - G.mouse.y), r = 24 * v.scale * G.cam.zoom + 8;
    if (d < r && d < bd) { bd = d; G.hovered = v; }
  }
}

function cardLines(d) {
  if (!d) return ['Loading…'];
  const kids = d.children.length ? `Children: ${d.children.length} (${d.children.slice(0, 3).map(c => c.name.split(' ')[0]).join(', ')}${d.children.length > 3 ? '…' : ''})` : '';
  return [
    d.name,
    `${d.sex} · ${d.age} yrs · ${d.stage}`,
    d.alive ? `Doing: ${d.doing}` : `Died in year ${d.diedYear}`,
    d.spouse ? `Spouse: ${d.spouse.name}` : d.courting ? `Courting ${d.courting}` : d.age >= 18 ? 'Single' : '',
    kids,
    d.pregnantMonth ? `Pregnant · month ${d.pregnantMonth}` : '',
    d.founder ? 'One of the village founders' : `Mother: ${d.mother ? d.mother.name : '?'} · Father: ${d.father ? d.father.name : '?'}`,
  ].filter(Boolean);
}

export function drawTooltip() {
  const v = G.hovered || G.follow;
  if (!v) return;
  const Z = G.cam.zoom, [gx, gy] = proj(v.x, 0, v.z);
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(gx, gy, 13 * v.scale * Z, 13 * v.scale * Z * TILT, 0, 0, TAU); ctx.stroke();

  const lines = cardLines(detailsFor(v.id));
  lines.push(G.follow === v && !G.hovered ? 'Following · move to release the camera' : 'Click to follow with the camera');
  ctx.font = '600 13px "Segoe UI",system-ui,sans-serif';
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 26, h = lines.length * 19 + 14;
  let x = G.hovered ? G.mouse.x + 18 : G.W - w - 20, y = G.hovered ? G.mouse.y + 18 : 150;
  x = Math.min(x, G.W - w - 10); y = Math.min(y, G.H - h - 10);
  ctx.fillStyle = 'rgba(18,22,32,.85)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = rgb(mixc(v.ink, [255, 255, 255], .6)); ctx.fillRect(x, y + 8, 3, h - 16);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    ctx.font = i === 0 ? '700 14px "Segoe UI",system-ui,sans-serif' : last ? 'italic 500 12px "Segoe UI",system-ui,sans-serif' : '500 13px "Segoe UI",system-ui,sans-serif';
    ctx.fillStyle = last ? 'rgba(255,255,255,.6)' : i === 2 ? '#ffd88a' : '#fff';
    ctx.fillText(l, x + 13, y + 8 + i * 19);
  });
}

// ───────── stats panel (polled from the API) ─────────
const statsEl = document.getElementById('stats'), statusEl = document.getElementById('status');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function startStatsPolling() {
  const poll = async () => {
    try {
      const [s, ev] = await Promise.all([api('/stats'), api('/events?limit=6')]);
      statsEl.innerHTML =
        `<b>Year ${s.year}</b>${s.timeScale > 1 ? ` <b>(×${s.timeScale})</b>` : ''} &nbsp;·&nbsp; Population <b>${s.population}</b> (${s.men} men, ${s.women} women, ${s.minors} under 18) &nbsp;·&nbsp; ${s.couples} couples<br>` +
        `Births <b>${s.births}</b> &nbsp;·&nbsp; Deaths <b>${s.deaths}</b> &nbsp;·&nbsp; 🫐 Food <b>${s.food}</b> &nbsp;·&nbsp; 🪵 Wood <b>${s.wood}</b> &nbsp;·&nbsp; 💧 Water <b>${s.water}</b>` +
        (s.population === 0 ? ' &nbsp;·&nbsp; <b>The village has died out</b>' : '') +
        `<div class="log">${ev.map(e => `<div>${esc(e.text)}</div>`).join('')}</div>`;
    } catch { /* server unreachable: the status banner already says so */ }
  };
  poll();
  setInterval(poll, 1000);
}
export function setOnline(on) {
  G.online = on;
  statusEl.textContent = on ? '' : 'Server offline — reconnecting…';
  statusEl.classList.toggle('show', !on);
}
