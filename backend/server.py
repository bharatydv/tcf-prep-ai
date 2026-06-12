"""
TCF Prep AI — FastAPI backend
French exam-preparation platform for TCF Canada.
All routes are prefixed with /api.
"""
import os
import re
import json
import uuid
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

load_dotenv()

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "tcf_prep_ai")
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-prod")
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60
REFRESH_TTL_DAYS = 7
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@frenchcorrector.com").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
FREE_MONTHLY_LIMIT = 5
FREE_MODEL_ANSWER_LIMIT = 3

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tcf-prep-ai")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="TCF Canada Prep API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str, kind: str, minutes: int = 0, days: int = 0) -> str:
    exp = now_utc() + timedelta(minutes=minutes, days=days)
    return jwt.encode(
        {"sub": user_id, "type": kind, "exp": exp, "iat": now_utc()},
        JWT_SECRET,
        algorithm=JWT_ALG,
    )


def decode_token(token: str, expected: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != expected:
            return None
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def set_auth_cookies(resp: Response, user_id: str):
    access = make_token(user_id, "access", minutes=ACCESS_TTL_MIN)
    refresh = make_token(user_id, "refresh", days=REFRESH_TTL_DAYS)
    resp.set_cookie("access_token", access, httponly=True, samesite="lax",
                    path="/", max_age=ACCESS_TTL_MIN * 60)
    resp.set_cookie("refresh_token", refresh, httponly=True, samesite="lax",
                    path="/", max_age=REFRESH_TTL_DAYS * 86400)


def clear_auth_cookies(resp: Response):
    resp.delete_cookie("access_token", path="/")
    resp.delete_cookie("refresh_token", path="/")


def public_user(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u["name"],
        "role": u["role"],
        "created_at": u["created_at"],
        "free_submissions_used": u.get("free_submissions_used", 0),
        "subscription_status": u.get("subscription_status", "free"),
        "monthly_reset_date": u.get("monthly_reset_date"),
        "current_streak": u.get("current_streak", 0),
        "longest_streak": u.get("longest_streak", 0),
        "last_activity_date": u.get("last_activity_date"),
        "xp": u.get("xp", 0),
        "badges": u.get("badges", []),
        "model_answers_read": u.get("model_answers_read", 0),
    }


def strip_mongo(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


# ----------------------------------------------------------------------------
# Auth dependencies
# ----------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = decode_token(token, "access")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ----------------------------------------------------------------------------
# Freemium limits & streaks
# ----------------------------------------------------------------------------
async def check_and_reset_monthly(user: dict) -> dict:
    """Reset the free counter if the month changed; returns the fresh user."""
    reset = user.get("monthly_reset_date")
    now = now_utc()
    needs_reset = True
    if reset:
        if isinstance(reset, str):
            try:
                reset = datetime.fromisoformat(reset)
            except ValueError:
                reset = None
        if reset and reset.month == now.month and reset.year == now.year:
            needs_reset = False
    if needs_reset:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"free_submissions_used": 0, "monthly_reset_date": now}},
        )
        user = await db.users.find_one({"user_id": user["user_id"]})
    return user


async def enforce_free_limit(user: dict) -> dict:
    user = await check_and_reset_monthly(user)
    if user.get("subscription_status") == "premium":
        return user
    if user.get("free_submissions_used", 0) >= FREE_MONTHLY_LIMIT:
        raise HTTPException(
            status_code=402,
            detail="Free tier limit reached. Please upgrade to continue.",
        )
    return user


async def consume_credit(user_id: str):
    await db.users.update_one(
        {"user_id": user_id}, {"$inc": {"free_submissions_used": 1}}
    )


async def update_streak(user_id: str) -> dict:
    """A qualifying action happened today; update the streak."""
    user = await db.users.find_one({"user_id": user_id})
    today = now_utc().date()
    last = user.get("last_activity_date")
    if isinstance(last, datetime):
        last = last.date()
    elif isinstance(last, str):
        try:
            last = datetime.fromisoformat(last).date()
        except ValueError:
            last = None
    current = user.get("current_streak", 0)
    extended = False
    if last == today:
        pass
    elif last == today - timedelta(days=1):
        current += 1
        extended = True
    else:
        current = 1
        extended = True
    longest = max(user.get("longest_streak", 0), current)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "current_streak": current,
            "longest_streak": longest,
            "last_activity_date": datetime(today.year, today.month, today.day,
                                           tzinfo=timezone.utc),
        }},
    )
    return {"current_streak": current, "longest_streak": longest,
            "extended": extended}


# ----------------------------------------------------------------------------
# AI grading
# ----------------------------------------------------------------------------
VALID_CATEGORIES = {"prepositions", "spelling", "conjugation",
                    "gender_number", "anglicism", "improvement"}

GRADER_SYSTEM = """You are a certified TCF Canada examiner grading French writing.
Analyze the text and return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{"errors":[{"error":"wrong text","correction":"fixed","explanation":"why (English)","category":"prepositions|spelling|conjugation|gender_number|anglicism|improvement"}],"overall_score":50,"tcf_level":"B1","improvement_suggestions":["tip1"],"linking_words":["mot1"],"vocabulary_suggestions":["word1"]}

Categories (assign exactly one per error):
- prepositions: wrong/missing prepositions
- spelling: orthography and accent errors
- conjugation: verb tense/form errors
- gender_number: gender and number agreement errors
- anglicism: English calques and false friends
- improvement: the sentence is CORRECT but below C1 level; "error" = the original sentence, "correction" = a C1-level rewrite with richer vocabulary, complex syntax, better connectors

CEFR scoring rubric (overall_score 0-100, tcf_level one of A1,A2,B1,B2,C1,C2):
- A1 (5-19): isolated words, no sentences
- A2 (20-39): simple sentences, basic errors (wrong articles, missing accents, wrong conjugation)
- B1 (40-54): connected text, limited vocabulary, basic connectors (et, mais, aussi)
- B2 (55-69): clear arguments, uses cependant/en revanche, occasional subjunctive/conditional errors
- C1 (70-84): fluent, well-structured, rich vocabulary, complex syntax, almost no real errors
- C2 (85-100): near-native, flawless, idiomatic

Hard capping rules:
- 5+ basic errors -> A2/B1 maximum
- 2-4 errors -> B2 maximum
- 0-1 real errors with good structure -> C1 minimum
- 0 errors + sophisticated vocabulary and complex syntax -> C2
- Simple correct sentences without complex structures -> B1 maximum

improvement_suggestions: 3-5 concrete English tips. linking_words: French connectors the writer should use. vocabulary_suggestions: French words/phrases to enrich the text."""

FALLBACK_ANALYSIS = {
    "errors": [],
    "overall_score": 0,
    "tcf_level": "A1",
    "improvement_suggestions": [],
    "linking_words": [],
    "vocabulary_suggestions": [],
    "ai_unavailable": True,
}


def _strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def _call_openai_sync(model: str, user_text: str) -> str:
    from openai import OpenAI
    oclient = OpenAI(api_key=OPENAI_API_KEY)
    resp = oclient.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[
            {"role": "system", "content": GRADER_SYSTEM},
            {"role": "user", "content": user_text},
        ],
    )
    return resp.choices[0].message.content or ""


def _validate_analysis(data: dict) -> dict:
    errors = []
    for e in data.get("errors", []) or []:
        if not isinstance(e, dict):
            continue
        cat = e.get("category", "spelling")
        if cat not in VALID_CATEGORIES:
            cat = "spelling"
        errors.append({
            "error": str(e.get("error", "")),
            "correction": str(e.get("correction", "")),
            "explanation": str(e.get("explanation", "")),
            "category": cat,
        })
    score = data.get("overall_score", 0)
    try:
        score = max(0, min(100, int(score)))
    except (TypeError, ValueError):
        score = 0
    level = data.get("tcf_level", "A1")
    if level not in {"A1", "A2", "B1", "B2", "C1", "C2"}:
        level = "A1"
    return {
        "errors": errors,
        "overall_score": score,
        "tcf_level": level,
        "improvement_suggestions": [str(x) for x in (data.get("improvement_suggestions") or [])][:8],
        "linking_words": [str(x) for x in (data.get("linking_words") or [])][:12],
        "vocabulary_suggestions": [str(x) for x in (data.get("vocabulary_suggestions") or [])][:12],
    }


async def analyze_text_with_ai(text: str, topic: Optional[str] = None) -> dict:
    """Grade with OpenAI. Two attempts."""
    prompt = (f"Topic/consigne: {topic}\n\nText to grade:\n{text}"
              if topic else f"Text to grade:\n{text}")
    if not OPENAI_API_KEY:
        log.warning("No OPENAI_API_KEY set")
        return dict(FALLBACK_ANALYSIS)
    loop = asyncio.get_event_loop()
    for attempt in range(2):
        try:
            raw = await loop.run_in_executor(
                None, _call_openai_sync, OPENAI_MODEL, prompt)
            data = json.loads(_strip_fences(raw))
            return _validate_analysis(data)
        except Exception as exc:  # noqa: BLE001
            log.warning("AI call failed (openai/%s attempt %s): %s",
                        OPENAI_MODEL, attempt + 1, exc)
            await asyncio.sleep(0.5)
    return dict(FALLBACK_ANALYSIS)


STATIC_DISTRACTORS = {
    "prepositions": "à la maison de",
    "spelling": "ortographe",
    "conjugation": "ils a fait",
    "gender_number": "une problème",
    "anglicism": "prendre une décision finale éventuellement",
    "improvement": "C'est bien.",
}


async def generate_distractor(error_text: str, correction: str,
                              category: str) -> str:
    """Batch-time MCQ distractor; falls back to a static map."""
    prompt = (f'A French learner wrote: "{error_text}". The correction is '
              f'"{correction}". Produce ONE plausible but INCORRECT alternative '
              f"a learner might choose (same length/style). Return ONLY the "
              f"alternative text, nothing else.")
    loop = asyncio.get_event_loop()
    try:
        if OPENAI_API_KEY:
            raw = await loop.run_in_executor(
                None, _call_openai_sync, OPENAI_MODEL, prompt)
            raw = _strip_fences(raw).strip().strip('"')
            if raw and raw.lower() != correction.lower():
                return raw[:200]
    except Exception:  # noqa: BLE001
        pass
    return STATIC_DISTRACTORS.get(category, "réponse incorrecte")


def normalize_error_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


async def record_mistakes(user_id: str, source: str, ref_id: str,
                          analysis: dict, generate_distractors: bool = True):
    """Write each detected error into the per-user mistakes collection."""
    for err in analysis.get("errors", []):
        if err["category"] == "improvement":
            continue  # improvements are not mistakes
        norm = normalize_error_text(err["error"])
        existing = await db.mistakes.find_one(
            {"user_id": user_id, "category": err["category"],
             "normalized_error": norm})
        if existing:
            new_status = ("new" if existing.get("status") == "mastered"
                          else existing.get("status", "new"))
            await db.mistakes.update_one(
                {"mistake_id": existing["mistake_id"]},
                {"$inc": {"times_repeated": 1},
                 "$set": {"last_seen_at": now_utc(), "status": new_status}})
            continue
        distractor = STATIC_DISTRACTORS.get(err["category"],
                                            "réponse incorrecte")
        if generate_distractors:
            distractor = await generate_distractor(
                err["error"], err["correction"], err["category"])
        await db.mistakes.insert_one({
            "mistake_id": new_id("mst"),
            "user_id": user_id,
            "source": source,
            "ref_id": ref_id,
            "category": err["category"],
            "error_text": err["error"],
            "normalized_error": norm,
            "correction": err["correction"],
            "explanation": err["explanation"],
            "distractor": distractor,
            "created_at": now_utc(),
            "last_seen_at": now_utc(),
            "status": "new",
            "times_repeated": 1,
            "srs_interval_index": 0,
            "srs_due_at": now_utc(),
            "srs_consecutive_got_it": 0,
        })


async def persist_submission(user: dict, text: str, prompt_id: Optional[str],
                             analysis: dict, source: str = "practice") -> dict:
    sub = {
        "submission_id": new_id("sub"),
        "user_id": user["user_id"],
        "prompt_id": prompt_id,
        "original_text": text,
        "errors": analysis["errors"],
        "overall_score": analysis["overall_score"],
        "tcf_level": analysis["tcf_level"],
        "improvement_suggestions": analysis["improvement_suggestions"],
        "linking_words": analysis["linking_words"],
        "vocabulary_suggestions": analysis["vocabulary_suggestions"],
        "word_count": len(text.split()),
        "source": source,
        "created_at": now_utc(),
    }
    await db.submissions.insert_one(dict(sub))
    await record_mistakes(user["user_id"], source, sub["submission_id"],
                          analysis)
    await consume_credit(user["user_id"])
    streak = await update_streak(user["user_id"])
    sub["streak"] = streak
    return sub


# ----------------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------------
class RegisterIn(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1)
    prompt_id: Optional[str] = None
    topic: Optional[str] = None
    label: Optional[str] = None  # alias used by paste / topic pages
    source: Optional[str] = "practice"  # practice | paste


class SimulatorTask(BaseModel):
    prompt: str
    text: str


class SimulatorSubmitIn(BaseModel):
    task1: SimulatorTask
    task2: SimulatorTask
    task3: SimulatorTask
    time_used_seconds: int = 0


class PromptIn(BaseModel):
    title: str
    description: str
    category: str
    level: str = "C1"


class ExamQuestionIn(BaseModel):
    exam_type: str
    text: str
    question: str
    options: List[Dict[str, str]]
    correct_answer: str


class ExamQuestionUpdate(BaseModel):
    exam_type: Optional[str] = None
    text: Optional[str] = None
    question: Optional[str] = None
    options: Optional[List[Dict[str, str]]] = None
    correct_answer: Optional[str] = None
    is_active: Optional[bool] = None


class RecentTopicIn(BaseModel):
    title: str
    task_type: int = Field(ge=1, le=3)
    topic_text: str
    model_answer: str
    target_level: str = "B2"
    month_label: str


class SimPromptIn(BaseModel):
    task_type: int = Field(ge=1, le=3)
    text: str


class ReviewResult(BaseModel):
    mistake_id: str
    correct: bool


class ReviewSubmitIn(BaseModel):
    mode: str  # flashcards | mcq | sprint
    results: List[ReviewResult]


# ----------------------------------------------------------------------------
# Seeds
# ----------------------------------------------------------------------------
SEED_PROMPTS = [
    ("L'impact de la technologie sur les relations humaines",
     "Analysez comment les nouvelles technologies ont transformé la communication et les relations humaines. Discutez des avantages et des inconvénients.",
     "technology"),
    ("Le rôle de l'éducation dans la société moderne",
     "Rédigez un essai argumentatif sur l'importance de l'éducation et sur la manière dont le système éducatif devrait évoluer pour le 21e siècle.",
     "education"),
    ("Les enjeux environnementaux contemporains",
     "Présentez les principaux défis environnementaux actuels et proposez des solutions concrètes pour les individus et les gouvernements.",
     "environment"),
    ("L'immigration et l'intégration culturelle",
     "Discutez des défis et des opportunités liés à l'immigration, ainsi que des conditions d'une intégration réussie tout en préservant la diversité culturelle.",
     "society"),
    ("Le travail à distance: révolution ou évolution?",
     "Analysez les impacts du télétravail sur la productivité, l'équilibre vie professionnelle/vie privée et les relations au travail.",
     "work"),
]

SEED_SIM_PROMPTS = [
    (1, "Vous organisez une fête pour le départ d'un collègue. Écrivez un message à vos collègues pour les inviter (date, lieu, organisation). (60 à 120 mots)"),
    (1, "Vous venez de déménager. Écrivez un message à un ami pour lui donner votre nouvelle adresse et l'inviter à visiter. (60 à 120 mots)"),
    (2, "Racontez sur votre blog une expérience de voyage qui vous a marqué(e) : décrivez le lieu, les rencontres et ce que vous avez appris. (120 à 150 mots)"),
    (2, "Vous avez participé à un événement culturel récemment. Écrivez un article pour le journal local racontant cette expérience. (120 à 150 mots)"),
    (3, "« Le télétravail devrait devenir la norme. » Certains approuvent, d'autres pensent que le bureau reste essentiel. Comparez les deux points de vue et donnez votre opinion. (120 à 180 mots)"),
    (3, "« Les réseaux sociaux rapprochent les gens. » D'autres affirment qu'ils nous isolent. Présentez les deux positions et défendez la vôtre. (120 à 180 mots)"),
]

SEED_EXAM_QUESTIONS = [
    {
        "exam_type": "reading-comprehension",
        "text": "La bibliothèque municipale sera fermée du 12 au 19 août pour travaux de rénovation. Les retours de livres restent possibles via la boîte extérieure.",
        "question": "Que peut-on faire pendant la fermeture ?",
        "options": [{"id": "a", "text": "Emprunter des livres"},
                    {"id": "b", "text": "Rendre des livres"},
                    {"id": "c", "text": "Consulter les archives"},
                    {"id": "d", "text": "Assister aux ateliers"}],
        "correct_answer": "b",
    },
    {
        "exam_type": "reading-comprehension",
        "text": "Suite à une forte demande, le festival prolonge ses ventes : les billets à tarif réduit sont disponibles jusqu'au 30 juin au lieu du 15 juin.",
        "question": "Quelle information est correcte ?",
        "options": [{"id": "a", "text": "Le festival est annulé"},
                    {"id": "b", "text": "Les tarifs ont augmenté"},
                    {"id": "c", "text": "La promotion est prolongée"},
                    {"id": "d", "text": "Les billets sont épuisés"}],
        "correct_answer": "c",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Mesdames et messieurs, en raison d'un incident technique, le train de 14h32 à destination de Montréal partira avec un retard d'environ vingt minutes. »",
        "question": "Quel est le problème annoncé ?",
        "options": [{"id": "a", "text": "Le train est annulé"},
                    {"id": "b", "text": "Le train est en retard"},
                    {"id": "c", "text": "Le quai a changé"},
                    {"id": "d", "text": "Le train est complet"}],
        "correct_answer": "b",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Bonjour, c'est Claire. Je voulais te dire que la réunion de demain est déplacée à jeudi à la même heure. Rappelle-moi si ça pose problème. »",
        "question": "Que demande Claire ?",
        "options": [{"id": "a", "text": "D'annuler la réunion"},
                    {"id": "b", "text": "De changer l'heure"},
                    {"id": "c", "text": "De la rappeler en cas de problème"},
                    {"id": "d", "text": "De préparer un document"}],
        "correct_answer": "c",
    },
]


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.submissions.create_index("submission_id", unique=True)
    await db.prompts.create_index("prompt_id", unique=True)
    await db.exam_questions.create_index("question_id", unique=True)
    await db.submissions.create_index("user_id")
    await db.exam_questions.create_index("exam_type")
    await db.mistakes.create_index([("user_id", 1), ("category", 1)])
    await db.recent_topics.create_index("topic_id", unique=True)
    await db.exam_attempts.create_index("attempt_id", unique=True)

    if not await db.users.find_one({"email": ADMIN_EMAIL}):
        await db.users.insert_one({
            "user_id": new_id("user"),
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Admin",
            "role": "admin",
            "created_at": now_utc(),
            "free_submissions_used": 0,
            "subscription_status": "premium",
            "monthly_reset_date": now_utc(),
            "current_streak": 0, "longest_streak": 0,
            "last_activity_date": None, "xp": 0, "badges": [],
            "model_answers_read": 0,
        })
        log.info("Seeded admin account %s", ADMIN_EMAIL)

    if await db.prompts.count_documents({}) == 0:
        for title, desc, cat in SEED_PROMPTS:
            await db.prompts.insert_one({
                "prompt_id": new_id("prompt"), "title": title,
                "description": desc, "category": cat, "level": "C1",
                "is_active": True, "created_at": now_utc(),
            })
        log.info("Seeded %d writing prompts", len(SEED_PROMPTS))

    if await db.simulator_prompts.count_documents({}) == 0:
        for task_type, text in SEED_SIM_PROMPTS:
            await db.simulator_prompts.insert_one({
                "sim_prompt_id": new_id("simp"), "task_type": task_type,
                "text": text, "is_active": True, "created_at": now_utc(),
            })

    if await db.exam_questions.count_documents({}) == 0:
        for q in SEED_EXAM_QUESTIONS:
            await db.exam_questions.insert_one({
                "question_id": new_id("q"), **q,
                "created_at": now_utc(), "is_active": True,
            })


# ----------------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------------
@app.get("/api/")
async def root():
    return {"message": "TCF Canada Prep API", "status": "healthy"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ----------------------------------------------------------------------------
# Auth routes
# ----------------------------------------------------------------------------
@app.post("/api/auth/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = {
        "user_id": new_id("user"),
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name.strip(),
        "role": "admin" if email == ADMIN_EMAIL else "user",
        "created_at": now_utc(),
        "free_submissions_used": 0,
        "subscription_status": "free",
        "monthly_reset_date": now_utc(),
        "current_streak": 0, "longest_streak": 0,
        "last_activity_date": None, "xp": 0, "badges": [],
        "model_answers_read": 0,
    }
    await db.users.insert_one(dict(user))
    set_auth_cookies(response, user["user_id"])
    return {"user": public_user(user)}


@app.post("/api/auth/login")
async def login(body: LoginIn, response: Response):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    set_auth_cookies(response, user["user_id"])
    return {"user": public_user(user)}


@app.post("/api/auth/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    user_id = decode_token(token, "refresh") if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = make_token(user_id, "access", minutes=ACCESS_TTL_MIN)
    response.set_cookie("access_token", access, httponly=True, samesite="lax",
                        path="/", max_age=ACCESS_TTL_MIN * 60)
    return {"user": public_user(user)}


@app.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    user = await check_and_reset_monthly(user)
    return {"user": public_user(user)}


@app.post("/api/auth/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"detail": "Logged out"}


# ----------------------------------------------------------------------------
# Prompts (public)
# ----------------------------------------------------------------------------
@app.get("/api/prompts")
async def list_prompts():
    cur = db.prompts.find({"is_active": True}).sort("created_at", 1)
    return {"prompts": [strip_mongo(p) async for p in cur]}


@app.get("/api/prompts/{prompt_id}")
async def get_prompt(prompt_id: str):
    p = await db.prompts.find_one({"prompt_id": prompt_id, "is_active": True})
    if not p:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"prompt": strip_mongo(p)}


# ----------------------------------------------------------------------------
# Analysis: streaming SSE + legacy
# ----------------------------------------------------------------------------
STAGES = ["parsing", "grammar", "spelling", "conjugation", "style", "generating"]


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.post("/api/analyze/stream")
async def analyze_stream(body: AnalyzeIn,
                         user: dict = Depends(get_current_user)):
    user = await enforce_free_limit(user)
    source = body.source if body.source in {"practice", "paste"} else "practice"

    async def gen():
        try:
            task = asyncio.create_task(
                analyze_text_with_ai(body.text, body.topic or body.label))
            for stage in STAGES:
                yield _sse("stage", {"stage": stage})
                await asyncio.sleep(0.6)
            analysis = await task
            sub = await persist_submission(
                user, body.text, body.prompt_id, analysis, source=source)
            yield _sse("complete", strip_mongo(sub))
        except HTTPException as exc:
            yield _sse("error", {"detail": exc.detail,
                                 "status": exc.status_code})
        except Exception:  # noqa: BLE001
            log.exception("Stream analysis failed")
            yield _sse("error",
                       {"detail": "AI analysis temporarily unavailable"})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.post("/api/submissions")
async def create_submission(body: AnalyzeIn,
                            user: dict = Depends(get_current_user)):
    user = await enforce_free_limit(user)
    source = body.source if body.source in {"practice", "paste"} else "practice"
    analysis = await analyze_text_with_ai(body.text, body.topic or body.label)
    sub = await persist_submission(user, body.text, body.prompt_id, analysis,
                                   source=source)
    return strip_mongo(sub)


@app.get("/api/submissions")
async def list_submissions(user: dict = Depends(get_current_user)):
    cur = db.submissions.find({"user_id": user["user_id"]}) \
        .sort("created_at", -1).limit(100)
    return {"submissions": [strip_mongo(s) async for s in cur]}


@app.get("/api/submissions/{submission_id}")
async def get_submission(submission_id: str,
                         user: dict = Depends(get_current_user)):
    sub = await db.submissions.find_one({"submission_id": submission_id})
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub["user_id"] != user["user_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return {"submission": strip_mongo(sub)}


# ----------------------------------------------------------------------------
# Exam simulator
# ----------------------------------------------------------------------------
@app.get("/api/simulator/start")
async def simulator_start(user: dict = Depends(get_current_user)):
    """Return one random active prompt per task."""
    tasks = {}
    for t in (1, 2, 3):
        pipeline = [{"$match": {"task_type": t, "is_active": True}},
                    {"$sample": {"size": 1}}]
        docs = await db.simulator_prompts.aggregate(pipeline).to_list(1)
        if not docs:
            raise HTTPException(status_code=503,
                                detail=f"No simulator prompts for Tâche {t}")
        tasks[f"task{t}"] = strip_mongo(docs[0])
    return tasks


WORD_GUIDE = {1: (60, 120), 2: (120, 150), 3: (120, 180)}


@app.post("/api/simulator/submit")
async def simulator_submit(body: SimulatorSubmitIn,
                           user: dict = Depends(get_current_user)):
    user = await enforce_free_limit(user)
    attempt_id = new_id("att")
    tasks_out = {}
    scores = []
    levels = []
    level_order = ["A1", "A2", "B1", "B2", "C1", "C2"]
    for i, task in ((1, body.task1), (2, body.task2), (3, body.task3)):
        if task.text.strip():
            analysis = await analyze_text_with_ai(task.text, task.prompt)
        else:
            analysis = dict(FALLBACK_ANALYSIS)
        tasks_out[f"task{i}"] = {
            "prompt": task.prompt, "text": task.text, "analysis": analysis,
            "word_count": len(task.text.split()),
            "word_guide": list(WORD_GUIDE[i]),
        }
        scores.append(analysis["overall_score"])
        levels.append(analysis["tcf_level"])
        await record_mistakes(user["user_id"], "simulator", attempt_id,
                              analysis)
    combined = round(sum(scores) / 3, 1)
    tcf_level = level_order[
        min(round(sum(level_order.index(l) for l in levels) / 3), 5)]
    attempt = {
        "attempt_id": attempt_id, "user_id": user["user_id"],
        **tasks_out,
        "combined_score": combined, "tcf_level": tcf_level,
        "time_used_seconds": body.time_used_seconds, "created_at": now_utc(),
    }
    await db.exam_attempts.insert_one(dict(attempt))
    await consume_credit(user["user_id"])  # one credit per run, not three
    streak = await update_streak(user["user_id"])
    attempt["streak"] = streak
    return {"attempt": strip_mongo(attempt)}


@app.get("/api/simulator/attempts")
async def simulator_attempts(user: dict = Depends(get_current_user)):
    cur = db.exam_attempts.find({"user_id": user["user_id"]}) \
        .sort("created_at", -1).limit(50)
    return [strip_mongo(a) async for a in cur]


@app.get("/api/simulator/attempts/{attempt_id}")
async def simulator_attempt(attempt_id: str,
                            user: dict = Depends(get_current_user)):
    a = await db.exam_attempts.find_one({"attempt_id": attempt_id})
    if not a:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if a["user_id"] != user["user_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return strip_mongo(a)


# ----------------------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------------------
@app.get("/api/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    subs = [s async for s in db.submissions.find(
        {"user_id": user["user_id"]}).sort("created_at", 1)]
    total = len(subs)
    avg = round(sum(s["overall_score"] for s in subs) / total, 1) if total else 0.0
    breakdown = {c: 0 for c in VALID_CATEGORIES}
    for s in subs:
        for e in s.get("errors", []):
            cat = e.get("category", "spelling")
            breakdown[cat] = breakdown.get(cat, 0) + 1
    trend = [{"date": s["created_at"].strftime("%Y-%m-%d")
              if isinstance(s["created_at"], datetime) else str(s["created_at"])[:10],
              "score": s["overall_score"]} for s in subs[-10:]]
    freq = sorted(((c, n) for c, n in breakdown.items() if n > 0),
                  key=lambda x: -x[1])
    return {
        "total_submissions": total,
        "average_score": avg,
        "error_breakdown": breakdown,
        "score_trend": trend,
        "most_frequent_errors": [{"category": c, "count": n} for c, n in freq],
        "current_streak": user.get("current_streak", 0),
        "longest_streak": user.get("longest_streak", 0),
        "xp": user.get("xp", 0),
        "badges": user.get("badges", []),
    }


@app.get("/api/dashboard/heatmap")
async def dashboard_heatmap(user: dict = Depends(get_current_user)):
    since = now_utc() - timedelta(days=365)
    out: Dict[str, int] = {}
    async for s in db.submissions.find(
            {"user_id": user["user_id"], "created_at": {"$gte": since}}):
        d = s["created_at"]
        key = d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)[:10]
        out[key] = out.get(key, 0) + 1
    async for r in db.review_sessions.find(
            {"user_id": user["user_id"], "created_at": {"$gte": since}}):
        d = r["created_at"]
        key = d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)[:10]
        out[key] = out.get(key, 0) + 1
    return {"heatmap": out}


CATEGORY_TIPS = {
    "gender_number": "Learn nouns WITH their article (une table, un livre). Endings help: -tion/-té/-ée are usually feminine; -age/-ment/-eau usually masculine. Always make adjectives and past participles agree.",
    "conjugation": "Drill the big irregulars (être, avoir, aller, faire, pouvoir, vouloir) daily. Watch passé composé auxiliaries: DR & MRS VANDERTRAMP verbs take être. After 'si', never the conditional in the same clause.",
    "prepositions": "Memorize verb+preposition pairs as units: penser À, dépendre DE, s'intéresser À. Cities take à, feminine countries en, masculine countries au.",
    "spelling": "Accents change meaning (a/à, ou/où, sur/sûr). Re-read once just for accents. Double consonants: appeler -> appelle, jeter -> jette.",
    "anglicism": "Beware false friends: 'actuellement' = currently (not actually), 'éventuellement' = possibly. Prefer 'finalement' over 'au final', 'soutenir' over 'supporter'.",
    "improvement": "Replace basic connectors (et, mais) with C1 ones: néanmoins, en outre, par conséquent, dans la mesure où. Vary sentence openings and use the subjunctive after bien que / il faut que.",
}

CATEGORY_LABELS_FR = {
    "prepositions": "Prépositions", "spelling": "Orthographe",
    "conjugation": "Conjugaison",
    "gender_number": "Accord en genre et nombre",
    "anglicism": "Anglicismes", "improvement": "Améliorations C1",
}


@app.get("/api/mistakes/summary")
async def mistakes_summary(user: dict = Depends(get_current_user)):
    mistakes = [m async for m in db.mistakes.find({"user_id": user["user_id"]})]
    per_cat = {c: 0 for c in VALID_CATEGORIES if c != "improvement"}
    status_counts = {"new": 0, "reviewing": 0, "mastered": 0}
    for m in mistakes:
        per_cat[m["category"]] = (per_cat.get(m["category"], 0)
                                  + m.get("times_repeated", 1))
        st = m.get("status", "new")
        status_counts[st] = status_counts.get(st, 0) + 1
    monthly: Dict[str, Dict[str, int]] = {}
    async for s in db.submissions.find({"user_id": user["user_id"]}):
        d = s["created_at"]
        key = d.strftime("%Y-%m") if isinstance(d, datetime) else str(d)[:7]
        bucket = monthly.setdefault(key, {"errors": 0, "words": 0})
        bucket["errors"] += len([e for e in s.get("errors", [])
                                 if e.get("category") != "improvement"])
        bucket["words"] += s.get("word_count",
                                 len(s["original_text"].split()))
    trend = [{"month": k,
              "errors_per_100_words": round(v["errors"] / v["words"] * 100, 2)
              if v["words"] else 0}
             for k, v in sorted(monthly.items())]
    repeat_leaders = sorted(mistakes,
                            key=lambda m: -m.get("times_repeated", 1))[:5]
    weak = sorted(((c, n) for c, n in per_cat.items() if n > 0),
                  key=lambda x: -x[1])[:3]
    narrative = None
    subs = [s async for s in db.submissions.find({"user_id": user["user_id"]})
            .sort("created_at", -1).limit(10)]
    if len(subs) >= 6:
        def rate(group, cat):
            errs = sum(len([e for e in s.get("errors", [])
                            if e.get("category") == cat]) for s in group)
            words = sum(s.get("word_count", 1) for s in group) or 1
            return errs / words
        recent, older = subs[:5], subs[5:]
        best_cat, best_drop = None, 0
        for cat in per_cat:
            r_new, r_old = rate(recent, cat), rate(older, cat)
            if r_old > 0:
                drop = (r_old - r_new) / r_old
                if drop > best_drop:
                    best_cat, best_drop = cat, drop
        if best_cat and best_drop >= 0.1:
            narrative = (f"{CATEGORY_LABELS_FR[best_cat]} errors down "
                         f"{round(best_drop * 100)}% over your last 5 "
                         f"submissions. Keep going!")
    return {
        "per_category": per_cat,
        "status_counts": status_counts,
        "trend": trend,
        "monthly_trend": trend,
        "repeat_leaders": [strip_mongo(m) for m in repeat_leaders],
        "weak_points": [{"category": c, "count": n,
                         "label": CATEGORY_LABELS_FR.get(c, c),
                         "tip": CATEGORY_TIPS.get(c, "")} for c, n in weak],
        "narrative": narrative,
    }


# ----------------------------------------------------------------------------
# Gamified review (spaced repetition)
# ----------------------------------------------------------------------------
SRS_LADDER = [1, 3, 7, 14]
XP_PER_CORRECT = 10
XP_CATEGORY_CLEAR_BONUS = 50


@app.get("/api/review/queue")
async def review_queue(category: Optional[str] = None,
                       limit: int = Query(20, le=50),
                       user: dict = Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": user["user_id"],
                         "status": {"$ne": "mastered"},
                         "srs_due_at": {"$lte": now_utc()}}
    if category and category in VALID_CATEGORIES:
        q["category"] = category
    cur = db.mistakes.find(q).sort("srs_due_at", 1).limit(limit)
    return {"due": [strip_mongo(m) async for m in cur]}


@app.post("/api/review/submit")
async def review_submit(body: ReviewSubmitIn,
                        user: dict = Depends(get_current_user)):
    xp = 0
    mastered_now: List[str] = []
    new_badges: List[str] = []
    for r in body.results:
        m = await db.mistakes.find_one(
            {"mistake_id": r.mistake_id, "user_id": user["user_id"]})
        if not m:
            continue
        updates: Dict[str, Any] = {}
        if r.correct:
            xp += XP_PER_CORRECT
            streak_ok = m.get("srs_consecutive_got_it", 0) + 1
            idx = m.get("srs_interval_index", 0)
            if idx >= len(SRS_LADDER) - 1 and streak_ok >= 2:
                updates["status"] = "mastered"
                mastered_now.append(m["mistake_id"])
            else:
                idx = min(idx + 1, len(SRS_LADDER) - 1)
                updates["status"] = "reviewing"
            updates["srs_consecutive_got_it"] = streak_ok
            updates["srs_interval_index"] = idx
            updates["srs_due_at"] = now_utc() + timedelta(days=SRS_LADDER[idx])
        else:
            updates["srs_consecutive_got_it"] = 0
            updates["srs_interval_index"] = 0
            updates["srs_due_at"] = now_utc() + timedelta(days=SRS_LADDER[0])
            updates["status"] = "reviewing"
        await db.mistakes.update_one({"mistake_id": m["mistake_id"]},
                                     {"$set": updates})
        if (updates.get("status") == "mastered"
                and m.get("times_repeated", 1) >= 3):
            new_badges.append("Comeback — fixed a mistake repeated 3+ times")
    user_doc = await db.users.find_one({"user_id": user["user_id"]})
    badges = set(user_doc.get("badges", []))
    slayer = "Conjugaison Slayer — 25 conjugation mistakes mastered"
    n_conj = await db.mistakes.count_documents(
        {"user_id": user["user_id"], "category": "conjugation",
         "status": "mastered"})
    if n_conj >= 25 and slayer not in badges:
        new_badges.append(slayer)
    for cat in VALID_CATEGORIES:
        remaining = await db.mistakes.count_documents(
            {"user_id": user["user_id"], "category": cat,
             "status": {"$ne": "mastered"}})
        had_any = await db.mistakes.count_documents(
            {"user_id": user["user_id"], "category": cat})
        if had_any and remaining == 0:
            xp += XP_CATEGORY_CLEAR_BONUS
    badges.update(new_badges)
    session = {
        "session_id": new_id("rev"), "user_id": user["user_id"],
        "mode": body.mode,
        "mistake_ids": [r.mistake_id for r in body.results],
        "results": [r.dict() for r in body.results],
        "xp_earned": xp, "created_at": now_utc(),
    }
    await db.review_sessions.insert_one(dict(session))
    await db.users.update_one({"user_id": user["user_id"]},
                              {"$inc": {"xp": xp},
                               "$set": {"badges": sorted(badges)}})
    streak = await update_streak(user["user_id"])
    return {"session": strip_mongo(session), "xp_earned": xp,
            "newly_mastered": mastered_now, "badges": new_badges,
            "total_xp": user_doc.get("xp", 0) + xp,
            "streak": streak}


@app.get("/api/review/mastery")
async def review_mastery(user: dict = Depends(get_current_user)):
    out = {}
    for cat in VALID_CATEGORIES:
        if cat == "improvement":
            continue
        total = await db.mistakes.count_documents(
            {"user_id": user["user_id"], "category": cat})
        mastered = await db.mistakes.count_documents(
            {"user_id": user["user_id"], "category": cat,
             "status": "mastered"})
        out[cat] = {"total": total, "mastered": mastered}
    return out


# ----------------------------------------------------------------------------
# Mock exams
# ----------------------------------------------------------------------------
@app.get("/api/exam/questions/{exam_type}")
async def exam_questions(exam_type: str):
    if exam_type not in {"reading-comprehension", "oral-comprehension"}:
        raise HTTPException(status_code=404, detail="Unknown exam type")
    cur = db.exam_questions.find({"exam_type": exam_type, "is_active": True})
    return {"questions": [strip_mongo(q) async for q in cur]}


# ----------------------------------------------------------------------------
# Speaking (stub)
# ----------------------------------------------------------------------------
@app.post("/api/speaking/analyze")
async def speaking_analyze(user: dict = Depends(get_current_user)):
    await enforce_free_limit(user)
    return {
        "message": ("La transcription audio n'est pas encore disponible. "
                    "Cette fonctionnalité arrive bientôt ! En attendant, "
                    "entraînez-vous avec l'Expression Écrite pour améliorer "
                    "votre français."),
        "available": False,
    }


# ----------------------------------------------------------------------------
# Recent topics
# ----------------------------------------------------------------------------
@app.get("/api/recent-topics")
async def recent_topics(task_type: Optional[int] = None):
    q: Dict[str, Any] = {"is_active": True}
    if task_type in (1, 2, 3):
        q["task_type"] = task_type
    cur = db.recent_topics.find(q).sort("created_at", -1)
    out = []
    async for t in cur:
        t = strip_mongo(t)
        t.pop("model_answer", None)  # never leak in the list view
        out.append(t)
    return {"topics": out}


@app.get("/api/recent-topics/{topic_id}")
async def recent_topic(topic_id: str,
                       user: dict = Depends(get_current_user)):
    """Topic detail. The model answer is included for premium users always,
    and for free users on up to FREE_MODEL_ANSWER_LIMIT distinct topics
    (re-reading an already-unlocked topic is free). Past the limit the
    answer is withheld and `model_answer_locked` is set instead."""
    t = await db.recent_topics.find_one(
        {"topic_id": topic_id, "is_active": True})
    if not t:
        raise HTTPException(status_code=404, detail="Topic not found")
    t = strip_mongo(t)
    model_answer = t.pop("model_answer", "")
    t["model_answer_locked"] = False
    if user.get("subscription_status") == "premium":
        t["model_answer"] = model_answer
    else:
        unlocked = user.get("model_answer_topic_ids", [])
        if topic_id in unlocked:
            t["model_answer"] = model_answer
        elif len(unlocked) < FREE_MODEL_ANSWER_LIMIT:
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$addToSet": {"model_answer_topic_ids": topic_id},
                 "$inc": {"model_answers_read": 1}})
            t["model_answer"] = model_answer
        else:
            t["model_answer_locked"] = True
    return {"topic": t}


# ----------------------------------------------------------------------------
# Admin
# ----------------------------------------------------------------------------
@app.get("/api/admin/users")
async def admin_users(admin: dict = Depends(get_admin_user)):
    return {"users": [strip_mongo(u) async for u in
                      db.users.find().sort("created_at", -1)]}


@app.get("/api/admin/submissions")
async def admin_submissions(admin: dict = Depends(get_admin_user)):
    cur = db.submissions.find().sort("created_at", -1).limit(200)
    return {"submissions": [strip_mongo(s) async for s in cur]}


@app.get("/api/admin/analytics")
async def admin_analytics(admin: dict = Depends(get_admin_user)):
    total_users = await db.users.count_documents({})
    total_submissions = await db.submissions.count_documents({})
    breakdown = {c: 0 for c in VALID_CATEGORIES}
    err_counts: Dict[str, int] = {}
    async for s in db.submissions.find():
        for e in s.get("errors", []):
            cat = e.get("category", "spelling")
            breakdown[cat] = breakdown.get(cat, 0) + 1
            key = e.get("error", "").strip()
            if key:
                err_counts[key] = err_counts.get(key, 0) + 1
    top = sorted(err_counts.items(), key=lambda x: -x[1])[:10]
    return {"total_users": total_users,
            "total_submissions": total_submissions,
            "error_breakdown": breakdown,
            "top_errors": [{"error": e, "count": n} for e, n in top]}


@app.post("/api/admin/prompts")
async def admin_create_prompt(body: PromptIn,
                              admin: dict = Depends(get_admin_user)):
    doc = {"prompt_id": new_id("prompt"), **body.dict(),
           "is_active": True, "created_at": now_utc()}
    await db.prompts.insert_one(dict(doc))
    return strip_mongo(doc)


@app.put("/api/admin/prompts/{prompt_id}")
async def admin_update_prompt(prompt_id: str, body: PromptIn,
                              admin: dict = Depends(get_admin_user)):
    res = await db.prompts.update_one({"prompt_id": prompt_id},
                                      {"$set": body.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return strip_mongo(await db.prompts.find_one({"prompt_id": prompt_id}))


@app.delete("/api/admin/prompts/{prompt_id}")
async def admin_delete_prompt(prompt_id: str,
                              admin: dict = Depends(get_admin_user)):
    res = await db.prompts.update_one({"prompt_id": prompt_id},
                                      {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"detail": "Prompt deactivated"}


@app.post("/api/admin/exam/questions")
async def admin_create_question(body: ExamQuestionIn,
                                admin: dict = Depends(get_admin_user)):
    doc = {"question_id": new_id("q"), **body.dict(),
           "created_at": now_utc(), "is_active": True}
    await db.exam_questions.insert_one(dict(doc))
    return strip_mongo(doc)


@app.put("/api/admin/exam/questions/{question_id}")
async def admin_update_question(question_id: str, body: ExamQuestionUpdate,
                                admin: dict = Depends(get_admin_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.exam_questions.update_one({"question_id": question_id},
                                             {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return strip_mongo(
        await db.exam_questions.find_one({"question_id": question_id}))


@app.delete("/api/admin/exam/questions/{question_id}")
async def admin_delete_question(question_id: str,
                                admin: dict = Depends(get_admin_user)):
    res = await db.exam_questions.update_one(
        {"question_id": question_id}, {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"detail": "Question deactivated"}


@app.get("/api/admin/exam/questions")
async def admin_list_questions(admin: dict = Depends(get_admin_user)):
    cur = db.exam_questions.find().sort("created_at", -1)
    return [strip_mongo(q) async for q in cur]


@app.post("/api/admin/recent-topics")
async def admin_create_topic(body: RecentTopicIn,
                             admin: dict = Depends(get_admin_user)):
    doc = {"topic_id": new_id("topic"), **body.dict(),
           "created_at": now_utc(), "is_active": True}
    await db.recent_topics.insert_one(dict(doc))
    return strip_mongo(doc)


@app.put("/api/admin/recent-topics/{topic_id}")
async def admin_update_topic(topic_id: str, body: RecentTopicIn,
                             admin: dict = Depends(get_admin_user)):
    res = await db.recent_topics.update_one({"topic_id": topic_id},
                                            {"$set": body.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Topic not found")
    return strip_mongo(
        await db.recent_topics.find_one({"topic_id": topic_id}))


@app.delete("/api/admin/recent-topics/{topic_id}")
async def admin_delete_topic(topic_id: str,
                             admin: dict = Depends(get_admin_user)):
    res = await db.recent_topics.update_one(
        {"topic_id": topic_id}, {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"detail": "Topic deactivated"}


@app.get("/api/admin/recent-topics")
async def admin_list_topics(admin: dict = Depends(get_admin_user)):
    cur = db.recent_topics.find().sort("created_at", -1)
    return {"topics": [strip_mongo(t) async for t in cur]}


@app.get("/api/admin/simulator-prompts")
async def admin_sim_prompts(admin: dict = Depends(get_admin_user)):
    cur = db.simulator_prompts.find().sort(
        [("task_type", 1), ("created_at", -1)])
    return {"prompts": [strip_mongo(p) async for p in cur]}


@app.post("/api/admin/simulator-prompts")
async def admin_create_sim_prompt(body: SimPromptIn,
                                  admin: dict = Depends(get_admin_user)):
    doc = {"sim_prompt_id": new_id("simp"), **body.dict(),
           "is_active": True, "created_at": now_utc()}
    await db.simulator_prompts.insert_one(dict(doc))
    return strip_mongo(doc)


@app.put("/api/admin/simulator-prompts/{sim_prompt_id}")
async def admin_update_sim_prompt(sim_prompt_id: str, body: SimPromptIn,
                                  admin: dict = Depends(get_admin_user)):
    res = await db.simulator_prompts.update_one(
        {"sim_prompt_id": sim_prompt_id}, {"$set": body.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404,
                            detail="Simulator prompt not found")
    return strip_mongo(await db.simulator_prompts.find_one(
        {"sim_prompt_id": sim_prompt_id}))


@app.delete("/api/admin/simulator-prompts/{sim_prompt_id}")
async def admin_delete_sim_prompt(sim_prompt_id: str,
                                  admin: dict = Depends(get_admin_user)):
    res = await db.simulator_prompts.update_one(
        {"sim_prompt_id": sim_prompt_id}, {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404,
                            detail="Simulator prompt not found")
    return {"detail": "Simulator prompt deactivated"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
