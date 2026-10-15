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

// One domain for everything: the website (public/home.html + its css/js/fonts) is the home page "/",
// and the Expo web app shell becomes app.html, served for every app route (/login, /teacher, ...) by the
// rewrites in public/vercel.json (Vercel and nginx serve real files first, so "/" is the website).
// public/index.html can't hold the website: Expo uses that file as the app's HTML template.
if (existsSync(join(dist, 'home.html'))) {
  renameSync(join(dist, 'index.html'), join(dist, 'app.html'));
  renameSync(join(dist, 'home.html'), join(dist, 'index.html'));
  console.log('vercel-prep: website -> index.html, app shell -> app.html');
}
