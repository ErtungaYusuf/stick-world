// You, the stranger: belongings, health, the crafting bench and recipe book, messages from the world.
// Everything is decided on the server (the same physics as for everyone); this file only shows it and sends intents.
import { G } from './state.js';

const ICON = {
  berry: '🫐', fruit: '🍎', mushroom: '🍄', redcap: '🍄', herb: '🌿', grain: '🌾', seed: '🌱', fish: '🐟', meat: '🥩', flesh: '🥩', cooked: '🍖',
  bread: '🫓', fat: '🧈', stick: '🪵', stone: '🪨', flint: '🔷', clay: '🟫', sand: '⏳', fiber: '🧶', resin: '🍯', fur: '🦬', bone: '🦴',
  'ore:copper': '🟠', 'ore:tin': '⚫', 'ore:iron': '🟤', 'ore:gold': '🟡', sulfur: '💛', saltpeter: '⚪',
  blade: '🔪', spear: '🔱', axe: '🪓', pick: '⛏', rope: '➰', glue: '🫙', net: '🕸', bow: '🏹', arrows: '➶', pot: '🏺', waterpot: '💧',
  cloak: '🧥', 'hide armor': '🦺', 'iron armor': '🛡', torch: '🔥', charcoal: '◼', bandage: '🩹', medicine: '💊',
  copper: '🟧', tin: '⬛', bronze: '🟫', iron: '⬜', gold: '🟨', 'metal blade': '🗡', 'metal axe': '🪓', 'metal spear': '🔱', 'metal pick': '⛏',
  sword: '⚔', scissors: '✂', necklace: '📿', powder: '🧂', bomb: '💣', FIRE: '🔥',
};
const NAME = { berry: 'berries', fruit: 'fruit', mushroom: 'mushrooms', redcap: 'red mushrooms', herb: 'herbs', fish: 'fish', meat: 'raw meat', flesh: 'human flesh',
  cooked: 'cooked meat', bread: 'flatbread', fat: 'animal fat', stick: 'wood', fiber: 'fibre', resin: 'pine resin', fur: 'hide', bone: 'bones',
  'ore:copper': 'copper ore', 'ore:tin': 'tin ore', 'ore:iron': 'iron ore', 'ore:gold': 'gold ore', sulfur: 'sulphur', saltpeter: 'saltpetre',
  blade: 'stone blade', axe: 'stone axe', glue: 'pitch glue', net: 'fishing net', pot: 'clay pot', waterpot: 'pot of water', powder: 'black powder',
  necklace: 'gold necklace', FIRE: 'fire' };
const name = k => NAME[k] || k;
const EDIBLE = new Set(['berry', 'fruit', 'mushroom', 'redcap', 'herb', 'grain', 'seed', 'fish', 'meat', 'flesh', 'cooked', 'bread', 'fat']);
const BUILD = { hut: 'stick 4', house: 'stick 2 · stone 4', store: 'stick 3', wall: 'stone 3', totem: 'stick 2', pen: 'stick 4', dam: 'stone 3 · stick 2', furnace: 'stone 4 · clay 3' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let net = null;
export const send = m => net && net.send({ t: 'act', ...m });
export function attach(n) { net = n; }

// a token kept in this browser makes you the same stranger after a reload
export function token() {
  let t = null;
  try { t = localStorage.getItem('sw-token'); } catch { /* storage blocked */ }
  if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem('sw-token', t); } catch { /* fine */ } }
  return t;
}

// ───────── the HUD: health, what you're doing, what just happened ─────────
const hud = document.createElement('div');
hud.id = 'me';
hud.innerHTML = `<div class="task"><span class="what"></span><span class="bar"><span></span></span></div>
  <div class="hp"><span class="fill"></span><span class="txt"></span></div>
  <div class="gear"></div><div class="hint">E use · R strike · Q throw bomb · I bag &amp; crafting</div>`;
document.body.appendChild(hud);
const toasts = document.createElement('div');
toasts.id = 'toasts';
document.body.appendChild(toasts);
const dead = document.createElement('div');
dead.id = 'dead';
document.body.appendChild(dead);

function toast(text, kind) {
  const d = document.createElement('div');
  d.className = 't ' + (kind || 'info');
  d.textContent = text;
  toasts.appendChild(d);
  while (toasts.children.length > 6) toasts.firstChild.remove();
  setTimeout(() => d.classList.add('gone'), 4200);
  setTimeout(() => d.remove(), 5000);
}

export function onMe(m) {
  const first = !G.me;
  G.me = { ...(G.me || {}), ...m, book: m.book || (G.me && G.me.book) || [] };
  for (const t of m.msgs || []) toast(t.text, t.kind);
  if (m.teleport) G.teleport = m.teleport;
  if (first) G.myId = m.id;
  renderHud();
  tidyBench();
  // redraw the bag only when something in it changed (redrawing under the mouse would swallow clicks)
  const sig = JSON.stringify([G.me.inv, G.me.book.length, G.me.fire, G.me.furnace]);
  if (panel.classList.contains('show') && sig !== lastSig) renderPanel();
  lastSig = sig;
}
let lastSig = '';
function renderHud() {
  const me = G.me;
  if (!me) return;
  const hp = Math.max(0, me.hp);
  hud.querySelector('.fill').style.width = Math.round(hp * 100) + '%';
  hud.querySelector('.fill').style.background = `hsl(${Math.round(hp * 120)},70%,45%)`;
  hud.querySelector('.txt').textContent = `${me.name} · ${Math.round(hp * 100)} HP${me.bleed ? ' · bleeding' : ''}`;
  const task = hud.querySelector('.task');
  task.style.opacity = me.task ? 1 : 0;
  if (me.task) { task.querySelector('.what').textContent = me.task.what; task.querySelector('.bar span').style.width = Math.round(me.task.p * 100) + '%'; }
  const n = Object.values(me.inv || {}).reduce((a, b) => a + b, 0);
  hud.querySelector('.gear').innerHTML = [me.weapon && `${ICON[me.weapon] || '•'} ${esc(name(me.weapon))}`, me.armor && `${ICON[me.armor] || '•'} ${esc(name(me.armor))}`,
    `🎒 ${n} thing${n === 1 ? '' : 's'}`, me.furnace ? '🏭 at a furnace' : me.fire ? '🔥 by a fire' : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
  dead.style.opacity = me.alive ? 0 : 1;
  if (!me.alive) dead.innerHTML = `<b>You died.</b><br>back in ${me.respawn}s — your belongings lie with your body`;
}

// ───────── the bag and the bench (I) ─────────
const panel = document.createElement('div');
panel.id = 'bag';
panel.className = 'panel';
document.body.appendChild(panel);
const slots = [null, null, null];
let where = null, selected = null, tab = 'book';

export function toggleBag(on = !panel.classList.contains('show')) {
  panel.classList.toggle('show', on);
  if (on) renderPanel();
}
export const bagOpen = () => panel.classList.contains('show');

function have(k) { return (G.me && G.me.inv[k]) || 0; }
function usedInSlots(k) { return slots.filter(s => s === k).length; }

function renderPanel() {
  const me = G.me;
  if (!me) { panel.innerHTML = '<i>connecting…</i>'; return; }
  if (where === 'furnace' && !me.furnace) where = me.fire ? 'fire' : null;
  if (where === 'fire' && !me.fire) where = null;
  const inv = Object.entries(me.inv || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const known = new Map((me.book || []).map(b => [b.rk, b]));
  const items = inv.map(([k, n]) => `<button class="it${selected === k ? ' sel' : ''}" data-k="${esc(k)}" title="${esc(name(k))}">
      <span class="ic">${ICON[k] || '•'}</span><span class="n">${n - usedInSlots(k)}</span><span class="nm">${esc(name(k))}</span></button>`).join('')
    || '<div class="dim">Your bag is empty. Walk up to plants, trees, rocks, the water or bodies and press E.</div>';
  const sel = selected && have(selected) ? `<div class="selrow"><b>${ICON[selected] || ''} ${esc(name(selected))}</b>
      ${EDIBLE.has(selected) ? '<button data-do="eat">Eat</button>' : ''}
      ${['bandage', 'medicine', 'herb'].includes(selected) ? '<button data-do="treat">Use on me</button>' : ''}
      ${['seed', 'grain'].includes(selected) ? '<button data-do="plant">Plant in front</button>' : ''}
      <button data-do="slot">To bench</button><button data-do="give">Give to nearest</button><button data-do="drop">Throw away</button></div>` : '';
  const bench = slots.map((k, i) => `<button class="slot" data-slot="${i}">${k ? `<span class="ic">${ICON[k] || '•'}</span><span class="nm">${esc(name(k))}</span>` : '<span class="dim">empty</span>'}</button>`).join('<span class="plus">+</span>');
  const W = [['hand', null, true], ['fire', 'fire', me.fire], ['furnace', 'furnace', me.furnace]];
  const stations = W.map(([lbl, w, ok]) => `<button class="st${where === w ? ' on' : ''}" data-where="${w || ''}" ${ok ? '' : 'disabled'} title="${ok ? '' : `you are not at a ${lbl}`}">${lbl === 'hand' ? '✋ by hand' : lbl === 'fire' ? '🔥 in the fire' : '🏭 in the furnace'}</button>`).join('');
  const rk = slots.filter(Boolean).slice().sort().join('+') + (where ? '+' + where : '');
  const hint = slots.some(Boolean) ? (known.has(rk) ? `→ ${ICON[known.get(rk).res] || ''} <b>${esc(name(known.get(rk).res))}</b> (you know this)` : '→ <span class="dim">untried: who knows?</span>') : '<span class="dim">click things in your bag to put them on the bench</span>';
  const book = [...known.values()].map(b => {
    const parts = b.rk.split('+'), w = ['fire', 'furnace'].includes(parts[parts.length - 1]) ? parts.pop() : null;
    const can = (() => { const need = {}; for (const p of parts) need[p] = (need[p] || 0) + 1; return Object.entries(need).every(([k, n]) => have(k) >= n) && (!w || (w === 'fire' ? me.fire : me.furnace)); })();
    return `<button class="rec${can ? '' : ' cant'}" data-rk="${esc(b.rk)}">${parts.map(p => `${ICON[p] || ''} ${esc(name(p))}`).join(' + ')}${w ? ` <i>(${w})</i>` : ''} → <b>${ICON[b.res] || ''} ${esc(name(b.res))}</b>${b.seen ? ` <span class="dim">· seen from ${esc(b.seen)}</span>` : ''}</button>`;
  }).join('') || '<div class="dim">Nothing yet. Try combinations on the bench — or watch the people work: what you see them make, you learn.</div>';
  const builds = Object.entries(BUILD).map(([k, cost]) => `<button class="rec" data-build="${k}"><b>${k}</b> <span class="dim">${cost}</span></button>`).join('');
  panel.innerHTML = `<div class="col bagcol"><h3>Bag</h3><div class="grid">${items}</div>${sel}</div>
    <div class="col"><h3>Bench</h3><div class="bench">${bench}</div><div class="stations">${stations}</div>
      <div class="hint">${hint}</div><button class="go" data-do="craft" ${slots.some(Boolean) ? '' : 'disabled'}>Combine</button><button class="clear" data-do="clear">Clear</button>
      <div class="tabs"><button class="${tab === 'book' ? 'on' : ''}" data-tab="book">📖 Recipes you know (${known.size})</button><button class="${tab === 'build' ? 'on' : ''}" data-tab="build">🏗 Build</button></div>
      <div class="list">${tab === 'book' ? book : `<div class="dim">Lays out a building site in front of you; then press E at it to raise it.</div>${builds}`}</div>
    </div>`;
}
panel.addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.k) { selected = d.k; toSlot(d.k); }
  else if (d.slot) { slots[+d.slot] = null; }
  else if (d.where !== undefined) where = d.where || null;
  else if (d.tab) tab = d.tab;
  else if (d.rk) {   // fill the bench from the book
    const parts = d.rk.split('+'), w = ['fire', 'furnace'].includes(parts[parts.length - 1]) ? parts.pop() : null;
    for (let i = 0; i < 3; i++) slots[i] = parts[i] || null;
    where = w;
  } else if (d.build) send({ a: 'build', k: d.build });
  else if (d.do === 'craft') send({ a: 'craft', items: slots.filter(Boolean), where });
  else if (d.do === 'clear') slots.fill(null);
  else if (d.do === 'slot') toSlot(selected);
  else if (selected && ['eat', 'treat', 'plant', 'give', 'drop'].includes(d.do)) send({ a: d.do, item: selected, n: 1 });
  renderPanel();
});
function toSlot(k) {
  if (!k || have(k) - usedInSlots(k) <= 0) return;
  const i = slots.indexOf(null);
  if (i >= 0) slots[i] = k;
}
// keep the bench honest when things run out
export function tidyBench() {
  for (let i = 0; i < 3; i++) if (slots[i] && usedInSlots(slots[i]) > have(slots[i])) slots[i] = null;
}

// where the mouse points, on the ground
export function mouseGround() {
  const c = G.cam, TILT = .62;
  return { x: (G.mouse.x - G.W / 2) / c.zoom + c.x, z: (G.mouse.y - G.H / 2) / c.zoom / TILT + c.z };
}
