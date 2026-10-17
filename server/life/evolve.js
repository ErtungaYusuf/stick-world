// Natural selection between whole worlds. Many worlds are founded at once and left to live for some years;
// the one with the most people alive at the end wins. With several rounds, every world of the next round is
// founded by people who carry the genes (mutated), purposes, beliefs, likes and recipes of the winner's survivors.
// Nothing about the people is tuned by hand: viability is whatever survives.
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

export function createEvolution() {
  const status = { running: false, round: 0, rounds: 0, done: 0, total: 0, worlds: 0, years: 0, best: null, leaderboard: [], history: [], error: null, startedAt: 0, finishedAt: 0 };
  let cancelled = false;

  function runRound(worlds, years, ancestors, threads, onProgress) {
    return new Promise((resolve, reject) => {
      const queue = Array.from({ length: worlds }, (_, i) => ({ id: i, seed: 10 + Math.floor(Math.random() * 99990), years, ancestors }));
      const results = [], progress = new Map();
      let best = null, active = 0, finished = 0;
      const pool = [];
      const next = w => {
        if (cancelled || !queue.length) { w.terminate(); active--; if (!active) resolve({ results, best }); return; }
        w.postMessage(queue.shift());
      };
      for (let i = 0; i < Math.min(threads, worlds); i++) {
        const w = new Worker(new URL('./evolve-worker.js', import.meta.url));
        active++;
        pool.push(w);
        w.on('message', m => {
          if (!m.done) { progress.set(m.id, m.progress); onProgress(finished + [...progress.values()].reduce((a, b) => a + b, 0), best); return; }
          progress.delete(m.id);
          finished++;
          results.push(m.summary);
          // only the best world so far is kept whole (each is a megabyte or so)
          if (!best || m.fitness > best.fitness) best = m;
          onProgress(finished, best);
          next(w);
        });
        w.on('error', err => { status.error = String(err && err.stack || err); reject(err); });
        next(w);
      }
    });
  }

  async function start({ worlds = 100, years = 25, rounds = 1, threads = Math.max(1, cpus().length - 2) } = {}, onWinner) {
    if (status.running) throw new Error('an evolution is already running');
    cancelled = false;
    Object.assign(status, { running: true, round: 0, rounds, done: 0, total: worlds * rounds, worlds, years, best: null, leaderboard: [], history: [], error: null, startedAt: Date.now(), finishedAt: 0 });
    let ancestors = null, winner = null;
    try {
      for (let r = 0; r < rounds && !cancelled; r++) {
        status.round = r + 1;
        const base = r * worlds;
        const { results, best } = await runRound(worlds, years, ancestors, threads, (done, b) => {
          status.done = base + done;
          if (b) status.best = b.summary;
        });
        if (!best) break;
        results.sort((a, b) => b.pop - a.pop || b.years - a.years || b.births - a.births);
        status.leaderboard = results.slice(0, 10);
        status.history.push({ round: r + 1, winner: best.summary, alive: results.filter(s => s.pop > 0).length, mean: Math.round(results.reduce((a, s) => a + s.pop, 0) / results.length * 10) / 10 });
        winner = best;
        // the next round descends from the winner's survivors (or, if all died, the founders keep their old ways)
        ancestors = best.heritage.length >= 4 ? best.heritage : ancestors;
      }
      if (winner && !cancelled) await onWinner(winner);
    } catch (err) {
      status.error = String(err && err.message || err);
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
    }
  }
  const cancel = () => { cancelled = true; };
  return { status, start, cancel };
}
