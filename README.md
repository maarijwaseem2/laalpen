# LaalPen — AI copy checking for schools

Teacher poori class ki copies ki photo leta hai → AI har sawal check karke **laal pen** se copy pe nishan lagata hai → sirf mushkil copies teacher ke paas aati hain → teacher approve karta hai → student aur parent (mobile number se, bina email) ko checked copy milti hai.

| Folder | Kya hai | Port |
| --- | --- | --- |
| `backend/` | NestJS + Prisma 7 + PostgreSQL — data, login/2FA/passkeys, roster, queue (pg-boss), notifications | 4000 |
| `ai-service/` | FastAPI (Python) — OpenAI/Gemini checking, photo gate, QR + OMR scanning, laal-pen annotation | 8000 |
| `app/` | Expo + React Native Paper — **ek hi code: Android, iOS aur Web** (English + اردو). Website bhi yahin hai (`app/public/home.html` → `/`, app `/login` waghera par; dekhein `app/WEBSITE.md`) | 8081 |
| `e2e/` | Browser test jo poora flow (12 steps) chalata hai | — |

**Live:** website + web app ek hi domain par — https://laalpen.vercel.app (website `/`, app `/login`, Android APK `/LaalPen.apk`); API https://laalpen-backend.onrender.com. Purana `web/` folder ab `app/public/` mein hai (`app/WEBSITE.md`).

`ROADMAP.md` mein saare phases (A, B, C) aur un ka status hai.

---

## 1. Ek dafa install karo

1. **Node.js 22 LTS** — https://nodejs.org
2. **Python 3.12** — https://python.org (Windows: "Add to PATH" tick karna)
3. **PostgreSQL 16** — aap ke paas pehle se hai ✔ (ya Docker Desktop se `docker compose up -d db`)
4. **VS Code** — `laalpen.code-workspace` double-click karke kholo
5. Phone pe **Expo Go** (Play Store / App Store)

## 2. Sirf do cheezen badalni hain

**(a) Apna PostgreSQL database** — `backend/.env` kholo aur `DATABASE_URL` mein apna user, password aur database ka naam likho:

```env
DATABASE_URL="postgresql://postgres:APNA_PASSWORD@localhost:5432/laalpen?schema=public"
```

Database (jaise `laalpen`) pgAdmin / psql mein pehle se bana hona chahiye (`CREATE DATABASE laalpen;`). **Tables khud mat banana** — migrations banayengi.

**(b) Apni OpenAI key** — `ai-service/.env` mein:

```env
OPENAI_API_KEY=sk-...
```

Bas. Key na ho to bhi sab chalta hai (free **mock mode** — asli laal-pen nishan, demo marks).
Baqi sab (`.env` ki baaki lines) abhi free defaults pe hain; paid services baad mein sirf `.env` badal kar on hoti hain (section 6).

## 3. Pehli dafa setup — migrations + seed

VS Code terminal mein (root folder `laalpen/` se):

```bash
# Backend: packages + tables (migrations) + demo school (seed)
cd backend
npm install
npx prisma migrate deploy     # saari tables, indexes, security (RLS, audit lock) — 7 migrations
npm run db:seed               # demo school, teachers, students, tests, checked copies
cd ..

# AI service
cd ai-service
python -m venv .venv
# Windows:   .venv\Scripts\activate
# Mac/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..

# App
cd app
npm install
cd ..
```

- Ek command mein bhi: `cd backend && npm run setup` (= generate + migrate deploy + seed).
- **Seed dobara chalana safe hai** — kuch bhi double nahi hota (sab upsert hai).
- Naya update aaye (nayi migration) to bas `npx prisma migrate deploy` dobara chalao — purana data rehta hai.
- Bilkul zero se shuru karna ho (**saara data mit jata hai**, sirf apne computer pe): `npm run db:reset`.
- Production mein demo data na chahiye: `.env` mein `SEED_DEMO=false`.

## 4. Roz chalana

VS Code: **Terminal → Run Task → "Start servers"** (apna PostgreSQL) ya "Start everything" (Docker wala database bhi). Ya teen terminals:

```bash
cd backend && npm run dev                                   # http://localhost:4000/api  (docs: /api/docs)
cd ai-service && python -m uvicorn app.main:app --reload --port 8000
cd app && npx expo start                                    # web ke liye "w" dabao → http://localhost:8081
```

Check: http://localhost:4000/api/health → `"database":"up"`, `"aiService":"openai"` (key daali ho to) ya `"mock"`.

### Phone pe chalana
- **Expo Go:** phone aur computer **ek hi Wi-Fi** pe. `npx expo start` ka QR code scan karo. App khud computer ka IP dhoond leti hai.
- Photos upload ke liye `backend/.env` mein `PUBLIC_API_URL=http://<computer-ka-WiFi-IP>:4000` likho (jaise `http://192.168.1.20:4000`).
- Windows firewall pooche to Node.js ko "Private network" allow karo.
- Google login, push notifications, passkeys (phone pe) ke liye development build: `npx expo run:android`.

### Demo logins (password sab ka `Demo@1234`)
| Role | Login |
| --- | --- |
| Admin / Principal | admin@laalpen.demo — pehli dafa **authenticator app** lagwata hai (Google/Microsoft Authenticator) |
| Teacher (Physics 9-A, 9-B, Maths 9-A) | sana.teacher@laalpen.demo |
| Teacher | imran.teacher@laalpen.demo |
| Student (9-A, roll 03) | ali.raza@laalpen.demo |
| Student jiska link teacher karega | saad.pending@laalpen.demo (Join requests mein "Saad Qamar, roll 09" suggestion) |
| **Parent** | "Parent login" → mobile **0300 1112233** → code backend terminal mein print hota hai (Ali 9-A + Danish 10-A, dono bhai) |

Class codes: **ALN-9A**, **ALN-9B**, **ALN-10A**. Class 10-A ke students sirf register pe hain (app account nahi) — jaise asal schools mein pehle din hota hai.

Emails/SMS keys na hon to **saare codes backend terminal mein** print hote hain: `[console email] to=... code=123456`, `[console sms] to=+92... code=123456`.

---

## 5. App mein kya kya hai

**Roster (register pehle, account baad mein)**
- Admin **Excel/CSV import**: GR No, Name, Father Name, Class, Section, Roll, DOB, Mobile (English ya Urdu column names). Pehle "dry run" — kya naya, kya update, kya galat; phir save. Dobara import → update hota hai, duplicate nahi.
- Teacher **quick add** ("01 Ali Raza, 0300 1234567" har line), **class code** (har section ka alag, badla ja sakta hai), **claim cards** (PDF, QR ke saath — student aur parent).
- Student **class code + roll + date of birth** se join → register se match ho to **foran andar** (approval nahi). Match na ho to teacher ko "Is this… Saad Qamar, roll 09?" suggestion → ek tap link.
- **Mark as left** (marks mehfooz), **school year + promotion** wizard (repeat karne wale untick), enrollment history.

**Checking**
- Answer key → AI marking scheme (final answer, steps, rules) → teacher confirm (versions).
- **Capture whole class**: roll list ke hisaab se photo → agla student; upload background mein (net chala jaye to phone pe save, baad mein khud upload). Class khatam → **ek hi notification**.
- **Pile of photos, kisi bhi order mein**: QR booklets / QR stickers print karo → saari photos ek saath upload → khud sahi student aur page pe lagti hain.
- **OMR bubble sheets** (sirf MCQ tests): print → photo → **AI ke baghair** foran marks (free). Do circle bhare hon to teacher ko "Check".
- Photo gate (blur/dark/glare/cut/duplicate) — kharab photo pe AI ka paisa nahi lagta; sirf "retake" alert.
- Sure / Check / Unreadable har jawab pe; "Approve all sure copies"; **question-by-question grading** (ek jaise jawab ek tap mein, comment bank, keyboard shortcuts).
- **Overnight mode** (Batch API, aadhi qeemat) — koi copy foran chahiye to "Check now".
- Voice note, mark history, published marks **re-open** (password dobara + wajah + principal ko alert).

**Parents & students**
- Parent **mobile number se login** (SMS/WhatsApp code) — saare bachche (bhai/behan) ek jagah; result WhatsApp/SMS pe link ke saath (bina app ke khulta hai).
- Student/parent: average, trend, strong/practise topic, checked copy, voice note, share.
- **اردو** (right-to-left, Nastaliq font) — login screen ya profile se switch. Urdu copies Gemini se (key ho to).

**Principal**
- **Insights**: photo→result time, kitni copies kis ke paas ruki hain, teachers, classes, **topic × class heatmap**.
- **Excel/CSV export** (board SBA / ERP) — "confirm it's you" ke baad.
- Activity log (koi edit/delete nahi kar sakta — database bhi rokta hai).

**Security**
- Admin: authenticator app (TOTP) ya **passkey** zaroori; 10 backup codes.
- Naya device → email code + alert email ("ye main nahi tha" link sab sessions band karta hai).
- Account lock after 10 ghalat passwords, leaked-password check, refresh-token chori pakarna, "Signed in now" list.
- Har school ka data alag (app checks + PostgreSQL row-level security).

## 6. Keys — abhi free, baad mein paid (sirf `.env` badlo)

| Cheez | Key na ho to | Kahan daalni hai |
| --- | --- | --- |
| AI checking | Mock mode | `ai-service/.env` → `OPENAI_API_KEY` (model `OPENAI_MODEL=gpt-5-mini`) |
| Urdu copies | OpenAI hi | `ai-service/.env` → `GEMINI_API_KEY` |
| Email | Terminal mein print | `backend/.env` → `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (Brevo free 300/din) |
| Parent SMS / WhatsApp | Terminal mein print | `backend/.env` → `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, ya `SMS_PROVIDER=twilio`/`http` |
| Files | `backend/uploads/` | `STORAGE_DRIVER=s3` + `S3_*` (Cloudflare R2 free 10 GB) |
| Google login | Button "not set up" | Firebase (`app/.env` + `FIREBASE_PROJECT_ID`) |
| Error monitoring | Off | `SENTRY_DSN` (backend aur ai-service) |
| Passkeys (live domain) | localhost | `WEBAUTHN_RP_ID=app.yourschool.pk`, `WEBAUTHN_ORIGINS=https://app.yourschool.pk` |

**Production mein zaroor:** `JWT_ACCESS_SECRET`, `FILE_SIGNING_SECRET`, `TOTP_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY` lambi random strings; `CORS_ORIGINS` apna domain; `DEVICE_CONFIRM_ROLES=ADMIN,TEACHER` (dev `.env` mein band hai).

### Firebase (Google login)
1. https://console.firebase.google.com → project → **Authentication → Google → Enable**.
2. **Project settings → Web app** → values `app/.env` mein (`EXPO_PUBLIC_FIREBASE_*`). `backend/.env` → `FIREBASE_PROJECT_ID`.
3. Android: Firebase mein Android app (`pk.laalpen.app`) + SHA-1; "Web client" ID `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` mein.

## 7. Bara school / scaling

- Checking workers alag chalao: `LAALPEN_ROLE=api` (website/API) aur ek ya zyada `LAALPEN_ROLE=worker node dist/main.js` (sirf queue). Sab ek hi database use karte hain.
- `CHECK_BULK_CONCURRENCY`, `AI_REQUESTS_PER_MINUTE` — apne OpenAI limit ke hisaab se.
- Connection pooler (Neon/Supabase "pooled" URL) use ho to `DIRECT_DATABASE_URL` mein direct URL do (queue ke liye).
- Docker: poora stack containers mein — neeche **section 9. Docker se chalana** dekhein.

---

## 8. Testing (sab pass ✅)

```bash
cd backend && npm test          # 76 API tests (8 files) — har run apna temporary database banata aur mitata hai
cd ai-service && pytest -q      # 33 tests — grading, photo gate, QR, OMR (tilted photo), batch
cd app && npm run typecheck     # poori app ka TypeScript check
cd app && npx expo export --platform web       # web build
cd app && npx expo export --platform android   # Android bundle
```

Backend tests ke liye PostgreSQL chal raha ho (default `postgresql://postgres@localhost:5432`; alag ho to `TEST_DATABASE_BASE_URL=postgresql://postgres:PASSWORD@localhost:5432`).

**Browser mein poora flow (12 steps)** — school register → email code → authenticator app → classes/teacher → **Excel import** → class code → **student khud join (DOB match, foran andar)** → answer key → copy → AI check → mark change → approve → publish → **parent mobile login** → student result → **Urdu** → dark mode → principal 2FA login → insights:

```bash
cd backend && npm run build && node dist/main.js > backend.log      # alag terminal (REQUIRE_ADMIN_2FA=true)
cd ai-service && python -m uvicorn app.main:app --port 8000
cd app && npx expo export --platform web && npx serve -s dist -l 8081
pip install playwright && playwright install chromium
python e2e/full_flow.py --api-log backend/backend.log --copy backend/prisma/seed-assets/mixed-page-1.jpg
```

Sample print sheets (OMR / booklet) banane ke liye: `cd backend && npx tsx scripts/sample-sheets.mts ./samples`.
AI accuracy (asli copies, teacher ke marks se mila kar): `ai-service/eval/` (README wahan hai).

---

## 9. Docker se chalana

Docker Desktop se poora LaalPen (database + backend + AI + app/website) ek command se chalta hai. Aap ka apna PostgreSQL (port 5432) is se nahi takrata — Docker wala database **port 5433** par hai.

**Pehli dafa:**

1. Docker Desktop kholein aur intezar karein jab tak "Engine running" na likha aaye.
2. `backend/.env` aur `ai-service/.env` maujood hon (`.env.example` copy kar ke). `ai-service/.env` mein `OPENAI_API_KEY=sk-...` aur `OPENAI_MODEL=gpt-5-mini` ho. `DATABASE_URL` aur `AI_SERVICE_URL` Docker khud set karta hai (`docker-compose.yml`), in ko badalne ki zaroorat nahi. Mazeed: `.env.docker.example`.
3. **Local servers band karein** (backend 4000, app 8081 wali windows), warna ports takrayenge. Ya ports badal dein: `$env:LP_API_PORT=14000; $env:LP_APP_PORT=18081; docker compose up -d` (AI host port default 8001, `LP_AI_PORT`).

**Chalana (root folder `laalpen/` se):**

```bash
docker compose up -d --build     # pehli dafa 5-10 minute (images banti hain)
docker compose ps                # sab "healthy" hone chahiye
```

Startup par backend khud `prisma migrate deploy` aur seed chalata hai (demo school, logins wahi: `admin@laalpen.demo` / `Demo@1234`).

| Service | Address | Health |
| --- | --- | --- |
| db (PostgreSQL 16) | `localhost:5433` (user `postgres`, password `postgres`, db `laalpen`) | `pg_isready` |
| ai | http://localhost:8001/health (container ke andar 8000) | `/health` |
| backend | http://localhost:4000/api/health | `/api/health` |
| app (website `/` + Expo web app `/login`, nginx) | http://localhost:8081 | `/` |

**Roz ke commands:**

```bash
docker compose logs -f backend   # backend ke logs (email/SMS codes bhi yahin print hote hain)
docker compose restart ai        # .env badla to service restart
docker compose down              # band karein — data (volumes) mehfooz rehta hai
docker compose up -d             # dobara chalayein (build ki zaroorat nahi)
docker compose up -d --build     # code badla to dobara build
```

- `docker compose down -v` **saara Docker database aur uploads mita deta hai** — sirf tab chalayein jab zero se shuru karna ho. Aap ke local PostgreSQL par is ka koi asar nahi.
- Sirf database Docker mein chahiye (baqi VS Code se): `docker compose up -d db` aur `backend/.env` mein `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/laalpen?schema=public`.
- App ka web build API ka address build ke waqt leta hai (`EXPO_PUBLIC_API_URL`, default `http://localhost:4000`). Doosre computer/phone se kholna ho to `docker-compose.yml` mein `app.build.args` badal kar `docker compose up -d --build app`.
