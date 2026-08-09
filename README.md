# monfrançais 🇨🇦

AI-powered preparation platform for the **TEF/TCF Canada** French exams. Learners write or speak in French, get instant CEFR grading (A1–C2) with every error highlighted and explained, then drill *their own* mistakes through spaced-repetition review games.

## Official TCF constraints

The exam's real limits are enforced end to end — the UI shows them while you write or speak, and the grader applies the matching score caps. Both read from one source: `WRITING_TASKS` / `SPEAKING_TASKS` in [`backend/server.py`](backend/server.py), mirrored in [`frontend/src/lib/tcf.js`](frontend/src/lib/tcf.js) and served by `GET /api/tcf-spec`.

**Expression écrite** — 60 minutes for all three tâches:

| Tâche | Words | Suggested time |
|---|---|---|
| 1 — Message court | 60–120 | ~15 min |
| 2 — Article, blog ou lettre | 120–150 | ~20 min |
| 3 — Texte argumentatif | 120–180 | ~25 min |

**Expression orale** — recording stops automatically at the limit:

| Tâche | Preparation | Speaking |
|---|---|---|
| 1 — Entretien dirigé | — | 2 min |
| 2 — Exercice en interaction | 2 min | 3 min 30 |
| 3 — Expression d'un point de vue | 2 min | 2 min 30 |

**Score caps applied in code** (not only requested in the prompt, because models do not follow rubric caps reliably):

- 5+ real errors → B1 max · 2–4 real errors → B2 max (`improvement` entries are style upgrades and never count)
- Under the word minimum → B1 max · under half the minimum → A2 max · over 1.5× the maximum → B2 max
- Spoken answer that does not address the consigne, or far too short → B1 / A2 max

Every cap is returned in `caps_applied` and shown to the learner, so a lowered level is always explained.

## Features

- **Writing Assistant** — official tâches or free writing, French accent toolbar, live word-count bar against the official range, streaming analysis (SSE) with a stage checklist
- **Exam Simulator** — the 3 writing tâches under real conditions: shared 60-minute countdown (auto-submit + 10/2-min warnings), no spellcheck, paste blocked, per-tâche word bars; the draft and the deadline survive a reload; one credit per full run
- **Speaking Lab** — recording with the official preparation and speaking timers, plus a live roleplay partner for Tâche 2
- **Check My Writing** — paste anything written elsewhere; same pipeline, same mistake tracking
- **AI grading** — pluggable provider per task (Anthropic / OpenAI / Gemini / Groq / DeepSeek), switchable from the Admin panel; 6 error categories each with its own highlight colour
- **Mistake tracking (USP)** — every error from every source lands in a per-user history with repeat detection, status (new/reviewing/mastered), and per-category mastery
- **Gamified review** — fix-it flashcards, choose-the-correct MCQs, 2-minute category sprints; spaced repetition at 1/3/7/14 days; XP, badges, streaks. Answers are graded **server-side**
- **Dashboard** — score trend, error breakdown, 365-day heatmap, weak-point tips; all bucketed in the learner's timezone
- **Recent Topics** — curated real consignes with model answers. Free users get 3, spent only on an explicit "Afficher le corrigé" click
- **Mock exams** — reading & listening MCQs, graded on the server and recorded in the learner's history
- **Freemium** — 5 AI corrections/month, monthly auto-reset, HTTP 402. **No payment processing yet**: the pricing page says so plainly and its buttons are disabled
- **Admin panel** — users, submissions, analytics, AI-provider selection, and full CRUD for prompts, exam questions, recent topics, blog posts and simulator prompts

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 (CRA + CRACO), react-router v7, Tailwind, recharts, sonner, @phosphor-icons/react, axios |
| Backend | FastAPI (single `server.py`), SQLAlchemy 2.0 async + asyncpg on PostgreSQL, PyJWT httpOnly-cookie auth, bcrypt, SSE |
| AI | Anthropic / OpenAI / Gemini / Groq / DeepSeek for grading; OpenAI / Gemini / Groq / AssemblyAI for transcription |

## Setup

### Prerequisites
- Python 3.11+, Node 18+, PostgreSQL running locally (or a hosted URL)
- At least one grading key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`). Without one, grading fails loudly with a 503 and **no credit is charged** — it never records a fake A1

### Backend (port 8000)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # edit: DATABASE_URL, JWT_SECRET, provider keys, ...
uvicorn server:app --reload --port 8000
```
On first start it creates the tables, runs the idempotent migrations in `MIGRATIONS`, and seeds the admin user, writing prompts, simulator consignes, speaking themes and sample mock-exam questions.

### Production settings
Set `ENV=production`. The app then **refuses to boot** unless `JWT_SECRET` is a non-default value of 32+ characters and `ADMIN_PASSWORD` has been changed, and it marks auth cookies `Secure`. `FRONTEND_URL` accepts a comma-separated list of allowed origins.

### Frontend (port 3000)
```bash
cd frontend
npm install
npm start        # API calls go to /api, proxied to the backend
```

### Default admin
- Email: `admin@frenchcorrector.com` (or `ADMIN_EMAIL`)
- Password: from `ADMIN_PASSWORD` — **required in production**

### Health checks
`GET /api/` → `{"message": "monfrancais API", "status": "healthy"}` · `GET /api/health` → `{"status": "ok"}` · `GET /api/tcf-spec` → the official constraints above

## Future work (out of scope by design)
- Payment processing — the pricing page is display-only and says so
- Email verification and password reset (needs an email provider)
- Google OAuth sign-in
- Rate limiting is per-process; move to Redis before running multiple workers
