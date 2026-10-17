// Lighting, compass, speech bubbles, tooltip (GET /api/people/:id) and stats panel (GET /api/stats, /api/events).
import { TAU, clamp, smooth, mixc, rgb } from '/shared/core.js';
import { G, ctx, dark, dctx, proj, TILT } from './state.js';
import { api } from './net.js';

export function nightAmount() { return 1 - smooth(-.15, .25, Math.sin(G.dayT * TAU)); }

// Soft round glows are rendered once and stamped (creating gradients every frame is slow)
function glowSprite(rgbStr) {
  const c = document.createElement('canvas'), n = 64;
  c.width = c.height = n * 2;
  const g = c.getContext('2d'), gr = g.createRadialGradient(n, n, 0, n, n, n);
  gr.addColorStop(0, `rgba(${rgbStr},1)`); gr.addColorStop(.5, `rgba(${rgbStr},.5)`); gr.addColorStop(1, `rgba(${rgbStr},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, n * 2, n * 2);
  return c;
}
const HOLE = glowSprite('0,0,0'), WARM = glowSprite('255,140,50'), FLY = glowSprite('220,255,140');
const stampGlow = (g, img, x, y, r, a) => { if (r < .5 || a <= 0) return; g.globalAlpha = a; g.drawImage(img, x - r, y - r, r * 2, r * 2); };

// Night: a dark layer (at a quarter of the screen resolution: it is all soft gradients) with holes for every light
export function lighting(flies, lights, player) {
  const { W, H } = G, Z = G.cam.zoom;
  const sunH = Math.sin(G.dayT * TAU), night = nightAmount(), dusk = Math.exp(-Math.pow(sunH / .25, 2));
  if (dusk > .02) { ctx.fillStyle = `rgba(255,140,70,${dusk * .13})`; ctx.fillRect(0, 0, W, H); }
  if (night > .02) {
    const q = dark.width / W;
    dctx.setTransform(q, 0, 0, q, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.globalAlpha = 1;
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = `rgba(8,12,38,${night * .8})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const [px, py] = proj(player.x, 20, player.z);
    stampGlow(dctx, HOLE, px, py, 150 * Z, .75);
    for (const f of flies) stampGlow(dctx, HOLE, f.sx, f.sy, 34 * Z, .6 * f.a);
    for (const l of lights) stampGlow(dctx, HOLE, l.sx, l.sy, l.r, l.a);
    dctx.globalAlpha = 1;
    ctx.drawImage(dark, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';   // warm firelight tint
    for (const l of lights) stampGlow(ctx, WARM, l.sx, l.sy, l.r * .8, .22 * night);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  if (night > .1 && flies.length) {   // firefly sparks
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) stampGlow(ctx, FLY, f.sx, f.sy, 9 * Z, f.a * .7);
    ctx.globalAlpha = 1;
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
  if (!d.alive) return [d.name, `Died in year ${d.diedYear}${d.cause ? ` (${d.cause})` : ''} at ${d.age}`, d.role ? `Was a ${d.role}` : ''].filter(Boolean);
  const kids = d.children.length ? `Children: ${d.children.length} (${d.children.slice(0, 3).map(c => c.name.split(' ')[0]).join(', ')}${d.children.length > 3 ? '…' : ''})` : '';
  const t = d.traits;
  const temper = t && [t.iq > 70 && 'clever', t.iq < 30 && 'dim', t.temper > 65 && 'hot-headed', t.temper < 20 && 'gentle', t.empathy > 70 && 'kind',
    t.empathy < 25 && 'cold-hearted', t.social > 70 && 'sociable', t.social < 25 && 'loner', t.curious > 70 && 'curious', t.greed > 70 && 'greedy'].filter(Boolean);
  const n = d.needs, meter = v => v < 30 ? `${v}%!` : `${v}%`;
  const carry = Object.entries(d.carrying || {});
  return [
    d.name,
    `${d.sex} · ${d.age} yrs · ${d.stage}${d.role && d.role !== 'child' && d.role !== 'baby' ? ` · ${d.role}` : ''}${d.health < 70 ? ` · hurt (${d.health}%)` : ''}${d.bleeding ? ' · bleeding' : ''}`,
    `Doing: ${d.doing}`,
    `Purpose: ${d.goal.replace(/^to /, '')}`,
    `Mood: ${d.mood}${d.sick ? ` · ${d.sick}` : ''}`,
    n ? `Food ${meter(n.food)} · Water ${meter(n.water)} · Warmth ${meter(n.warmth)} · Energy ${meter(n.energy)}` : '',
    d.loves && d.loves.length ? `Loves: ${d.loves.join(', ')}` : '',
    d.hates && d.hates.length ? `Hates: ${d.hates.join(', ')}` : '',
    ...(d.beliefs || []).slice(0, 4).map((b, i) => `${i ? '          ' : 'Believes: '}${b}`),
    d.recipes && d.recipes.length ? `Can make: ${d.recipes.slice(0, 4).join(', ')}${d.recipes.length > 4 ? '…' : ''}` : '',
    carry.length ? `Carries: ${carry.slice(0, 6).map(([k, v]) => `${v} ${k}`).join(', ')}${carry.length > 6 ? '…' : ''}` : 'Carries nothing',
    d.faith ? `Faith: ${d.faith}` : d.sacred ? `Reveres ${d.sacred}` : '',
    d.band ? `Band: ${d.band}` : '',
    d.followers ? `👑 ${d.followers} follow ${d.sex === 'Male' ? 'him' : 'her'}` : '',
    d.follows ? `Follows ${d.follows}` : '',
    d.kills ? `⚔ Has killed ${d.kills}` : '',
    d.thefts ? `🦹 Has stolen ${d.thefts} times` : '',
    d.partner ? `Lover: ${d.partner}` : '',
    kids,
    d.pregnant ? `Pregnant · month ${d.pregnant}` : '',
    d.founder ? 'One of the founders' : `Mother: ${d.mother ? d.mother.name : '?'} · Father: ${d.father ? d.father.name : '?'}`,
    temper && temper.length ? `Nature: ${temper.join(', ')}` : '',
    ...(d.story || []).map((s, i) => `${i ? '          ' : 'Life: '}year ${s.y} · ${s.t}`),
  ].filter(Boolean);
}

export function drawTooltip() {
  if (G.menuOpen) return;
  const v = G.hovered || G.follow;
  if (!v) return;
  const Z = G.cam.zoom, [gx, gy] = proj(v.x, 0, v.z);
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(gx, gy, 13 * v.scale * Z, 13 * v.scale * Z * TILT, 0, 0, TAU); ctx.stroke();

  const lines = cardLines(detailsFor(v.id));
  lines.push(G.follow === v && !G.hovered ? 'Following · move to release the camera' : 'Click: talk · give · strike · follow');
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
      const [s, ev, evo] = await Promise.all([api('/stats'), api('/events?limit=6'), api('/evolve').catch(() => null)]);
      const SEASON_ICON = { spring: '🌱', summer: '☀', autumn: '🍂', winter: '❄' };
      const sep = ' &nbsp;·&nbsp; ';
      statsEl.innerHTML =
        `<b>Year ${s.year}</b> ${SEASON_ICON[s.season] || ''} ${s.season}${s.storm ? ' ⛈' : s.rain ? ' 🌧' : ''}${s.speed !== 1 ? `${sep}<b>${s.speed === 0 ? '⏸ paused' : `⏩ ×${s.speed}`}</b>` : ''}${sep}Population <b>${s.population}</b> (${s.men} men, ${s.women} women, ${s.minors} young)<br>` +
        `👶 Births <b>${s.births}</b>${sep}✝ Deaths <b>${s.deaths}</b>${sep}⚔ Fights <b>${s.fights}</b>${s.killings ? ` (<b style="color:#ff9a8a">${s.killings} killed</b>)` : ''}${sep}🦹 Thefts <b>${s.thefts}</b>${sep}🎁 Gifts <b>${s.gifts}</b><br>` +
        `💡 Inventions <b>${s.inventions}</b>${sep}🏠 Buildings <b>${s.buildings}</b>${sep}⚱ Graves <b>${s.graves}</b>${sep}☠ Bodies lying <b>${s.corpses}</b>${sep}🌱 Crops <b>${s.crops}</b>${sep}🐾 ${s.animals} animals${s.tame ? ` (${s.tame} tame)` : ''}<br>` +
        `👥 Bands <b>${s.bands}</b>${sep}🙏 Faiths <b>${s.faiths}</b>${sep}🏘 Settlements <b>${s.settlements}</b>${s.wars ? `${sep}<b style="color:#ff9a8a">⚔ ${s.wars} war${s.wars > 1 ? 's' : ''}</b>` : ''}${s.wildfires ? `${sep}<b style="color:#ffb070">🔥 ${s.wildfires} burning</b>` : ''}` +
        `${sep}👑 ${s.chief ? `<b>${esc(s.chief.name)}</b> (${s.chief.followers} follow)` : 'no leader'}` +
        (s.hungry || s.thirsty || s.freezing || s.sick ? `<br><span style="color:#ffb3a0">${[s.hungry && `${s.hungry} hungry`, s.thirsty && `${s.thirsty} thirsty`, s.freezing && `${s.freezing} freezing`, s.sick && `${s.sick} sick${s.plague ? ` (${esc(s.plague.name)})` : ''}`].filter(Boolean).join(' · ')}</span>` : '') +
        (s.population === 0 ? `${sep}<b>Everyone has died out</b>` : '') +
        (evo && evo.running ? `<br><b style="color:#b9f0a8">🧬 Evolving: ${Math.floor(evo.done)}/${evo.total} worlds${evo.rounds > 1 ? ` · round ${evo.round}/${evo.rounds}` : ''}${evo.best ? ` · best so far ${evo.best.pop} alive` : ''}</b>` : '') +
        `<div class="log">${ev.map(e => `<div>${esc(e.text)}</div>`).join('')}</div>`;
    } catch { /* server unreachable: the status banner already says so */ }
  };
  poll();
  setInterval(poll, 1000);
}
// ───────── society panel (G): religions, clans, ideologies, technology — GET /api/society ─────────
const socEl = document.getElementById('society');
let socTimer = null;
const bar = (n, max, color) => `<span class="bar"><span style="width:${Math.round(100 * n / Math.max(1, max))}%;background:${color}"></span></span>`;
async function refreshSociety() {
  try {
    const s = await api('/society');
    const faiths = s.faiths.filter(f => f.active), gone = s.faiths.filter(f => !f.active);
    const maxF = Math.max(1, ...faiths.map(f => f.believers)), maxB = Math.max(1, ...s.bands.map(b => b.members));
    const maxG = Math.max(1, ...s.goals.map(g => g.count)), maxR = Math.max(1, ...s.roles.map(r => r.count));
    socEl.innerHTML =
      `<h3>Bands</h3>` +
      (s.bands.length ? s.bands.map(b => `<div class="row"><b style="color:${b.color}">■ ${esc(b.name)}</b> ${bar(b.members, maxB, b.color)} ${b.members}
        <div class="sub">${b.chief ? `${esc(b.chief)} is followed by ${b.followers}` : 'nobody leads'} · since year ${b.year}</div></div>`).join('')
        : '<div class="sub">No lasting friendships yet.</div>') +
      (s.wars.length ? `<div class="row feud">${s.wars.map(w => `⚔ ${esc(w.a)} vs ${esc(w.b)} since year ${w.since} (${w.deaths} dead)`).join('<br>')}</div>` : '') +
      `<h3>Faiths</h3>` +
      (faiths.length ? faiths.map(f => `<div class="row"><b style="color:${f.color}">${f.symbol} ${esc(f.name)}</b> ${bar(f.believers, maxF, f.color)} ${f.faithful} pray · ${f.believers} believe
        <div class="sub">reverence for ${esc(f.of)} · first prayed by ${esc(f.founder)} in year ${f.year}</div></div>`).join('')
        : '<div class="sub">Nobody prays together (yet).</div>') +
      (gone.length ? `<div class="sub">Forgotten: ${gone.map(f => `${f.symbol} ${esc(f.name)}`).join(', ')}</div>` : '') +
      `<h3>What people live for</h3>` +
      s.goals.map(g => `<div class="row">${esc(g.name)} ${bar(g.count, maxG, '#8fb0d8')} ${g.count}</div>`).join('') +
      `<h3>What people actually do</h3>` +
      s.roles.map(r => `<div class="row">${esc(r.name)} ${bar(r.count, maxR, '#c99ae8')} ${r.count}</div>`).join('') +
      `<h3>Needs</h3>` +
      `<div class="row">Food ${bar(s.needs.food, 100, '#d8344a')} ${s.needs.food}%</div>` +
      `<div class="row">Water ${bar(s.needs.water, 100, '#4aa8d8')} ${s.needs.water}%</div>` +
      `<div class="row">Warmth ${bar(s.needs.warmth, 100, '#f2862e')} ${s.needs.warmth}%</div>` +
      `<h3>Discoveries</h3>` +
      (s.knowledge.length ? s.knowledge.map(k => `<div class="row"${k.knowers ? '' : ' style="opacity:.55"'}><b>${k.knowers ? '✓' : '✝'} ${esc(k.name)}</b> ${bar(k.knowers, Math.max(1, k.of), k.knowers ? '#ffd36a' : '#777')} ${k.knowers}/${k.of}
        <div class="sub">${esc(k.how)} · ${k.by === 'the ancestors' ? 'known since the beginning' : `found by ${esc(k.by)} in year ${k.year}`}${k.knowers ? '' : ' · forgotten'}</div></div>`).join('') : '<div class="sub">Nothing yet.</div>') +
      (s.strains.length ? `<h3>Sicknesses</h3>` + s.strains.map(st => `<div class="row">${st.sick ? '🦠' : '·'} ${esc(st.name)}: ${st.sick} sick now, ${st.cases} ever${st.sick ? '' : ''}<div class="sub">deadliness ${st.deadly}% · appeared in year ${st.year}</div></div>`).join('') : '') +
      (s.settlements.length ? `<h3>Settlements</h3>` + s.settlements.map(t => `<div class="row">🏘 ${esc(t.name)}: ${t.buildings} buildings, ${t.pop} people nearby<div class="sub">since year ${t.year}</div></div>`).join('') : '') +
      `<h3>Animals</h3><div class="sub">${Object.entries(s.animals).map(([k, a]) => `${k}: ${a.wild}${a.tame ? ` (+${a.tame} tame)` : ''}`).join(' · ')}</div>` +
      `<div class="sub" style="margin-top:8px">Fights ${s.fights} · killings ${s.killings} · thefts ${s.thefts} · gifts ${s.gifts}</div>`;
  } catch { /* offline */ }
}
export function toggleSociety() {
  const show = !socEl.classList.contains('show');
  socEl.classList.toggle('show', show);
  clearInterval(socTimer);
  if (show) { refreshSociety(); socTimer = setInterval(refreshSociety, 2000); }
}

export function setOnline(on) {
  G.online = on;
  statusEl.textContent = on ? '' : 'Server offline — reconnecting…';
  statusEl.classList.toggle('show', !on);
}
