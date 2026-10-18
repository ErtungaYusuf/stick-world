// Animals are part of nature, not of the society: they graze, flee, hunt, breed, and slowly come to
// trust whoever keeps feeding them. Whether people ever hunt, herd or tame them is up to the people.
import { TAU, clamp, angDiff, damp } from '../../shared/core.js';
import { WATER } from '../../shared/world.js';
import { moveCollide } from '../../shared/motion.js';
import { YEAR, rnd, pick } from './util.js';

export const KINDS = {
  deer:   { walk: 30, run: 98, alert: 80, hp: .8, meat: 6, fur: 1, herd: [3, 6], life: 14, cap: 20, litter: 1, prey: true, diet: 'plants' },
  rabbit: { walk: 22, run: 105, alert: 50, hp: .25, meat: 2, fur: 1, herd: [1, 3], life: 6, cap: 18, litter: 3, prey: true, diet: 'plants', small: true },
  boar:   { walk: 24, run: 82, alert: 55, hp: 1.3, meat: 8, fur: 1, herd: [1, 3], life: 12, cap: 11, litter: 2, bite: .08, diet: 'plants' },
  goat:   { walk: 26, run: 92, alert: 60, hp: .7, meat: 5, fur: 1, herd: [3, 7], life: 13, cap: 18, litter: 2, prey: true, diet: 'plants', milk: true, wool: true },
  wolf:   { walk: 36, run: 108, alert: 95, hp: .9, meat: 3, fur: 2, herd: [2, 4], life: 11, cap: 7, litter: 2, bite: .06, predator: true, diet: 'meat' },
  bear:   { walk: 26, run: 96, alert: 70, hp: 2.6, meat: 14, fur: 3, herd: [1, 1], life: 25, cap: 3, litter: 1, bite: .16, predator: true, diet: 'meat', big: true, sleeps: true },
  fox:    { walk: 30, run: 112, alert: 85, hp: .35, meat: 1, fur: 1, herd: [1, 2], life: 8, cap: 7, litter: 2, bite: .03, predator: true, diet: 'meat', small: true },
};
const MIN_AROUND = { deer: 10, rabbit: 10, boar: 5, goat: 7, wolf: 4, bear: 1, fox: 3 };
// what each hunter goes after (foxes only small game; bears anything)
const PREY = { wolf: k => k === 'deer' || k === 'rabbit' || k === 'goat', bear: k => KINDS[k].prey, fox: k => k === 'rabbit' };

export function createAnimals(world, S, x) {
  const env = x.env;
  const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const land = (px, pz) => world.elev(px, pz) > WATER + .02;

  function spawn(k, px, pz, o = {}) {
    const a = {
      id: S.nextId++, k, x: px, z: pz, h: rnd() * TAU, vx: 0, vz: 0, hp: KINDS[k].hp, age: 1 + rnd() * 4, sex: rnd() < .5 ? 'M' : 'F',
      hunger: rnd() * .4, state: 'graze', t: rnd() * 5, tx: px, tz: pz, home: { x: px, z: pz }, owner: null, trust: {}, threat: null,
      act: null, bred: -1, ...o,
    };
    S.animals.push(a);
    return a;
  }
  // a herd somewhere suitable between r0 and r1 from (cx, cz)
  function spawnHerd(k, cx, cz, r0, r1) {
    for (let tries = 0; tries < 30; tries++) {
      const ang = rnd() * TAU, r = r0 + rnd() * (r1 - r0), px = cx + Math.cos(ang) * r, pz = cz + Math.sin(ang) * r;
      if (!land(px, pz)) continue;
      const m = world.moist(px, pz), tp = world.temp(px, pz);
      if (k === 'wolf' && m < .5 && tp > .45) continue;          // wolves keep to forests and the cold
      if ((k === 'deer' || k === 'rabbit') && tp < world.SNOW) continue;
      if (k === 'goat' && world.rocky(px, pz) < .5) continue;            // goats keep to rocky hills
      if (k === 'bear' && m < .55) continue;                              // bears to deep forest
      const [lo, hi] = KINDS[k].herd, n = lo + Math.floor(rnd() * (hi - lo + 1));
      for (let i = 0; i < n; i++) {
        const q = world.landNear(px, pz, 0, 40);
        spawn(k, q.x, q.z, { home: { x: px, z: pz } });
      }
      return true;
    }
    return false;
  }
  function populate(cx, cz, k = 1) {
    for (let i = 0; i < Math.round(6 * k); i++) spawnHerd('deer', cx, cz, 250, 1100);
    for (let i = 0; i < Math.round(9 * k); i++) spawnHerd('rabbit', cx, cz, 120, 900);
    for (let i = 0; i < Math.round(4 * k); i++) spawnHerd('boar', cx, cz, 300, 1100);
    for (let i = 0; i < Math.round(2 * k); i++) spawnHerd('wolf', cx, cz, 700, 1500);
    for (let i = 0; i < Math.round(5 * k); i++) spawnHerd('goat', cx, cz, 300, 1300);
    for (let i = 0; i < Math.round(1 * k); i++) spawnHerd('bear', cx, cz, 900, 1800);
    for (let i = 0; i < Math.round(3 * k); i++) spawnHerd('fox', cx, cz, 400, 1300);
  }

  function die(a, cause) {
    const i = S.animals.indexOf(a);
    if (i < 0) return;
    S.animals.splice(i, 1);
    const K = KINDS[a.k], young = a.age < 1;
    S.corpses.push({ id: a.id, k: a.k, x: a.x, z: a.z, h: a.h, t0: S.time, meat: Math.ceil(K.meat * (young ? .5 : 1)), fur: K.fur, inv: {}, cause, owner: a.owner });
    if (K.big && cause === 'hunted') x.log('hunt', `🐻 A ${a.k} was brought down`);
  }
  // returns true when the animal dies of it
  function hurt(a, dmg, by) {
    a.hp -= dmg;
    x.fx({ kind: 'hit', x: a.x, z: a.z, blood: true, animal: a.id });
    if (by) {
      a.threat = by;
      // boars stand and fight; a wolf only does when it is starving or cornered with nothing to lose
      if (KINDS[a.k].bite && !KINDS[a.k].small && a.hp > KINDS[a.k].hp * .3 && (a.k !== 'wolf' || a.hunger > .9)) { a.state = 'fight'; a.t = 8; }
      else { a.state = 'flee'; a.t = 4; }
    }
    if (a.hp <= 0) { die(a, by ? 'hunted' : 'wounds'); return true; }
    return false;
  }
  // a person offers food; animals that aren't running away take it and remember who gave it
  function feed(a, e) {
    if (a.state === 'flee' || a.state === 'fight') return false;
    a.trust[e.id] = Math.min(1, (a.trust[e.id] || 0) + (a.k === 'wolf' ? .12 : .2));
    a.hunger = 0;
    if (!a.owner && a.trust[e.id] >= .6) { a.owner = e.id; a.home = { x: e.x, z: e.z }; return 'tamed'; }
    return true;
  }

  function steerTo(a, tx, tz, speed, dt) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    const want = d > 3 ? speed : 0, vx = d > 3 ? dx / d * want : 0, vz = d > 3 ? dz / d * want : 0;
    a.vx += (vx - a.vx) * damp(6, dt); a.vz += (vz - a.vz) * damp(6, dt);
    if (Math.abs(a.vx) + Math.abs(a.vz) < .5) return { d, hit: false };   // standing still: nothing to collide with
    if (Math.hypot(a.vx, a.vz) > 2) a.h += angDiff(a.h, Math.atan2(a.vz, a.vx)) * damp(8, dt);
    // far from anyone: no trees or rocks to bump into, only water stops them (nobody is watching)
    if (a.far) {
      const nx = a.x + a.vx * dt, nz = a.z + a.vz * dt;
      if (world.blocked(nx, nz)) { a.vx = a.vz = 0; return { d, hit: true }; }
      a.x = nx; a.z = nz;
      return { d, hit: false };
    }
    const hit = moveCollide(world, a, dt, 4);
    return { d, hit };
  }
  const trusts = (a, p) => a.owner === p.id || (a.trust[p.id] || 0) >= .2;
  // every wild beast keeps away from fire: a burning hearth, a torch or a lamp in someone's hand
  const hearthNear = (px, pz, r) => { let y = false; env.near('fires', px, pz, r * 1.42, f => { if (!f.wild && f.fuel > 0 && Math.abs(f.x - px) < r && Math.abs(f.z - pz) < r) y = true; }); return y; };
  const carriesLight = p => p.inv && (p.inv.torch || p.inv.lamp || p.inv.pitch || p.inv.candle);

  let checkT = 0, popT = 0, lodT = 2, frame = 0, wolves = [];
  // a bear in its den all winter
  const asleepNow = (a, K) => K.sleeps && !a.owner && env.season() === 3 && a.state !== 'fight';
  function think(a) {
    const K = KINDS[a.k];
    // threats: people (unless trusted), wolves for prey, wildfire for everyone
    let threat = null, td = Infinity;
    x.peopleNear(a.x, a.z, K.alert + 10, (p, d) => {
      if (trusts(a, p) || p.held) return;
      const alert = K.alert * (p.sneaking ? .35 : 1) * (x.night() > .5 ? .7 : 1);
      if (d < alert && d < td && !(K.predator && a.hunger > .6)) { threat = p; td = d; }
    });
    if (K.prey) for (const w of wolves) if (PREY[w.k](a.k) && Math.abs(w.x - a.x) < 120 && Math.abs(w.z - a.z) < 120) { const d = near(a, w); if (d < 110 && d < td) { threat = w; td = d; } }
    if (!a.owner) env.near('fires', a.x, a.z, 128, (f, d) => { if ((f.wild ? 90 : f.fuel > 0 ? 55 : 0) > Math.max(Math.abs(f.x - a.x), Math.abs(f.z - a.z))) { threat = f; td = d; } });
    if (threat && a.state !== 'fight' && !(a.owner && threat === x.byId(a.owner))) { a.state = 'flee'; a.threat = threat; a.t = 3 + rnd() * 2; return; }
    if (a.owner) {
      const o = x.byId(a.owner);
      if (!o) { a.owner = null; a.state = 'graze'; return; }
      // a tame wolf goes for whatever its person is fighting
      const tgt = o.task && (o.task.A.id === 'attack' || o.task.A.id === 'hunt') ? o.task.tgt : null;
      if (a.k === 'wolf' && tgt && tgt !== a && (tgt.alive !== false)) { a.state = 'fight'; a.threat = tgt; a.t = 6; return; }
      if (a.state !== 'fight') a.state = 'follow';
      return;
    }
    if (K.predator) {
      a.hunger = Math.min(1, a.hunger);
      if (a.hunger > .5 && a.state !== 'fight') {
        // a carcass first, then the nearest prey; a lone grown-up person only when starving
        let best = null, bd = 320;
        env.near('corpses', a.x, a.z, bd, (c, d) => { if (c.meat > 0 && d < bd) { bd = d; best = c; } });
        if (best) { a.state = 'eat'; a.prey = best; return; }
        for (const p of S.animals) if (KINDS[p.k].prey && PREY[a.k](p.k) && !p.owner && Math.abs(p.x - a.x) < 280 && Math.abs(p.z - a.z) < 280) { const d = near(a, p); if (d < bd) { bd = d; best = p; } }
        // like real wolves they pick the weak: a lone child, or someone wounded, sick or old
        if (!best && !K.small && a.hunger > .95 && (x.night() > .5 || K.big)) x.peopleNear(a.x, a.z, 220, (p, d) => {
          if (p.held || d > bd || (p.health > .6 && p.age >= 12 && p.age < 55)) return;
          if (carriesLight(p) || hearthNear(p.x, p.z, 110)) return;
          let company = 0;
          x.peopleNear(p.x, p.z, 70, () => company++);
          if (company <= 1) { bd = d; best = p; }
        });
        if (best) { a.state = 'fight'; a.threat = best; a.t = 12; return; }
      }
    }
    if (a.state === 'flee' && a.t > 0) return;
    if (a.state !== 'fight' && a.state !== 'eat') a.state = 'graze';
  }

  // Animals nobody is near (no one within 800) are simulated a third as often with triple steps:
  // nobody sees the difference, and most of the land is empty most of the time.
  function tick(dt0) {
    const yearIdx = Math.floor(S.time / YEAR);
    const thinkNow = (checkT += dt0) >= .5;
    if (thinkNow) { checkT = 0; wolves = S.animals.filter(w => KINDS[w.k].predator && !w.owner && !asleepNow(w, KINDS[w.k])); }
    if ((lodT += dt0) >= 2) {
      lodT = 0;
      for (const a of S.animals) { let seen = false; x.peopleNear(a.x, a.z, 800, () => { seen = true; }); a.far = !seen && !a.owner; }
    }
    frame++;
    for (let i = S.animals.length - 1; i >= 0; i--) {
      const a = S.animals[i], K = KINDS[a.k];
      let dt = dt0;
      if (a.far) { if ((frame + a.id) % 6) continue; dt = dt0 * 6; }
      a.age += dt / YEAR;
      if (asleepNow(a, K)) { a.act = 'sleep'; a.vx = a.vz = 0; continue; }
      a.hunger += dt / (K.predator ? 220 : 400) * (env.season() === 3 && !a.owner ? 1 + (S.winterSev || 0) * 9 : 1);
      if (a.age > K.life * (.8 + (a.id % 7) * .06)) { die(a, 'old age'); continue; }
      if (a.hunger > 1.6 && !a.owner) { die(a, 'starvation'); continue; }
      if (thinkNow) think(a);
      a.t -= dt;
      a.act = null;
      if (a.state === 'flee' && a.threat) {
        const th = a.threat, dx = a.x - th.x, dz = a.z - th.z, d = Math.hypot(dx, dz) || 1;
        steerTo(a, a.x + dx / d * 80, a.z + dz / d * 80, K.run * (.35 + .65 * Math.max(0, a.hp) / K.hp), dt);   // wounded animals tire
        if (a.t <= 0 && d > K.alert * 1.6) { a.state = 'graze'; a.threat = null; }
      } else if (a.state === 'fight' && a.threat) {
        const th = a.threat;
        if (th.alive === false || (th.hp != null && th.hp <= 0) || !(th.isPlayer || S.people.includes(th) || S.animals.includes(th)) || a.t <= 0) { a.state = 'graze'; a.threat = null; continue; }
        const { d } = steerTo(a, th.x, th.z, K.run * .9, dt);
        if (d < 13) {
          a.act = 'bite';
          if ((a.biteT = (a.biteT || 0) - dt) <= 0) {
            a.biteT = 1;
            const dmg = (K.bite || .06) * (.6 + rnd() * .8);
            const killed = th.hp != null ? hurt(th, dmg, a) : th.isPlayer ? x.hurtAvatar(th, dmg, a) : x.hurtPerson(th, dmg, a, a.k);
            if (killed) { a.hunger = 0; a.state = 'graze'; a.threat = null; }
          }
        }
      } else if (a.state === 'eat' && a.prey) {
        const c = a.prey;
        if (!S.corpses.includes(c) || c.meat <= 0) { a.state = 'graze'; a.prey = null; continue; }
        const { d } = steerTo(a, c.x, c.z, K.walk * 1.5, dt);
        if (d < 10) { a.act = 'eat'; a.hunger -= dt / 8; if ((a.chew = (a.chew || 0) + dt) > 6) { a.chew = 0; c.meat--; } if (a.hunger <= 0) { a.state = 'graze'; a.prey = null; } }
      } else if (a.state === 'follow' && a.owner) {
        const o = x.byId(a.owner);
        if (o) {
          const d = near(a, o);
          if (d > 60) steerTo(a, o.x, o.z, K.run * .7, dt);
          else if (d > 30) steerTo(a, o.x, o.z, K.walk, dt);
          else { steerTo(a, a.x, a.z, 0, dt); a.act = 'eat'; }
          if (a.k !== 'wolf') a.hunger -= dt / 900;   // tame grazers nibble around the camp
        }
      } else {
        // grazing: amble to a spot near home, then nibble
        const { d, hit } = steerTo(a, a.tx, a.tz, K.walk, dt);
        if (d < 6) { a.act = 'eat'; if (!K.predator) a.hunger = Math.max(0, a.hunger - dt / 30); }
        if (a.t <= 0 || hit) {
          a.t = 5 + rnd() * 9;
          const ang = rnd() * TAU, r = 20 + rnd() * 110;
          const px = a.home.x + Math.cos(ang) * r, pz = a.home.z + Math.sin(ang) * r;
          if (land(px, pz)) { a.tx = px; a.tz = pz; }
          a.home.x += (a.x - a.home.x) * .05; a.home.z += (a.z - a.home.z) * .05;   // herds drift
        }
      }
      // spring: young are born if the land around is not already full of their kind
      if (thinkNow && env.season() === 0 && a.sex === 'F' && a.age > 2 && a.bred !== yearIdx) {
        a.bred = yearIdx;
        let n = 0;
        for (const b of S.animals) if (b.k === a.k && Math.abs(b.x - a.x) < 400 && Math.abs(b.z - a.z) < 400) n++;
        if (n < K.cap * (a.owner ? 1.5 : 1) && S.animals.length < 380) for (let k = 0; k < 1 + Math.floor(rnd() * K.litter); k++)
          spawn(a.k, a.x + (rnd() - .5) * 10, a.z + (rnd() - .5) * 10, { age: 0, home: { ...a.home }, owner: a.owner, trust: a.owner ? { [a.owner]: .7 } : {} });
      }
    }
    // animals wander in from beyond when the land around the people has been hunted empty
    if ((popT += dt0) > 30 && S.people.length) {
      popT = 0;
      let cx = 0, cz = 0;
      for (const p of S.people) { cx += p.x; cz += p.z; }
      cx /= S.people.length; cz /= S.people.length;
      for (const k in MIN_AROUND) {
        let n = 0;
        for (const a of S.animals) if (a.k === k && Math.abs(a.x - cx) < 1600 && Math.abs(a.z - cz) < 1600) n++;
        if (n < MIN_AROUND[k]) spawnHerd(k, cx, cz, 1000, 1500);
      }
    }
  }
  return { spawn, populate, hurt, feed, tick, die };
}
