"""
TCF Prep AI — FastAPI backend (PostgreSQL edition)
French exam-preparation platform for TCF Canada.
All routes are prefixed with /api.

Database layer: SQLAlchemy 2.0 (async) + asyncpg.
Business logic, API routes, AI prompts and grading are unchanged from the
original MongoDB version — only persistence was migrated.
"""
import os
import re
import json
import uuid
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone, date
from typing import Optional, List, Dict, Any

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from sqlalchemy import (
    String, Integer, Boolean, DateTime, Text, ForeignKey, func, select,
    update as sa_update, delete as sa_delete,
)
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship,
)

load_dotenv()

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
RAW_DB_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/tcf_prep_ai")
# Force the asyncpg driver.
DATABASE_URL = RAW_DB_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

DB_NAME = os.environ.get("DB_NAME", "tcf_prep_ai")
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-prod")
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60
REFRESH_TTL_DAYS = 7
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@frenchcorrector.com").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
# OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
# OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
FREE_MONTHLY_LIMIT = 5
FREE_MODEL_ANSWER_LIMIT = 3

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tcf-prep-ai")

# ----------------------------------------------------------------------------
# Database engine / session
# ----------------------------------------------------------------------------
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False,
                                  class_=AsyncSession)


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


class Base(DeclarativeBase):
    pass


# ----------------------------------------------------------------------------
# ORM models  (one class per former Mongo collection)
# ----------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    free_submissions_used: Mapped[int] = mapped_column(Integer, default=0)
    subscription_status: Mapped[str] = mapped_column(String(20), default="free")
    monthly_reset_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_activity_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    badges: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    model_answers_read: Mapped[int] = mapped_column(Integer, default=0)
    model_answer_topic_ids: Mapped[List[str]] = mapped_column(
        ARRAY(String), default=list)


class Prompt(Base):
    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prompt_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50))
    level: Mapped[str] = mapped_column(String(8), default="C1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    prompt_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    original_text: Mapped[str] = mapped_column(Text)
    errors: Mapped[Any] = mapped_column(JSONB, default=list)
    overall_score: Mapped[int] = mapped_column(Integer, default=0)
    tcf_level: Mapped[str] = mapped_column(String(8), default="A1")
    improvement_suggestions: Mapped[Any] = mapped_column(JSONB, default=list)
    linking_words: Mapped[Any] = mapped_column(JSONB, default=list)
    vocabulary_suggestions: Mapped[Any] = mapped_column(JSONB, default=list)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(20), default="practice")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)


class Mistake(Base):
    __tablename__ = "mistakes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mistake_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    source: Mapped[str] = mapped_column(String(20))
    ref_id: Mapped[str] = mapped_column(String(64))
    category: Mapped[str] = mapped_column(String(30), index=True)
    error_text: Mapped[str] = mapped_column(Text)
    normalized_error: Mapped[str] = mapped_column(Text)
    correction: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text)
    distractor: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="new")
    times_repeated: Mapped[int] = mapped_column(Integer, default=1)
    srs_interval_index: Mapped[int] = mapped_column(Integer, default=0)
    srs_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    srs_consecutive_got_it: Mapped[int] = mapped_column(Integer, default=0)


class SimulatorPrompt(Base):
    __tablename__ = "simulator_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sim_prompt_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    task_type: Mapped[int] = mapped_column(Integer, index=True)
    text: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attempt_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    task1: Mapped[Any] = mapped_column(JSONB)
    task2: Mapped[Any] = mapped_column(JSONB)
    task3: Mapped[Any] = mapped_column(JSONB)
    combined_score: Mapped[float] = mapped_column(Integer)
    tcf_level: Mapped[str] = mapped_column(String(8))
    time_used_seconds: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ExamQuestion(Base):
    __tablename__ = "exam_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    exam_type: Mapped[str] = mapped_column(String(40), index=True)
    text: Mapped[str] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
    options: Mapped[Any] = mapped_column(JSONB)
    correct_answer: Mapped[str] = mapped_column(String(8))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RecentTopic(Base):
    __tablename__ = "recent_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    topic_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    task_type: Mapped[int] = mapped_column(Integer)
    topic_text: Mapped[str] = mapped_column(Text)
    model_answer: Mapped[str] = mapped_column(Text)
    target_level: Mapped[str] = mapped_column(String(8), default="B2")
    month_label: Mapped[str] = mapped_column(String(40))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReviewSession(Base):
    __tablename__ = "review_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    mode: Mapped[str] = mapped_column(String(20))
    mistake_ids: Mapped[Any] = mapped_column(JSONB, default=list)
    results: Mapped[Any] = mapped_column(JSONB, default=list)
    xp_earned: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)


# ----------------------------------------------------------------------------
# Row -> dict helpers (replace Mongo's strip_mongo)
# ----------------------------------------------------------------------------
def _row_to_dict(obj: Base, drop: tuple = ()) -> dict:
    """Serialize an ORM row to a plain dict, dropping internal/sensitive cols."""
    out = {}
    for col in obj.__table__.columns:
        if col.name in drop or col.name == "id":
            continue
        out[col.name] = getattr(obj, col.name)
    return out


def strip_user(u: User) -> dict:
    return _row_to_dict(u, drop=("password_hash",))


def public_user(u: User) -> dict:
    return {
        "user_id": u.user_id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "created_at": u.created_at,
        "free_submissions_used": u.free_submissions_used or 0,
        "subscription_status": u.subscription_status or "free",
        "monthly_reset_date": u.monthly_reset_date,
        "current_streak": u.current_streak or 0,
        "longest_streak": u.longest_streak or 0,
        "last_activity_date": u.last_activity_date,
        "xp": u.xp or 0,
        "badges": u.badges or [],
        "model_answers_read": u.model_answers_read or 0,
    }


# ----------------------------------------------------------------------------
# Generic helpers
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
        JWT_SECRET, algorithm=JWT_ALG)


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


# small DB convenience helpers --------------------------------------------------
async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    res = await db.execute(select(User).where(User.user_id == user_id))
    return res.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    res = await db.execute(select(User).where(User.email == email))
    return res.scalar_one_or_none()


# ----------------------------------------------------------------------------
# Auth dependencies
# ----------------------------------------------------------------------------
async def get_current_user(request: Request,
                           db: AsyncSession = Depends(get_db)) -> User:
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
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ----------------------------------------------------------------------------
# Freemium limits & streaks
# ----------------------------------------------------------------------------
async def check_and_reset_monthly(db: AsyncSession, user: User) -> User:
    """Reset the free counter if the month changed; returns the fresh user."""
    reset = user.monthly_reset_date
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
        user.free_submissions_used = 0
        user.monthly_reset_date = now
        await db.commit()
        await db.refresh(user)
    return user


async def enforce_free_limit(db: AsyncSession, user: User) -> User:
    user = await check_and_reset_monthly(db, user)
    if user.subscription_status == "premium":
        return user
    if (user.free_submissions_used or 0) >= FREE_MONTHLY_LIMIT:
        raise HTTPException(
            status_code=402,
            detail="Free tier limit reached. Please upgrade to continue.")
    return user


async def consume_credit(db: AsyncSession, user_id: str):
    await db.execute(
        sa_update(User).where(User.user_id == user_id)
        .values(free_submissions_used=User.free_submissions_used + 1))
    await db.commit()


async def update_streak(db: AsyncSession, user_id: str) -> dict:
    """A qualifying action happened today; update the streak."""
    user = await get_user_by_id(db, user_id)
    today = now_utc().date()
    last = user.last_activity_date
    if isinstance(last, datetime):
        last = last.date()
    elif isinstance(last, str):
        try:
            last = datetime.fromisoformat(last).date()
        except ValueError:
            last = None
    current = user.current_streak or 0
    extended = False
    if last == today:
        pass
    elif last == today - timedelta(days=1):
        current += 1
        extended = True
    else:
        current = 1
        extended = True
    longest = max(user.longest_streak or 0, current)
    user.current_streak = current
    user.longest_streak = longest
    user.last_activity_date = datetime(today.year, today.month, today.day,
                                       tzinfo=timezone.utc)
    await db.commit()
    return {"current_streak": current, "longest_streak": longest,
            "extended": extended}


# ----------------------------------------------------------------------------
# AI grading  (unchanged logic)
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


def _call_anthropic_sync(model: str, user_text: str) -> str:
    from anthropic import Anthropic
    aclient = Anthropic(api_key=ANTHROPIC_API_KEY)
    resp = aclient.messages.create(
        model=model,
        max_tokens=2000,
        temperature=0.2,
        system=GRADER_SYSTEM,
        messages=[{"role": "user", "content": user_text}],
    )
    parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
    return "".join(parts)


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
    """Grade with Anthropic. Two attempts."""
    prompt = (f"Topic/consigne: {topic}\n\nText to grade:\n{text}"
              if topic else f"Text to grade:\n{text}")
    if not ANTHROPIC_API_KEY:
        log.warning("No ANTHROPIC_API_KEY set")
        return dict(FALLBACK_ANALYSIS)
    loop = asyncio.get_event_loop()
    for attempt in range(2):
        try:
            raw = await loop.run_in_executor(
                None, _call_anthropic_sync, ANTHROPIC_MODEL, prompt)
            data = json.loads(_strip_fences(raw))
            return _validate_analysis(data)
        except Exception as exc:  # noqa: BLE001
            log.warning("AI call failed (anthropic/%s attempt %s): %s",
                        ANTHROPIC_MODEL, attempt + 1, exc)
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
        if ANTHROPIC_API_KEY:
            raw = await loop.run_in_executor(
                None, _call_anthropic_sync, ANTHROPIC_MODEL, prompt)
            raw = _strip_fences(raw).strip().strip('"')
            if raw and raw.lower() != correction.lower():
                return raw[:200]
    except Exception:  # noqa: BLE001
        pass
    return STATIC_DISTRACTORS.get(category, "réponse incorrecte")


def normalize_error_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


async def record_mistakes(db: AsyncSession, user_id: str, source: str,
                          ref_id: str, analysis: dict,
                          generate_distractors: bool = True):
    """Write each detected error into the per-user mistakes table."""
    for err in analysis.get("errors", []):
        if err["category"] == "improvement":
            continue  # improvements are not mistakes
        norm = normalize_error_text(err["error"])
        res = await db.execute(
            select(Mistake).where(
                Mistake.user_id == user_id,
                Mistake.category == err["category"],
                Mistake.normalized_error == norm))
        existing = res.scalar_one_or_none()
        if existing:
            new_status = ("new" if existing.status == "mastered"
                          else (existing.status or "new"))
            existing.times_repeated = (existing.times_repeated or 0) + 1
            existing.last_seen_at = now_utc()
            existing.status = new_status
            await db.commit()
            continue
        distractor = STATIC_DISTRACTORS.get(err["category"],
                                            "réponse incorrecte")
        if generate_distractors:
            distractor = await generate_distractor(
                err["error"], err["correction"], err["category"])
        db.add(Mistake(
            mistake_id=new_id("mst"),
            user_id=user_id,
            source=source,
            ref_id=ref_id,
            category=err["category"],
            error_text=err["error"],
            normalized_error=norm,
            correction=err["correction"],
            explanation=err["explanation"],
            distractor=distractor,
            created_at=now_utc(),
            last_seen_at=now_utc(),
            status="new",
            times_repeated=1,
            srs_interval_index=0,
            srs_due_at=now_utc(),
            srs_consecutive_got_it=0,
        ))
        await db.commit()


async def persist_submission(db: AsyncSession, user: User, text: str,
                             prompt_id: Optional[str], analysis: dict,
                             source: str = "practice") -> dict:
    sub = Submission(
        submission_id=new_id("sub"),
        user_id=user.user_id,
        prompt_id=prompt_id,
        original_text=text,
        errors=analysis["errors"],
        overall_score=analysis["overall_score"],
        tcf_level=analysis["tcf_level"],
        improvement_suggestions=analysis["improvement_suggestions"],
        linking_words=analysis["linking_words"],
        vocabulary_suggestions=analysis["vocabulary_suggestions"],
        word_count=len(text.split()),
        source=source,
        created_at=now_utc(),
    )
    db.add(sub)
    await db.commit()
    await record_mistakes(db, user.user_id, source, sub.submission_id, analysis)
    await consume_credit(db, user.user_id)
    streak = await update_streak(db, user.user_id)
    out = _row_to_dict(sub)
    out["streak"] = streak
    return out


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


async def run_seeds():
    async with SessionLocal() as db:
        # Admin
        admin = await get_user_by_email(db, ADMIN_EMAIL)
        if not admin:
            db.add(User(
                user_id=new_id("user"),
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                name="Admin",
                role="admin",
                created_at=now_utc(),
                free_submissions_used=0,
                subscription_status="premium",
                monthly_reset_date=now_utc(),
                current_streak=0, longest_streak=0,
                last_activity_date=None, xp=0, badges=[],
                model_answers_read=0, model_answer_topic_ids=[],
            ))
            await db.commit()
            log.info("Seeded admin account %s", ADMIN_EMAIL)

        # Prompts
        count = await db.scalar(select(func.count()).select_from(Prompt))
        if not count:
            for title, desc, cat in SEED_PROMPTS:
                db.add(Prompt(
                    prompt_id=new_id("prompt"), title=title, description=desc,
                    category=cat, level="C1", is_active=True,
                    created_at=now_utc()))
            await db.commit()
            log.info("Seeded %d writing prompts", len(SEED_PROMPTS))

        # Simulator prompts
        count = await db.scalar(
            select(func.count()).select_from(SimulatorPrompt))
        if not count:
            for task_type, text in SEED_SIM_PROMPTS:
                db.add(SimulatorPrompt(
                    sim_prompt_id=new_id("simp"), task_type=task_type,
                    text=text, is_active=True, created_at=now_utc()))
            await db.commit()

        # Exam questions
        count = await db.scalar(
            select(func.count()).select_from(ExamQuestion))
        if not count:
            for q in SEED_EXAM_QUESTIONS:
                db.add(ExamQuestion(
                    question_id=new_id("q"), created_at=now_utc(),
                    is_active=True, **q))
            await db.commit()

        # Themes + theme questions
        count = await db.scalar(select(func.count()).select_from(Theme))
        if not count:
            name_to_id = {}
            for name, emoji, premium, order, desc in SEED_THEMES:
                tid = new_id("theme")
                name_to_id[name] = tid
                db.add(Theme(
                    theme_id=tid, name=name, emoji=emoji, description=desc,
                    is_premium=premium, sort_order=order, is_active=True,
                    created_at=now_utc()))
            await db.commit()
            for theme_name, task_type, prompt_text in SEED_THEME_QUESTIONS:
                tid = name_to_id.get(theme_name)
                if not tid:
                    continue
                db.add(ThemeQuestion(
                    question_id=new_id("tq"), theme_id=tid, task_type=task_type,
                    prompt_text=prompt_text, is_active=True,
                    created_at=now_utc()))
            await db.commit()
            log.info("Seeded %d themes and %d theme questions",
                     len(SEED_THEMES), len(SEED_THEME_QUESTIONS))


# ----------------------------------------------------------------------------
# Lifespan: create tables + seed
# ----------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_seeds()
    yield
    await engine.dispose()


app = FastAPI(title="TCF Canada Prep API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
async def register(body: RegisterIn, response: Response,
                   db: AsyncSession = Depends(get_db)):
    email = body.email.lower()
    if await get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        user_id=new_id("user"),
        email=email,
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        role="admin" if email == ADMIN_EMAIL else "user",
        created_at=now_utc(),
        free_submissions_used=0,
        subscription_status="free",
        monthly_reset_date=now_utc(),
        current_streak=0, longest_streak=0,
        last_activity_date=None, xp=0, badges=[],
        model_answers_read=0, model_answer_topic_ids=[],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    set_auth_cookies(response, user.user_id)
    return {"user": public_user(user)}


@app.post("/api/auth/login")
async def login(body: LoginIn, response: Response,
                db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, body.email.lower())
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    set_auth_cookies(response, user.user_id)
    return {"user": public_user(user)}


@app.post("/api/auth/refresh")
async def refresh(request: Request, response: Response,
                  db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    user_id = decode_token(token, "refresh") if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = make_token(user_id, "access", minutes=ACCESS_TTL_MIN)
    response.set_cookie("access_token", access, httponly=True, samesite="lax",
                        path="/", max_age=ACCESS_TTL_MIN * 60)
    return {"user": public_user(user)}


@app.get("/api/auth/me")
async def me(user: User = Depends(get_current_user),
             db: AsyncSession = Depends(get_db)):
    user = await check_and_reset_monthly(db, user)
    return {"user": public_user(user)}


@app.post("/api/auth/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"detail": "Logged out"}


# ----------------------------------------------------------------------------
# Prompts (public)
# ----------------------------------------------------------------------------
@app.get("/api/prompts")
async def list_prompts(db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Prompt).where(Prompt.is_active == True)  # noqa: E712
        .order_by(Prompt.created_at.asc()))
    return {"prompts": [_row_to_dict(p) for p in res.scalars().all()]}


@app.get("/api/prompts/{prompt_id}")
async def get_prompt(prompt_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Prompt).where(Prompt.prompt_id == prompt_id,
                             Prompt.is_active == True))  # noqa: E712
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"prompt": _row_to_dict(p)}


# ----------------------------------------------------------------------------
# Analysis: streaming SSE + legacy
# ----------------------------------------------------------------------------
STAGES = ["parsing", "grammar", "spelling", "conjugation", "style", "generating"]


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.post("/api/analyze/stream")
async def analyze_stream(body: AnalyzeIn,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    user = await enforce_free_limit(db, user)
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
                db, user, body.text, body.prompt_id, analysis, source=source)
            yield _sse("complete", sub)
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
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    user = await enforce_free_limit(db, user)
    source = body.source if body.source in {"practice", "paste"} else "practice"
    analysis = await analyze_text_with_ai(body.text, body.topic or body.label)
    sub = await persist_submission(db, user, body.text, body.prompt_id,
                                   analysis, source=source)
    return sub


@app.get("/api/submissions")
async def list_submissions(user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Submission).where(Submission.user_id == user.user_id)
        .order_by(Submission.created_at.desc()).limit(100))
    return {"submissions": [_row_to_dict(s) for s in res.scalars().all()]}


@app.get("/api/submissions/{submission_id}")
async def get_submission(submission_id: str,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Submission).where(Submission.submission_id == submission_id))
    sub = res.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.user_id != user.user_id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return {"submission": _row_to_dict(sub)}


# ----------------------------------------------------------------------------
# Exam simulator
# ----------------------------------------------------------------------------
@app.get("/api/simulator/start")
async def simulator_start(user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Return one random active prompt per task."""
    tasks = {}
    for t in (1, 2, 3):
        res = await db.execute(
            select(SimulatorPrompt).where(
                SimulatorPrompt.task_type == t,
                SimulatorPrompt.is_active == True)  # noqa: E712
            .order_by(func.random()).limit(1))
        doc = res.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=503,
                                detail=f"No simulator prompts for Tâche {t}")
        tasks[f"task{t}"] = _row_to_dict(doc)
    return tasks


WORD_GUIDE = {1: (60, 120), 2: (120, 150), 3: (120, 180)}


@app.post("/api/simulator/submit")
async def simulator_submit(body: SimulatorSubmitIn,
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    user = await enforce_free_limit(db, user)
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
        await record_mistakes(db, user.user_id, "simulator", attempt_id,
                              analysis)
    combined = round(sum(scores) / 3, 1)
    tcf_level = level_order[
        min(round(sum(level_order.index(l) for l in levels) / 3), 5)]
    attempt = ExamAttempt(
        attempt_id=attempt_id, user_id=user.user_id,
        task1=tasks_out["task1"], task2=tasks_out["task2"],
        task3=tasks_out["task3"],
        combined_score=combined, tcf_level=tcf_level,
        time_used_seconds=body.time_used_seconds, created_at=now_utc(),
    )
    db.add(attempt)
    await db.commit()
    await consume_credit(db, user.user_id)  # one credit per run, not three
    streak = await update_streak(db, user.user_id)
    out = _row_to_dict(attempt)
    out["streak"] = streak
    return {"attempt": out}


@app.get("/api/simulator/attempts")
async def simulator_attempts(user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ExamAttempt).where(ExamAttempt.user_id == user.user_id)
        .order_by(ExamAttempt.created_at.desc()).limit(50))
    return [_row_to_dict(a) for a in res.scalars().all()]


@app.get("/api/simulator/attempts/{attempt_id}")
async def simulator_attempt(attempt_id: str,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ExamAttempt).where(ExamAttempt.attempt_id == attempt_id))
    a = res.scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if a.user_id != user.user_id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return _row_to_dict(a)


# ----------------------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------------------
@app.get("/api/dashboard/stats")
async def dashboard_stats(user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Submission).where(Submission.user_id == user.user_id)
        .order_by(Submission.created_at.asc()))
    subs = res.scalars().all()
    total = len(subs)
    avg = round(sum(s.overall_score for s in subs) / total, 1) if total else 0.0
    breakdown = {c: 0 for c in VALID_CATEGORIES}
    for s in subs:
        for e in (s.errors or []):
            cat = e.get("category", "spelling")
            breakdown[cat] = breakdown.get(cat, 0) + 1
    trend = [{"date": s.created_at.strftime("%Y-%m-%d")
              if isinstance(s.created_at, datetime) else str(s.created_at)[:10],
              "score": s.overall_score} for s in subs[-10:]]
    freq = sorted(((c, n) for c, n in breakdown.items() if n > 0),
                  key=lambda x: -x[1])
    return {
        "total_submissions": total,
        "average_score": avg,
        "error_breakdown": breakdown,
        "score_trend": trend,
        "most_frequent_errors": [{"category": c, "count": n} for c, n in freq],
        "current_streak": user.current_streak or 0,
        "longest_streak": user.longest_streak or 0,
        "xp": user.xp or 0,
        "badges": user.badges or [],
    }


@app.get("/api/dashboard/heatmap")
async def dashboard_heatmap(user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    since = now_utc() - timedelta(days=365)
    out: Dict[str, int] = {}
    res = await db.execute(
        select(Submission).where(Submission.user_id == user.user_id,
                                 Submission.created_at >= since))
    for s in res.scalars().all():
        d = s.created_at
        key = d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)[:10]
        out[key] = out.get(key, 0) + 1
    res = await db.execute(
        select(ReviewSession).where(ReviewSession.user_id == user.user_id,
                                    ReviewSession.created_at >= since))
    for r in res.scalars().all():
        d = r.created_at
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
async def mistakes_summary(user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Mistake).where(Mistake.user_id == user.user_id))
    mistakes = res.scalars().all()
    per_cat = {c: 0 for c in VALID_CATEGORIES if c != "improvement"}
    status_counts = {"new": 0, "reviewing": 0, "mastered": 0}
    for m in mistakes:
        per_cat[m.category] = (per_cat.get(m.category, 0)
                               + (m.times_repeated or 1))
        st = m.status or "new"
        status_counts[st] = status_counts.get(st, 0) + 1
    monthly: Dict[str, Dict[str, int]] = {}
    res = await db.execute(
        select(Submission).where(Submission.user_id == user.user_id))
    subs_all = res.scalars().all()
    for s in subs_all:
        d = s.created_at
        key = d.strftime("%Y-%m") if isinstance(d, datetime) else str(d)[:7]
        bucket = monthly.setdefault(key, {"errors": 0, "words": 0})
        bucket["errors"] += len([e for e in (s.errors or [])
                                 if e.get("category") != "improvement"])
        bucket["words"] += s.word_count or len(s.original_text.split())
    trend = [{"month": k,
              "errors_per_100_words": round(v["errors"] / v["words"] * 100, 2)
              if v["words"] else 0}
             for k, v in sorted(monthly.items())]
    repeat_leaders = sorted(mistakes,
                            key=lambda m: -(m.times_repeated or 1))[:5]
    weak = sorted(((c, n) for c, n in per_cat.items() if n > 0),
                  key=lambda x: -x[1])[:3]
    narrative = None
    res = await db.execute(
        select(Submission).where(Submission.user_id == user.user_id)
        .order_by(Submission.created_at.desc()).limit(10))
    subs = res.scalars().all()
    if len(subs) >= 6:
        def rate(group, cat):
            errs = sum(len([e for e in (s.errors or [])
                            if e.get("category") == cat]) for s in group)
            words = sum(s.word_count or 1 for s in group) or 1
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
        "repeat_leaders": [_row_to_dict(m) for m in repeat_leaders],
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
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    stmt = select(Mistake).where(
        Mistake.user_id == user.user_id,
        Mistake.status != "mastered",
        Mistake.srs_due_at <= now_utc())
    if category and category in VALID_CATEGORIES:
        stmt = stmt.where(Mistake.category == category)
    stmt = stmt.order_by(Mistake.srs_due_at.asc()).limit(limit)
    res = await db.execute(stmt)
    return {"due": [_row_to_dict(m) for m in res.scalars().all()]}


@app.post("/api/review/submit")
async def review_submit(body: ReviewSubmitIn,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    xp = 0
    mastered_now: List[str] = []
    new_badges: List[str] = []
    for r in body.results:
        res = await db.execute(
            select(Mistake).where(Mistake.mistake_id == r.mistake_id,
                                  Mistake.user_id == user.user_id))
        m = res.scalar_one_or_none()
        if not m:
            continue
        if r.correct:
            xp += XP_PER_CORRECT
            streak_ok = (m.srs_consecutive_got_it or 0) + 1
            idx = m.srs_interval_index or 0
            if idx >= len(SRS_LADDER) - 1 and streak_ok >= 2:
                m.status = "mastered"
                mastered_now.append(m.mistake_id)
            else:
                idx = min(idx + 1, len(SRS_LADDER) - 1)
                m.status = "reviewing"
            m.srs_consecutive_got_it = streak_ok
            m.srs_interval_index = idx
            m.srs_due_at = now_utc() + timedelta(days=SRS_LADDER[idx])
        else:
            m.srs_consecutive_got_it = 0
            m.srs_interval_index = 0
            m.srs_due_at = now_utc() + timedelta(days=SRS_LADDER[0])
            m.status = "reviewing"
        await db.commit()
        if m.status == "mastered" and (m.times_repeated or 1) >= 3:
            new_badges.append("Comeback — fixed a mistake repeated 3+ times")

    user_doc = await get_user_by_id(db, user.user_id)
    badges = set(user_doc.badges or [])
    slayer = "Conjugaison Slayer — 25 conjugation mistakes mastered"
    n_conj = await db.scalar(
        select(func.count()).select_from(Mistake).where(
            Mistake.user_id == user.user_id,
            Mistake.category == "conjugation",
            Mistake.status == "mastered"))
    if (n_conj or 0) >= 25 and slayer not in badges:
        new_badges.append(slayer)
    for cat in VALID_CATEGORIES:
        remaining = await db.scalar(
            select(func.count()).select_from(Mistake).where(
                Mistake.user_id == user.user_id, Mistake.category == cat,
                Mistake.status != "mastered"))
        had_any = await db.scalar(
            select(func.count()).select_from(Mistake).where(
                Mistake.user_id == user.user_id, Mistake.category == cat))
        if had_any and not remaining:
            xp += XP_CATEGORY_CLEAR_BONUS
    badges.update(new_badges)
    session = ReviewSession(
        session_id=new_id("rev"), user_id=user.user_id, mode=body.mode,
        mistake_ids=[r.mistake_id for r in body.results],
        results=[r.dict() for r in body.results],
        xp_earned=xp, created_at=now_utc(),
    )
    db.add(session)
    prev_xp = user_doc.xp or 0
    user_doc.xp = prev_xp + xp
    user_doc.badges = sorted(badges)
    await db.commit()
    streak = await update_streak(db, user.user_id)
    return {"session": _row_to_dict(session), "xp_earned": xp,
            "newly_mastered": mastered_now, "badges": new_badges,
            "total_xp": prev_xp + xp,
            "streak": streak}


@app.get("/api/review/mastery")
async def review_mastery(user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    out = {}
    for cat in VALID_CATEGORIES:
        if cat == "improvement":
            continue
        total = await db.scalar(
            select(func.count()).select_from(Mistake).where(
                Mistake.user_id == user.user_id, Mistake.category == cat))
        mastered = await db.scalar(
            select(func.count()).select_from(Mistake).where(
                Mistake.user_id == user.user_id, Mistake.category == cat,
                Mistake.status == "mastered"))
        out[cat] = {"total": total or 0, "mastered": mastered or 0}
    return out


# ----------------------------------------------------------------------------
# Mock exams
# ----------------------------------------------------------------------------
@app.get("/api/exam/questions/{exam_type}")
async def exam_questions(exam_type: str, db: AsyncSession = Depends(get_db)):
    if exam_type not in {"reading-comprehension", "oral-comprehension"}:
        raise HTTPException(status_code=404, detail="Unknown exam type")
    res = await db.execute(
        select(ExamQuestion).where(ExamQuestion.exam_type == exam_type,
                                   ExamQuestion.is_active == True))  # noqa: E712
    return {"questions": [_row_to_dict(q) for q in res.scalars().all()]}


# ----------------------------------------------------------------------------
# Speaking (stub)
# ----------------------------------------------------------------------------
@app.post("/api/speaking/analyze")
async def speaking_analyze(user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    await enforce_free_limit(db, user)
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
async def recent_topics(task_type: Optional[int] = None,
                        db: AsyncSession = Depends(get_db)):
    stmt = select(RecentTopic).where(RecentTopic.is_active == True)  # noqa: E712
    if task_type in (1, 2, 3):
        stmt = stmt.where(RecentTopic.task_type == task_type)
    stmt = stmt.order_by(RecentTopic.created_at.desc())
    res = await db.execute(stmt)
    out = []
    for t in res.scalars().all():
        d = _row_to_dict(t)
        d.pop("model_answer", None)  # never leak in the list view
        out.append(d)
    return {"topics": out}


@app.get("/api/recent-topics/{topic_id}")
async def recent_topic(topic_id: str,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Topic detail. The model answer is included for premium users always,
    and for free users on up to FREE_MODEL_ANSWER_LIMIT distinct topics
    (re-reading an already-unlocked topic is free). Past the limit the
    answer is withheld and `model_answer_locked` is set instead."""
    res = await db.execute(
        select(RecentTopic).where(RecentTopic.topic_id == topic_id,
                                  RecentTopic.is_active == True))  # noqa: E712
    t_obj = res.scalar_one_or_none()
    if not t_obj:
        raise HTTPException(status_code=404, detail="Topic not found")
    t = _row_to_dict(t_obj)
    model_answer = t.pop("model_answer", "")
    t["model_answer_locked"] = False
    if user.subscription_status == "premium":
        t["model_answer"] = model_answer
    else:
        unlocked = user.model_answer_topic_ids or []
        if topic_id in unlocked:
            t["model_answer"] = model_answer
        elif len(unlocked) < FREE_MODEL_ANSWER_LIMIT:
            user.model_answer_topic_ids = list(unlocked) + [topic_id]
            user.model_answers_read = (user.model_answers_read or 0) + 1
            await db.commit()
            t["model_answer"] = model_answer
        else:
            t["model_answer_locked"] = True
    return {"topic": t}


# ----------------------------------------------------------------------------
# Admin
# ----------------------------------------------------------------------------
@app.get("/api/admin/users")
async def admin_users(admin: User = Depends(get_admin_user),
                      db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).order_by(User.created_at.desc()))
    return {"users": [strip_user(u) for u in res.scalars().all()]}


@app.get("/api/admin/submissions")
async def admin_submissions(admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Submission).order_by(Submission.created_at.desc()).limit(200))
    return {"submissions": [_row_to_dict(s) for s in res.scalars().all()]}


@app.get("/api/admin/analytics")
async def admin_analytics(admin: User = Depends(get_admin_user),
                          db: AsyncSession = Depends(get_db)):
    total_users = await db.scalar(select(func.count()).select_from(User))
    total_submissions = await db.scalar(
        select(func.count()).select_from(Submission))
    breakdown = {c: 0 for c in VALID_CATEGORIES}
    err_counts: Dict[str, int] = {}
    res = await db.execute(select(Submission))
    for s in res.scalars().all():
        for e in (s.errors or []):
            cat = e.get("category", "spelling")
            breakdown[cat] = breakdown.get(cat, 0) + 1
            key = e.get("error", "").strip()
            if key:
                err_counts[key] = err_counts.get(key, 0) + 1
    top = sorted(err_counts.items(), key=lambda x: -x[1])[:10]
    return {"total_users": total_users or 0,
            "total_submissions": total_submissions or 0,
            "error_breakdown": breakdown,
            "top_errors": [{"error": e, "count": n} for e, n in top]}


@app.post("/api/admin/prompts")
async def admin_create_prompt(body: PromptIn,
                              admin: User = Depends(get_admin_user),
                              db: AsyncSession = Depends(get_db)):
    p = Prompt(prompt_id=new_id("prompt"), **body.dict(),
               is_active=True, created_at=now_utc())
    db.add(p)
    await db.commit()
    return _row_to_dict(p)


@app.put("/api/admin/prompts/{prompt_id}")
async def admin_update_prompt(prompt_id: str, body: PromptIn,
                              admin: User = Depends(get_admin_user),
                              db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Prompt).where(Prompt.prompt_id == prompt_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Prompt not found")
    for k, v in body.dict().items():
        setattr(p, k, v)
    await db.commit()
    return _row_to_dict(p)


@app.delete("/api/admin/prompts/{prompt_id}")
async def admin_delete_prompt(prompt_id: str,
                              admin: User = Depends(get_admin_user),
                              db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Prompt).where(Prompt.prompt_id == prompt_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Prompt not found")
    p.is_active = False
    await db.commit()
    return {"detail": "Prompt deactivated"}


@app.post("/api/admin/exam/questions")
async def admin_create_question(body: ExamQuestionIn,
                                admin: User = Depends(get_admin_user),
                                db: AsyncSession = Depends(get_db)):
    q = ExamQuestion(question_id=new_id("q"), **body.dict(),
                     created_at=now_utc(), is_active=True)
    db.add(q)
    await db.commit()
    return _row_to_dict(q)


@app.put("/api/admin/exam/questions/{question_id}")
async def admin_update_question(question_id: str, body: ExamQuestionUpdate,
                                admin: User = Depends(get_admin_user),
                                db: AsyncSession = Depends(get_db)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.execute(
        select(ExamQuestion).where(ExamQuestion.question_id == question_id))
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    for k, v in updates.items():
        setattr(q, k, v)
    await db.commit()
    return _row_to_dict(q)


@app.delete("/api/admin/exam/questions/{question_id}")
async def admin_delete_question(question_id: str,
                                admin: User = Depends(get_admin_user),
                                db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ExamQuestion).where(ExamQuestion.question_id == question_id))
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    q.is_active = False
    await db.commit()
    return {"detail": "Question deactivated"}


@app.get("/api/admin/exam/questions")
async def admin_list_questions(admin: User = Depends(get_admin_user),
                               db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ExamQuestion).order_by(ExamQuestion.created_at.desc()))
    return [_row_to_dict(q) for q in res.scalars().all()]


@app.post("/api/admin/recent-topics")
async def admin_create_topic(body: RecentTopicIn,
                             admin: User = Depends(get_admin_user),
                             db: AsyncSession = Depends(get_db)):
    t = RecentTopic(topic_id=new_id("topic"), **body.dict(),
                    created_at=now_utc(), is_active=True)
    db.add(t)
    await db.commit()
    return _row_to_dict(t)


@app.put("/api/admin/recent-topics/{topic_id}")
async def admin_update_topic(topic_id: str, body: RecentTopicIn,
                             admin: User = Depends(get_admin_user),
                             db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(RecentTopic).where(RecentTopic.topic_id == topic_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Topic not found")
    for k, v in body.dict().items():
        setattr(t, k, v)
    await db.commit()
    return _row_to_dict(t)


@app.delete("/api/admin/recent-topics/{topic_id}")
async def admin_delete_topic(topic_id: str,
                             admin: User = Depends(get_admin_user),
                             db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(RecentTopic).where(RecentTopic.topic_id == topic_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Topic not found")
    t.is_active = False
    await db.commit()
    return {"detail": "Topic deactivated"}


@app.get("/api/admin/recent-topics")
async def admin_list_topics(admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(RecentTopic).order_by(RecentTopic.created_at.desc()))
    return {"topics": [_row_to_dict(t) for t in res.scalars().all()]}


@app.get("/api/admin/simulator-prompts")
async def admin_sim_prompts(admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(SimulatorPrompt).order_by(
            SimulatorPrompt.task_type.asc(),
            SimulatorPrompt.created_at.desc()))
    return {"prompts": [_row_to_dict(p) for p in res.scalars().all()]}


@app.post("/api/admin/simulator-prompts")
async def admin_create_sim_prompt(body: SimPromptIn,
                                  admin: User = Depends(get_admin_user),
                                  db: AsyncSession = Depends(get_db)):
    p = SimulatorPrompt(sim_prompt_id=new_id("simp"), **body.dict(),
                        is_active=True, created_at=now_utc())
    db.add(p)
    await db.commit()
    return _row_to_dict(p)


@app.put("/api/admin/simulator-prompts/{sim_prompt_id}")
async def admin_update_sim_prompt(sim_prompt_id: str, body: SimPromptIn,
                                  admin: User = Depends(get_admin_user),
                                  db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(SimulatorPrompt).where(
            SimulatorPrompt.sim_prompt_id == sim_prompt_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404,
                            detail="Simulator prompt not found")
    for k, v in body.dict().items():
        setattr(p, k, v)
    await db.commit()
    return _row_to_dict(p)


@app.delete("/api/admin/simulator-prompts/{sim_prompt_id}")
async def admin_delete_sim_prompt(sim_prompt_id: str,
                                  admin: User = Depends(get_admin_user),
                                  db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(SimulatorPrompt).where(
            SimulatorPrompt.sim_prompt_id == sim_prompt_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404,
                            detail="Simulator prompt not found")
    p.is_active = False
    await db.commit()
    return {"detail": "Simulator prompt deactivated"}




# ============================================================================
# BLOG — additions for server.py (PostgreSQL edition)
# ============================================================================
# This file shows the EXACT code to paste into your existing server.py.
# Each block is labelled with WHERE it goes. Nothing here changes existing
# behaviour — it only adds blog support.
# ============================================================================


# ----------------------------------------------------------------------------
# 1) ORM MODEL  — paste alongside your other models (e.g. after ReviewSession)
# ----------------------------------------------------------------------------
class BlogPost(Base):
    __tablename__ = "blog_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    excerpt: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text)            # markdown or HTML
    cover_image: Mapped[str] = mapped_column(Text, default="")
    meta_description: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str] = mapped_column(String(120), default="MonFrancais")
    tags: Mapped[Any] = mapped_column(JSONB, default=list)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ----------------------------------------------------------------------------
# 2) HELPER  — paste near your other helpers (e.g. after new_id())
# ----------------------------------------------------------------------------
def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text[:200] or new_id("post")


# ----------------------------------------------------------------------------
# 3) PYDANTIC SCHEMAS  — paste with your other Pydantic models
# ----------------------------------------------------------------------------
class BlogPostIn(BaseModel):
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    excerpt: Optional[str] = ""
    cover_image: Optional[str] = ""
    meta_description: Optional[str] = ""
    author: Optional[str] = "MonFrancais"
    tags: Optional[List[str]] = None
    is_published: Optional[bool] = True
    slug: Optional[str] = None  # auto-generated from title if omitted


class BlogPostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    meta_description: Optional[str] = None
    author: Optional[str] = None
    tags: Optional[List[str]] = None
    is_published: Optional[bool] = None
    slug: Optional[str] = None


# ----------------------------------------------------------------------------
# 4) PUBLIC ENDPOINTS  — paste with your other public routes
#    (e.g. just after the /api/recent-topics routes)
# ----------------------------------------------------------------------------
@app.get("/api/blog")
async def list_blog_posts(db: AsyncSession = Depends(get_db)):
    """Public: list published posts, newest first (no full content)."""
    res = await db.execute(
        select(BlogPost).where(BlogPost.is_published == True)  # noqa: E712
        .order_by(BlogPost.created_at.desc()))
    out = []
    for p in res.scalars().all():
        d = _row_to_dict(p)
        d.pop("content", None)  # list view doesn't need the full body
        out.append(d)
    return {"posts": out}


@app.get("/api/blog/{slug}")
async def get_blog_post(slug: str, db: AsyncSession = Depends(get_db)):
    """Public: a single published post by slug."""
    res = await db.execute(
        select(BlogPost).where(BlogPost.slug == slug,
                               BlogPost.is_published == True))  # noqa: E712
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"post": _row_to_dict(p)}


# ----------------------------------------------------------------------------
# 5) ADMIN ENDPOINTS  — paste with your other admin routes
# ----------------------------------------------------------------------------
@app.get("/api/admin/blog")
async def admin_list_blog(admin: User = Depends(get_admin_user),
                          db: AsyncSession = Depends(get_db)):
    """Admin: list ALL posts (published or not), newest first."""
    res = await db.execute(
        select(BlogPost).order_by(BlogPost.created_at.desc()))
    return {"posts": [_row_to_dict(p) for p in res.scalars().all()]}


async def _unique_slug(db: AsyncSession, base: str,
                       ignore_post_id: Optional[str] = None) -> str:
    """Ensure the slug is unique; append -2, -3, ... if needed."""
    slug = base
    n = 1
    while True:
        res = await db.execute(
            select(BlogPost).where(BlogPost.slug == slug))
        existing = res.scalar_one_or_none()
        if not existing or existing.post_id == ignore_post_id:
            return slug
        n += 1
        slug = f"{base}-{n}"


@app.post("/api/admin/blog")
async def admin_create_blog(body: BlogPostIn,
                            admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    base = slugify(body.slug or body.title)
    slug = await _unique_slug(db, base)
    now = now_utc()
    p = BlogPost(
        post_id=new_id("post"),
        slug=slug,
        title=body.title,
        excerpt=body.excerpt or "",
        content=body.content,
        cover_image=body.cover_image or "",
        meta_description=body.meta_description or (body.excerpt or "")[:160],
        author=body.author or "MonFrancais",
        tags=body.tags or [],
        is_published=body.is_published if body.is_published is not None else True,
        created_at=now,
        updated_at=now,
    )
    db.add(p)
    await db.commit()
    return _row_to_dict(p)


@app.put("/api/admin/blog/{post_id}")
async def admin_update_blog(post_id: str, body: BlogPostUpdate,
                            admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(BlogPost).where(BlogPost.post_id == post_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    updates = {k: v for k, v in body.dict().items() if v is not None}
    # Handle slug/title changes carefully so slugs stay unique.
    new_slug = updates.pop("slug", None)
    if new_slug is not None:
        p.slug = await _unique_slug(db, slugify(new_slug), ignore_post_id=post_id)
    for k, v in updates.items():
        setattr(p, k, v)
    p.updated_at = now_utc()
    await db.commit()
    return _row_to_dict(p)


@app.delete("/api/admin/blog/{post_id}")
async def admin_delete_blog(post_id: str,
                            admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(BlogPost).where(BlogPost.post_id == post_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.delete(p)
    await db.commit()
    return {"detail": "Post deleted"}


# ============================================================================
# PHASE 2 — THEMES + THEME QUESTIONS  (additions for server.py)
# ============================================================================
# Paste each labelled block into the matching place in your server.py.
# The themes hold writing questions grouped by tâche (1/2/3). Some themes are
# free, others premium (Pro-locked). Phase 4 will add per-user progress.
# Tables auto-create on startup (your lifespan runs create_all).
# ============================================================================


# ----------------------------------------------------------------------------
# 1) ORM MODELS  — paste with your other models (after BlogPost / ReviewSession)
# ----------------------------------------------------------------------------
class Theme(Base):
    __tablename__ = "themes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    theme_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    emoji: Mapped[str] = mapped_column(String(8), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ThemeQuestion(Base):
    __tablename__ = "theme_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    theme_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("themes.theme_id"), index=True)
    task_type: Mapped[int] = mapped_column(Integer, index=True)  # 1, 2 or 3
    prompt_text: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ----------------------------------------------------------------------------
# 2) PYDANTIC SCHEMAS  — paste with your other BaseModel classes
# ----------------------------------------------------------------------------
class ThemeIn(BaseModel):
    name: str = Field(min_length=1)
    emoji: Optional[str] = ""
    description: Optional[str] = ""
    is_premium: Optional[bool] = False
    sort_order: Optional[int] = 0


class ThemeUpdate(BaseModel):
    name: Optional[str] = None
    emoji: Optional[str] = None
    description: Optional[str] = None
    is_premium: Optional[bool] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ThemeQuestionIn(BaseModel):
    theme_id: str
    task_type: int = Field(ge=1, le=3)
    prompt_text: str = Field(min_length=1)


class ThemeQuestionUpdate(BaseModel):
    theme_id: Optional[str] = None
    task_type: Optional[int] = Field(default=None, ge=1, le=3)
    prompt_text: Optional[str] = None
    is_active: Optional[bool] = None


# ----------------------------------------------------------------------------
# 3) PUBLIC ENDPOINTS  — paste with your other public routes
# ----------------------------------------------------------------------------
@app.get("/api/themes")
async def list_themes(task_type: Optional[int] = None,
                      db: AsyncSession = Depends(get_db)):
    """List active themes, with the question count for a given tâche.

    Pass ?task_type=1 (or 2/3) to get the count of questions for that tâche.
    Premium themes are returned too, marked is_premium=True so the UI can
    show a Pro badge / lock.
    """
    res = await db.execute(
        select(Theme).where(Theme.is_active == True)  # noqa: E712
        .order_by(Theme.sort_order.asc(), Theme.name.asc()))
    themes = res.scalars().all()
    out = []
    for t in themes:
        d = _row_to_dict(t)
        if task_type in (1, 2, 3):
            count = await db.scalar(
                select(func.count()).select_from(ThemeQuestion).where(
                    ThemeQuestion.theme_id == t.theme_id,
                    ThemeQuestion.task_type == task_type,
                    ThemeQuestion.is_active == True))  # noqa: E712
            d["question_count"] = count or 0
        out.append(d)
    return {"themes": out}


@app.get("/api/themes/{theme_id}/questions")
async def theme_questions(theme_id: str, task_type: Optional[int] = None,
                          db: AsyncSession = Depends(get_db)):
    """List active questions in a theme, optionally filtered by tâche."""
    stmt = select(ThemeQuestion).where(
        ThemeQuestion.theme_id == theme_id,
        ThemeQuestion.is_active == True)  # noqa: E712
    if task_type in (1, 2, 3):
        stmt = stmt.where(ThemeQuestion.task_type == task_type)
    stmt = stmt.order_by(ThemeQuestion.created_at.asc())
    res = await db.execute(stmt)
    return {"questions": [_row_to_dict(q) for q in res.scalars().all()]}


# ----------------------------------------------------------------------------
# 4) ADMIN ENDPOINTS  — paste with your other /api/admin routes
# ----------------------------------------------------------------------------
@app.get("/api/admin/themes")
async def admin_list_themes(admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Theme).order_by(Theme.sort_order.asc(), Theme.name.asc()))
    return {"themes": [_row_to_dict(t) for t in res.scalars().all()]}


@app.post("/api/admin/themes")
async def admin_create_theme(body: ThemeIn,
                             admin: User = Depends(get_admin_user),
                             db: AsyncSession = Depends(get_db)):
    t = Theme(theme_id=new_id("theme"), **body.dict(),
              is_active=True, created_at=now_utc())
    db.add(t)
    await db.commit()
    return _row_to_dict(t)


@app.put("/api/admin/themes/{theme_id}")
async def admin_update_theme(theme_id: str, body: ThemeUpdate,
                             admin: User = Depends(get_admin_user),
                             db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Theme).where(Theme.theme_id == theme_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Theme not found")
    for k, v in body.dict().items():
        if v is not None:
            setattr(t, k, v)
    await db.commit()
    return _row_to_dict(t)


@app.delete("/api/admin/themes/{theme_id}")
async def admin_delete_theme(theme_id: str,
                             admin: User = Depends(get_admin_user),
                             db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Theme).where(Theme.theme_id == theme_id))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Theme not found")
    t.is_active = False
    await db.commit()
    return {"detail": "Theme deactivated"}


@app.get("/api/admin/theme-questions")
async def admin_list_theme_questions(theme_id: Optional[str] = None,
                                     admin: User = Depends(get_admin_user),
                                     db: AsyncSession = Depends(get_db)):
    stmt = select(ThemeQuestion)
    if theme_id:
        stmt = stmt.where(ThemeQuestion.theme_id == theme_id)
    stmt = stmt.order_by(ThemeQuestion.task_type.asc(),
                         ThemeQuestion.created_at.asc())
    res = await db.execute(stmt)
    return {"questions": [_row_to_dict(q) for q in res.scalars().all()]}


@app.post("/api/admin/theme-questions")
async def admin_create_theme_question(body: ThemeQuestionIn,
                                      admin: User = Depends(get_admin_user),
                                      db: AsyncSession = Depends(get_db)):
    q = ThemeQuestion(question_id=new_id("tq"), **body.dict(),
                      is_active=True, created_at=now_utc())
    db.add(q)
    await db.commit()
    return _row_to_dict(q)


@app.put("/api/admin/theme-questions/{question_id}")
async def admin_update_theme_question(question_id: str,
                                      body: ThemeQuestionUpdate,
                                      admin: User = Depends(get_admin_user),
                                      db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ThemeQuestion).where(ThemeQuestion.question_id == question_id))
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    for k, v in body.dict().items():
        if v is not None:
            setattr(q, k, v)
    await db.commit()
    return _row_to_dict(q)


@app.delete("/api/admin/theme-questions/{question_id}")
async def admin_delete_theme_question(question_id: str,
                                      admin: User = Depends(get_admin_user),
                                      db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ThemeQuestion).where(ThemeQuestion.question_id == question_id))
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    q.is_active = False
    await db.commit()
    return {"detail": "Question deactivated"}


# ----------------------------------------------------------------------------
# 5) SEED CONTENT  — paste ABOVE run_seeds(), then add the seeding block
#    shown in block 6 INSIDE run_seeds().
# ----------------------------------------------------------------------------
# Each theme: (name, emoji, is_premium, sort_order, description)
SEED_THEMES = [
    ("Logement & Déménagement", "🏠", False, 1,
     "Locations, voisinage, déménagement et vie quotidienne à la maison."),
    ("Voyages & Déplacements", "✈️", False, 2,
     "Vacances, transports, tourisme et expériences de voyage."),
    ("Travail & Études", "💼", True, 3,
     "Vie professionnelle, recherche d'emploi, formation et études."),
    ("Santé & Bien-être", "🩺", True, 4,
     "Mode de vie sain, sport, alimentation et équilibre de vie."),
    ("Environnement & Société", "🌍", True, 5,
     "Écologie, vie en société et grands enjeux contemporains."),
    ("Loisirs & Culture", "🎭", True, 6,
     "Sorties, gastronomie, événements culturels et temps libre."),
]

# Each question: (theme_name, task_type, prompt_text)
SEED_THEME_QUESTIONS = [
    # --- Logement & Déménagement ---
    ("Logement & Déménagement", 1,
     "Vous venez d'emménager dans un nouvel appartement. Écrivez un message à un ami pour lui donner votre nouvelle adresse et l'inviter à venir le visiter. (60 à 120 mots)"),
    ("Logement & Déménagement", 1,
     "Votre voisin organise des travaux bruyants. Écrivez-lui un message poli pour lui demander de réduire le bruit le soir. (60 à 120 mots)"),
    ("Logement & Déménagement", 1,
     "Vous cherchez un colocataire. Écrivez une annonce courte décrivant le logement et la personne recherchée. (60 à 120 mots)"),
    ("Logement & Déménagement", 2,
     "Racontez sur votre blog votre expérience de déménagement récente : les préparatifs, les difficultés et vos impressions sur votre nouveau quartier. (120 à 150 mots)"),
    ("Logement & Déménagement", 2,
     "Rédigez un article décrivant le logement idéal selon vous et expliquant pourquoi il vous correspondrait. (120 à 150 mots)"),
    ("Logement & Déménagement", 3,
     "« Il vaut mieux louer son logement que de l'acheter. » Comparez les deux points de vue et donnez votre opinion. (120 à 180 mots)"),
    ("Logement & Déménagement", 3,
     "« Vivre en ville est préférable à vivre à la campagne. » Présentez les avantages des deux modes de vie et défendez votre position. (120 à 180 mots)"),

    # --- Voyages & Déplacements ---
    ("Voyages & Déplacements", 1,
     "Vous préparez un voyage avec un ami. Écrivez-lui un message pour proposer une destination, des dates et le moyen de transport. (60 à 120 mots)"),
    ("Voyages & Déplacements", 1,
     "Vous avez raté votre train. Écrivez un message à la personne qui vous attend pour expliquer la situation et proposer une solution. (60 à 120 mots)"),
    ("Voyages & Déplacements", 1,
     "Écrivez une carte postale à votre famille pour décrire le lieu où vous passez vos vacances. (60 à 120 mots)"),
    ("Voyages & Déplacements", 2,
     "Racontez sur votre blog un voyage qui vous a particulièrement marqué : le lieu, les rencontres et ce que vous en avez retenu. (120 à 150 mots)"),
    ("Voyages & Déplacements", 2,
     "Rédigez un article pour conseiller les voyageurs sur la meilleure façon de découvrir une ville étrangère. (120 à 150 mots)"),
    ("Voyages & Déplacements", 3,
     "« Voyager seul est plus enrichissant que voyager en groupe. » Comparez les deux façons de voyager et donnez votre avis. (120 à 180 mots)"),
    ("Voyages & Déplacements", 3,
     "« Le tourisme de masse nuit aux destinations. » Présentez les deux points de vue et défendez le vôtre. (120 à 180 mots)"),

    # --- Travail & Études (premium) ---
    ("Travail & Études", 1,
     "Vous ne pouvez pas assister à une réunion importante. Écrivez un message à votre responsable pour vous excuser et proposer une alternative. (60 à 120 mots)"),
    ("Travail & Études", 2,
     "Racontez dans un article une expérience professionnelle ou un stage qui vous a beaucoup appris. (120 à 150 mots)"),
    ("Travail & Études", 3,
     "« Le télétravail devrait devenir la norme. » Comparez les avantages du bureau et du télétravail, puis donnez votre opinion. (120 à 180 mots)"),

    # --- Santé & Bien-être (premium) ---
    ("Santé & Bien-être", 1,
     "Un ami se sent stressé. Écrivez-lui un message pour lui proposer des activités qui pourraient l'aider à se détendre. (60 à 120 mots)"),
    ("Santé & Bien-être", 2,
     "Rédigez un article sur les habitudes que vous avez adoptées pour rester en bonne santé. (120 à 150 mots)"),
    ("Santé & Bien-être", 3,
     "« La technologie nuit à notre santé. » Présentez les deux points de vue et défendez votre position. (120 à 180 mots)"),

    # --- Environnement & Société (premium) ---
    ("Environnement & Société", 1,
     "Votre quartier organise une journée de nettoyage. Écrivez un message pour inviter vos voisins à y participer. (60 à 120 mots)"),
    ("Environnement & Société", 2,
     "Rédigez un article décrivant les gestes simples que chacun peut faire pour protéger l'environnement. (120 à 150 mots)"),
    ("Environnement & Société", 3,
     "« Les individus, et non les gouvernements, sont responsables de la protection de l'environnement. » Comparez les deux points de vue et donnez votre avis. (120 à 180 mots)"),

    # --- Loisirs & Culture (premium) ---
    ("Loisirs & Culture", 1,
     "Vous organisez une sortie au restaurant pour l'anniversaire d'un ami. Écrivez un message pour inviter vos amis (date, lieu, organisation). (60 à 120 mots)"),
    ("Loisirs & Culture", 2,
     "Racontez dans un article un événement culturel (concert, exposition, festival) auquel vous avez assisté. (120 à 150 mots)"),
    ("Loisirs & Culture", 3,
     "« Les livres papier sont meilleurs que les livres numériques. » Comparez les deux et défendez votre position. (120 à 180 mots)"),
]


# ----------------------------------------------------------------------------


# ----------------------------------------------------------------------------
# 7) PHASE 4 — Pro-lock enforcement + progress
#    Paste with your other public routes (needs get_current_user).
# ----------------------------------------------------------------------------
@app.get("/api/themes/{theme_id}/access")
async def theme_access(theme_id: str,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Check whether the current user may use a theme. Premium themes require
    a premium subscription. Returns the theme plus an `allowed` flag."""
    res = await db.execute(
        select(Theme).where(Theme.theme_id == theme_id,
                            Theme.is_active == True))  # noqa: E712
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Theme not found")
    allowed = (not t.is_premium) or (user.subscription_status == "premium")
    return {"theme": _row_to_dict(t), "allowed": allowed}


@app.get("/api/themes/progress")
async def themes_progress(user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Per-user practice progress. Returns the total number of practice
    submissions the user has made (used to show simple progress in the UI).
    A finer per-theme breakdown can be added once submissions store theme_id."""
    total = await db.scalar(
        select(func.count()).select_from(Submission).where(
            Submission.user_id == user.user_id,
            Submission.source == "practice"))
    return {"practice_submissions": total or 0}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)