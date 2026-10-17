// The mind of one person. Nothing here says what anyone should do. It only defines:
//  · pain: how much the body and heart hurt, as one number (the first motivation is not to suffer)
//  · a model of the world: for every action they have tried or watched, the average change it brought
//  · likes: how much each thing, person or activity has gone along with feeling better (TD learning)
//  · a purpose in life, which adds its own reward on top of pain relief
// Clever people average over many experiences; dull ones jump to conclusions and see causes everywhere.
import { clamp } from '../../shared/core.js';
import { rnd, gauss } from './util.js';

// what a mind keeps track of (the first eleven are felt in the body or heart)
export const VARS = ['food', 'water', 'warmth', 'energy', 'health', 'sick', 'social', 'fear', 'distress', 'grief', 'desire', 'wealth', 'goal', 'tpain'];
export const NV = VARS.length;
export const [FOOD, WATER, WARMTH, ENERGY, HEALTH, SICK, SOCIAL, FEAR, DISTRESS, GRIEF, DESIRE, WEALTH, GOAL, TPAIN] = VARS.map((_, i) => i);
export const FELT = 11;
// what an onlooker can read off someone else (you can see a person eat and look relieved; you can't see their purpose)
export const VISIBLE = [FOOD, WATER, WARMTH, ENERGY, HEALTH, SICK, SOCIAL, FEAR, DISTRESS, WEALTH];

// ───────── genes ─────────
export function randomTraits() {
  const g = (m, s) => clamp(m + gauss() * s, 0, 1);
  return {
    iq: g(.5, .2), curious: g(.5, .2), soc: g(.5, .2), empathy: g(.5, .22), agg: g(.35, .2),
    greed: g(.5, .2), libido: g(.55, .18), brave: g(.5, .2), open: g(.4, .2),
    // personal sensitivity to each kind of pain: hunger, thirst, cold, tiredness, wounds, sickness, loneliness, fear, distress, grief
    sens: Array.from({ length: 10 }, () => clamp(1 + gauss() * .2, .5, 1.6)),
  };
}
export function inheritTraits(a, b) {
  const o = {};
  for (const k of Object.keys(a)) if (k !== 'sens') o[k] = clamp((a[k] + (b ? b[k] : a[k])) / 2 + gauss() * .1, 0, 1);
  o.sens = a.sens.map((v, i) => clamp((v + (b ? b.sens[i] : v)) / 2 + gauss() * .08, .5, 1.6));
  return o;
}

// ───────── pain ─────────
const q = (t, v) => v >= t ? 0 : ((t - v) / t) ** 2;   // nothing above the threshold, then quadratically worse
export function painOf(e, s) {
  const k = e.tr.sens;
  return k[0] * q(.55, s[FOOD]) + k[1] * 1.3 * q(.6, s[WATER]) + k[2] * q(.5, s[WARMTH]) + k[3] * .6 * q(.3, s[ENERGY])
    + k[4] * 1.6 * (1 - s[HEALTH]) ** 1.5 + k[5] * 1.2 * s[SICK] + k[6] * e.tr.soc * .8 * q(.35, s[SOCIAL])
    + k[7] * (1.3 - e.tr.brave) * s[FEAR] + k[8] * s[DISTRESS] + k[9] * s[GRIEF]
    + (s[DESIRE] > .4 ? ((s[DESIRE] - .4) / .6) ** 2 * 1.1 * e.tr.libido : 0);
}
export function stateOf(e, s = e.sv) {
  s[FOOD] = e.food; s[WATER] = e.water; s[WARMTH] = e.warmth; s[ENERGY] = e.energy; s[HEALTH] = e.health;
  s[SICK] = Math.min(1, e.dis + e.tox); s[SOCIAL] = e.social; s[FEAR] = e.fear; s[DISTRESS] = e.distress;
  s[GRIEF] = e.grief; s[DESIRE] = e.desire; s[WEALTH] = e.wealth; s[GOAL] = e.goalVal; s[TPAIN] = 0;
  return s;
}
// total suffering right now: the body and heart, plus the stench of death and a bleeding wound
export const painNow = e => painOf(e, stateOf(e)) + e.disgust * .5 + e.bleed * 2.5;
// the pain parts, for showing what hurts most
export function painParts(e) {
  const s = stateOf(e), k = e.tr.sens;
  return {
    hunger: k[0] * q(.55, s[FOOD]), thirst: k[1] * 1.3 * q(.6, s[WATER]), cold: k[2] * q(.5, s[WARMTH]), tiredness: k[3] * .6 * q(.3, s[ENERGY]),
    wounds: k[4] * 1.6 * (1 - s[HEALTH]) ** 1.5 + e.bleed * 2.5, sickness: k[5] * 1.2 * s[SICK], loneliness: k[6] * e.tr.soc * .8 * q(.35, s[SOCIAL]),
    fear: k[7] * (1.3 - e.tr.brave) * s[FEAR], distress: k[8] * s[DISTRESS], grief: k[9] * s[GRIEF], stench: e.disgust * .5,
    desire: s[DESIRE] > .4 ? ((s[DESIRE] - .4) / .6) ** 2 * 1.1 * e.tr.libido : 0,
  };
}

// ───────── the world model: what an action does, on average, as far as this person has seen ─────────
// e.M: key -> { n: experience, T: seconds it takes, d: average change of every variable }
// Learning rate: 1/n (a true average) but never below a floor; the floor is high for dull minds,
// so they are ruled by their last few experiences and keep false lessons from a single coincidence.
// gain: the things that ended up in their hands ({ berry: 3 }); they learn what an action yields, too
export function learn(e, key, delta, T, weight = 1, mask = null, gain = null) {
  let m = e.M.get(key);
  if (!m) { m = { n: 0, T, d: new Array(NV).fill(0), g: {} }; e.M.set(key, m); }
  if (!m.g) m.g = {};
  const a = Math.min(1, Math.max(1 / (m.n + 1), .06 + .3 * (1 - e.tr.iq)) * weight);
  if (mask) for (const i of mask) m.d[i] += a * (delta[i] - m.d[i]);
  else for (let i = 0; i < NV; i++) m.d[i] += a * (delta[i] - m.d[i]);
  if (gain) {
    for (const k in m.g) if (!(k in gain)) { m.g[k] *= 1 - a; if (m.g[k] < .02) delete m.g[k]; }
    for (const k in gain) m.g[k] = (m.g[k] || 0) + a * (gain[k] - (m.g[k] || 0));
  }
  m.T += a * (T - m.T);
  m.n += weight;
}
// expected outcome of an action on a target kind; with little experience of this exact pairing
// the estimate is pulled toward what the action did on other targets (Bayesian shrinkage)
const pbuf = { d: new Array(NV).fill(0), T: 0, n: 0, g: null };
export function predict(e, key, akey) {
  const m = e.M.get(key), g = e.M.get(akey);
  if (!m && !g) return null;
  const n = m ? m.n : 0, c = 2, wg = g ? c / (n + c) : 0, wm = 1 - wg;
  for (let i = 0; i < NV; i++) pbuf.d[i] = (m ? m.d[i] * wm : 0) + (g ? g.d[i] * wg : 0);
  pbuf.T = (m ? m.T * wm : 0) + (g ? g.T * wg : 0);
  pbuf.n = n;
  pbuf.g = m && m.g && Object.keys(m.g).length ? m.g : null;   // what it yields is specific to the target
  return pbuf;
}

// ───────── likes (temporal-difference learning over everything they notice) ─────────
// e.W: concept -> value in [-100, 100]: how much its presence has predicted feeling better (or worse).
// Concepts: things ("berry", "river", "fire"), people ("p:12"), groups ("b:3") and activities ("do:chop").
export const like = (e, c) => e.W.get(c) || 0;
export function setLike(e, c, v) {
  e.W.set(c, clamp(v, -100, 100));
  if (e.W.size > 160) {   // forget the faintest feelings
    let wk = null, wv = Infinity;
    for (const [k, w] of e.W) if (Math.abs(w) < wv && !k.startsWith('do:') && k !== '~') { wv = Math.abs(w); wk = k; }
    e.W.delete(wk);
  }
}
// one learning step per second. r: reward over that second; sal: [[concept, salience]] noticed now
// A bias feature ("~", always on) soaks up the steady drift of life (hunger growing by the hour),
// so things and people only take credit or blame for changes that come along with them.
export function tdStep(e, r, sal) {
  sal.push(['~', 1]);
  let V = 0;
  for (const [c, x] of sal) V += like(e, c) * x;
  V /= 100;
  const delta = r + .85 * V - e.Vprev;
  // normalised step (NLMS): the more things share the credit, the less each one gets; keeps learning stable
  let norm = 1;
  for (const el of e.EL.values()) norm += el * el;
  const a = (.5 + .6 * (1 - e.tr.iq)) / norm;
  if (Math.abs(delta) > 1e-4) for (const [c, el] of e.EL) setLike(e, c, like(e, c) + a * delta * el * 100);
  for (const [c, el] of e.EL) { const v = el * .62; if (v < .03) e.EL.delete(c); else e.EL.set(c, v); }
  for (const [c, x] of sal) e.EL.set(c, Math.min(2.5, (e.EL.get(c) || 0) + x));
  e.Vprev = V;
}
// something grabs their attention: it will take the credit (or blame) for what they feel next
export function notice(e, c, amount) { e.EL.set(c, Math.min(3, (e.EL.get(c) || 0) + amount)); }

// ───────── purpose ─────────
// Each purpose is a quantity the person wants to grow (computed in the simulation from what they can see);
// drive converts one unit of it into the same scale as pain.
export const GOALS = {
  survive:   { label: 'to live without pain', drive: 0 },
  better:    { label: 'to make the world a better place', drive: 1.2 },
  wealth:    { label: 'to own everything', drive: .15 },
  power:     { label: 'to rule over others', drive: .35 },
  cruelty:   { label: 'to see others suffer', drive: .9 },
  kill:      { label: 'to kill everyone', drive: .8 },
  love:      { label: 'to be loved', drive: .6 },
  family:    { label: 'to raise a big family', drive: .5 },
  knowledge: { label: 'to know everything', drive: .25 },
  devotion:  { label: 'to serve', drive: .35 },
  builder:   { label: 'to build things that last', drive: .4 },
};
// how strongly each purpose pulls on this person, from temperament and from what life has done to them
export function goalWeights(e) {
  const t = e.tr, x = e.exp;
  return {
    survive: .8,
    better: .4 + t.empathy * 1.1 + x.gifts * .04,
    wealth: .3 + t.greed * 1.1 + x.starved * .25 + x.robbed * .25,
    power: .15 + t.agg * .9 + x.beaten * .12,
    cruelty: .02 + Math.max(0, t.agg - t.empathy) * .7 + x.hurt * .02,
    kill: .01 + Math.max(0, t.agg - .55) * .5 + x.kinKilled * .25,
    love: .35 + t.soc * 1.1,
    family: .4 + t.libido * .6 + t.soc * .3,
    knowledge: .15 + t.curious * .8 + t.iq * .5,
    builder: .15 + t.curious * .3 + t.greed * .3,
    devotion: e.sacred ? .5 + (1 - t.iq) * .9 : 0,
  };
}
export function rollGoal(e) {
  const w = goalWeights(e);
  let sum = 0;
  for (const k in w) sum += w[k];
  let r = rnd() * sum;
  for (const k in w) if ((r -= w[k]) <= 0) return { k, c: k === 'devotion' ? e.sacred : null };
  return { k: 'survive', c: null };
}
export const goalText = g => g.k === 'devotion' && g.c ? `to serve ${conceptName(g.c)}` : GOALS[g.k].label;

// ───────── words ─────────
const NAMES = {
  river: 'the river', sun: 'the sun', moon: 'the moon', rain: 'the rain', snow: 'the snow', storm: 'the storm', fire: 'fire',
  tree: 'fruit trees', pine: 'pines', bush: 'berry bushes', rock: 'the rocks', grass: 'tall grass', reed: 'reeds', shrub: 'shrubs',
  corpse: 'the dead', carcass: 'carcasses', bones: 'bones', grave: 'graves', totem: 'the totem', hut: 'huts', house: 'houses',
  store: 'storehouses', wall: 'walls', pen: 'pens', dam: 'the dam', crop: 'crops', ground: 'the ground', land: 'wandering',
};
export function conceptName(c, people) {
  if (c.startsWith('p:')) { const p = people && people.get(Number(c.slice(2))); return p ? (typeof p === 'string' ? p : p.name) : 'someone dead'; }
  if (c.startsWith('b:')) return 'a band';
  if (c.startsWith('do:')) return c.slice(3);
  if (c.startsWith('ore:')) return `${c.slice(4)} ore`;
  return NAMES[c] || c;
}
// things a person can come to revere (not food in the hand, not other people's names)
export const SACRED = new Set(['river', 'sun', 'moon', 'rain', 'snow', 'storm', 'fire', 'tree', 'pine', 'rock', 'totem', 'grave',
  'deer', 'wolf', 'boar', 'rabbit', 'bones', 'corpse', 'crop', 'bush', 'dam', 'ore:gold']);
