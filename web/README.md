# LaalPen website

Simple static website (HTML + CSS + JS). No build step, no npm, no framework.
Har "Open app" button **mobile app** kholta hai — web wala app kabhi nahi khulta.

## Chalana (local)

```bash
cd web
python3 -m http.server 8090
# browser: http://localhost:8090
```

(VS Code mein "Live Server" extension se bhi chal jata hai.)

## Settings — `config.js`

| Setting | Kya hai |
|---|---|
| `appScheme` | `laalpen` — `app/app.config.ts` ki `scheme` jaisa hi hona chahiye |
| `androidPackage` | `pk.laalpen.app` — `app.config.ts` ka `android.package` |
| `playStoreUrl` | Play Store link (app publish hone ke baad) |
| `apkUrl` | Jab tak Play Store pe nahi, direct APK link (Google Drive / GitHub Release) |
| `appStoreUrl` | iPhone App Store link |
| `contactEmail`, `contactWhatsApp` | "Contact / Talk to us" links. WhatsApp number `923001234567` format mein |

Links khali hon to site likhti hai "app jald aa rahi hai, apne school se link lein".

## "Open app" kaise kaam karta hai

- **Android (Chrome):** `intent://open#Intent;scheme=laalpen;package=pk.laalpen.app;S.browser_fallback_url=...;end`
  App installed hai to seedha app khulti hai; nahi to Chrome khud Play Store / APK link pe le jata hai.
- **iPhone:** `laalpen://` khulta hai; 1.6 second mein app na khule to App Store link (ya "Get the app" box).
- **Computer:** wahan mobile app nahi hoti, is liye QR code dikhta hai. Phone se scan karein → `?open=1` page → "Open the app" button.

## Test karna (zaroori baat)

**Expo Go mein `laalpen://` kaam nahi karta** — Expo Go ka apna `exp://` scheme hai.
Deep link test karne ke liye app ka development ya production build chahiye:

```bash
cd app
npx expo run:android          # phone USB se connected ho
# ya: eas build -p android --profile preview   (APK banata hai)
```

Phir phone ke Chrome mein site kholein (same WiFi: `http://<computer-ip>:8090`) aur "Open app" dabayein.
Sirf link check karna ho to: `adb shell am start -a android.intent.action.VIEW -d "laalpen://"`

## Free deploy

- **Netlify:** app.netlify.com → "Add new site" → "Deploy manually" → `web` folder drag & drop.
- **GitHub Pages:** `web` folder ko repo mein daalein → Settings → Pages → branch select.
- **Cloudflare Pages:** same, free, Pakistan mein fast.

Apna domain (e.g. `laalpen.pk`) baad mein in teeno pe free connect hota hai.

## Baad mein (recommended)

Custom scheme (`laalpen://`) ke bajaye **Android App Links / iOS Universal Links** lagayein
(`https://laalpen.pk/open` seedha app kholega, koi "Open with?" sawal nahi). Iske liye domain chahiye
aur `/.well-known/assetlinks.json` + `apple-app-site-association` files is website pe rakhni hoti hain.

## Files

- `index.html` — page
- `styles.css` — design (light + dark automatic), mobile pe side button neeche pill ban jata hai
- `main.js` — open-app logic, QR, animation
- `config.js` — upar wali settings
- `vendor/qrcode.js` — QR generator (MIT license)
- `fonts/` — Lexend, Caveat, Kalam (OFL license), self-hosted
- `assets/` — icon, favicon, sample checked copy
