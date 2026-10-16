# LaalPen

Teachers photograph a class of answer copies. LaalPen checks them against the teacher's own answer key, marks the page in red pen, and waits for the teacher to approve. Students and parents then see the checked copy and why each mark was given.

Built for Pakistani schools and academies: Classes 1–12, FBISE, and the Sindh and Punjab boards. English and Urdu.

[![Live demo](https://img.shields.io/badge/live%20demo-laalpen.vercel.app-C8102E)](https://laalpen.vercel.app)
[![Android APK](https://img.shields.io/badge/Android-download%20APK-3DDC84)](https://laalpen.vercel.app/LaalPen.apk)
[![License: MIT](https://img.shields.io/badge/license-MIT-1B2A4A)](LICENSE)

| | |
| --- | --- |
| Website and web app | https://laalpen.vercel.app (`/` is the site, `/login` is the app) |
| Android APK | https://laalpen.vercel.app/LaalPen.apk |
| API | https://laalpen-backend.onrender.com |

AI does the first check. The teacher decides the final marks. Nothing is published until a teacher approves it.

## Screenshots

UI captures are not in the repo yet. The images below are **placeholders** in [`docs/screenshots/`](docs/screenshots/README.md). Replace each SVG with a PNG of the same name when you have a real shot. Do not commit photographs of real students.

| Marketing site | Teacher capture |
| --- | --- |
| ![Placeholder: marketing site](docs/screenshots/01-marketing-site.svg) | ![Placeholder: teacher capture](docs/screenshots/02-teacher-capture.svg) |

| Teacher review | Student and parent result |
| --- | --- |
| ![Placeholder: teacher review](docs/screenshots/03-teacher-review.svg) | ![Placeholder: student result](docs/screenshots/04-student-result.svg) |

The picture below is a **synthetic** demo page (generated handwriting, not a student). It shows the red-pen annotation the checker draws: ticks, the mistake underlined, and a short comment.

![Synthetic Class 9 physics page marked in red pen](backend/prisma/seed-assets/good-checked-1.jpg)

## Features

**Checking**

- The teacher writes an answer key. The model turns it into a marking scheme (final answer, steps, rules). The teacher confirms it, and each version is kept.
- Capture a whole class in roll order, or drop a pile of photos in any order. Printed QR booklets and stickers attach each page to the right student.
- A photo gate rejects blur, darkness, glare, cut-off pages, and duplicates before any model call.
- Each answer is Sure, Check, or Unreadable. Teachers can approve every sure copy, or grade one question across the class (comment bank, keyboard shortcuts).
- OMR bubble sheets for MCQ-only tests are scored in code, with no model call. Double-filled bubbles are sent to the teacher.
- Overnight batch checking, voice notes on a copy, mark history, and a step-up re-open of published marks (password again, a reason, and an alert to the principal).

**Roster**

- Register first, accounts later. Excel/CSV import with a dry run (new, update, invalid), English or Urdu column names.
- Class codes, claim cards (PDF with a QR), and quick-add. A student who enters class code, roll, and date of birth and matches the register is in immediately.
- Mark a student as left without deleting marks. School-year promotion keeps an enrollment history.

**Families**

- Parents sign in with a mobile number (SMS or WhatsApp code), see every child, and can open a result from a link without installing the app.
- Students and parents see the average, the trend, topics to practise, the checked copy, and the voice note.
- Urdu UI (right-to-left, Nastaliq). Urdu answer copies can be read with Gemini when that key is set.

**Principal**

- Insights: time from photo to result, copies waiting on each teacher, and a topic-by-class heatmap.
- Excel/CSV export for board SBA or an ERP, after a fresh "confirm it's you".
- An activity log that neither the app nor the database will let anyone edit or delete.

## Architecture

```mermaid
flowchart TB
  subgraph clients [Expo app and marketing site]
    Teacher[Teacher]
    Family[Student and parent]
    Site[Website]
  end

  subgraph api [backend]
    Nest[NestJS API]
    Workers[Checking workers]
  end

  DB[(PostgreSQL)]
  Queue[pg-boss]

  subgraph checker [ai-service]
    Gate[Photo gate]
    Grade[Vision grader]
    Scan[QR and OMR]
  end

  Teacher --> Nest
  Family --> Nest
  Site --> Nest
  Nest --> DB
  Nest --> Queue
  Queue --> Workers
  Workers --> Gate
  Workers --> Scan
  Gate --> Grade
  Grade --> OpenAI[OpenAI]
  Grade --> Gemini[Gemini]
  Grade --> Mock[Mock mode]
  Workers --> DB
```

| Folder | What it is | Port |
| --- | --- | --- |
| `backend/` | NestJS, Prisma 7, PostgreSQL. Accounts, 2FA, passkeys, roster, the pg-boss queue, notifications. | 4000 |
| `ai-service/` | FastAPI. OpenAI or Gemini checking, photo gate, QR and OMR, red-pen annotation. Mock mode needs no key. | 8000 |
| `app/` | Expo and React Native Paper. One codebase for Android, iOS, and web (English and Urdu). The marketing site lives in `app/public` (`app/WEBSITE.md`). | 8081 |
| `e2e/` | A 12-step browser script of the full school flow. | — |

The API can run separately from the workers (`LAALPEN_ROLE=api` vs `LAALPEN_ROLE=worker`) so a larger school can add checking capacity without adding a second database.

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Expo SDK 57, React Native, React Native Paper, Expo Router. Android, iOS, and web. |
| API | NestJS 12, Prisma 7, PostgreSQL 16, pg-boss (queue in Postgres, no Redis). |
| Checker | FastAPI, OpenAI vision, optional Gemini for Urdu, OpenCV (photo gate, QR, OMR), SymPy for numeric answers, Pillow for the red pen. |
| Auth | Email and password, email codes, Firebase Google sign-in, TOTP, passkeys (WebAuthn). |
| Files | Local disk in development. S3-compatible storage (including Cloudflare R2) when `STORAGE_DRIVER=s3`. |
| Delivery | Web on Vercel. API on Render. Android APK linked from the site. Docker Compose for the full stack. |

## How the checker marks a copy

The model is asked to quote what the student wrote before it awards marks, so a misread is visible. Blank answers are forced to zero even if the model invents text. Unreadable answers are never silently scored zero: they go to the teacher as "Couldn't read". Marks have to cite numbered rules from the teacher's scheme. The total is added in code, not by the model. Numeric answers are checked again with SymPy, and MCQ choices are compared in code. Only uncertain or partial-credit theory answers are sent back for a second look; if those samples disagree, the answer is flagged Check.

The same scheme text is sent for every student of a test, with the page images last, so a provider prompt cache can apply. Comments on the page are short on purpose.

Without an API key the service runs in **mock mode**: it still finds ink on the page and returns predictable marks, so the app can be developed and demonstrated at no cost.

### Evaluation

The harness in [`ai-service/eval/`](ai-service/eval/golden/README.md) can score a golden set with quadratic-weighted kappa, mean absolute error, bias, exact and near-exact agreement, the share of answers sent to the teacher, and estimated cost.

The set that ships with this repo is **small and synthetic**: three generated Class 9 physics pages, three questions each, with marks filled in so the script has something to run. It is a smoke test of the harness. It is **not** a measurement of agreement with teachers on real classroom handwriting, and this README does not claim an accuracy number.

A real release gate would use copies marked independently by two teachers (the notes in `ai-service/eval/golden/README.md` suggest on the order of a few hundred answers, mixed subjects and handwriting). That set is not in the repo, and that gate has not been run. `ROADMAP.md` records the target used while building: agreement with the reference teacher and QWK at least 0.85. Treat that as a target, not a result.

## Security

- Principals must turn on an authenticator app (TOTP) or a passkey before they open school data. Email codes confirm a new device; they do not replace the authenticator for admins.
- TOTP secrets are encrypted at rest (AES-256-GCM). Backup codes are hashed, shown once, and stored so the plaintext is not kept.
- New-device email, a "this was not me" link that ends every session, lockout after repeated wrong passwords, and a breached-password check (Have I Been Pwned range API, k-anonymity: only the first five characters of the SHA-1 are sent).
- Refresh-token reuse detection, a list of current sessions, and a step-up password prompt before exports, imports, promotion, and reopening a published copy.
- Each school's rows are isolated in the application and with PostgreSQL row-level security. The audit log is append-only.
- The checker is a separate service and requires a shared service token. Uploads are checked for a real image signature, not only a file extension.

Production needs long random values for `JWT_ACCESS_SECRET`, `FILE_SIGNING_SECRET`, `TOTP_ENCRYPTION_KEY`, and `DATA_ENCRYPTION_KEY`, plus an explicit `CORS_ORIGINS`. See `backend/.env.example`.

## Testing

```bash
cd backend && npm test          # API tests — each run creates and drops its own database
cd ai-service && pytest -q      # grading, photo gate, QR, OMR (including a tilted photo), batch
cd app && npm run typecheck
```

The API suite covers auth, the school flow, abuse cases, and the phase A–C behaviour (87 cases in 11 files). The Python suite is 34 tests. Backend tests expect PostgreSQL (default `postgresql://postgres@localhost:5432`; override with `TEST_DATABASE_BASE_URL`).

The 12-step browser script walks school sign-up, the authenticator setup, Excel import, a student joining with date of birth, an AI check, a mark edit, publish, parent mobile login, Urdu, dark mode, and principal insights:

```bash
cd backend && npm run build && node dist/main.js > backend.log
cd ai-service && python -m uvicorn app.main:app --port 8000
cd app && npx expo export --platform web && npx serve -s dist -l 8081
pip install playwright && playwright install chromium
python e2e/full_flow.py --api-log backend/backend.log --copy backend/prisma/seed-assets/mixed-page-1.jpg
```

Sample OMR and booklet sheets: `cd backend && npx tsx scripts/sample-sheets.mts ./samples`.

## Roadmap

Phases 0–12 and A–C in [`ROADMAP.md`](ROADMAP.md) are implemented: foundation through roster, capture, parents, QR/OMR, insights, passkeys, and the Urdu UI.

Still ahead, after a pilot:

- Run the eval gate on real double-marked copies (the target above). The synthetic sample is only a stand-in.
- Passkeys inside a store build, and a document scanner on the phone.
- Urdu for the rest of the app (login and the student/parent screens are translated today).
- Board-specific SBA column orders on the export.

## Author

**Syed Abdul Maarij** — full-stack engineer.

- GitHub: [maarijwaseem2](https://github.com/maarijwaseem2)
- LinkedIn: [maarijwaseem2](https://www.linkedin.com/in/maarijwaseem2)
- Product: [laalpen.vercel.app](https://laalpen.vercel.app) · hello@laalpen.pk

## License

The project is [MIT](LICENSE), copyright 2026 Syed Abdul Maarij. `app/LICENSE` is the Expo template notice that ships with the app scaffold, not a separate project license. Fonts under `app/public/fonts` and `ai-service/app/fonts` stay under the SIL Open Font License (`OFL-LICENSE.txt`).

---

## Local setup

### 1. Install once

1. **Node.js 22 LTS** — https://nodejs.org (the API accepts Node `>=20.19`)
2. **Python 3.12** — https://python.org (on Windows, tick "Add to PATH")
3. **PostgreSQL 16** — a local server, or `docker compose up -d db`
4. **VS Code** — open `laalpen.code-workspace`
5. **Expo Go** on a phone (Play Store / App Store) if you want to run the app on a device

### 2. Two things you set yourself

**(a) Your PostgreSQL database.** Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` to your user, password, and database name:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/laalpen?schema=public"
```

Create the database first (`CREATE DATABASE laalpen;`). Do not create tables by hand — migrations do that.

**(b) Your OpenAI key**, in `ai-service/.env` (copy from `ai-service/.env.example`):

```env
OPENAI_API_KEY=sk-...
```

That is enough for real checking. With no key, everything still runs in free **mock mode** (real red-pen marks, demo scores). Other paid services stay off until you fill their variables (see [Optional keys](#6-optional-keys)).

### 3. First-time setup

From the repo root:

```bash
# Backend: packages, tables, demo school
cd backend
npm install
npx prisma migrate deploy     # tables, indexes, row-level security, audit lock
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

- One shot for the API: `cd backend && npm run setup` (generate, migrate, seed).
- Seeding again is safe. Records are upserted, not duplicated.
- After a new migration, run `npx prisma migrate deploy` again. Existing data stays.
- To wipe your **local** database and start over: `npm run db:reset` inside `backend/`.
- To skip demo data: `SEED_DEMO=false`.

### 4. Day to day

In VS Code: **Terminal → Run Task → "Start servers"** (your own PostgreSQL) or **"Start everything"** (the Docker database too). Or three terminals:

```bash
cd backend && npm run dev                                   # http://localhost:4000/api  (docs: /api/docs)
cd ai-service && python -m uvicorn app.main:app --reload --port 8000
cd app && npx expo start                                    # press w for web → http://localhost:8081
```

Health: http://localhost:4000/api/health should report `"database":"up"` and `"aiService":"openai"` when a key is set, or `"mock"` when it is not.

**On a phone**

- **Expo Go:** phone and computer on the same Wi-Fi. Scan the QR from `npx expo start`. The app finds the computer's IP.
- For photo upload, set `PUBLIC_API_URL=http://<your-Wi-Fi-IP>:4000` in `backend/.env`.
- If Windows Firewall asks, allow Node.js on private networks.
- Google sign-in, push notifications, and passkeys on a phone need a development build: `npx expo run:android`.

**Demo accounts**

`npm run db:seed` creates a demo school. Every demo account uses the password in `SEED_DEMO_PASSWORD` (`backend/.env`, documented in `backend/.env.example`). Use that only on your own machine. Do not point a public deployment at demo data with a password that is written down in an example file — set `SEED_DEMO=false` in production, or change the password.

| Role | Login |
| --- | --- |
| Admin / principal | `admin@laalpen.demo` — first sign-in asks you to set up an authenticator app |
| Teacher (Physics 9-A, 9-B, Maths 9-A) | `sana.teacher@laalpen.demo` |
| Teacher | `imran.teacher@laalpen.demo` |
| Student (9-A, roll 03) | `ali.raza@laalpen.demo` |
| Student a teacher still has to link | `saad.pending@laalpen.demo` (Join requests suggests "Saad Qamar, roll 09") |
| Parent | Parent login → mobile **0300 1112233**. The code is printed in the backend terminal (Ali in 9-A and Danish in 10-A). |

Class codes: **ALN-9A**, **ALN-9B**, **ALN-10A**. Class 10-A students are on the register only (no app account yet), which is how a school looks on day one.

With no email or SMS keys, codes are printed in the backend terminal (`[console email]`, `[console sms]`).

### 5. What you can click through

The demo school covers the roster (Excel import, class codes, claim cards, self-join by roll and date of birth, promotion), checking (answer key, class capture, QR pile, OMR, photo gate, Sure/Check/Unreadable, overnight batch, voice notes, re-open), parent and student results, Urdu and dark mode, and the principal insights and export. Detail is in [Features](#features) and [`ROADMAP.md`](ROADMAP.md).

### 6. Optional keys

Empty means the free path. Fill the variable later; no code change.

| Service | If the key is empty | Where |
| --- | --- | --- |
| AI checking | Mock mode | `ai-service/.env` → `OPENAI_API_KEY` (`OPENAI_MODEL=gpt-5-mini`) |
| Urdu copies | OpenAI is used | `ai-service/.env` → `GEMINI_API_KEY` |
| Email | Printed in the terminal | `backend/.env` → `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (Brevo free tier is 300/day) |
| Parent SMS / WhatsApp | Printed in the terminal | `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, or `SMS_PROVIDER=twilio` / `http` |
| Files | `backend/uploads/` | `STORAGE_DRIVER=s3` and `S3_*` |
| Google sign-in | Button shows "not set up" | Firebase (`app/.env` and `FIREBASE_PROJECT_ID`) |
| Error monitoring | Off | `SENTRY_DSN` (backend and ai-service) |
| Passkeys on a real domain | localhost | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` |

**Firebase (Google sign-in)**

1. Firebase console → Authentication → Google → Enable.
2. Project settings → Web app → copy the values into `app/.env` (`EXPO_PUBLIC_FIREBASE_*`). Set `FIREBASE_PROJECT_ID` in `backend/.env`.
3. Android: register `pk.laalpen.app` with your SHA-1, and put the Web client ID in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. `google-services.json` stays on your machine (it is gitignored).

### 7. A larger school

- Run the API and the workers separately: `LAALPEN_ROLE=api` for the website, and one or more `LAALPEN_ROLE=worker node dist/main.js` processes. They share one database.
- `CHECK_BULK_CONCURRENCY` and `AI_REQUESTS_PER_MINUTE` should stay inside your provider limit.
- If `DATABASE_URL` is a pooled connection (Neon or Supabase "pooled"), set `DIRECT_DATABASE_URL` to the direct URL. The queue needs `LISTEN`/`NOTIFY`, which poolers drop.
- The full stack in containers is the next section.

---

## Docker

Docker Compose runs the database, API, checker, and the website/app. It does not touch a PostgreSQL you already have on port 5432. The container database is published on **port 5433**.

**First time**

1. Start Docker and wait until the engine is running.
2. `backend/.env` and `ai-service/.env` must exist (copy the examples). Put your model key in `ai-service/.env` (`OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5-mini`). Compose sets `DATABASE_URL` and `AI_SERVICE_URL` itself (`docker-compose.yml`); you do not need to change those. See also `.env.docker.example`.
3. Stop anything already bound to the host ports (API 4000, app 8081), or move them: `LP_API_PORT=14000 LP_APP_PORT=18081 docker compose up -d`. The checker is on host port 8001 by default (`LP_AI_PORT`).

**Run (from the repo root)**

```bash
docker compose up -d --build     # first build takes several minutes
docker compose ps                # wait until each service is healthy
```

On startup the API runs `prisma migrate deploy` and the seed (the demo school and the accounts in the table above). The password is `SEED_DEMO_PASSWORD` from `backend/.env`.

| Service | Address | Health |
| --- | --- | --- |
| db (PostgreSQL 16) | `localhost:5433` (user `postgres`, password `postgres`, database `laalpen`) | `pg_isready` |
| ai | http://localhost:8001/health (8000 inside the container) | `/health` |
| backend | http://localhost:4000/api/health | `/api/health` |
| app (website `/`, Expo web `/login`, nginx) | http://localhost:8081 | `/` |

**Everyday**

```bash
docker compose logs -f backend   # API logs, including email and SMS codes when those keys are empty
docker compose restart ai        # after you edit ai-service/.env
docker compose down              # stop; volumes (data) stay
docker compose up -d             # start again, no rebuild
docker compose up -d --build     # rebuild after code changes
```

- `docker compose down -v` **deletes the Docker database and uploads**. Use it only when you want a clean Docker volume. It does not affect PostgreSQL installed on the host.
- Database only, and run the rest from VS Code: `docker compose up -d db`, then set `DATABASE_URL` in `backend/.env` to `postgresql://postgres:postgres@localhost:5433/laalpen?schema=public`.
- The web app bakes in the API address at build time (`EXPO_PUBLIC_API_URL`, default `http://localhost:4000`). To open it from another machine, change `app.build.args` in `docker-compose.yml` and run `docker compose up -d --build app`.
