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

// Stale-chunk guard: a tab (or a home-screen shortcut) still holding an old app.html asks for a JS chunk that no
// longer exists after a deploy (or that the old laalpen-app domain used to redirect cross-origin). Reload once to
// get the fresh HTML; sessionStorage stops a reload loop.
const appHtml = join(dist, existsSync(join(dist, 'app.html')) ? 'app.html' : 'index.html');
const GUARD = `<script>(function(){var K='laalpen.chunk-reload';function again(){try{var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<60000)return;sessionStorage.setItem(K,String(Date.now()));}catch(e){return;}location.reload();}
window.addEventListener('error',function(e){var s=e&&e.target;if(s&&s.tagName==='SCRIPT'&&/\\/_expo\\/static\\//.test(s.src||''))again();},true);
window.addEventListener('unhandledrejection',function(e){var m=String((e&&e.reason&&(e.reason.message||e.reason))||'');if(/Loading module|ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(m))again();});
window.addEventListener('load',function(){setTimeout(function(){try{sessionStorage.removeItem(K);}catch(e){}},15000);});})();</script>`;
if (existsSync(appHtml)) {
  const html = readFileSync(appHtml, 'utf8');
  if (!html.includes('laalpen.chunk-reload')) {
    writeFileSync(appHtml, html.replace('<head>', `<head>${GUARD}`));
    console.log(`vercel-prep: stale-chunk reload guard added to ${appHtml.split('/').pop()}`);
  }
}
