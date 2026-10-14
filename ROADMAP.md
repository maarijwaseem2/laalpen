# LaalPen — Master Plan (yaad rakhne wali list)

Ye file poore project ka "dimagh" hai: kya banana hai, kis order mein, aur har phase kab complete maana jayega.

## 1. Project mein teen folders hain

| Folder | Kya hai | Technology |
| --- | --- | --- |
| `backend/` | Main API — saara data, login, roles, queue, notifications | NestJS 12, Prisma 7, PostgreSQL (RLS), pg-boss (job queue) |
| `ai-service/` | Copy checking AI — padhna, marks dena, laal pen annotation | FastAPI (Python), OpenAI / Gemini vision, OpenCV (photo gate, QR, OMR), SymPy |
| `app/` | Mobile app (Android/iOS) + Web portal — ek hi codebase | Expo, React Native, React Native Paper (Material 3), Expo Router |

## 2. Free-first faisle (paid baad mein, sirf .env badlo)

| Cheez | Abhi (free) | Baad mein (paid) — sirf `.env` change |
| --- | --- | --- |
| AI model | OpenAI key (aapke paas hai) — `gpt-4o-mini`. Key na ho to **mock mode** | `OPENAI_MODEL`, `ESCALATION_MODEL`, `GEMINI_API_KEY` |
| Email | Brevo free plan (300 emails/day). Key na ho to email console mein print | Brevo paid |
| Google login | Firebase Auth (free Spark plan) | Same |
| File storage | Local disk `backend/uploads/` | S3 / Cloudflare R2 (`STORAGE_DRIVER=s3`) |
| Job queue | pg-boss — PostgreSQL ke andar hi, Redis ki zaroorat nahi | Same ya BullMQ |
| Push notifications | Expo Push (free) | Same |
| Parent report | Email + share link; codes in terminal | WhatsApp Cloud API / SMS gateway |

## 3. Roles aur portals

- **Admin** — school setup: classes, sections, subjects, teachers, students; teacher ko class+subject assign; poore school ka dashboard.
- **Teacher** — "My Classes" tiles (POS style) → class/section pe click → agar 2+ subjects parhata hai to subject tiles → subject ke andar Students aur Tests. Test banana, copies upload karna (camera/gallery/web file), AI checking, review karke marks theek karna, approve, publish.
- **Student** — apne subjects, har test ke marks, checked copy (laal pen wali image), har sawal ka feedback, progress.
- Sab ke liye: notifications (app ke andar bell + push + email), light theme default, dark mode button.

## 4. Phases

| Phase | Kaam | Complete kab | Status |
| --- | --- | --- | --- |
| 0. Foundation | Folders, env files, docker-compose (Postgres), scripts | `npm run dev` teeno chal jayein | ✅ Done |
| 1. Database | Prisma schema, migrations, seeds (base + demo) | `npx prisma migrate deploy && npm run seed` se demo school tayyar | ✅ Done |
| 2. Auth | Email+password, email OTP verification (Brevo), forgot password, JWT + refresh, Firebase Google login, role guards | Tests pass | ✅ Done |
| 3. Admin APIs | Classes, sections, subjects, teachers, students, assignments, dashboard | Tests pass | ✅ Done |
| 4. Teacher APIs | My classes → subjects → tests, upload copies, queue, review, approve, publish | Tests pass | ✅ Done |
| 5. AI service | OpenAI vision grading, structured JSON, mock mode, SymPy check, annotation (underline + margin comment) | pytest pass | ✅ Done |
| 6. Student APIs + notifications | Results, copies, in-app/push/email notifications | Tests pass | ✅ Done |
| 7. App design system | Theme (light + dark toggle), responsive layout (phone: bottom tabs, web: sidebar) | Web build ok | ✅ Done |
| 8. App portals | Auth screens, admin, teacher, student portals | Web build + screenshots ok | ✅ Done |
| 9. Testing + packaging | End-to-end flow, README, zip | Poora flow demo data pe chal jaye | ✅ Done |
| 10. Student self-signup | School code + class/section/roll, pending waiting screen, teacher/admin approve-reject, notifications | 7 enrollment tests + e2e | ✅ Done |
| 11. Review fixes | Queue run-safety, publish ek dafa email, throttling per IP+email, OTP atomic, disabled user turant bahar, Google takeover fix | 8 safety tests | ✅ Done |
| 12. Website | Static site, "Open app" → mobile app (Android intent / iOS scheme / desktop QR) | Screenshots desktop + mobile | ✅ Done |

| **A. Accuracy, cost, queue safety** | Photo gate (blur/dark/glare/cut/duplicate), problem copies, structured answer key + versions, Sure/Check/Unreadable, totals in code, MCQ/numeric in code, self-consistency, rate limiter, retries + DLQ, cost report, TOTP 2FA + backup codes, new-device email, lockout, breached passwords, sessions + token-reuse detection | 11 + 8 tests | ✅ Done |
| **B. Roster, capture, parents** | Excel/CSV import (dry run, upsert), class codes, claim cards, auto-link (roll + DOB), teacher link suggestions, quick add, sessions + promotion, mark left; class capture (presigned upload, offline queue, one "class done" alert), overnight Batch API, grade by question + groups + comment bank, voice note, re-open with step-up, mark history, append-only audit, RLS; parent phone login + siblings, share links, WhatsApp/SMS | 14 tests + app screens | ✅ Done |
| **C. Scale & polish** | QR booklets / stickers + pile-of-photos scan, OMR sheets (no AI), principal insights + topic heatmap, Excel/CSV export (SBA/ERP), passkeys (WebAuthn), Urdu UI (RTL, Nastaliq) + Gemini for Urdu, Sentry (optional), worker scaling | 8 tests + AI scan tests + 12-step browser test | ✅ Done |

## 5. Rules

- Kuch bhi manual nahi: har table migration se, har shuruaati record seed se.
- Secrets sirf `.env` mein, git mein kabhi nahi. `.env.example` mein har variable likha hai.
- AI pehla checker, teacher final: koi mark approve ke baghair student tak nahi jata.
- AI unsure ho to marks nahi kaatta — "needs review" flag lagata hai.


## 6. Agla kaam (pilot ke baad)

- OpenAI key ke saath 100+ asli copies pe accuracy naapna (`ai-service/eval`, Gate 1: teacher se 85% match, QWK ≥ 0.85)
- Phone app mein passkeys (store build + native passkey module) aur ML Kit document scanner
- Poori app ka Urdu tarjuma (abhi student/parent/login screens Urdu mein hain)
- Board-specific SBA formats (har board ka apna column order) — export sheet se mapping
