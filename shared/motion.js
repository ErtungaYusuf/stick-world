// Movement used by both the local player (browser) and villagers (server).
import { damp, angDiff } from './core.js';

// accelerate velocity toward (tx, tz) and turn the heading toward the movement
export function steer(e, dt, tx, tz, acc) {
  let dx = tx - e.vx, dz = tz - e.vz;
  const dl = Math.hypot(dx, dz), a = acc * dt;
  if (dl > a) { dx *= a / dl; dz *= a / dl; }
  e.vx += dx; e.vz += dz;
  if (tx * tx + tz * tz > 1) e.heading += angDiff(e.heading, Math.atan2(tz, tx)) * damp(e.turn || 14, dt);
}

// integrate position; water blocks movement, trees/rocks push out. Returns true on any contact.
export function moveCollide(world, e, dt, r, extraSolids = []) {
  let hit = false;
  const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
  if (!world.blocked(nx + Math.sign(e.vx) * r, e.z)) e.x = nx; else { e.vx *= .2; hit = true; }
  if (!world.blocked(e.x, nz + Math.sign(e.vz) * r)) e.z = nz; else { e.vz *= .2; hit = true; }
  if ((e.y || 0) < 30) {
    const push = o => {
      const ox = e.x - o.x, oz = e.z - o.z, d = Math.hypot(ox, oz) || .01, min = o.solid + r;
      if (d < min) { e.x = o.x + ox / d * min; e.z = o.z + oz / d * min; hit = true; }
    };
    for (const o of world.nearbySolids(e.x, e.z)) push(o);
    for (const o of extraSolids) push(o);
  }
  return hit;
}
