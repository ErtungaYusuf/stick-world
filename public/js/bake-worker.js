// Background thread that computes ground textures so walking into new terrain never stalls the frame.
import { createWorld } from '/shared/world.js';
import { bakePixels } from './ground.js';

let world = null;
self.onmessage = ({ data }) => {
  if (data.t === 'init') { world = createWorld(data.seed); return; }
  if (data.t === 'bake' && world) {
    const px = bakePixels(world, data.cx, data.cz);
    self.postMessage({ k: data.k, px }, [px.buffer]);
  }
};
