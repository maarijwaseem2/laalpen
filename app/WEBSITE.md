# LaalPen website (part of the app)

Website aur web app **ek hi domain** par hain: **https://laalpen.vercel.app**

- `/` — website (`public/home.html` + `public/styles.css`, `main.js`, `config.js`, `fonts/`, `vendor/`, `assets/`)
- `/login`, `/admin`, `/teacher`, `/student`, `/parent` ... — Expo web app
- `/LaalPen.apk` — Android app download (release step `dist/` mein copy karta hai, git mein nahi)

Plain HTML + CSS + JS hai, koi framework nahi. `public/index.html` is liye nahi ke Expo us file ko app ke
HTML template ki tarah use karta hai; `scripts/vercel-prep.mjs` build ke baad `home.html` → `index.html`
aur app ka shell → `app.html` kar deta hai. `public/vercel.json` (Vercel) aur `nginx.conf` (Docker) baqi
saare routes `app.html` par bhejte hain.

## Build / deploy (ek command)

```bash
cd app
npm run build:web          # expo export + vercel-prep -> dist/ (website + app)
cp <path>/LaalPen.apk dist/  # optional: APK download
npx vercel deploy --prod   # dist/ folder, Vercel project "laalpen-app" (domain laalpen.vercel.app)
```

Docker: `docker compose up -d --build app` → http://localhost:8081 (website `/`, app `/login`).

## Settings — `public/config.js`

| Setting | Kya hai |
|---|---|
| `webAppUrl` | `/login` — isi site par web app |
| `appScheme` | `laalpen` — `app.config.ts` ki `scheme` jaisa |
| `androidPackage` | `pk.laalpen.app` — `app.config.ts` ka `android.package` |
| `playStoreUrl` | Play Store link (publish hone ke baad) |
| `apkUrl` | `/LaalPen.apk` |
| `appStoreUrl` | iPhone App Store link |
| `contactEmail`, `contactWhatsApp` | "Contact / Talk to us" links (`923001234567` format) |

## "Open app" kaise kaam karta hai

- **Computer:** seedha web app (`/login`) khulta hai.
- **Android (Chrome):** `intent://open#Intent;scheme=laalpen;package=pk.laalpen.app;S.browser_fallback_url=...;end` —
  app installed hai to app khulti hai, warna Chrome web app (`/login`) par le jata hai. APK footer aur "Get the app" box mein hai.
- **iPhone:** `laalpen://`; 1.6 second mein app na khule to web app.
- Header mein "Log in" link bhi `/login` par jata hai.

Deep link test: Expo Go mein `laalpen://` kaam nahi karta; release APK chahiye
(`adb shell am start -a android.intent.action.VIEW -d "laalpen://"`).

## Baad mein (recommended)

Custom scheme ke bajaye **Android App Links / iOS Universal Links** (`/.well-known/assetlinks.json` +
`apple-app-site-association` `public/.well-known/` mein).

## Files (`app/public/`)

- `home.html` — website page (build mein `/`)
- `styles.css`, `main.js`, `config.js`
- `vendor/qrcode.js` — QR generator (MIT)
- `fonts/` — Lexend, Caveat, Kalam (OFL), self-hosted
- `assets/` — icon, favicon, sample checked copy
- `vercel.json` — rewrites + security headers
