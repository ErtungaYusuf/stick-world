# Stick World

A game-theory sandbox with stick figures. Nobody in it is told what to do. Every person has a body that hurts,
a few belongings only they control, a purpose in life, and a mind that learns from experience. Theft, gifts,
worship, burial, cannibalism, leadership, farming, taming animals, plague doctors and war are not programmed:
they happen when they pay off for someone, the way that person sees it — and people can be wrong.

Simulated on a Node.js server, stored in SQLite, rendered in the browser.

## Run

```bash
npm install
npm start          # http://localhost:5178
npm test
```

Requires Node 22.13+ (built-in `node:sqlite`). The world only advances while a browser is connected.

## How a mind works (`server/life/mind.js`, `server/life/sim.js`)

- **Pain** is one number: hunger, thirst, cold, tiredness, wounds and bleeding, sickness, loneliness, fear, distress,
  grief, the stench of the dead and unmet desire, each felt more or less strongly by each person.
  Not suffering is everyone's first motivation.
- **Purpose**: drawn at twelve from temperament and life so far, and it can change on any birthday (often toward the
  purpose of someone they admire): to make the world a better place, to own everything, to rule others, to see others
  suffer, to kill everyone, to be loved, to raise a big family, to know everything, to serve something sacred, to build
  things that last — or just to live without pain. Each purpose is a quantity they want to grow.
- **World model**: for every action-on-a-kind-of-thing they have tried, watched or been told about, the average change it
  brought (to every need, to their wealth, their purpose, the other person's pain) and what it put in their hands.
  Clever minds average over many experiences; dull ones are ruled by the last few and keep false lessons from a
  single coincidence. Delayed consequences (the stomach ache an hour after the mushrooms) are pinned on what they did before.
- **Likes**: temporal-difference learning over everything they notice. Whatever is around when life gets better
  (a person, the river, the sun, a ritual, an activity) is liked a little more; whatever is around when it gets worse
  is blamed. A bias term soaks up the steady drift of life so bystanders aren't blamed for hunger.
  Dull minds notice more of the background and credit it — superstition. Someone who wants a better world and sees a
  tree felled while things feel better comes to like felling trees.
- **Choosing**: every option in sight (and remembered places out of sight) is scored by the relief it is expected to
  bring 25 seconds from now, plus what it yields (valued by how much they'll need it later, discounted by patience),
  plus progress on their purpose, plus what it does to the other person as they feel about them (love makes another's
  pain hurt, hatred makes it sweet for the hot-tempered), plus how much they've come to love doing it, plus curiosity
  for the untried; then picked with noise (more for dull minds). Long tasks are reconsidered when something hurts.
- **Learning from others**: everyone watching learns what an action did to the person doing it (children most of all,
  babies too from their mother's arms). Talk spreads one story and one feeling; teaching passes on the most confident
  beliefs, likes and a recipe — true or false.
- **Instinct** (biology, not learning): a parent's love for a newborn, a soft spot for small children, the urge and
  its instinct at puberty, babies nursed and carried. Close kin don't mate; lovemaking needs two adults who both want it.
  Nobody is excluded from violence: children can fight and be attacked, by people and by wolves.

## The world (`server/life/env.js`, `animals.js`, `items.js`)

- One day = 60 s, one year = 6 days = 360 s at speed ×1; four seasons with a temperature swing, rain, storms, lightning,
  snow and frozen water in the north. Berries, fruit, mushrooms and herbs only in season; felled trees regrow over decades.
- Animals graze, flee, breed and are hunted; wolves hunt prey and, starving at night, lone people. Animals that are fed
  come to trust the feeder and follow them — tame.
- Fire burns fuel and goes out; it spreads to trees and wooden buildings in dry weather. Bodies lie where they fell,
  rot, stink and breed disease; drinking near them is dangerous. Sicknesses spread by contact; herbs and medicine help.
- Crafting is trying combinations: two sticks may light a fire, stone on stone makes a blade, blade + stick a spear,
  clay over fire a pot, ore over fire metal, charcoal + sulfur blasting powder, powder in a pot a bomb… The table lives in
  `items.js` behind `setRecipeResolver`, so a model could one day answer "what do these two make?".
- Ore shows as coloured rocks in rocky ground (copper, iron, gold, sulfur). Buildings: hut, stone house, store, wall,
  totem, pen, dam, grave. Seeds come from eaten fruit; planted ones grow into crops.
- Belongings: inventory only its owner controls; others can only take it by stealing. When someone dies, what they had
  goes to the person they loved most.

## What is read off the people (`server/life/society.js`) — names only, no behaviour

Bands (friendship clusters), leaders (whoever many choose to follow), faiths (people who revere the same thing and
pray to it), roles (what they actually spend their life doing: hunter, thief, killer, healer, plague doctor, priest…),
settlements (clusters of buildings), wars (bands that keep drawing each other's blood), plagues.

The world starts with three bands of twelve, each around its own fire, far apart and strangers to one another.

## Evolution between worlds (`server/life/evolve.js`)

`evolve 100 25` (terminal) or `POST /api/evolve {worlds, years, rounds}` founds that many worlds at once in worker
threads (one per CPU core) and lets each live that many years. The world with the most people alive at the end wins
and replaces the live world. With `rounds > 1`, every world of the next round is founded by people carrying the genes
(mutated), purposes, beliefs, likes and recipes of the previous winner's survivors — selection, not hand-tuning,
decides what kind of people make it.

## Drawing fast (`public/js/objects.js`, `terrain.js`, `hud.js`)

- Trees, bushes, rocks and animals are rendered once per look (kind × shape variant × season × walking frame) into small
  bitmaps at three resolutions, like mipmaps, and stamped; swaying is a skew of the stamp.
- Zoomed far out, each map chunk's plants, rocks and shadows become one image, rebuilt only when the season or the
  chunk's felled trees change. Flowers, pebbles and still grass are baked into a per-chunk ground layer.
- Night is a quarter-resolution darkness layer with pre-rendered light glows.
- Newly visible chunks are generated a few per frame, nearest first; the render resolution drops automatically if
  frames come too slowly and recovers when they don't. Terminal: `fps`, `bench [frames]`.

## Watching and listening (`public/js/sound.js`, `main.js`)

- **F** hands the camera to a director that goes wherever the most is happening (fights, people beaten down, hunts…)
  and stays a while on each; walking takes the camera back.
- All sound is synthesised with WebAudio, no files: blows, blocks, axes, falling trees, fire, thunder, deaths, plus
  wind, rain, birds by day, crickets and wolf howls at night — placed by distance and panned. **M** mutes.
- Everyone has health; a fight is blows that land or get blocked until someone is beaten to the ground (lying there
  a few seconds) or dies. Wounds keep bleeding, edged weapons much more.

## Playing: you are a stranger among them (`server/life/players.js`, `public/js/player.js`)

- You have a body with health, belongings and a recipe book of your own, kept per browser (a token in localStorage)
  and saved with the world. Die and everything you carried lies with your body (anyone may loot it); you wake up elsewhere.
- **E** does the sensible thing with what is in front of you: pick, break off branches, fell a tree (with an axe),
  break stone (sometimes flint), mine ore (better with a pick), dig clay or sand at the water, fill a pot, butcher or
  loot a body, harvest crops, feed a fire, raise a building site. **R** strikes with your best weapon (a bow needs
  arrows), **Q** throws a bomb at the mouse, **I** opens the bag: a bench with up to three things, done by hand, in a
  fire or in a furnace; the recipes you know; and building sites to lay out. Terminal: `name <you>`.
- Nothing about you is special to the people: they see you, notice what you do to them, and like or hate you through
  the same learning as anyone. They may attack you, flee from you, or learn recipes by watching you — and you learn
  every recipe you watch them make.

## Crafting (`server/life/items.js`)

Real chains, the same for people and players, found by trying (and wrong guesses cost materials):
knapped flint → blades, spears (lashed with fibre or glued with pine-resin pitch), axes, picks, bows and arrows ·
fibre → rope, nets, bandages · hide → cloaks, hide armour · clay fired → pots; pot of water + herbs boiled → medicine ·
wood smothered in embers → charcoal · a **furnace** (stone + clay) smelts ore with charcoal: copper, tin, iron (needs
more charcoal), gold; copper + tin → bronze · forging metal at a fire with a hammer stone → metal blades, axes, picks,
swords; two blades riveted → scissors · iron + hide armour → iron armour · saltpetre + charcoal + sulphur → black
powder (without saltpetre it barely works) · powder in a pot with a rope fuse → bomb.
Ores show as coloured rocks: copper (orange), tin (dark grey), iron (rust), gold, sulphur (yellow, hot lands),
saltpetre (white crust, warm dry lands).

How people come to make things, without being told: a tool takes credit for what was gained with it, a material is
worth what the recipes they know turn it into, an untested material has the value of finding out (curiosity, much
stronger in the young), and a recipe seen being made is often learned on the spot.

## Layout

```
shared/             core.js (math, noise) · world.js (terrain, objects, ore from a seed) · motion.js
server/
  index.js          Express, WebSocket, simulation loop (coarser steps above ×20), save every 20 s
  api.js · db.js    REST endpoints · SQLite (people, events, the saved world)
  life/             sim.js (people, perception, choosing, learning, body, birth, death, reports)
                    mind.js · actions.js · env.js · animals.js · items.js · society.js · util.js (grid, A*)
public/js/          main.js · entities.js · figure.js · beasts.js · objects.js · hud.js · terminal.js · terrain.js
test/sim.test.js
```

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/world` · `/api/state` · `/api/stats` | seed and spawn · full snapshot · summary |
| GET | `/api/events?limit=20&type=killing` | the chronicle |
| GET | `/api/people?q=name` · `/api/people/:id` | everyone who ever lived · one person, mind included |
| GET | `/api/people/:id/why` | the options they are weighing right now, with the value of each |
| GET | `/api/society` · `/api/economy` · `/api/settlements` · `/api/felled` | what emerged |
| POST | `/api/speed` `{speed}` · `/api/fertility` · `/api/capacity` · `/api/time` · `/api/reset` | controls |

## Terminal (the ⌨ button on the left, or **`**)

`speed <0-200>` · `p` / `r` · `inspect <name>` · `why <name>` · `society` · `economy` · `leaders` · `stats` ·
`events [n] [type]` · `find` / `follow` / `goto <name>` · `fertility` · `aging` · `capacity` ·
`evolve [worlds] [years] [rounds]` / `evolve status` / `evolve cancel` · `fps` · `bench` · `reset confirm`.
