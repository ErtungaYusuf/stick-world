// Shared client state, canvas and camera projection.
export const G = {
  W: 0, H: 0, DPR: 1,
  cam: { x: 0, z: 0, zoom: 1.5, tz: 1.5 },
  time: 0, lastDt: 1 / 60,
  world: null,              // shared/world.js instance (same seed as the server)
  // latest server state
  dayT: .3, year: 0, timeScale: 1, season: 0, sf: 0, rain: 0, storm: 0,
  people: new Map(),        // id -> rendered person (interpolated + animated locally)
  animals: new Map(),       // id -> rendered animal
  others: new Map(),        // other connected players
  corpses: [], fires: [], structs: [], crops: [],
  picked: new Set(), chopping: new Set(), shake: new Map(),
  blood: [], throws: [], hurtT: 0, me: null, teleport: null, felled: new Map(), felledVer: 0, serverFelledVer: 0, falling: new Map(),
  speed: 1, chiefs: new Set(), bands: {},
  myId: null, online: false,
  // local-only effects & input
  particles: [], hearts: [], flashes: [],
  keys: {}, mouse: { x: -999, y: -999 }, hovered: null, follow: null,
};

export const cv = document.getElementById('c');
export const ctx = cv.getContext('2d');
export const dark = document.createElement('canvas');
export const dctx = dark.getContext('2d');

G.renderScale = 1;   // lowered automatically when frames get slow (see main.js)
export function resize() {
  G.DPR = Math.min(window.devicePixelRatio || 1, 1.5) * G.renderScale;   // beyond 1.5× the extra sharpness costs more than it shows
  G.W = innerWidth; G.H = innerHeight;
  cv.width = Math.round(G.W * G.DPR);
  cv.height = Math.round(G.H * G.DPR);
  dark.width = Math.ceil(G.W / 4);    // the night layer is all soft gradients: a quarter resolution is plenty
  dark.height = Math.ceil(G.H / 4);
}

// Orthographic camera tilted ~38° (Don't Starve / Clash of Clans style). North = up (-z), East = right (+x).
export const TILT = 0.62, HK = 0.86;
export function proj(x, y, z) {
  const c = G.cam;
  return [(x - c.x) * c.zoom + G.W / 2, ((z - c.z) * TILT - y * HK) * c.zoom + G.H / 2];
}

// the same seasonal temperature curve as the server (0 spring … 3 winter)
export const yearFrac = () => (G.season + G.sf) / 4;
export const seasonTemp = () => .19 * Math.cos(Math.PI * 2 * (yearFrac() - .375)) - .07;
