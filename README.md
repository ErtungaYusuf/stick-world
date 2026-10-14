# Stick World

An open-world stick-figure village. Villagers are born, grow up, marry, have children, work and die —
simulated on a Node.js server, stored in SQLite and rendered in the browser.

## Run

```bash
npm install
npm start          # http://localhost:5178
npm test           # 400-year simulation + save/load round trip
```

Requires Node 22.13+ (uses the built-in `node:sqlite`). The world only advances while at least one browser is connected.

## Layout

```
shared/            code used by both sides
  core.js            math, noise, colours
  world.js           deterministic terrain + objects from a seed (same result on server and client)
  motion.js          steering + collision
server/
  index.js           Express (static + REST), WebSocket, 20 Hz simulation loop, autosave every 5 s
  api.js             REST endpoints
  db.js              SQLite schema and queries
  sim/village.js     life cycle, relationships, jobs, economy
public/            frontend (ES modules, no build step)
  js/main.js         boot, input, game loop, frame composition
  js/net.js          fetch + WebSocket client
  js/entities.js     local player, interpolated villagers, effects
  js/figure.js       procedural stick-figure pose and drawing
  js/terrain.js      ground textures and decals
  js/objects.js      trees, rocks, campfire, stockpiles, graves
  js/hud.js          lighting, compass, tooltip, stats panel
test/sim.test.js
```

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/world` | seed and spawn point |
| GET | `/api/state` | full snapshot (same as the WebSocket `state` message) |
| GET | `/api/stats` | population, births, deaths, food / wood / water |
| GET | `/api/events?limit=10` | latest births, marriages, deaths… |
| GET | `/api/people?alive=0&limit=100&offset=0` | everyone who ever lived (`alive=1` for the living) |
| GET | `/api/people/:id` | one person: family, spouse, children, what they are doing now |
| POST | `/api/time` `{ "scale": 40 }` | fast-forward (1–40) |
| POST | `/api/reset` | wipe the database and start a new world |

WebSocket `/ws`: server sends `hello`, `state` (10 Hz), `fx` (hearts, births, deaths), `reset`;
clients send `player` with their position so villagers make room and other players can see them.

## Rules of life

- 1 year = 12 s at normal speed. Height, head size, speed and posture follow age.
- Mortality follows a Gompertz–Makeham curve (plus infant risk); the dead leave a grave for 8 years.
- Marriage needs a man and a woman, both 18–59, at most 12 years apart and not siblings or parent/child.
- Conception needs a married couple, fertility falls with age (women ~18–45), 9-month pregnancy,
  at least 1.6 years between births, ~1.5 % twins, ~105:100 boys to girls; less likely when the food basket is empty
  and as the village approaches its carrying capacity.
- Children take their father's surname and mix both parents' colour and height.
- Jobs: gathering berries (bushes regrow), fishing, chopping wood, fetching water, chatting; children play tag,
  elders rest by the fire; everyone sleeps around the campfire at night, which burns the wood pile.
