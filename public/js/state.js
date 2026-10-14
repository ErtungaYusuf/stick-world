// Shared client state, canvas and camera projection.
export const G = {
  W: 0, H: 0, DPR: 1,
  cam: { x: 0, z: 0, zoom: 1.5, tz: 1.5 },
  time: 0, lastDt: 1 / 60,
  world: null,              // shared/world.js instance (same seed as the server)
  // latest server state
  dayT: .12, year: 0, timeScale: 1, village: null,
  people: new Map(),        // id -> rendered villager (interpolated + animated locally)
  others: new Map(),        // other connected players
  graves: [], picked: new Set(), chopping: new Set(), shake: new Map(),
  myId: null, online: false,
  // local-only effects & input
  particles: [], hearts: [], ghosts: [],
  keys: {}, mouse: { x: -999, y: -999 }, hovered: null, follow: null,
};

export const cv = document.getElementById('c');
export const ctx = cv.getContext('2d');
export const dark = document.createElement('canvas');
export const dctx = dark.getContext('2d');

export function resize() {
  G.DPR = Math.min(window.devicePixelRatio || 1, 2);
  G.W = innerWidth; G.H = innerHeight;
  cv.width = dark.width = Math.round(G.W * G.DPR);
  cv.height = dark.height = Math.round(G.H * G.DPR);
}

// Orthographic camera tilted ~38° (Don't Starve / Clash of Clans style). North = up (-z), East = right (+x).
export const TILT = 0.62, HK = 0.86;
export function proj(x, y, z) {
  const c = G.cam;
  return [(x - c.x) * c.zoom + G.W / 2, ((z - c.z) * TILT - y * HK) * c.zoom + G.H / 2];
}
