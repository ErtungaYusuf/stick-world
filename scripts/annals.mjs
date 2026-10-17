// Build the annals page from the long runs: node scripts/annals.mjs  →  data/history/annals.html
// (runs chronicle.mjs's summary first, then pours it into scripts/annals-template.html)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = join(ROOT, 'data', 'history');
execFileSync(process.execPath, [join(ROOT, 'scripts', 'chronicle.mjs')], { stdio: 'inherit' });
const data = readFileSync(join(H, 'summary.json'), 'utf8').replace(/</g, '\\u003c');
const page = readFileSync(join(ROOT, 'scripts', 'annals-template.html'), 'utf8').replace('/*DATA*/null', data);
writeFileSync(join(H, 'annals.html'), page);
console.log(`annals → ${join(H, 'annals.html')} (${Math.round(page.length / 1024)} KB)`);
