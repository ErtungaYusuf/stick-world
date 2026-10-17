// Everything a person can carry, and what can be made from it.
// The physics of the world lives here (what food feeds, what a spear does); nobody is told any of it.
// People (and players) find recipes by trying combinations, and can be wrong about them.
//
// The chains follow the real ones: knapped flint, hafted tools lashed with fibre, pottery fired in a fire,
// ore smelted with charcoal in a furnace, bronze from copper and tin, iron that needs a hotter furnace,
// black powder from saltpetre + charcoal + sulphur, and a bomb that is powder in a sealed pot with a fuse.

export const ITEMS = {
  // food
  berry:        { food: .15, seed: .25, label: 'berries', eat: 'animal' },
  fruit:        { food: .22, seed: .3, label: 'fruit', eat: 'animal' },
  mushroom:     { food: .12, label: 'mushrooms', eat: 'animal' },
  redcap:       { food: .04, poison: .55, vision: true, label: 'red mushrooms' },
  herb:         { food: .02, cure: .3, label: 'herbs' },
  grain:        { food: .07, plant: 'grain', label: 'grain', eat: 'animal' },
  seed:         { food: .03, plant: 'bush', label: 'seeds', eat: 'animal' },
  fish:         { food: .28, germ: .03, eat: 'wolf' },
  meat:         { food: .3, germ: .07, label: 'raw meat', eat: 'wolf' },
  flesh:        { food: .3, germ: .2, human: true, label: 'human flesh', eat: 'wolf' },
  cooked:       { food: .45, label: 'cooked meat', eat: 'wolf' },
  bread:        { food: .4, label: 'flatbread', eat: 'animal' },
  fat:          { food: .1, fuel: 40, label: 'animal fat' },
  // raw materials
  stick:        { fuel: 60, label: 'wood' },
  stone:        {},
  flint:        {},
  clay:         {},
  sand:         {},
  fiber:        { label: 'fibre' },
  resin:        { fuel: 30, label: 'pine resin' },
  fur:          { label: 'hide' },
  bone:         { label: 'bones' },
  'ore:copper': { label: 'copper ore' },
  'ore:tin':    { label: 'tin ore' },
  'ore:iron':   { label: 'iron ore' },
  'ore:gold':   { label: 'gold ore' },
  sulfur:       { label: 'sulphur' },
  saltpeter:    { label: 'saltpetre' },
  // made things
  blade:        { power: .12, cut: 2, label: 'stone blade' },
  spear:        { power: .2, reach: 26, fish: .32 },
  axe:          { power: .14, chop: 12, label: 'stone axe' },
  pick:         { power: .1, dig: 2, label: 'pick' },
  rope:         {},
  glue:         { label: 'pitch glue' },
  net:          { fish: .55, label: 'fishing net' },
  bow:          { power: .2, reach: 95, ammo: 'arrows' },
  arrows:       {},
  pot:          { label: 'clay pot' },
  waterpot:     { drink: .5, back: 'pot', label: 'pot of water' },
  cloak:        { warm: .2 },
  'hide armor': { armor: .25, warm: .1 },
  'iron armor': { armor: .5, warm: .05 },
  torch:        { fuel: 20, label: 'torch' },
  charcoal:     { fuel: 140 },
  bandage:      { stanch: .9 },
  medicine:     { cure: .6, label: 'medicine' },
  copper:       {}, tin: {}, bronze: {}, iron: {}, gold: {},
  'metal blade':{ power: .22, cut: 4 },
  'metal axe':  { power: .22, chop: 7 },
  'metal spear':{ power: .32, reach: 28, fish: .38 },
  'metal pick': { power: .14, dig: 3.5 },
  sword:        { power: .42, reach: 14 },
  scissors:     { power: .06, cut: 6 },
  necklace:     { label: 'gold necklace' },
  powder:       { label: 'black powder' },
  bomb:         { label: 'bomb' },
};
export const label = k => (ITEMS[k] && ITEMS[k].label) || k;
export const edible = k => !!(ITEMS[k] && ITEMS[k].food);
export const TOOLS = new Set(['blade', 'spear', 'axe', 'pick', 'net', 'pot', 'cloak', 'torch', 'metal blade', 'metal axe', 'metal spear', 'metal pick',
  'sword', 'scissors', 'bow', 'hide armor', 'iron armor', 'necklace', 'bomb']);

// the best thing someone carries for a purpose: 'power' (fighting), 'reach', 'chop', 'dig', 'fish', 'cut', 'armor', 'warm'
// (a bow is no weapon without arrows)
export function best(inv, prop) {
  let k = null, v = 0;
  for (const name in inv) {
    const it = ITEMS[name];
    if (inv[name] > 0 && it && it[prop] > v && (!it.ammo || inv[it.ammo] > 0)) { v = it[prop]; k = name; }
  }
  return k;
}

// ───────── recipes ─────────
// [ingredients (repeats mean two of it), where: null (by hand) | 'fire' | 'furnace', result(s), chance per try]
// Results are { item: count }; an ingredient that comes back out (the hammer stone, the pot) is simply listed again.
// 'FIRE' lights a campfire instead of making an item.
const METALS = ['copper', 'bronze', 'iron'];
const FORGE = { copper: .55, bronze: .7, iron: .75 };   // how well each metal takes an edge
const TABLE = [
  // fire
  [['stick', 'stick'], null, 'FIRE', .3],                          // a fire drill
  [['fiber', 'flint', 'stone'], null, { FIRE: 1, flint: 1, stone: 1 }, .75],   // sparks onto dry tinder (only the tinder burns)
  // stone age
  [['stone', 'stone'], null, 'blade', .45],                        // crude chopping flakes
  [['flint', 'stone'], null, { blade: 1, stone: 1 }, .85],         // knapping flint with a hammer stone
  [['stick', 'stone'], null, 'axe', .6],
  [['fiber', 'stick', 'stone'], null, 'axe', .9],                  // lashed: far more often holds together
  [['blade', 'stick'], null, 'spear', .75],
  [['blade', 'fiber', 'stick'], null, 'spear', .95],
  [['blade', 'glue', 'stick'], null, 'spear', .97],
  [['axe', 'stone'], null, 'pick', .5],
  [['bone', 'fiber', 'stick'], null, 'pick', .7],                  // an antler pick
  [['fiber', 'fiber'], null, 'rope', .8],
  [['rope', 'rope'], null, 'net', .6],
  [['rope', 'stick'], null, 'bow', .45],
  [['glue', 'rope', 'stick'], null, 'bow', .8],
  [['flint', 'stick'], null, { arrows: 4 }, .7],
  [['bone', 'stick'], null, { arrows: 3 }, .5],
  [['fur', 'rope'], null, 'cloak', .8],
  [['fiber', 'rope'], null, 'cloak', .45],
  [['fur', 'fur', 'rope'], null, 'hide armor', .65],
  [['fiber', 'herb'], null, 'bandage', .8],
  [['blade', 'fur'], null, { blade: 1, fiber: 3 }, .9],           // cutting hide into strips
  [['fur', 'scissors'], null, { scissors: 1, fiber: 4 }, .95],
  // fire: cooking, pottery, pitch, charcoal
  [['meat'], 'fire', 'cooked', .95], [['fish'], 'fire', 'cooked', .95], [['flesh'], 'fire', 'cooked', .95],
  [['grain', 'grain'], 'fire', 'bread', .75],
  [['clay'], 'fire', 'pot', .7],
  [['resin'], 'fire', 'glue', .85],
  [['stick'], 'fire', 'torch', .95],
  [['fat', 'fiber', 'stick'], 'fire', { torch: 2 }, .95],
  [['stick', 'stick'], 'fire', { charcoal: 2 }, .6],               // wood smothered in the embers
  [['torch'], 'fire', 'charcoal', .8],
  [['herb', 'waterpot'], 'fire', { medicine: 1, pot: 1 }, .7],     // herbs boiled in a pot
  // the furnace: smelting needs charcoal and far more heat than a campfire
  [['charcoal', 'ore:copper'], 'furnace', 'copper', .8],
  [['ore:copper'], 'fire', 'copper', .12],                         // a lucky campfire, rarely
  [['charcoal', 'ore:tin'], 'furnace', 'tin', .85],
  [['ore:tin'], 'fire', 'tin', .3],
  [['charcoal', 'charcoal', 'ore:iron'], 'furnace', 'iron', .6],
  [['ore:gold'], 'furnace', 'gold', .85],
  [['ore:gold'], 'fire', 'gold', .25],
  [['copper', 'tin'], 'furnace', { bronze: 2 }, .8],
  // the forge (a fire, a stone to hammer on)
  ...METALS.flatMap(m => [
    [[m, 'stone'], 'fire', { 'metal blade': 1, stone: 1 }, FORGE[m]],
    [[m, m, 'stick'], 'fire', 'metal axe', FORGE[m]],
    [[m, 'stick', 'stone'], 'fire', { 'metal pick': 1, stone: 1 }, FORGE[m] * .9],
    ...(m === 'copper' ? [] : [[[m, m, m], 'fire', 'sword', FORGE[m] * .7]]),
    [[m, 'metal blade', 'metal blade'], 'fire', 'scissors', .75],   // two blades riveted on a pin
  ]),
  [['copper', 'axe'], null, 'metal axe', .7], [['iron', 'axe'], null, 'metal axe', .8],
  [['copper', 'spear'], null, 'metal spear', .7], [['iron', 'spear'], null, 'metal spear', .8],
  [['metal blade', 'stick'], null, 'metal spear', .85],
  [['metal blade', 'rope', 'stick'], null, 'metal spear', .97],
  [['metal blade', 'metal blade', 'rope'], null, 'scissors', .35],  // lashed shears, wobbly
  [['hide armor', 'iron', 'iron'], 'fire', 'iron armor', .6],
  [['gold', 'rope'], null, 'necklace', .8],
  // gunpowder: saltpetre is what makes it burn fast; without it, it just smoulders
  [['charcoal', 'saltpeter', 'sulfur'], null, { powder: 2 }, .65],
  [['charcoal', 'sulfur'], null, 'powder', .08],
  [['pot', 'powder', 'rope'], null, 'bomb', .75],
  [['pot', 'powder'], null, 'bomb', .3],
];

// "a+b+c", sorted, repeats kept, with "+fire" / "+furnace" for where it's done
export const recipeKey = (items, where = null) => {
  if (!Array.isArray(items)) items = [items];   // (legacy call shape: a single item)
  return items.filter(Boolean).slice().sort().join('+') + (where ? '+' + where : '');
};
export const STATIONS = ['fire', 'furnace'];
export const ingredients = key => {
  const parts = key.split('+'), last = parts[parts.length - 1];
  const where = STATIONS.includes(last) ? last : null;
  const items = where ? parts.slice(0, -1) : parts;
  const need = {};
  for (const k of items) need[k] = (need[k] || 0) + 1;
  // legacy: "a+b+fire" with a true boolean
  return { items, need, where, fire: !!where, a: items[0], b: items[1] || null };
};
const withoutFire = o => { const r = { ...o }; delete r.FIRE; return r; };
const BOOK = new Map(TABLE.map(([items, where, result, p]) => [
  recipeKey(items, where),
  { result: typeof result === 'string' ? result : Object.keys(result)[0], out: typeof result === 'string' ? (result === 'FIRE' ? {} : { [result]: 1 }) : withoutFire(result), p, items, where },
]));

// What happens when someone puts these together. Swappable: a model could answer this one day
// ("what do a stone and a stick make?") and the people would get an open-ended recipe book.
let resolver = key => BOOK.get(key) || null;
export const resolveRecipe = key => resolver(key);
export function setRecipeResolver(fn) { resolver = fn; }
export const ALL_RESULTS = [...new Set(TABLE.map(r => typeof r[2] === 'string' ? r[2] : Object.keys(r[2])[0]))];
// every item that is an ingredient of something (to tell what is worth keeping)
export const USED_IN = (() => {
  const m = new Map();
  for (const [key, r] of BOOK) for (const k of new Set(r.items)) { if (!m.has(k)) m.set(k, []); m.get(k).push(key); }
  return m;
})();
