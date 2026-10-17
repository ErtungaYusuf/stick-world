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
  milk: '🥛', wool: '🐑', yarn: '🧵', cloth: '🧻', tunic: '👕', 'fur coat': '🧥', boots: '🥾', hat: '🎩', needle: '🪡', cheese: '🧀', butter: '🧈',
  salt: '🧂', 'salted meat': '🥓', jerky: '🥓', 'rotten meat': '🤢', flour: '🌫', porridge: '🥣', stew: '🍲', beer: '🍺', wine: '🍷', honey: '🍯',
  quern: '⚙', bowl: '🥣', brick: '🧱', lamp: '🪔', candle: '🕯', hoe: '⛏', sickle: '🌙', plough: '🛠', 'fishing rod': '🎣', boat: '🛶', paddle: '🏏',
  sling: '🪃', club: '🏏', mace: '🔨', shield: '🛡', helmet: '⛑', mail: '🥋', drum: '🥁', flute: '🪈', crown: '👑', coins: '🪙', trap: '🪤',
  tablet: '📜', dye: '🎨', paint: '🖌', basket: '🧺', poultice: '🌿', antidote: '🧪', splint: '🦯', saw: '🪚', hammer: '🔨', nails: '📌',
  glass: '🔹', bottle: '🍶', lens: '🔍', ash: '🌫', soap: '🧼', bark: '🪵', pitch: '🔥',
};
const NAME = { berry: 'berries', fruit: 'fruit', mushroom: 'mushrooms', redcap: 'red mushrooms', herb: 'herbs', fish: 'fish', meat: 'raw meat', flesh: 'human flesh',
  cooked: 'cooked meat', bread: 'flatbread', fat: 'animal fat', stick: 'wood', fiber: 'fibre', resin: 'pine resin', fur: 'hide', bone: 'bones',
  'ore:copper': 'copper ore', 'ore:tin': 'tin ore', 'ore:iron': 'iron ore', 'ore:gold': 'gold ore', sulfur: 'sulphur', saltpeter: 'saltpetre',
  blade: 'stone blade', axe: 'stone axe', glue: 'pitch glue', net: 'fishing net', pot: 'clay pot', waterpot: 'pot of water', powder: 'black powder',
  necklace: 'gold necklace', FIRE: 'fire' };
const name = k => NAME[k] || k;
const EDIBLE = new Set(['berry', 'fruit', 'mushroom', 'redcap', 'herb', 'grain', 'seed', 'fish', 'meat', 'flesh', 'cooked', 'bread', 'fat', 'cheese', 'butter',
  'salted meat', 'jerky', 'rotten meat', 'flour', 'porridge', 'stew', 'honey']);
const DRINK = new Set(['waterpot', 'milk', 'beer', 'wine']);
const TREAT = new Set(['bandage', 'medicine', 'herb', 'poultice', 'antidote', 'splint', 'soap']);
const BUILD = { hut: 'wood 4', house: 'wood 2 · stone 4', store: 'wood 3', wall: 'stone 3', totem: 'wood 2', pen: 'wood 4', dam: 'stone 3 · wood 2',
  furnace: 'stone 4 · clay 3', well: 'stone 4', hall: 'brick 6 · wood 3', granary: 'brick 4 · wood 2', stele: 'stone 2 · tablet 2', snare: 'snare 1' };
// what to show first: what you fight with, then tools, then food
const ORDER = k => (/sword|mace|spear|bow|sling|club|bomb/.test(k) ? 0 : /axe|pick|blade|scissors|hoe|sickle|saw|rod|net|boat/.test(k) ? 1 : EDIBLE.has(k) || DRINK.has(k) ? 2 : 3);
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
  <div class="gear"></div><div class="hint">click: walk / use / talk · right-click: strike · Q: throw bomb · I: bag &amp; crafting</div>`;
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
  renderHotbar();
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

// ───────── the hotbar: what you carry, always in view ─────────
// click: hold it (then click someone to give it, the ground to throw a bomb) · right-click: eat / drink / use it
const bar = document.createElement('div');
bar.id = 'hotbar';
document.body.appendChild(bar);
let barSig = '';
function renderHotbar() {
  const inv = (G.me && G.me.inv) || {};
  if (G.held && !inv[G.held]) G.held = null;
  const items = Object.entries(inv).sort((a, b) => ORDER(a[0]) - ORDER(b[0]) || a[0].localeCompare(b[0])).slice(0, 14);
  const sig = JSON.stringify([items, G.held]);
  if (sig === barSig) return;
  barSig = sig;
  bar.innerHTML = items.map(([k, n], i) => `<button class="hb${G.held === k ? ' on' : ''}" data-k="${esc(k)}" title="${esc(name(k))}${i < 9 ? ' (' + (i + 1) + ')' : ''} — click to hold, right-click to use">
    <span class="ic">${ICON[k] || '•'}</span><span class="n">${n}</span>${i < 9 ? `<span class="key">${i + 1}</span>` : ''}</button>`).join('')
    + (items.length ? '' : '<span class="empty">empty-handed — click plants, trees, rocks, water to gather</span>');
}
export function holdItem(k) { G.held = G.held === k ? null : k; barSig = ''; renderHotbar(); if (G.held) toast(`Holding ${name(G.held)} — click someone to give it${G.held === 'bomb' ? ', or the ground to throw it' : ''}`, 'dim'); }
export function quickUse(k) {
  if (EDIBLE.has(k)) send({ a: 'eat', item: k });
  else if (DRINK.has(k)) send({ a: 'drink', item: k });
  else if (TREAT.has(k)) send({ a: 'treat', item: k });
  else if (k === 'seed' || k === 'grain') send({ a: 'plant', item: k });
  else toast(`${name(k)}: hold it and click someone to give it, or use it on the bench (I)`, 'dim');
}
export function hotbarKey(i) { const b = bar.querySelectorAll('.hb')[i]; if (b) holdItem(b.dataset.k); }
bar.addEventListener('click', ev => { const b = ev.target.closest('.hb'); if (b) holdItem(b.dataset.k); });
bar.addEventListener('contextmenu', ev => { ev.preventDefault(); const b = ev.target.closest('.hb'); if (b) quickUse(b.dataset.k); });

// ───────── what is under the mouse ─────────
const THING = {
  tree: 'pick fruit / gather wood', pine: 'gather wood', twig: 'gather wood', bush: 'pick berries', boulder: 'break stone', tall: 'cut fibre',
  reed: 'cut reeds', mush: 'pick mushrooms', redcap: 'pick red mushrooms', herb: 'pick herbs',
};
export function targetAt() {
  const g = mouseGround();
  if (G.hovered) return { kind: 'person', v: G.hovered, x: G.hovered.x, z: G.hovered.z, label: G.hovered.net && G.hovered.net.n ? G.hovered.net.n : 'person' };
  let best = null, bd = 22 / Math.min(1.4, G.cam.zoom);
  for (const v of G.animals.values()) { const d = Math.hypot(v.x - g.x, v.z - g.z - 4); if (d < bd) { bd = d; best = { kind: 'animal', v, x: v.x, z: v.z, label: v.net.k + (v.net.tame ? ' (tame)' : '') }; } }
  if (best) return best;
  for (const v of G.others.values()) { const d = Math.hypot(v.x - g.x, v.z - g.z); if (d < 14) return { kind: 'stranger', v, x: v.x, z: v.z, label: v.net.name || 'stranger' }; }
  bd = 18;
  for (const c of G.corpses) { const d = Math.hypot(c.x - g.x, c.z - g.z); if (d < bd) { bd = d; best = { kind: 'thing', x: c.x, z: c.z, label: c.k === 'person' ? `body of ${c.name || 'someone'}` : `dead ${c.k}` }; } }
  for (const s of G.structs) { const d = Math.hypot(s.x - g.x, s.z - g.z); if (d < bd) { bd = d; best = { kind: 'thing', x: s.x, z: s.z, label: s.p < 1 ? `${s.k} site (${Math.round(s.p * 100)}%) — help build` : s.k } } }
  for (const c of G.crops) { const d = Math.hypot(c.x - g.x, c.z - g.z); if (d < bd) { bd = d; best = { kind: 'thing', x: c.x, z: c.z, label: c.ripe ? 'harvest' : 'crop (growing)' }; } }
  if (best) return best;
  const CH = 256;
  bd = 20;
  for (let cz = Math.floor((g.z - 30) / CH); cz <= Math.floor((g.z + 30) / CH); cz++) for (let cx = Math.floor((g.x - 30) / CH); cx <= Math.floor((g.x + 30) / CH); cx++) {
    const data = G.world.peek ? G.world.peek(cx, cz) : null;
    if (!data) continue;
    for (const o of data.objs) {
      const lift = o.t === 'tree' || o.t === 'pine' ? 10 : 2;
      const d = Math.hypot(o.x - g.x, o.z - g.z - lift);
      if (d < bd && THING[o.t]) { bd = d; best = { kind: 'thing', x: o.x, z: o.z, label: o.felled ? 'stump — plant a seed in it' : o.t === 'boulder' && o.ore ? `mine ${o.ore}` : THING[o.t] }; }
    }
  }
  if (best) return best;
  if (G.world.blocked(g.x, g.z)) return { kind: 'water', x: g.x, z: g.z, label: G.me && G.me.boat ? 'sail' : 'water — dig clay / fill a pot at the edge' };
  return { kind: 'ground', x: g.x, z: g.z, label: '' };
}
const hint = document.createElement('div');
hint.id = 'cursor-hint';
document.body.appendChild(hint);
export function updateHint() {
  if (menu.classList.contains('show') || G.mouse.x < 0) { hint.style.opacity = 0; return; }
  const t = targetAt();
  const held = G.held ? `${ICON[G.held] || ''} ` : '';
  let text = t.kind === 'person' ? (G.held ? `give ${name(G.held)}` : 'talk · give · …') : t.kind === 'animal' ? `${t.label} — ${G.held && EDIBLE.has(G.held) ? 'feed' : 'hunt (right-click)'}` : t.kind === 'ground' ? (G.held === 'bomb' ? 'throw the bomb here' : '') : t.label;
  if (t.kind === 'stranger') text = t.label;
  hint.style.opacity = text ? 1 : 0;
  hint.textContent = held + text;
  hint.style.transform = `translate(${G.mouse.x + 16}px,${G.mouse.y + 14}px)`;
}

// ───────── clicking ─────────
export function onClick(ev) {
  if (menu.classList.contains('show')) { closeMenu(); return; }
  const t = targetAt();
  G.clickMark = { x: t.x, z: t.z, t: G.time };
  if (G.held === 'bomb' && (t.kind === 'ground' || t.kind === 'water' || t.kind === 'person' || t.kind === 'animal')) { send({ a: 'throw', x: t.x, z: t.z }); return; }
  if (t.kind === 'person') {
    if (G.held) { const id = t.v.id, k = G.held; walk(t.v, 22, () => send({ a: 'give', item: k, to: id })); return; }
    openMenu(t.v, ev.clientX, ev.clientY); return;
  }
  if (t.kind === 'animal') {
    const id = t.v.id;
    if (G.held && EDIBLE.has(G.held)) { const k = G.held; walk(t.v, 22, () => send({ a: 'feed', to: id, item: k })); }
    else walk(t.v, 26, () => send({ a: 'strike', to: id }));
    return;
  }
  if (t.kind === 'thing') { walk({ x: t.x, z: t.z }, 20, () => send({ a: 'use', x: t.x, z: t.z })); return; }
  if (t.kind === 'water' && !(G.me && G.me.boat)) { walk({ x: t.x, z: t.z }, 30, () => send({ a: 'use', x: t.x, z: t.z })); return; }
  walk({ x: t.x, z: t.z }, 5);
}
export function onRightClick(ev) {
  ev.preventDefault();
  const t = targetAt();
  if (t.kind === 'person' || t.kind === 'animal' || t.kind === 'stranger') {
    const id = t.v.id;
    walk(t.v, 18, () => send({ a: 'strike', to: id }));
  } else send({ a: 'strike' });
}
// walk to something (following it if it moves), then act
function walk(target, near, then) {
  const moving = target.vx !== undefined;
  G.walkTo = moving ? { track: () => (target.net ? (G.people.get(target.id) || G.animals.get(target.id) || G.others.get(target.id)) : target), near, then } : { x: target.x, z: target.z, near, then };
}

// ───────── a person's menu ─────────
const menu = document.createElement('div');
menu.id = 'pmenu';
menu.className = 'panel';
document.body.appendChild(menu);
let menuFor = null;
function openMenu(v, mx, my) {
  menuFor = v; G.menuOpen = true;
  const inv = Object.entries((G.me && G.me.inv) || {});
  menu.innerHTML = `<div class="who">${esc(v.net.n || 'Someone')}</div>
    <button data-do="talk">💬 Talk</button>
    <button data-do="givemenu">🎁 Give…</button>
    <button data-do="strike" class="bad">✊ Strike</button>
    <button data-do="watch">👁 Follow with the camera</button>
    <div class="gives">${inv.map(([k, n]) => `<button class="gv" data-k="${esc(k)}" title="${esc(name(k))}">${ICON[k] || '•'}<span>${n}</span></button>`).join('') || '<i>nothing to give</i>'}</div>`;
  menu.classList.add('show');
  menu.style.left = Math.min(mx + 8, innerWidth - 240) + 'px';
  menu.style.top = Math.min(my + 8, innerHeight - 260) + 'px';
}
export function closeMenu() { menu.classList.remove('show'); menu.classList.remove('giving'); menuFor = null; G.menuOpen = false; }
menu.addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b || !menuFor) return;
  const v = menuFor, id = v.id;
  if (b.dataset.do === 'givemenu') { menu.classList.add('giving'); return; }
  if (b.dataset.k) { const k = b.dataset.k; walk(v, 22, () => send({ a: 'give', item: k, to: id })); }
  else if (b.dataset.do === 'talk') walk(v, 24, () => send({ a: 'talk', to: id }));
  else if (b.dataset.do === 'strike') walk(v, 18, () => send({ a: 'strike', to: id }));
  else if (b.dataset.do === 'watch') G.follow = v;
  closeMenu();
});
