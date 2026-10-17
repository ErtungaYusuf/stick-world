// In-game terminal (left side, toggle with ` or the ⌨ button). Every command goes through the REST API.
import { G } from './state.js';
import { api } from './net.js';
import { P } from './entities.js';
import { send } from './player.js';

const root = document.getElementById('terminal');
const out = root.querySelector('.out');
const input = root.querySelector('input');
const history = [];
let hpos = 0;

export const isTyping = () => document.activeElement === input;
export function toggleTerminal(force) {
  const show = force ?? !root.classList.contains('show');
  root.classList.toggle('show', show);
  document.body.classList.toggle('term-open', show);
  if (show) setTimeout(() => input.focus(), 0); else input.blur();
}

function print(text, cls = '') {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  out.appendChild(div);
  while (out.children.length > 400) out.firstChild.remove();
  out.scrollTop = out.scrollHeight;
}
const table = rows => rows.forEach(r => print(r));

// find a living villager by (part of) their name
async function person(name) {
  if (!name) throw new Error('give a name, e.g. "follow emma"');
  const found = await api(`/people?q=${encodeURIComponent(name)}&limit=5`);
  if (!found.length) throw new Error(`nobody alive called "${name}"`);
  return found[0];
}
const villager = id => G.people.get(id);
const num = (v, name, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be a number between ${lo} and ${hi}`);
  return n;
};

let lastSpeed = 1;
const ALIASES = { p: 'pause', r: 'resume', s: 'speed', f: 'fertility', i: 'inspect', w: 'why', h: 'help', '?': 'help' };
const COMMANDS = {
  help: {
    desc: 'list commands',
    run: () => {
      table(Object.entries(COMMANDS).map(([k, c]) => `  ${(k + ' ' + (c.args || '')).padEnd(22)} ${c.desc}`));
      print(`  shortcuts: ${Object.entries(ALIASES).map(([a, k]) => `${a} = ${k}`).join(' · ')}`, 'dim');
    },
  },
  speed: {
    args: '<0-200>', desc: 'whole-game speed (movement, needs, days, seasons, years)',
    run: async ([v]) => {
      if (v === undefined) return print(`speed is ×${G.speed}`);
      const r = await api('/speed', { speed: num(v, 'speed', 0, 200) });
      print(r.speed === 0 ? 'paused' : `speed ×${r.speed}`, 'ok');
    },
  },
  pause: { desc: 'stop the world (short: p)', run: async () => { lastSpeed = G.speed || lastSpeed; await api('/speed', { speed: 0 }); print('paused — "r" to resume', 'ok'); } },
  resume: { desc: 'carry on at the speed before the pause (short: r)', run: async () => { const r = await api('/speed', { speed: lastSpeed || 1 }); print(`speed ×${r.speed}`, 'ok'); } },
  fertility: {
    args: '<0-20>', desc: 'multiply the chance that lovemaking makes a child (1 = natural)',
    run: async ([v]) => {
      if (v === undefined) { const s = await api('/stats'); return print(`fertility ×${s.fertility} · capacity ${s.capacity}`); }
      const r = await api('/fertility', { fertility: num(v, 'fertility', 0, 20) });
      print(`fertility ×${r.fertility}`, 'ok');
    },
  },
  capacity: {
    args: '<10-2000>', desc: 'computer safety limit: above it conception becomes rare',
    run: async ([v]) => {
      if (v === undefined) { const s = await api('/stats'); return print(`capacity ${s.capacity} · population ${s.population}`); }
      const r = await api('/capacity', { capacity: num(v, 'capacity', 10, 2000) });
      print(`capacity ${r.capacity}`, 'ok');
    },
  },
  aging: {
    args: '<1-40>', desc: 'people grow older this many times faster than the seasons turn',
    run: async ([v]) => { const r = await api('/time', { scale: num(v ?? 1, 'aging', 1, 40) }); print(`ageing ×${r.timeScale}`, 'ok'); },
  },
  stats: {
    desc: 'world summary',
    run: async () => {
      const s = await api('/stats');
      table([
        `year ${s.year} · ${s.season}${s.rain ? ' · raining' : ''} · speed ×${s.speed} · ageing ×${s.timeScale} · fertility ×${s.fertility} · ${s.night ? 'night' : 'day'}`,
        `population ${s.population} (${s.men} men, ${s.women} women, ${s.minors} young) · births ${s.births} · deaths ${s.deaths}`,
        `fights ${s.fights} · killings ${s.killings} · thefts ${s.thefts} · gifts ${s.gifts} · explosions ${s.explosions}`,
        `inventions ${s.inventions} · things made ${s.crafted} · buildings ${s.buildings} · graves ${s.graves} · bodies lying ${s.corpses} · crops ${s.crops}`,
        `bands ${s.bands} · faiths ${s.faiths} · settlements ${s.settlements} · wars ${s.wars} · fires ${s.fires} · wildfires ${s.wildfires}`,
        `animals ${s.animals} (${s.tame} tame) · sick ${s.sick}${s.plague ? ` (${s.plague.name}: ${s.plague.sick})` : ''}`,
        `hungry ${s.hungry} · thirsty ${s.thirsty} · freezing ${s.freezing} · most followed: ${s.chief ? `${s.chief.name} (${s.chief.followers}, ${s.chief.band})` : 'nobody'}`,
      ]);
    },
  },
  inspect: {
    args: '<name>', desc: 'everything about one person (their mind included)',
    run: async args => {
      const p = await person(args.join(' '));
      const d = await api(`/people/${p.id}`);
      if (!d.alive) return table([`${d.name} died in year ${d.diedYear} at ${d.age}${d.cause ? ` (${d.cause})` : ''}`]);
      const goods = o => Object.entries(o || {}).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
      const t = d.traits;
      table([
        `${d.name} · ${d.sex} · ${d.age} · ${d.stage} · ${d.role} · health ${d.health}%${d.sick ? ` · ${d.sick}` : ''}`,
        `purpose: ${d.goal.replace(/^to /, '')}`,
        `doing: ${d.doing} · ${d.mood} (pain ${d.pain})`,
        `needs: food ${d.needs.food}% · water ${d.needs.water}% · warmth ${d.needs.warmth}% · energy ${d.needs.energy}%`,
        `carries: ${goods(d.carrying)}`,
        `loves: ${(d.loves || []).join(', ') || '-'}`,
        `hates: ${(d.hates || []).join(', ') || '-'}`,
        'believes:', ...(d.beliefs || []).map(b => `  ${b}`),
        `can make: ${(d.recipes || []).join(', ') || 'nothing'}`,
        `band: ${d.band || '-'} · faith: ${d.faith || (d.sacred ? `reveres ${d.sacred}` : '-')} · follows: ${d.follows || '-'} · followers: ${d.followers}`,
        `kills ${d.kills} · thefts ${d.thefts} · lover: ${d.partner || '-'} · children: ${d.children.length}`,
        t ? `iq ${t.iq} · curious ${t.curious} · social ${t.social} · empathy ${t.empathy} · temper ${t.temper} · greed ${t.greed}` : '',
      ].filter(Boolean));
    },
  },
  why: {
    args: '<name>', desc: 'the options someone is weighing right now, and what each is worth to them',
    run: async args => {
      const p = await person(args.join(' '));
      const opts = await api(`/people/${p.id}/why`);
      print(`${p.name} is weighing (higher = more tempting; n = how often tried or seen):`);
      table(opts.map(o => `  ${o.what.replace(':', ' · ').padEnd(28)} ${(o.u >= 0 ? '+' : '') + o.u.toFixed(3)}  n${o.n}${o.d ? ` · ${o.d} away${o.mem ? ' (remembered)' : ''}` : ''}`));
    },
  },
  find: {
    args: '<name>', desc: 'move the camera to someone',
    run: async args => { const p = await person(args.join(' ')); const v = villager(p.id); if (!v) throw new Error('not in view yet'); G.cam.x = v.x; G.cam.z = v.z; G.follow = v; print(`found ${p.name} ${p.surname}`, 'ok'); },
  },
  follow: {
    args: '<name>', desc: 'keep the camera on someone (move to stop)',
    run: async args => { const p = await person(args.join(' ')); const v = villager(p.id); if (!v) throw new Error('not in view yet'); G.follow = v; print(`following ${p.name} ${p.surname}`, 'ok'); },
  },
  goto: {
    args: '<name>', desc: 'teleport next to someone',
    run: async args => { const p = await person(args.join(' ')); const v = villager(p.id); if (!v) throw new Error('not in view yet'); P.x = v.x + 20; P.z = v.z + 10; G.follow = null; print(`you are next to ${p.name}`, 'ok'); },
  },
  tp: {
    args: '<x> <z>', desc: 'teleport (metres east, metres south)',
    run: ([x, z]) => { P.x = num(x, 'x', -1e5, 1e5) * 10; P.z = num(z, 'z', -1e5, 1e5) * 10; G.follow = null; print('whoosh', 'ok'); },
  },
  name: { args: '<your name>', desc: 'what the people will call you', run: args => { const n = args.join(' ').trim(); if (!n) throw new Error('give a name, e.g. "name Yusuf"'); send({ a: 'name', name: n }); print(`you are now ${n.slice(0, 20)}`, 'ok'); } },
  zoom: { args: '<0.4-3.4>', desc: 'camera zoom', run: ([v]) => { G.cam.tz = G.cam.zoom = num(v, 'zoom', .4, 3.4); } },
  events: {
    args: '[n] [type]', desc: 'recent events (types: killing, theft, invention, religion, ritual, plague, war, band, leader, cannibal, burial, inheritance…)',
    run: async ([n, type]) => {
      const list = await api(`/events?limit=${Math.min(50, Number(n) || 12)}${type ? `&type=${encodeURIComponent(type)}` : ''}`);
      table(list.reverse().map(e => `  [${Math.floor(e.year)}] ${e.text}`));
    },
  },
  leaders: {
    desc: 'who follows whom (nobody is appointed)',
    run: async () => {
      const e = await api('/economy');
      if (!e.leaders.length) return print('  nobody follows anyone right now');
      table(e.leaders.map(l => `  ${l.name.padEnd(20)} ${String(l.followers).padStart(2)} followers${l.band ? ` · ${l.band}` : ''} · lives ${l.goal}`));
    },
  },
  economy: {
    desc: 'the rich, the thieves, the generous, the killers',
    run: async () => {
      const e = await api('/economy'), t = e.totals;
      table([
        `thefts ${t.thefts} · gifts ${t.gifts} · things made ${t.crafted} · killings ${t.killings}`,
        'richest:', ...e.richest.map(r => `  ${r.name.padEnd(20)} ${String(r.wealth).padStart(4)} things · ${r.role}`),
        'thieves:', ...(e.thieves.length ? e.thieves.map(r => `  ${r.name.padEnd(20)} ${r.thefts} thefts`) : ['  none']),
        'most generous:', ...(e.givers.length ? e.givers.map(r => `  ${r.name.padEnd(20)} ${r.gifts} gifts`) : ['  none']),
        'killers:', ...(e.killers.length ? e.killers.map(r => `  ${r.name.padEnd(20)} ${r.kills} killed · lives ${r.goal}`) : ['  none']),
      ]);
    },
  },
  society: {
    desc: 'bands, faiths, purposes, roles, discoveries, plagues, wars',
    run: async () => {
      const s = await api('/society');
      table([
        'bands:', ...(s.bands.length ? s.bands.map(b => `  ${b.name} · ${b.members} people${b.chief ? ` · ${b.followers} follow ${b.chief}` : ''}`) : ['  none']),
        ...(s.wars.length ? ['wars:', ...s.wars.map(w => `  ${w.a} vs ${w.b} since year ${w.since} · ${w.deaths} dead`)] : []),
        'faiths:', ...(s.faiths.filter(f => f.active).length ? s.faiths.filter(f => f.active).map(f => `  ${f.symbol} ${f.name} · ${f.faithful} pray, ${f.believers} believe`) : ['  none']),
        'live for:', ...s.goals.map(g => `  ${String(g.count).padStart(3)} ${g.name}`),
        'actually do:', ...s.roles.map(r => `  ${String(r.count).padStart(3)} ${r.name}`),
        'discoveries:', ...s.knowledge.map(k => `  ${k.name.padEnd(16)} ${k.knowers}/${k.of} know it · ${k.how}`),
        ...(s.strains.length ? ['sicknesses:', ...s.strains.map(st => `  ${st.name}: ${st.sick} sick, ${st.cases} cases`)] : []),
        ...(s.settlements.length ? ['settlements:', ...s.settlements.map(t => `  ${t.name}: ${t.buildings} buildings, ${t.pop} people`)] : []),
      ]);
    },
  },
  evolve: {
    args: '[worlds] [years] [rounds] | status | cancel', desc: 'run many worlds at once; the one with the most survivors replaces this one',
    run: async ([a, b, c]) => {
      if (a === 'cancel') { await api('/evolve/cancel', {}); return print('stopping after the worlds already running…', 'ok'); }
      if (a === 'status' || (a === undefined && (await api('/evolve')).running)) {
        const s = await api('/evolve');
        if (!s.running && !s.history.length) return print('no evolution has run yet — try "evolve 100 25"');
        table([
          s.running ? `running: ${Math.floor(s.done)}/${s.total} worlds · round ${s.round}/${s.rounds} · ${s.years} years each · ${Math.round((Date.now() - s.startedAt) / 1000)} s` : `finished${s.error ? ` with an error: ${s.error}` : ''}`,
          ...s.history.map(h => `  round ${h.round}: winner ${h.winner.pop} alive (peak ${h.winner.peak}) · ${h.alive} worlds still alive · mean ${h.mean}`),
          ...(s.leaderboard.length ? ['best worlds of the last round:', ...s.leaderboard.map((w, i) => `  ${String(i + 1).padStart(2)}. seed ${String(w.seed).padEnd(6)} ${String(w.pop).padStart(3)} alive · peak ${w.peak} · ${w.births} born · ${w.killings} killed · ${w.faiths} faiths · trace ${w.trace.join('→')}`)] : []),
        ]);
        return;
      }
      const body = { worlds: num(a ?? 100, 'worlds', 2, 500), years: num(b ?? 25, 'years', 1, 300), rounds: num(c ?? 1, 'rounds', 1, 20) };
      await api('/evolve', body);
      print(`🧬 ${body.worlds} worlds × ${body.years} years${body.rounds > 1 ? ` × ${body.rounds} rounds (each round descends from the last winner)` : ''} started in the background. "evolve status" to watch; the winner replaces this world when it's done.`, 'ok');
    },
  },
  fps: { desc: 'how long a frame takes to draw, and the current render resolution', run: () => { const p = G.perf(); print(`frame ${p.frameMs} ms (${Math.round(1000 / Math.max(p.frameMs, 1000 / 240))} fps possible) · render scale ×${p.renderScale} · canvas ${p.canvas}`); } },
  bench: { args: '[frames]', desc: 'draw the current view N times; CPU time per frame and per stage', run: ([n]) => { const k = num(n ?? 30, 'frames', 1, 500); G.prof(); const ms = G.bench(k); print(`${ms.toFixed(2)} ms per frame over ${k} frames`, 'ok'); print(Object.entries(G.prof()).map(([a, v]) => `${a} ${(v / k).toFixed(2)}`).join(' · '), 'dim'); } },
  clear: { desc: 'clear the terminal', run: () => { out.innerHTML = ''; } },
  reset: {
    args: 'confirm', desc: 'delete this world and start a new one',
    run: async ([c]) => { if (c !== 'confirm') return print('type "reset confirm" to really wipe the world', 'err'); await api('/reset', {}); },
  },
};

async function execute(line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  print(`> ${line}`, 'cmd');
  const c = COMMANDS[ALIASES[cmd.toLowerCase()] || cmd.toLowerCase()];
  if (!c) return print(`unknown command "${cmd}" — try "help"`, 'err');
  try { await c.run(args); } catch (err) { print(err.message, 'err'); }
}

input.addEventListener('keydown', e => {
  e.stopPropagation();   // typing never moves the player
  if (e.key === 'Enter') { const line = input.value; input.value = ''; if (line.trim()) { history.push(line); hpos = history.length; } execute(line); }
  else if (e.key === 'ArrowUp') { if (hpos > 0) input.value = history[--hpos]; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { hpos = Math.min(history.length, hpos + 1); input.value = history[hpos] || ''; e.preventDefault(); }
  else if (e.key === 'Escape' || e.code === 'Backquote') { e.preventDefault(); toggleTerminal(false); }
  else if (e.key === 'Tab') {   // complete command names
    e.preventDefault();
    const m = Object.keys(COMMANDS).filter(k => k.startsWith(input.value.trim().toLowerCase()));
    if (m.length === 1) input.value = m[0] + ' '; else if (m.length) print(m.join('  '));
  }
});
input.addEventListener('keyup', e => e.stopPropagation());
root.querySelector('.close').addEventListener('click', () => toggleTerminal(false));
document.getElementById('term-btn').addEventListener('click', () => toggleTerminal());
print('Stick World terminal — type "help". Try: speed 50, p / r, inspect <name>, why <name>, society, economy, events 20 killing', 'dim');
