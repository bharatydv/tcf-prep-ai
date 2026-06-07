# TCF Prep AI 🇨🇦

AI-powered preparation platform for the **TCF Canada** French proficiency exam. Learners write in French, get instant CEFR grading (A1–C2) with every error highlighted and explained, then drill *their own* mistakes through spaced-repetition review games.

## Features

- **Writing Assistant** — 5 seeded C1 prompts or free writing, French accent toolbar, optional 60-min timer, live streaming analysis (SSE) with an animated stage checklist
- **Exam Simulator** — the 3 official TCF writing tasks under real conditions: strict shared 60-minute countdown (auto-submit + 10/2-min warnings), no spellcheck, paste blocked, per-task word counters; one credit per full run
- **Check My Writing** — paste anything written elsewhere; same pipeline, same mistake tracking
- **AI grading** — gemini-2.0-flash → gpt-4o-mini → gemini-2.5-flash fallback chain; certified-examiner prompt with an embedded CEFR rubric and hard score caps; 6 error categories (Prépositions, Orthographe, Conjugaison, Accord en genre et nombre, Anglicismes, Améliorations C1) each with its own highlight color
- **Mistake tracking (USP)** — every error from every source lands in a per-user history with repeat detection, status (new/reviewing/mastered), and per-category mastery
- **Gamified review** — fix-it flashcards, choose-the-correct MCQs (with stored LLM distractors), 2-minute category sprints; spaced repetition at 1/3/7/14 days; XP, badges ("Conjugaison Slayer", "Comeback"), streaks
- **Dashboard** — score trend, error breakdown, errors-per-100-words monthly trend, GitHub-style 365-day heatmap, weak-point tips, progress narrative, streak flames
- **Recent Topics** — admin-curated real exam consignes with model answers, revealed only after the learner submits their own attempt (free users: 3 model answers)
- **Mock exams** — reading & listening comprehension MCQs (seeded samples included)
- **Freemium** — 5 AI corrections/month free, monthly auto-reset, HTTP 402 + upgrade flow; display-only pricing page (Bronze/Silver/Gold)
- **Admin panel** — users, submissions, analytics (top-10 exact errors), and full CRUD for prompts, exam questions, recent topics, and the simulator prompt pool (soft deletes)

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 (CRA + CRACO), react-router v7, Tailwind, recharts, sonner, @phosphor-icons/react, axios |
| Backend | FastAPI (single `server.py`), Motor (async MongoDB), PyJWT httpOnly-cookie auth, bcrypt, SSE |
| AI | Google Gemini (`google-genai`) primary, OpenAI fallback |

## Setup

### Prerequisites
- Python 3.11+, Node 18+, MongoDB running locally (or an Atlas URL)
- A `GEMINI_API_KEY` (and/or `OPENAI_API_KEY`) — without keys the app still runs; analyses return a graceful "AI temporarily unavailable" fallback

### Backend (port 8000)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # edit: MONGO_URL, JWT_SECRET, GEMINI_API_KEY, ...
uvicorn server:app --reload --port 8000
```
On first start it seeds: the admin user, 5 C1 writing prompts, 9 simulator consignes (3 per task), and 4 sample mock-exam questions.

### Frontend (port 3000)
```bash
cd frontend
npm install
cp .env.local.example .env.local   # REACT_APP_BACKEND_URL=http://localhost:8000
npm start
```

### Default admin
- Email: `admin@frenchcorrector.com` (or `ADMIN_EMAIL`)
- Password: `ChangeMe123!` (or `ADMIN_PASSWORD`) — **change it in `.env`**

### Health checks
`GET /api/` → `{"message": "TCF Canada Prep API", "status": "healthy"}` · `GET /api/health` → `{"status": "ok"}`

## Future work (out of scope by design)
- Payment processing — the pricing page is display-only
- Real speech-to-text for the Speaking Lab (currently a stub)
- Email verification and password reset
- Google OAuth sign-in
