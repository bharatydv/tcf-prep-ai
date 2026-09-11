# prepfrancais 🇨🇦

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
- **Freemium** — a one-time trial of 3 AI writing corrections and 3 speaking evaluations, of which at most one may be the tâche 2 roleplay. It never refills. Running out returns HTTP 402 with the allowance that was spent, which the frontend renders as a plan chooser over the page rather than an error
- **Payments** — Razorpay card payments (Cashfree behind a `PAYMENT_PROVIDER` switch) for three plans, with an introductory rate for an account that has never paid, itemised processing fee, PDF invoices by email, and refund/chargeback handling that takes back exactly the cycle that was reversed. See [Billing](#billing)
- **Account recovery** — password reset and email confirmation over SMTP, with single-use hashed link tokens; logging out and changing a password both revoke every existing session
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
npm install      # NOT --production: tailwind/postcss are devDependencies
npm start        # /api is proxied to :8000 by the `proxy` field in package.json
```

`npm run build` regenerates `public/sitemap.xml` first (`prebuild`). Set
`SITEMAP_API=http://localhost:8000` to include blog slugs and topic ids.

`npm run build:prerender` additionally runs react-snap over the public routes,
writing real HTML into each one, then:

- saves the pristine empty shell as `build/app-shell.html`, which nginx serves
  as the SPA fallback — falling back to `index.html` would hand every unmatched
  URL the prerendered *homepage* markup;
- prunes the routes behind `ProtectedRoute`. react-snap has no exclude option
  and follows their redirect to `/login`, which otherwise baked a login form
  into `build/dashboard/index.html`.

This is what makes the site readable to crawlers that do not execute
JavaScript — which is all of the AI indexing crawlers (GPTBot, ClaudeBot,
PerplexityBot, CCBot). Without it they receive an empty `<div id="root">`.
Verify a deploy with:

```bash
curl -sA GPTBot https://your-site/tef-tcf-writing-guide | grep -c "tâche"
```

**Known limit:** the crawl runs against the static build with no API, so pages
whose content comes from `/api` — the blog list, `/recent-topics`, and every
`/blog/:slug` — prerender as their empty state. Static pages (the guide,
pricing, the section landings, legal) carry their full text. Prerendering the
API-driven ones needs the crawl to run against a stack with the backend
reachable on the same origin.

### Default admin
- Email: `admin@frenchcorrector.com` (or `ADMIN_EMAIL`)
- Password: from `ADMIN_PASSWORD` — **required in production**

### Health checks
`GET /api/` → `{"message": "prepfrancais API", "status": "healthy"}` · `GET /api/health` → `{"status": "ok"}` · `GET /api/tcf-spec` → the official constraints above

### Docker

`docker compose up --build` serves the built frontend through nginx on port 80,
which also proxies `/api` to the backend over the compose network. The backend
is not published to the host: everything goes through the proxy, which is where
the body-size limit and the forwarded-header handling live.

## Deployment notes

- **`TRUSTED_PROXIES`** must name the proxy in front of the API, or be `*` when
  the API is only reachable through one — which is the case for this compose
  stack, so compose sets it. Trusting `X-Forwarded-For` unconditionally lets an
  anonymous caller rotate the header and walk past the login rate limit; but
  leaving this **empty behind a proxy is worse**, because then every anonymous
  caller is metered under the proxy's own address and they all share one
  bucket — ten failed logins from anybody 429s the entire site. In production
  an empty value logs a loud error at boot.
- **`SMTP_HOST`** is needed for password reset and email verification. Without
  it the links are written to the log; in production `/auth/forgot-password`
  answers 503 rather than pretending a message was sent.
- **`AI_MAX_CONCURRENCY`** (default 32) sets how many gradings can run at once.
  It used to inherit asyncio's default pool of `min(32, cpu+4)` — six on a
  2-vCPU box, which was the real ceiling on simultaneous users.
- **`AI_HTTP_TIMEOUT`** (default 60s) is passed to every provider client. Left
  unset, a stalled socket held a worker thread for the life of the process.

## Billing

Card payments through **Razorpay**, with **Cashfree** kept behind a switch.
Card details never reach this server: `POST /api/billing/subscribe` opens an
order at the gateway and returns what the browser needs to pay it, the learner
pays at the gateway, and the **signed webhook is the only thing that grants
premium** — a POST from a browser can be forged, an HMAC-signed webhook cannot.

`PAYMENT_PROVIDER` (`razorpay` by default, or `cashfree`) selects which one
takes the money. It is read by the backend only: `/api/billing/subscribe` tells
the browser which script to load, so switching is a restart rather than a
frontend rebuild.

One order, one payment, one fixed period — the learner buys a week, a month or
a quarter, it expires, and they buy again. Neither gateway opens a recurring
mandate: Cashfree rejected Subscriptions for this account, and Razorpay
Subscriptions needs its own product approval. Access is granted from the
**plan**, never from the amount, so the processing fee riding along with a
payment can never be read as a bigger purchase.

| Plan | Standing | First-time | Grants |
|---|---|---|---|
| `week` | $20 | $15 | 1 week + 3 XP |
| `month` | $80 | $60 | 30 days + 8 XP |
| `quarter` | $220 | $160 | 90 days + 15 XP |

Prices come from `BILLING_PRICE_*` / `BILLING_FIRST_*` and are served by
`GET /api/billing/plans` — never sent by the browser. The introductory rate is
decided from the database (`has_paid_before`), not from the request.

**The processing fee is added to the customer's total, not taken out of the
plan price.** `checkout_breakdown()` is the single place a total is computed —
the pricing page, the amount sent to the gateway, the figure the webhook is
checked against and the invoice all read it, so they cannot disagree.
Razorpay states money in the smallest currency unit, so `to_minor_units()`
converts once at the boundary — through `money()` first, because
`int(1.15 * 100)` is 114.
`TAX_PERCENT` is deliberately 0 by default; turn it on only where the business
actually owes it.

Every successful charge writes a numbered invoice and emails it as a PDF.
Refunds, chargebacks and disputes remove exactly one cycle — an account that
paid for three and had one reversed keeps the two it still owns.

Required to turn Razorpay checkout on: `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BILLING_CURRENCY`. For
Cashfree: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_WEBHOOK_SECRET`.
Only the selected provider's credentials are checked — leave them empty and
`/api/billing/plans` reports `configured: false` and the buy buttons stay
disabled with an explanation rather than failing at the moment of purchase.

`RAZORPAY_WEBHOOK_SECRET` is **not** the API key secret. It is the string typed
into Settings → Webhooks when the webhook is created, and there is no fallback:
unset, every event is refused. In the dashboard, point the webhook at
`/api/billing/webhook` and subscribe `payment.captured`, `refund.created` and
`payment.failed`. `order.paid` may also be subscribed — it is treated as the
same payment as `payment.captured` and cannot double-grant. `payment.authorized`
is ignored on purpose: a hold is not money.

The webhook URL is shared by both gateways and picks its verifier from the
signature header present, not from `PAYMENT_PROVIDER`. A Cashfree payment taken
before the switch is still retrying, and a refund on one can arrive months
later; refusing those because the setting moved on would strand real money.

Three tools exercise the money paths without charging anyone:

```bash
python tools/razorpay_probe.py          # do these keys work, and can this
                                        # account open an order in
                                        # BILLING_CURRENCY?
python tools/cashfree_probe.py          # sandbox: can this account hold a
                                        # USD plan and enrol a foreign card?
python tools/webhook_replay.py --api http://127.0.0.1:15000
                                        # grant, duplicate delivery, refund —
                                        # against a real stack, no gateway
```

If payments land at the gateway but accounts stay on the free trial, check the
webhook secret first: a wrong value rejects every webhook with 401.

Razorpay accounts are INR by default. `BILLING_CURRENCY=USD` needs
International Payments enabled *and* USD allowed on the account — the probe's
order step is what answers that, and without it every checkout 502s.

## Languages and URLs

English is unprefixed, French lives under `/fr`. `/pricing` and `/fr/pricing`
are one page in two languages, each naming the other with `hreflang`, and both
are prerendered and listed in the sitemap.

The asymmetry is deliberate: every URL this site has indexed is unprefixed, and
moving them under `/en` would trade a known ranking for a redirect chain and a
recovery period. Adding `/fr` costs nothing that already exists.

Routing is one `<BrowserRouter basename>`, set from the address before the
router mounts — not a prefix on each of the sixty route declarations. Inside
the router every path is already relative to the locale: `useLocation()` on
`/fr/pricing` returns `/pricing`, and `<Link to="/pricing">` from a French page
goes to `/fr/pricing` by itself. So internal links stay inside their locale
with no call site changed, and only `src/lib/locale.js`, `<Seo>` and the
language toggle ever mention the prefix.

**The URL is the authority on language**, not localStorage. A shared link opens
in the language it was shared in, and a page whose content disagrees with its
own canonical URL is the duplicate-content problem `hreflang` exists to solve.
The toggle still remembers the choice — it is what a later visit to a
locale-less entry point reads — and switching language is a full navigation,
because `basename` is read once at mount.

Content that exists in only one language passes `localized={false}` to `<Seo>`:
it canonicalises to its unprefixed URL from either locale and claims no
alternate. Blog posts are the case that matters — a post is written once and
only the shell around it is translated.

Four lists must agree when a public route is added. `tcfCanada/slugs.js` (or
`App.js`) for the router, `scripts/generate-sitemap.js`, and
`package.json -> reactSnap.include` — the last two now emit both locales from
one entry. And `public/robots.txt`, which matches path prefixes literally and
has no notion of a locale: a private path needs listing twice, or its French
twin is crawlable.

## Future work (out of scope by design)
- Google OAuth sign-in
- Rate limiting is per-process; move to Redis before running multiple workers
