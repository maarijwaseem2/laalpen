// Vercel's CLI upload skips any folder named "node_modules", which drops the fonts and icons that
// `expo export` puts under dist/assets/node_modules. Rename that folder and point the bundle at it.
// Run after `npx expo export --platform web`:  node scripts/vercel-prep.mjs
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const from = join(dist, 'assets', 'node_modules');
if (existsSync(from)) renameSync(from, join(dist, 'assets', 'vendor_modules'));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let n = 0;
for (const f of walk(join(dist, '_expo'))) {
  if (!f.endsWith('.js') && !f.endsWith('.css')) continue;
  const s = readFileSync(f, 'utf8');
  if (s.includes('assets/node_modules')) {
    writeFileSync(f, s.replaceAll('assets/node_modules', 'assets/vendor_modules'));
    n++;
  }
}
console.log(`vercel-prep: ${n} file(s) updated`);
