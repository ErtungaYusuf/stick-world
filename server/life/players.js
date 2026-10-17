// Players: strangers walking among the people. A player is a body in the world with belongings, health and a
// recipe book of their own. They gather, craft, build, fight and give with exactly the same physics as everyone
// else (the same recipes, the same blows, the same bombs). The people see them, and learn to love or hate them
// like anyone: there is no rule that says how they react, only what the stranger does to them.
import { TAU, clamp } from '../../shared/core.js';
import { CH } from '../../shared/world.js';
import { ITEMS, label, edible, recipeKey, ingredients, best as bestItem, worn } from './items.js';
import { conceptOfObj } from './env.js';
import { rnd } from './util.js';
import * as M from './mind.js';

const STAT_KEYS = ['kills', 'thefts', 'gifts', 'tends', 'sickTends', 'hunted', 'fish', 'picks', 'chops', 'ores', 'crafted', 'built', 'planted', 'harvests', 'fed', 'tamed', 'venerated', 'taught', 'buried', 'cannibal', 'attacks', 'mates'];
const PICK = { bush: ['berry', 3], tree: ['fruit', 3], mushroom: ['mushroom', 1], redcap: ['redcap', 1], herb: ['herb', 2], grass: ['fiber', 2], reed: ['fiber', 2] };
const ORE_ITEM = { 'ore:copper': 'ore:copper', 'ore:iron': 'ore:iron', 'ore:gold': 'ore:gold', 'ore:tin': 'ore:tin', 'ore:sulfur': 'sulfur', 'ore:saltpeter': 'saltpeter' };
const ANIM = { pick: 'pick', sticks: 'pick', stone: 'mine', ore: 'mine', fell: 'chop', dig: 'mine', water: 'drink', butcher: 'pick', loot: 'grab', crop: 'pick', build: 'craft', craft: 'craft', feed: 'kindle', plant: 'plant', treat: 'heal', eat: 'eat' };

export function createPlayers(world, S, x, BUILD, BUILD_T) {
  const { env } = x;
  // here = connected, alive, and the game actually running in front of someone (positions keep arriving);
  // a background tab, a closed laptop lid or a dead connection leaves no body standing around
  const here = a => a.online && a.alive && Date.now() - (a.seenAt || 0) < 6000;
  const msg = (a, text, kind = 'info') => { a.msgs.push({ text, kind }); if (a.msgs.length > 8) a.msgs.shift(); };

  function make(token, name) {
    return {
      id: S.nextId++, token, name: name || 'Stranger', sur: '', isPlayer: true, alive: true, online: false,
      x: 0, z: 0, y: 0, vx: 0, vz: 0, heading: 0, sex: 'M', age: 25, hue: 210, tall: 1,
      inv: {}, R: new Map(), M: new Map(), W: new Map(), EL: new Map(), stats: Object.fromEntries(STAT_KEYS.map(k => [k, 0])), exp: { gifts: 0, hurt: 0, beaten: 0 },
      tr: { iq: .7, brave: .6, empathy: .5, curious: .5 }, health: 1, bleed: 0, home: null,
      task: null, cool: 0, aggroT: 0, hitT: 0, respawnAt: 0, msgs: [], teleport: null,
    };
  }
  function join(token, name) {
    let a = S.avatars.get(token);
    if (!a) { a = make(token, name); S.avatars.set(token, a); }
    if (name) a.name = String(name).slice(0, 20);
    a.online = true;
    return a;
  }
  const leave = token => { const a = S.avatars.get(token); if (a) { a.online = false; a.task = null; } };
  function move(token, p) {
    const a = S.avatars.get(token);
    if (!a) return;
    a.seenAt = Date.now();   // still there, even while dead (waiting to wake up again)
    if (!a.alive) return;
    Object.assign(a, p);
    a.heading = p.h; a.seenAt = Date.now();
    if (a.task && Math.hypot(a.x - a.task.x0, a.z - a.task.z0) > 26) { msg(a, 'You stopped ' + a.task.what + '.', 'dim'); a.task = null; }
  }

  // ───────── what is around ─────────
  function objectsNear(px, pz, r) {
    const out = [];
    for (let cz = Math.floor((pz - r) / CH); cz <= Math.floor((pz + r) / CH); cz++)
      for (let cx = Math.floor((px - r) / CH); cx <= Math.floor((px + r) / CH); cx++)
        for (const o of world.chunkData(cx, cz).objs) {
          const d = Math.hypot(o.x - px, o.z - pz);
          if (d < r && !o.felled) out.push({ o, d, c: conceptOfObj(o) });
        }
    return out;
  }
  const front = (a, k = 10) => ({ x: a.x + Math.cos(a.heading) * k, z: a.z + Math.sin(a.heading) * k });

  // E: the most sensible thing to do with whatever is right in front
  function use(a, aim) {
    const f = aim && Math.hypot(aim.x - a.x, aim.z - a.z) < 48 ? { x: aim.x, z: aim.z } : front(a), C = [];
    if (aim) a.heading = Math.atan2(f.z - a.z, f.x - a.x);
    const near = (o, r) => Math.hypot(o.x - f.x, o.z - f.z) < r;
    const dd = o => Math.hypot(o.x - f.x, o.z - f.z);
    for (const s of S.structs) if ((s.prog ?? 1) < 1 && near(s, 34)) C.push({ d: dd(s) - 8, what: `building the ${s.k}`, kind: 'build', dur: 3, run: () => {
      const doneNow = x.raiseSite(a, s, 3 * 1.5 / BUILD_T[s.k]);
      msg(a, doneNow ? `The ${s.k} stands.` : `The ${s.k} is ${Math.round(s.prog * 100)}% built.`, doneNow ? 'good' : 'info');
    } });
    for (const c of S.corpses) if (near(c, 24)) {
      if (Object.keys(c.inv || {}).length) C.push({ d: dd(c) - 2, what: 'going through the belongings', kind: 'loot', dur: 1.5, run: () => {
        const got = Object.entries(c.inv).map(([k, n]) => { x.add(a, k, n); return `${n} ${label(k)}`; });
        c.inv = {};
        msg(a, 'You took ' + got.join(', ') + '.', 'good');
        x.harm(a, 'p:' + (c.pid || 0), .4, c);
      } });
      else if (c.meat > 0 && env.rotOf(c) < 1.2) C.push({ d: dd(c), what: 'cutting meat', kind: 'butcher', dur: bestItem(a.inv, 'cut') ? 1.5 : 3, run: () => { const before = { ...a.inv }; x.butcher(a, c); gotMsg(a, before); } });
    }
    for (const c of S.crops) if (near(c, 22) && env.cropRipe(c)) C.push({ d: dd(c), what: 'harvesting', kind: 'crop', dur: 1.2, run: () => { const before = { ...a.inv }; x.harvestCrop(a, c); gotMsg(a, before); } });
    for (const { o, c } of objectsNear(f.x, f.z, 24)) {
      const d = Math.hypot(o.x - f.x, o.z - f.z);
      if (PICK[c] && env.ripe(o)) {
        const [item, n] = PICK[c];
        C.push({ d, what: 'picking ' + label(item), kind: 'pick', dur: 1.2, run: () => {
          if (!env.ripe(o)) return msg(a, 'Nothing left on it.', 'dim');
          env.harvest(o); x.add(a, item, n);
          if (c === 'grass' && env.season() !== 0 && rnd() < .5) x.add(a, 'grain');
          msg(a, `+${n} ${label(item)}`, 'good');
        } });
      }
      if (c === 'tree' || c === 'pine' || c === 'shrub') {
        const axe = bestItem(a.inv, 'chop');
        if (axe && c !== 'shrub') C.push({ d: d + 1, what: 'felling a tree', kind: 'fell', dur: ITEMS[axe].chop * .5, run: () => {
          if (o.felled) return;
          env.fell(o); x.add(a, 'stick', 4);
          if (c === 'pine') x.add(a, 'resin');
          x.fx({ kind: 'fell', id: o.id, x: o.x, z: o.z, dir: o.x >= a.x ? 1 : -1 });
          x.harm(a, c, .7, o);
          msg(a, `Timber! +4 wood${c === 'pine' ? ', +1 resin' : ''}`, 'good');
        } });
        else if (env.sticksLeft(o) >= 1) C.push({ d: d + 2, what: 'breaking off branches', kind: 'sticks', dur: 1.5, run: () => {
          if (env.sticksLeft(o) < 1) return msg(a, 'No dry branches left on it.', 'dim');
          env.takeStick(o); x.add(a, 'stick');
          const resin = c === 'pine' && rnd() < .3;
          if (resin) x.add(a, 'resin');
          msg(a, '+1 wood' + (resin ? ', +1 resin' : ''), 'good');
        } });
        else if (!axe && c !== 'shrub') C.push({ d: d + 3, what: 'pushing at the tree', kind: 'sticks', dur: .6, run: () => msg(a, 'No loose branches. An axe would fell it.', 'dim') });
      }
      if (c === 'rock') C.push({ d, what: 'breaking stone', kind: 'stone', dur: 2, run: () => { const fl = rnd() < .22; x.add(a, fl ? 'flint' : 'stone'); msg(a, fl ? '+1 flint (a sharp-breaking nodule)' : '+1 stone', 'good'); } });
      if (ORE_ITEM[c] && env.oreLeft(o) > 0) {
        const pick = bestItem(a.inv, 'dig');
        C.push({ d, what: 'mining ' + label(ORE_ITEM[c]), kind: 'ore', dur: pick ? 1.8 : 3.5, run: () => {
          if (env.oreLeft(o) <= 0) return msg(a, 'The vein is worked out.', 'dim');
          if (rnd() < (pick ? .85 : .35)) {
            env.takeOre(o); x.add(a, ORE_ITEM[c]); a.stats.ores++;
            x.first(`ore:${ORE_ITEM[c]}`, 'discovery', `⛏ ${a.name} dug ${label(ORE_ITEM[c])} out of a coloured rock`);
            msg(a, '+1 ' + label(ORE_ITEM[c]), 'good');
          } else { x.add(a, 'stone'); msg(a, 'Only rubble came off. +1 stone' + (pick ? '' : ' (a pick would help)'), 'dim'); }
        } });
      }
    }
    const shore = env.nearestShore(a.x, a.z, 46);
    if (shore) {
      const d = Math.hypot(shore.x - f.x, shore.z - f.z) + 4;
      if (x.has(a, 'pot')) C.push({ d: d - 2, what: 'filling the pot', kind: 'water', dur: 1.2, run: () => { if (x.take(a, 'pot')) { x.add(a, 'waterpot'); msg(a, 'A pot of water.', 'good'); } } });
      C.push({ d: d + 1, what: 'digging', kind: 'dig', dur: bestItem(a.inv, 'dig') ? 1.5 : 2.5, run: () => {
        const sand = x.sandy(a.x, a.z) || x.sandy(shore.x, shore.z);
        x.add(a, sand ? 'sand' : 'clay', 2); msg(a, sand ? '+2 sand' : '+2 clay', 'good');
      } });
    }
    const fire = x.fireNear(a, 28);
    if (fire && (x.has(a, 'stick') || x.has(a, 'charcoal'))) C.push({ d: Math.hypot(fire.x - f.x, fire.z - f.z) - 3, what: 'feeding the fire', kind: 'feed', dur: 1, run: () => {
      const k = x.has(a, 'charcoal') ? 'charcoal' : 'stick';
      if (x.take(a, k)) { fire.fuel += ITEMS[k].fuel; msg(a, 'The fire flares up.', 'good'); }
    } });
    if (!C.length) return msg(a, 'Nothing here to use. Face a plant, tree, rock, the water, a body or a building site.', 'dim');
    C.sort((p, q) => p.d - q.d);
    start(a, C[0]);
  }
  function gotMsg(a, before) {
    const got = [];
    for (const k in a.inv) { const n = a.inv[k] - (before[k] || 0); if (n > 0) got.push(`+${n} ${label(k)}`); }
    msg(a, got.length ? got.join(', ') : 'Nothing came of it.', got.length ? 'good' : 'dim');
  }
  function start(a, c) {
    a.task = { ...c, t: 0, x0: a.x, z0: a.z };
  }

  // R / click: strike whoever is in front (people or animals) with the best weapon carried
  function strike(a, toId) {
    if (a.cool > 0) return;
    if (toId != null) {
      const t = x.byId(toId) || S.animals.find(an => an.id === toId) || [...S.avatars.values()].find(o => o.id === toId);
      if (t) a.heading = Math.atan2(t.z - a.z, t.x - a.x);
    }
    const w = bestItem(a.inv, 'power'), reach = (bestItem(a.inv, 'reach') ? ITEMS[bestItem(a.inv, 'reach')].reach : 10) + 10;
    a.cool = w && ITEMS[w].ammo ? 1.1 : .65;
    a.hitT = .3;
    let best = null, bs = Infinity;
    const consider = (t, isAnimal) => {
      const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz);
      if (d > reach || d < .1) return;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dz, dx) - a.heading), Math.cos(Math.atan2(dz, dx) - a.heading)));
      const sc = d + off * 30;
      if (off < 1.2 && sc < bs) { bs = sc; best = { t, isAnimal }; }
    };
    x.peopleNear(a.x, a.z, reach, p => consider(p, false));
    for (const an of S.animals) if (Math.abs(an.x - a.x) < reach && Math.abs(an.z - a.z) < reach) consider(an, true);
    for (const o of S.avatars.values()) if (o !== a && here(o)) consider(o, false);
    if (!best) { msg(a, 'You swing at the air.', 'dim'); return; }
    const t = best.t;
    a.heading = Math.atan2(t.z - a.z, t.x - a.x);
    const dmg = x.strikePower(a) * (.7 + rnd() * .6);
    a.aggroT = S.time + 25;
    if (best.isAnimal) {
      if (x.zoo.hurt(t, dmg * (t.state === 'graze' ? 2 : 1), a)) { a.stats.hunted++; msg(a, `You killed the ${t.k}.`, 'good'); }
    } else if (t.isPlayer) {
      if (hurt(t, dmg, a)) msg(a, `You killed ${t.name}.`, 'bad');
    } else {
      a.stats.attacks++; S.attacks++;
      if (x.hurtPerson(t, dmg, a, 'wounds')) msg(a, `You killed ${t.name}.`, 'bad');
      else if (t.downUntil > S.time) msg(a, `${t.name} is down.`, 'info');
    }
  }

  // Q: throw a bomb (it flies for a second, then the fuse burns down)
  function throwBomb(a, tx, tz) {
    if (!x.has(a, 'bomb')) return msg(a, 'You have no bomb. (powder + clay pot + rope)', 'dim');
    let dx = tx - a.x, dz = tz - a.z;
    const d = Math.hypot(dx, dz), k = d > 170 ? 170 / d : 1;
    dx *= k; dz *= k;
    x.take(a, 'bomb');
    const b = { x: a.x + dx, z: a.z + dz, at: S.time + 2.4, by: a };
    S.bombs.push(b);
    a.aggroT = S.time + 40;
    x.fx({ kind: 'throw', x0: a.x, z0: a.z, x: b.x, z: b.z, t: .9 });
    msg(a, 'The fuse is burning…', 'bad');
  }

  function craftNow(a, items, where) {
    items = (items || []).filter(k => typeof k === 'string' && ITEMS[k]).slice(0, 3);
    if (!items.length) return msg(a, 'Put one to three things in the slots.', 'dim');
    if (where && where !== 'fire' && where !== 'furnace') where = null;
    const rk = recipeKey(items, where);
    const g = ingredients(rk);
    for (const k in g.need) if (!x.has(a, k, g.need[k])) return msg(a, `You need ${g.need[k]} ${label(k)}.`, 'bad');
    if (!x.canCraft(a, rk)) return msg(a, where === 'furnace' ? 'You need to stand at a finished furnace.' : 'You need to stand by a fire (or a furnace).', 'bad');
    const known = (a.R.get(rk) || {}).res;
    start(a, { what: known ? 'making ' + (known === 'FIRE' ? 'a fire' : label(known)) : 'trying ' + items.map(label).join(' + '), kind: 'craft', dur: where === 'furnace' ? 3 : 2, run: () => {
      if (!x.canCraft(a, rk)) return msg(a, 'Something is missing now.', 'bad');
      const before = { ...a.inv }, fires = S.fires.length;
      const ok = x.craft(a, rk);
      if (ok) {
        const r = a.R.get(rk).res;
        if (r === 'FIRE' || S.fires.length > fires) msg(a, '🔥 A fire catches!', 'good');
        else gotMsg(a, before);
        if (!known) msg(a, `💡 New recipe: ${g.items.map(label).join(' + ')}${where ? ' in the ' + where : ''} → ${r === 'FIRE' ? 'fire' : label(r)}`, 'good');
      } else {
        const lost = Object.keys(before).filter(k => (a.inv[k] || 0) < before[k]);
        msg(a, `Nothing came of ${g.items.map(label).join(' + ')}${where ? ' in the ' + where : ''}${lost.length ? ` (the ${label(lost[0])} was ruined)` : ''}.`, 'dim');
      }
    } });
  }

  function build(a, k) {
    if (!BUILD[k]) return;
    for (const [m, n] of Object.entries(BUILD[k])) if (!x.has(a, m, n)) return msg(a, `A ${k} needs ${Object.entries(BUILD[k]).map(([m, n]) => `${n} ${label(m)}`).join(' + ')}.`, 'bad');
    const f = front(a, 26);
    if (!x.spotFree(f.x, f.z, k)) return msg(a, 'No room there. Face open ground.', 'bad');
    x.layFoundation(a, k, f.x, f.z);
    msg(a, `You laid out a ${k}. Press E at the site to raise it (others may help).`, 'good');
  }
  function plant(a, item) {
    if (!ITEMS[item] || !ITEMS[item].plant || !x.has(a, item)) return msg(a, 'Plant seeds or grain.', 'dim');
    const f = front(a, 14);
    if (S.crops.some(c => Math.hypot(c.x - f.x, c.z - f.z) < 10)) return msg(a, 'Something already grows there.', 'dim');
    x.plant(a, item, f.x, f.z);
    msg(a, `You planted ${label(item)}. It will bear in a while.`, 'good');
  }
  function eat(a, k) {
    if (!edible(k) || !x.take(a, k)) return;
    const it = ITEMS[k];
    a.health = Math.min(1, a.health + it.food * .6);
    if (it.poison) a.health -= it.poison * .4;
    if (it.vision) msg(a, 'The world swims and glows…', 'info');
    msg(a, `You ate ${label(k)}.`, 'info');
  }
  function give(a, k, toId) {
    if (!x.has(a, k)) return;
    let best = null, bd = 34;
    const chosen = toId != null && x.byId(toId);
    if (chosen && Math.hypot(chosen.x - a.x, chosen.z - a.z) < 40) best = chosen;
    else x.peopleNear(a.x, a.z, 34, (p, d) => { if (d < bd && !p.held) { bd = d; best = p; } });
    if (!best) return msg(a, 'Nobody close enough to give it to.', 'dim');
    x.giveItem(a, best, k);
    msg(a, `You gave ${label(k)} to ${best.name}.`, 'good');
  }

  // a few words: they warm (or not) to whoever talks to them, and show what they feel
  function talk(a, toId) {
    const p = x.byId(toId);
    if (!p || Math.hypot(p.x - a.x, p.z - a.z) > 45) return msg(a, 'Too far away to talk.', 'dim');
    if (p.asleep) return msg(a, `${p.name} is asleep.`, 'dim');
    const w = M.like(p, 'p:' + a.id);
    p.social = Math.min(1, p.social + .15);
    M.notice(p, 'p:' + a.id, .5);
    p.bubble = { ch: w > 25 ? '☺' : w < -25 ? '😠' : w < -5 ? '…' : '!', t: 2 };
    a.heading = Math.atan2(p.z - a.z, p.x - a.x);
    const mood = p.Pnow > 1.2 ? 'is suffering' : p.Pnow > .6 ? 'looks troubled' : 'seems at ease';
    const feel = w > 40 ? 'is glad to see you' : w > 10 ? 'is friendly' : w < -40 ? 'hates you' : w < -10 ? 'is wary of you' : 'does not know what to make of you';
    msg(a, `${p.name} ${feel} and ${mood}. (${p.label || 'idle'})`, w < -10 ? 'bad' : 'info');
  }
  function feedAnimal(a, toId, k) {
    const an = S.animals.find(q => q.id === toId);
    if (!an || Math.hypot(an.x - a.x, an.z - a.z) > 40) return msg(a, 'Too far away.', 'dim');
    if (!k || !x.has(a, k)) return msg(a, 'Hold some food to offer it.', 'dim');
    const r = x.zoo.feed(an, a);
    if (!r) return msg(a, `The ${an.k} won't come near.`, 'dim');
    x.take(a, k);
    msg(a, r === 'tamed' ? `The ${an.k} follows you now. 🐾` : `The ${an.k} eats from your hand.`, 'good');
    if (r === 'tamed') x.first('tame:' + an.k, 'herding', `🐾 ${a.name} tamed a ${an.k}`);
  }
  function act(token, m) {
    const a = S.avatars.get(token);
    if (!a || !a.alive || !m || typeof m.a !== 'string') return;
    switch (m.a) {
      case 'use': if (!a.task) use(a, Number.isFinite(m.x) && Number.isFinite(m.z) ? { x: m.x, z: m.z } : null); break;
      case 'talk': talk(a, m.to); break;
      case 'feed': feedAnimal(a, m.to, m.item); break;
      case 'cancel': a.task = null; break;
      case 'strike': strike(a, m.to); break;
      case 'throw': if (Number.isFinite(m.x) && Number.isFinite(m.z)) throwBomb(a, m.x, m.z); break;
      case 'craft': if (!a.task) craftNow(a, m.items, m.where); break;
      case 'build': if (!a.task && typeof m.k === 'string') build(a, m.k); break;
      case 'plant': plant(a, m.item); break;
      case 'eat': eat(a, m.item); break;
      case 'treat': if (x.treat(a, a, m.item)) msg(a, `You used ${label(m.item)}.`, 'good'); break;
      case 'give': give(a, m.item, m.to); break;
      case 'drink': if (x.has(a, m.item) && ITEMS[m.item] && ITEMS[m.item].drink) { x.take(a, m.item); if (ITEMS[m.item].back) x.add(a, ITEMS[m.item].back); else if (m.item === 'waterpot') x.add(a, 'pot'); a.health = Math.min(1, a.health + .05); msg(a, `You drank ${label(m.item)}.`, 'info'); } break;
      case 'drop': if (x.take(a, m.item, clamp(m.n | 0, 1, 99))) msg(a, `You threw away ${label(m.item)}.`, 'dim'); break;
      case 'name': if (typeof m.name === 'string' && m.name.trim()) a.name = m.name.trim().slice(0, 20); break;
    }
  }

  // ───────── body ─────────
  function hurt(a, dmg, by) {
    if (!here(a)) return false;
    const arm = Math.min(.8, worn(a.inv, 'armor'));
    dmg *= 1 - arm;
    a.health -= dmg;
    const edged = !!(by && by.inv && bestItem(by.inv, 'power')) || (by && by.k === 'wolf');
    a.bleed = Math.min(1, a.bleed + dmg * (edged ? .6 : .15) * (1 - arm * .6));
    a.task = null;
    x.fx({ kind: 'hit', pid: a.id, x: a.x, z: a.z, blood: true, big: dmg > .2, ...(by ? { bx: Math.round(by.x * 10) / 10, bz: Math.round(by.z * 10) / 10 } : {}) });
    // say who it is once per fight, not on every blow
    const who = by ? by.id ?? by.k : null;
    if (who != null && (a.lastHitBy !== who || S.time - a.lastHitMsg > 8)) {
      if (by.name && !by.isPlayer) msg(a, `${by.name} is attacking you!`, 'bad');
      else if (by.k) msg(a, `A ${by.k} is attacking you!`, 'bad');
    }
    if (who != null) { a.lastHitBy = who; a.lastHitMsg = S.time; }
    if (a.health <= 0) { die(a, by); return true; }
    return false;
  }
  function die(a, by) {
    a.alive = false; a.task = null; a.respawnAt = S.time + 8;
    S.corpses.push({ id: S.nextId++, k: 'person', pid: a.id, name: a.name, x: a.x, z: a.z, h: a.heading, t0: S.time, sex: a.sex, hue: a.hue, tall: a.tall, age: a.age,
      meat: 6, fur: 0, inv: a.inv, strain: null, killer: by && by.id, violent: true });
    a.inv = {};
    x.fx({ kind: 'death', pid: a.id, x: a.x, z: a.z, violent: true });
    if (by && by.name) {
      if (by.stats) by.stats.kills++;
      S.killings++;
      x.log('killing', `⚔ ${a.name} (a stranger) was killed by ${by.name}${by.sur ? ' ' + by.sur : ''}`);
    } else x.log('death', `💀 ${a.name} (a stranger) died${by && by.k ? `, killed by a ${by.k}` : ''}`);
    msg(a, 'You died. Everything you carried lies with your body.', 'bad');
  }
  function tick(dt) {
    for (const a of S.avatars.values()) {
      if (!a.online || Date.now() - (a.seenAt || 0) > 6000) { a.task = null; continue; }
      if (!a.alive) {
        if (S.time >= a.respawnAt) {
          const h = S.home || { x: a.x, z: a.z }, p = x.landAround(h.x, h.z, 30, 160) || h;
          Object.assign(a, { alive: true, health: 1, bleed: 0, x: p.x, z: p.z, teleport: { x: p.x, z: p.z } });
          msg(a, 'You wake up somewhere else, with nothing.', 'info');
        }
        continue;
      }
      a.cool -= dt; a.hitT -= dt;
      if (a.bleed > 0) { a.health -= a.bleed * dt * .6; a.bleed = Math.max(0, a.bleed - dt * .02); if (a.health <= 0) { die(a, null); continue; } }
      else a.health = Math.min(1, a.health + dt / 150);
      const T = a.task;
      if (T && (T.t += dt) >= T.dur) { a.task = null; T.run(); }
    }
    // bombs whose fuse has burned down
    for (let i = S.bombs.length - 1; i >= 0; i--) {
      const b = S.bombs[i];
      if (S.time < b.at) continue;
      S.bombs.splice(i, 1);
      x.explode(b.x, b.z, b.by);
    }
  }
  // someone made something where a player could see it: they can pick it up too
  function watch(e, rk, res) {
    for (const a of S.avatars.values()) {
      if (a === e || !here(a) || (a.R.get(rk) || {}).ok) continue;
      if (Math.hypot(a.x - e.x, a.z - e.z) > 90) continue;
      a.R.set(rk, { ok: 1, tries: 0, res, seen: e.name });
      const g = ingredients(rk);
      msg(a, `👀 You watched ${e.name} make ${res === 'FIRE' ? 'fire' : label(res)} from ${g.items.map(label).join(' + ')}${g.where ? ' in the ' + g.where : ''}.`, 'good');
    }
  }

  // ───────── what each client is told ─────────
  function view(token, conn = {}) {
    const a = S.avatars.get(token);
    if (!a) return null;
    const v = {
      t: 'me', id: a.id, name: a.name, alive: a.alive, hp: Math.round(a.health * 100) / 100, bleed: a.bleed > .05 ? 1 : 0, inv: a.inv,
      task: a.task ? { what: a.task.what, kind: a.task.kind, p: Math.round(a.task.t / a.task.dur * 100) / 100 } : null,
      fire: !!(x.fireNear(a, 40) || x.furnaceNear(a, 45)), furnace: !!x.furnaceNear(a, 45),
      respawn: a.alive ? 0 : Math.max(0, Math.ceil(a.respawnAt - S.time)), msgs: a.msgs.splice(0),
      weapon: bestItem(a.inv, 'power'), armor: bestItem(a.inv, 'armor'), boat: !!a.inv.boat,
    };
    if (a.teleport) { v.teleport = a.teleport; a.teleport = null; }
    let known = 0; for (const r of a.R.values()) if (r.ok) known++;
    if (conn.bookVer !== known) { conn.bookVer = known; v.book = [...a.R.entries()].filter(([, r]) => r.ok).map(([rk, r]) => ({ rk, res: r.res, seen: r.seen || null })); }
    return v;
  }
  const others = () => [...S.avatars.values()].filter(here).map(a => ({
    id: a.id, name: a.name, x: Math.round(a.x * 10) / 10, z: Math.round(a.z * 10) / 10, h: Math.round(a.heading * 100) / 100, y: a.y || 0, vx: a.vx || 0, vz: a.vz || 0,
    act: a.task ? ANIM[a.task.kind] : a.hitT > 0 ? 'fight' : null, tool: weaponLook(a), hp: Math.round(a.health * 100) / 100,
  }));
  const weaponLook = a => { const w = bestItem(a.inv, 'power'); return !w ? null : w.includes('spear') ? 'spear' : w.includes('axe') ? 'axe' : w === 'pick' || w.includes('pick') ? 'pick' : 'blade'; };
  const serialize = () => [...S.avatars.values()].map(a => ({ token: a.token, id: a.id, name: a.name, inv: a.inv, R: [...a.R.entries()], health: a.health, x: a.x, z: a.z, stats: a.stats, alive: a.alive }));
  function restore(list) {
    S.avatars = new Map();
    for (const o of list || []) {
      const a = make(o.token, o.name);
      Object.assign(a, { id: o.id, inv: o.inv || {}, R: new Map(o.R || []), health: o.health ?? 1, x: o.x || 0, z: o.z || 0, stats: { ...a.stats, ...(o.stats || {}) } });
      if (o.alive === false) { a.alive = false; a.respawnAt = S.time + 3; }
      S.avatars.set(a.token, a);
    }
  }
  return { join, leave, move, act, tick, hurt, watch, view, others, serialize, restore, here };
}
