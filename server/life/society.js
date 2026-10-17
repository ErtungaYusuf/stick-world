// Reading society off the people. Nothing here changes anyone's behaviour: it only names what emerged.
//  · bands: people who like each other, found by label propagation on the friendship graph
//  · leaders: whoever many people have chosen to follow
//  · faiths: people who revere the same thing and have prayed to it
//  · roles: what each person actually spends their life doing
//  · settlements: clusters of buildings and hearths
//  · wars: bands that keep drawing each other's blood
import { like, conceptName, SACRED } from './mind.js';
import { rnd } from './util.js';

const COLORS = ['#e8c35a', '#7fb4e8', '#e87f7f', '#8fd18a', '#c99ae8', '#e8a96a', '#6ad1c4', '#e88fc4', '#b7d36a', '#9aa6ff', '#ff9a6a', '#d0d0d0'];
const TOWN_NAMES = ['Oakhollow', 'Riverbend', 'Stonefield', 'Ashford', 'Pinecrest', 'Willowmere', 'Redbank', 'Foxden', 'Highmoor', 'Elmstead',
  'Cold Spring', 'Sunvale', 'Thornby', 'Larkwood', 'Mossgate', 'Brightwater', 'Greywell', 'Hawksreach', 'Fernhill', 'Blackwater'];
const FAITH_NAMES = {
  river: 'the River Cult', sun: 'the Sun Worshippers', moon: 'the Moon Cult', rain: 'the Rain Dancers', storm: 'the Storm Callers',
  snow: 'the Children of Snow', fire: 'the Keepers of the Flame', tree: 'the Tree Folk', pine: 'the Pine Folk', rock: 'the Stone Speakers',
  totem: 'the Totem Cult', grave: 'the Cult of the Dead', deer: 'the Deer Cult', wolf: 'the Wolf Cult', boar: 'the Boar Cult', rabbit: 'the Hare Cult',
  bones: 'the Bone Readers', corpse: 'the Cult of the Dead', crop: 'the Harvest Cult', bush: 'the Berry Cult', dam: 'the Dam Builders', 'ore:gold': 'the Gold Worshippers',
};
const FAITH_SYMBOL = { river: '≈', sun: '☀', moon: '☾', rain: '☂', storm: '⚡', snow: '❄', fire: '🔥', tree: '♣', pine: '♠', rock: '◆', totem: '♜',
  grave: '✝', deer: '🦌', wolf: '🐺', boar: '🐗', rabbit: '🐇', bones: '☠', corpse: '☠', crop: '🌾', bush: '❦', dam: '▬', 'ore:gold': '✦' };

export function createSociety(S, x) {
  // ───────── bands ─────────
  function bands() {
    const ppl = S.people.filter(p => p.age >= 6);
    const label = new Map(ppl.map(p => [p.id, p.band ? 'b' + p.band : 'p' + p.id]));
    for (let it = 0; it < 4; it++) {
      for (const p of ppl.slice().sort(() => rnd() - .5)) {
        const votes = new Map([[label.get(p.id), 18]]);
        for (const [c, w] of p.W) {
          if (!c.startsWith('p:') || w < 15) continue;
          const q = S.byId.get(Number(c.slice(2)));
          if (!q || !label.has(q.id)) continue;
          const mutual = (w + like(q, 'p:' + p.id)) / 2;
          if (mutual < 20) continue;
          const l = label.get(q.id);
          votes.set(l, (votes.get(l) || 0) + mutual);
        }
        let best = null, bv = -1;
        for (const [l, v] of votes) if (v > bv) { bv = v; best = l; }
        label.set(p.id, best);
      }
    }
    const groups = new Map();
    for (const p of ppl) { const l = label.get(p.id); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(p); }
    const old = S.bands, next = new Map(), taken = new Set();
    for (const members of groups.values()) {
      if (members.length < 3) continue;
      // keep the identity of the band most of these people were in before
      const count = new Map();
      for (const p of members) if (p.band && old.has(p.band)) count.set(p.band, (count.get(p.band) || 0) + 1);
      let id = null, bc = 0;
      for (const [b, n] of count) if (n > bc && !taken.has(b)) { bc = n; id = b; }
      let band = id && bc >= members.length * .4 ? old.get(id) : null;
      if (!band) {
        band = { id: S.nextId++, color: COLORS[S.bandSeq++ % COLORS.length], year: S.year, name: '', peak: 0 };
        if (members.length >= 4) x.log('band', `👥 A band of ${members.length} formed around ${centre(members).name}`);
      }
      taken.add(band.id);
      const chief = chiefOf(members), c = centre(members);
      band.size = members.length; band.chief = chief ? chief.id : null;
      band.name = `${(chief || c).name}'s band`;
      band.peak = Math.max(band.peak, members.length);
      next.set(band.id, band);
      for (const p of members) p.band = band.id;
    }
    for (const p of S.people) if (p.band && !next.has(p.band)) p.band = null;
    for (const [id, b] of old) if (!next.has(id) && b.peak >= 4) x.log('band', `👥 ${b.name} broke apart`);
    S.bands = next;
  }
  // the one everyone else likes most
  function centre(members) {
    let best = members[0], bs = -Infinity;
    for (const p of members) { let s = 0; for (const q of members) if (q !== p) s += like(q, 'p:' + p.id); if (s > bs) { bs = s; best = p; } }
    return best;
  }

  // ───────── leaders: nobody is appointed, people just follow whom they choose ─────────
  function followers() {
    const f = new Map();
    for (const p of S.people) if (p.following && p.followUntil > S.time && S.byId.has(p.following)) f.set(p.following, (f.get(p.following) || 0) + 1);
    S.followers = f;
    for (const [id, n] of f) {
      const p = S.byId.get(id);
      const step = [3, 6, 10, 15, 25].filter(k => n >= k).pop();
      if (step && (p.followPeak || 0) < step) { p.followPeak = step; x.log('leader', `👑 ${step} people now follow ${p.name}`); }
    }
  }
  function chiefOf(members) {
    let best = null, bn = 1;
    for (const p of members) { const n = S.followers.get(p.id) || 0; if (n > bn) { bn = n; best = p; } }
    return best;
  }

  // ───────── faiths ─────────
  function sacredOf(p) {
    let best = null, bw = 30;
    for (const [c, w] of p.W) {
      if (w <= bw) continue;
      if (SACRED.has(c) || (c.startsWith('p:') && !S.byId.has(Number(c.slice(2))) && S.names.has(Number(c.slice(2))))) { bw = w; best = c; }
    }
    return best;
  }
  function faiths() {
    const believers = new Map(), worshippers = new Map();
    for (const p of S.people) {
      p.sacred = sacredOf(p);
      for (const [c, w] of p.W) if (w > 40 && (SACRED.has(c) || c.startsWith('p:'))) believers.set(c, (believers.get(c) || 0) + 1);
      if (p.sacred && (p.ven[p.sacred] || 0) >= 2) { if (!worshippers.has(p.sacred)) worshippers.set(p.sacred, []); worshippers.get(p.sacred).push(p); }
    }
    S.believers = believers;
    for (const [c, ppl] of worshippers) {
      let f = S.faiths.get(c);
      if (!f && ppl.length >= 2) {
        const founder = ppl.slice().sort((a, b) => (b.ven[c] || 0) - (a.ven[c] || 0))[0];
        const dead = c.startsWith('p:') ? conceptName(c, S.names) : null;
        f = {
          c, name: dead ? `the Cult of ${dead}` : FAITH_NAMES[c] || `the worship of ${conceptName(c)}`, symbol: dead ? '✝' : FAITH_SYMBOL[c] || '✦',
          color: COLORS[(S.faithSeq++ * 5 + 3) % COLORS.length], founder: founder.name, year: S.year, peak: 0, active: true,
        };
        S.faiths.set(c, f);
        x.log('religion', `${f.symbol} ${f.name} was born: ${ppl.map(p => p.name).slice(0, 4).join(', ')} pray to ${dead ? `${dead}'s spirit` : conceptName(c)}`);
      }
      if (!f) continue;
      f.active = true; f.count = ppl.length;
      const step = [5, 10, 20, 40].filter(k => ppl.length >= k).pop();
      if (step && f.peak < step) { f.peak = step; x.log('religion', `${f.symbol} ${f.name} has ${step} faithful`); }
    }
    for (const f of S.faiths.values()) if (f.active && !worshippers.has(f.c)) { f.active = false; f.count = 0; x.log('religion', `${f.symbol} ${f.name} has died out`); }
  }

  // ───────── roles ─────────
  function roleOf(p) {
    if (p.age < 12) return p.age < 3 ? 'baby' : 'child';
    const s = p.stats;
    const r = {
      killer: s.kills * 8, cannibal: s.cannibal * 10, thief: s.thefts * 4, 'plague doctor': s.sickTends >= 4 ? s.sickTends * 3 : 0,
      healer: s.tends * 2, hunter: s.hunted * 3, fisher: s.fish * 1.5, gatherer: s.picks * .5, woodcutter: s.chops * 2, miner: s.ores * 2,
      crafter: s.crafted * 1.5, builder: s.built * 3, farmer: s.planted * 2 + s.harvests, herder: s.fed * 1.5 + s.tamed * 5,
      priest: s.venerated * .8 + (p.sacred ? s.taught : 0), teacher: s.taught * 1.2, gravedigger: s.buried * 3, giver: s.gifts,
    };
    let best = 'wanderer', bv = 4;
    for (const k in r) if (r[k] > bv) { bv = r[k]; best = k; }
    return best;
  }

  // ───────── settlements ─────────
  function settlements() {
    const pts = [...S.structs.filter(s => s.k !== 'grave'), ...S.fires.filter(f => !f.wild).map(f => ({ ...f, k: 'fire' }))];
    const parent = pts.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
      if (Math.abs(pts[i].x - pts[j].x) < 150 && Math.abs(pts[i].z - pts[j].z) < 150) parent[find(i)] = find(j);
    const groups = new Map();
    pts.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
    const next = [];
    for (const g of groups.values()) {
      const builds = g.filter(p => p.k !== 'fire');
      if (builds.length < 2) continue;
      const cx = g.reduce((a, p) => a + p.x, 0) / g.length, cz = g.reduce((a, p) => a + p.z, 0) / g.length;
      let town = S.towns.find(t => !next.includes(t) && Math.hypot(t.x - cx, t.z - cz) < 250);
      if (!town) {
        const used = new Set(S.towns.map(t => t.name));
        town = { id: S.nextId++, name: TOWN_NAMES.find(n => !used.has(n)) || `Camp ${S.towns.length + 1}`, year: S.year };
        const owner = builds[0].owner && S.byId.get(builds[0].owner);
        x.log('settle', `🏘 A settlement took shape${owner ? ` around ${owner.name}'s home` : ''}: ${town.name}`);
      }
      Object.assign(town, { x: cx, z: cz, buildings: builds.length, houses: builds.filter(b => b.k === 'hut' || b.k === 'house').length });
      town.pop = S.people.filter(p => Math.hypot(p.x - cx, p.z - cz) < 260).length;
      next.push(town);
    }
    for (const t of S.towns) if (!next.includes(t)) x.log('settle', `🏚 ${t.name} was abandoned`);
    S.towns = next;
  }

  // ───────── wars: bands that keep drawing each other's blood ─────────
  function wars() {
    for (const [k, h] of S.hostility) {
      h.hits *= .96; h.deaths *= .985;
      const [a, b] = k.split('|').map(Number), A = S.bands.get(a), B = S.bands.get(b);
      const on = h.hits > 6 && h.deaths >= 1 && A && B;
      if (on && !h.war) { h.war = true; h.since = S.year; x.log('war', `⚔ War: ${A.name} and ${B.name} are killing each other`); }
      else if (h.war && (h.hits < 1.5 || !A || !B)) { h.war = false; x.log('war', `🕊 The fighting between ${A ? A.name : 'a band that is gone'} and ${B ? B.name : 'a band that is gone'} has stopped`); }
      if (!h.war && h.hits < .3) S.hostility.delete(k);
    }
  }
  function hit(att, vic, killed) {
    if (!att.band || !vic.band || att.band === vic.band) return;
    const k = att.band < vic.band ? `${att.band}|${vic.band}` : `${vic.band}|${att.band}`;
    let h = S.hostility.get(k);
    if (!h) S.hostility.set(k, h = { hits: 0, deaths: 0, war: false });
    h.hits++;
    if (killed) h.deaths++;
  }

  // ───────── outbreaks ─────────
  function plagues() {
    const n = new Map();
    for (const p of S.people) if (p.strain) n.set(p.strain, (n.get(p.strain) || 0) + 1);
    for (const [id, c] of n) {
      const st = S.strains.get(id);
      if (!st) continue;
      const step = [3, 8, 15, 30].filter(k => c >= k).pop();
      if (step && (st.peak || 0) < step) { st.peak = step; x.log('plague', `🦠 ${st.name[0].toUpperCase() + st.name.slice(1)} is spreading: ${c} people are sick`); }
    }
  }

  function update() {
    followers();
    bands();
    faiths();
    for (const p of S.people) p.role = roleOf(p);
    settlements();
    wars();
    plagues();
  }
  return { update, hit, sacredOf, roleOf };
}
