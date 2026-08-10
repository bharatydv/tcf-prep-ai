"""
monfrancais — FastAPI backend (PostgreSQL edition)
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
from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Text, ForeignKey, func, select,
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
# "production" turns on Secure cookies and refuses to boot on default secrets.
ENV = os.environ.get("ENV", "development").lower()
IS_PROD = ENV in {"production", "prod"}
_DEFAULT_JWT_SECRET = "change-me-in-prod"
_DEFAULT_ADMIN_PASSWORD = "admin123!"
JWT_SECRET = os.environ.get("JWT_SECRET", _DEFAULT_JWT_SECRET)
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60
REFRESH_TTL_DAYS = 7
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@frenchcorrector.com").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", _DEFAULT_ADMIN_PASSWORD)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

# A forgeable JWT secret or a published admin password in production is a full
# account takeover, so fail at boot rather than serve traffic with either.
if IS_PROD:
    _bad = []
    if JWT_SECRET == _DEFAULT_JWT_SECRET or len(JWT_SECRET) < 32:
        _bad.append("JWT_SECRET (set a random value of 32+ characters)")
    if ADMIN_PASSWORD == _DEFAULT_ADMIN_PASSWORD:
        _bad.append("ADMIN_PASSWORD (still the built-in default)")
    if _bad:
        raise RuntimeError(
            "Refusing to start with insecure production settings: "
            + "; ".join(_bad))
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
ASSEMBLYAI_API_KEY = os.environ.get("ASSEMBLYAI_API_KEY", "")

# ---- Per-task AI provider selection (you decide which API does which task) ----
# Grading providers: "anthropic" | "openai" | "gemini"
WRITING_GRADER_PROVIDER = os.environ.get("WRITING_GRADER_PROVIDER", "anthropic").lower()
SPEAKING_GRADER_PROVIDER = os.environ.get("SPEAKING_GRADER_PROVIDER", "anthropic").lower()
# Transcription providers: "openai" | "gemini"  (anthropic cannot transcribe)
TRANSCRIBE_PROVIDER = os.environ.get("TRANSCRIBE_PROVIDER", "openai").lower()

# ---- Per-provider models (all current, non-deprecated; override in .env) ----
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
OPENAI_GRADER_MODEL = os.environ.get("OPENAI_GRADER_MODEL", "gpt-4o-mini")
GEMINI_GRADER_MODEL = os.environ.get("GEMINI_GRADER_MODEL", "gemini-2.5-flash-lite")
OPENAI_TRANSCRIBE_MODEL = os.environ.get("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
GEMINI_TRANSCRIBE_MODEL = os.environ.get("GEMINI_TRANSCRIBE_MODEL", "gemini-2.5-flash")
# Groq: Whisper transcription + fast LLM grading (OpenAI-compatible API)
# llama-3.3-70b-versatile was deprecated by Groq on 2026-06-17 and stops being
# served on 2026-08-16; gpt-oss-120b is their named replacement. Override with
# GROQ_GRADER_MODEL if you have an enterprise contract that keeps llama alive.
GROQ_GRADER_MODEL = os.environ.get("GROQ_GRADER_MODEL", "openai/gpt-oss-120b")
GROQ_TRANSCRIBE_MODEL = os.environ.get("GROQ_TRANSCRIBE_MODEL", "whisper-large-v3")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
# DeepSeek: text grading only (OpenAI-compatible API, no transcription)
DEEPSEEK_GRADER_MODEL = os.environ.get("DEEPSEEK_GRADER_MODEL", "deepseek-v4-flash")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
# AssemblyAI: file transcription (upload -> submit -> poll)
ASSEMBLYAI_BASE_URL = os.environ.get("ASSEMBLYAI_BASE_URL", "https://api.assemblyai.com")
ASSEMBLYAI_LANGUAGE = os.environ.get("ASSEMBLYAI_LANGUAGE", "fr")
FREE_MONTHLY_LIMIT = 5
FREE_MODEL_ANSWER_LIMIT = 3
# Cost controls. The longest TCF tâche is 180 words, so 6000 characters is far
# above any legitimate answer while still bounding what one credit can spend.
MAX_TEXT_CHARS = 6000
MAX_AUDIO_BYTES = 25 * 1024 * 1024
# Open-ended "talk to the AI" practice is cheaper to allow than a graded task,
# but still costs tokens, so free users get a small monthly allowance.
FREE_CONVERSATION_LIMIT = 2

# ---- Runtime provider selection (Admin panel overrides the .env defaults) ----
# .env values are the fallback defaults; the Admin panel can override them and
# the choice is stored in the app_settings table under these keys.
_ENV_PROVIDER_DEFAULTS = {
    "transcribe_provider": TRANSCRIBE_PROVIDER,
    "speaking_grader_provider": SPEAKING_GRADER_PROVIDER,
    "writing_grader_provider": WRITING_GRADER_PROVIDER,
}
_provider_cache: dict = {}          # key -> value
_provider_cache_ts: float = 0.0     # last refresh time
_PROVIDER_CACHE_TTL = 10.0          # seconds


async def get_provider(db: AsyncSession, key: str) -> str:
    """Return the active provider for a task key, DB setting first then .env.

    Cached briefly so we don't hit the DB on every grade call, but still pick
    up Admin-panel changes within ~10 seconds.
    """
    global _provider_cache, _provider_cache_ts
    import time as _t
    now = _t.time()
    if now - _provider_cache_ts > _PROVIDER_CACHE_TTL:
        try:
            res = await db.execute(select(AppSetting))
            _provider_cache = {r.key: r.value for r in res.scalars().all()}
        except Exception:  # noqa: BLE001
            _provider_cache = {}
        _provider_cache_ts = now
    val = _provider_cache.get(key)
    if val:
        return val.lower()
    return _ENV_PROVIDER_DEFAULTS.get(key, "").lower()


def _invalidate_provider_cache():
    global _provider_cache_ts
    _provider_cache_ts = 0.0

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
    # Streaks and the heatmap roll over at the learner's local midnight.
    timezone: Mapped[str] = mapped_column(String(64), default="America/Toronto")
    # One-off XP rewards already granted, so they are never paid twice.
    awarded_bonuses: Mapped[List[str]] = mapped_column(
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


class AppSetting(Base):
    """Simple key-value store for runtime-editable settings (e.g. which AI
    provider is active for each task). Overrides the .env defaults when set."""
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    value: Mapped[str] = mapped_column(String(128))


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
    # Which TCF barème caps were applied, so the learner sees why the level
    # was lowered instead of an unexplained score.
    caps_applied: Mapped[Any] = mapped_column(JSONB, default=list)
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
    # Float: the combined score is the mean of three task scores, e.g. 72.3.
    combined_score: Mapped[float] = mapped_column(Float)
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


class MockExamAttempt(Base):
    """A completed reading/listening mock exam, graded on the server."""
    __tablename__ = "mock_exam_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mock_attempt_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    exam_type: Mapped[str] = mapped_column(String(40), index=True)
    answers: Mapped[Any] = mapped_column(JSONB, default=dict)
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    time_used_seconds: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)


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
        "timezone": u.timezone or "America/Toronto",
        # Shown before the editor, so nobody writes 150 words only to be told
        # afterwards that they had no credits left.
        "credits_remaining": (
            None if (u.subscription_status or "free") == "premium"
            else max(0, FREE_MONTHLY_LIMIT - (u.free_submissions_used or 0))),
        "free_monthly_limit": FREE_MONTHLY_LIMIT,
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


def _set_access_cookie(resp: Response, user_id: str):
    """Secure in production so the cookie is never sent over plain HTTP."""
    resp.set_cookie("access_token", make_token(user_id, "access",
                                               minutes=ACCESS_TTL_MIN),
                    httponly=True, samesite="lax", secure=IS_PROD,
                    path="/", max_age=ACCESS_TTL_MIN * 60)


def set_auth_cookies(resp: Response, user_id: str):
    _set_access_cookie(resp, user_id)
    resp.set_cookie("refresh_token",
                    make_token(user_id, "refresh", days=REFRESH_TTL_DAYS),
                    httponly=True, samesite="lax", secure=IS_PROD,
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
# Rate limiting
# ----------------------------------------------------------------------------
# A fixed-window counter held in process memory. Enough to stop credential
# stuffing and runaway AI spend from one client; swap for Redis if the API is
# ever run as more than one worker, since each worker keeps its own counts.
_rate_buckets: Dict[str, List[float]] = {}


def _client_key(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """Dependency factory: at most `limit` calls per `window_seconds` per IP."""
    async def dep(request: Request):
        import time as _t
        now = _t.time()
        key = f"{bucket}:{_client_key(request)}"
        hits = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
        if len(hits) >= limit:
            retry = int(window_seconds - (now - hits[0])) + 1
            raise HTTPException(
                status_code=429,
                detail="Trop de requêtes. Réessayez dans un instant.",
                headers={"Retry-After": str(retry)})
        hits.append(now)
        _rate_buckets[key] = hits
        # Opportunistic sweep so the dict cannot grow without bound.
        if len(_rate_buckets) > 10_000:
            for k in [k for k, v in _rate_buckets.items()
                      if not v or now - v[-1] > window_seconds]:
                _rate_buckets.pop(k, None)
    return dep


# Auth is brute-forceable; AI calls cost money. Both are capped per IP.
auth_rate_limit = rate_limit("auth", limit=10, window_seconds=300)
ai_rate_limit = rate_limit("ai", limit=20, window_seconds=300)


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
    """Read-only check. Anything that will spend a credit must use
    reserve_credit() instead, which claims it atomically."""
    user = await check_and_reset_monthly(db, user)
    if user.subscription_status == "premium":
        return user
    if (user.free_submissions_used or 0) >= FREE_MONTHLY_LIMIT:
        raise HTTPException(
            status_code=402,
            detail="Free tier limit reached. Please upgrade to continue.")
    return user


async def enforce_free_conversation_limit(db: AsyncSession, user: User) -> User:
    """Free-conversation allowance, counted from the conversations already
    graded this month. Derived from the submissions table rather than a new
    user column, so this needs no migration on an existing database."""
    user = await check_and_reset_monthly(db, user)
    if user.subscription_status == "premium":
        return user
    now = now_utc()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = await db.scalar(
        select(func.count()).select_from(Submission).where(
            Submission.user_id == user.user_id,
            Submission.source == "conversation",
            Submission.created_at >= month_start,
        ))
    if (used or 0) >= FREE_CONVERSATION_LIMIT:
        raise HTTPException(
            status_code=402,
            detail=(f"Vous avez utilisé vos {FREE_CONVERSATION_LIMIT} conversations "
                    "gratuites ce mois-ci. Passez à la version Pro pour continuer."))
    return user


async def consume_credit(db: AsyncSession, user_id: str):
    await db.execute(
        sa_update(User).where(User.user_id == user_id)
        .values(free_submissions_used=User.free_submissions_used + 1))
    await db.commit()


async def reserve_credit(db: AsyncSession, user: User) -> User:
    """Atomically claim one free credit, or 402 if none are left.

    Checking the count and incrementing it in two statements lets two parallel
    requests both pass the check, so the increment carries the limit in its
    WHERE clause and the row lock decides the winner.
    """
    user = await check_and_reset_monthly(db, user)
    if user.subscription_status == "premium":
        return user
    res = await db.execute(
        sa_update(User)
        .where(User.user_id == user.user_id,
               User.free_submissions_used < FREE_MONTHLY_LIMIT)
        .values(free_submissions_used=User.free_submissions_used + 1)
        .returning(User.free_submissions_used))
    if res.scalar_one_or_none() is None:
        await db.rollback()
        raise HTTPException(
            status_code=402,
            detail="Free tier limit reached. Please upgrade to continue.")
    await db.commit()
    await db.refresh(user)
    return user


async def refund_credit(db: AsyncSession, user: User):
    """Give a reserved credit back when the work could not be graded."""
    if user.subscription_status == "premium":
        return
    await db.execute(
        sa_update(User)
        .where(User.user_id == user.user_id, User.free_submissions_used > 0)
        .values(free_submissions_used=User.free_submissions_used - 1))
    await db.commit()


def user_today(user: User) -> date:
    """Today's date in the learner's own timezone.

    A candidate in Montréal practising at 8pm is still on 'today'; using UTC
    would roll their streak over five hours early and grey out the heatmap
    square they just earned.
    """
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(user.timezone or "America/Toronto")).date()
    except Exception:  # noqa: BLE001 - unknown tz name, fall back to UTC
        return now_utc().date()


async def update_streak(db: AsyncSession, user_id: str) -> dict:
    """A qualifying action happened today; update the streak."""
    user = await get_user_by_id(db, user_id)
    today = user_today(user)
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
    # Stored as the learner's local calendar day at midnight UTC, so reading it
    # back with .date() returns the same day it was recorded as.
    user.last_activity_date = datetime(today.year, today.month, today.day,
                                       tzinfo=timezone.utc)
    await db.commit()
    return {"current_streak": current, "longest_streak": longest,
            "extended": extended}


# ----------------------------------------------------------------------------
# Official TCF Canada task specifications
# ----------------------------------------------------------------------------
# These are the real exam constraints, not house rules. Every writing and
# speaking surface enforces them, and the graders cap the level when a
# candidate falls outside them — exactly as a real examiner would.
#
# Expression écrite: 60 minutes total for the three tâches.
# Expression orale:  ~12 minutes total; tâches 2 and 3 include preparation time
#                    during which the candidate does not speak.
CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
# Highest score still inside each level, used when a cap is applied.
LEVEL_MAX_SCORE = {"A1": 19, "A2": 39, "B1": 54, "B2": 69, "C1": 84, "C2": 100}

WRITING_TASKS = {
    1: {"min_words": 60,  "max_words": 120, "minutes": 15,
        "name": "Tâche 1 — Message court"},
    2: {"min_words": 120, "max_words": 150, "minutes": 20,
        "name": "Tâche 2 — Article, blog ou lettre"},
    3: {"min_words": 120, "max_words": 180, "minutes": 25,
        "name": "Tâche 3 — Texte argumentatif"},
}
WRITING_TOTAL_SECONDS = 60 * 60

SPEAKING_TASKS = {
    1: {"prep_seconds": 0,   "speak_seconds": 120, "min_words": 40,
        "name": "Tâche 1 — Entretien dirigé"},
    2: {"prep_seconds": 120, "speak_seconds": 210, "min_words": 60,
        "name": "Tâche 2 — Exercice en interaction"},
    3: {"prep_seconds": 120, "speak_seconds": 150, "min_words": 90,
        "name": "Tâche 3 — Expression d'un point de vue"},
}

# Kept for backwards compatibility with the simulator response shape.
WORD_GUIDE = {n: (s["min_words"], s["max_words"]) for n, s in WRITING_TASKS.items()}


def cap_level(analysis: dict, max_level: str, code: str, **params) -> dict:
    """Lower a graded result to `max_level` if it sits above it.

    The model is instructed to apply the CEFR caps itself but does not do so
    reliably, so the rubric is also enforced here — a learner deciding whether
    to book a real exam must not be told they are a level above their work.

    `code` and `params` are returned rather than a sentence, so the interface
    can render the reason in whichever language the learner is reading.
    """
    if max_level not in LEVEL_MAX_SCORE:
        return analysis
    current = analysis.get("tcf_level", "A1")
    if current not in CEFR_LEVELS:
        current = "A1"
    if CEFR_LEVELS.index(current) <= CEFR_LEVELS.index(max_level):
        return analysis
    analysis["tcf_level"] = max_level
    analysis["overall_score"] = min(int(analysis.get("overall_score", 0) or 0),
                                    LEVEL_MAX_SCORE[max_level])
    caps = list(analysis.get("caps_applied") or [])
    caps.append({"code": code, "params": params})
    analysis["caps_applied"] = caps
    return analysis


def apply_error_cap(analysis: dict) -> dict:
    """CEFR cap driven by how many real errors the grader found.

    'improvement' entries are style upgrades on correct sentences, so they
    never count as errors here.
    """
    real = [e for e in analysis.get("errors", [])
            if e.get("category") != "improvement"]
    n = len(real)
    if n >= 5:
        return cap_level(analysis, "B1", "errors5plus", n=n)
    if n >= 2:
        return cap_level(analysis, "B2", "errors2to4", n=n)
    return analysis


def apply_writing_length_cap(analysis: dict, text: str,
                             task_type: Optional[int]) -> dict:
    """Enforce the official word range for a writing tâche.

    A real examiner penalises an answer that is short of the minimum or well
    past the maximum, however good the French is. Below half the minimum the
    answer is not a valid attempt at the task at all.
    """
    spec = WRITING_TASKS.get(task_type or 0)
    words = len([w for w in text.split() if w.strip()])
    analysis["word_count"] = words
    if not spec:
        return analysis
    analysis["word_guide"] = [spec["min_words"], spec["max_words"]]
    lo, hi = spec["min_words"], spec["max_words"]
    if words < lo // 2:
        return cap_level(analysis, "A2", "lengthNotAttempted", words=words, min=lo)
    if words < lo:
        return cap_level(analysis, "B1", "lengthTooShort", words=words, min=lo)
    if words > hi * 1.5:
        return cap_level(analysis, "B2", "lengthTooLong", words=words, max=hi)
    return analysis


def apply_speaking_caps(analysis: dict, transcript: str,
                        task_type: Optional[int]) -> dict:
    """Length and relevance caps for a spoken answer.

    The word floors approximate the volume of speech the official timings
    expect; well under it means the candidate stopped far too early.
    """
    analysis = apply_error_cap(analysis)
    if analysis.get("answers_question") is False:
        analysis = cap_level(analysis, "B1", "offTopic")
    spec = SPEAKING_TASKS.get(task_type or 0)
    words = len([w for w in (transcript or "").split() if w.strip()])
    analysis["word_count"] = words
    if not spec:
        return analysis
    floor = spec["min_words"]
    if words < floor // 2:
        return cap_level(analysis, "A2", "speakVeryShort", words=words)
    if words < floor:
        return cap_level(analysis, "B1", "speakTooShort", words=words)
    return analysis


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

Hard capping rules (apply them strictly — a candidate must never be told they are above the level their text demonstrates):
- 5+ real errors -> B1 maximum
- 2-4 real errors -> B2 maximum
- 0-1 real errors with good structure -> C1 minimum
- 0 errors + sophisticated vocabulary and complex syntax -> C2
- Simple correct sentences without complex structures -> B1 maximum
"improvement" entries are style upgrades on correct sentences and do NOT count as errors for these caps.

Official TCF Canada length requirements per tâche:
- Tâche 1 (message court): 60-120 words
- Tâche 2 (article, blog ou lettre): 120-150 words
- Tâche 3 (texte argumentatif): 120-180 words
If the consigne identifies a tâche and the text is under the minimum, say so in improvement_suggestions and lower the level accordingly: a real examiner penalises an under-length answer however good the French is.

improvement_suggestions: 3-5 concrete English tips. linking_words: French connectors the writer should use. vocabulary_suggestions: French words/phrases to enrich the text."""

# A full grading reply lists every error with an explanation, which can run
# past 2000 tokens on a long Tache 3. Truncation lands mid-JSON, which used
# to surface as a bare "AI unavailable" with the provider blamed.
GRADER_MAX_TOKENS = int(os.environ.get("GRADER_MAX_TOKENS", "4000"))

AI_UNAVAILABLE_DETAIL = ("Correction indisponible : le correcteur IA a refusé la "
                         "requête (clé API ou quota du fournisseur). "
                         "Réessayez dans un instant.")
AI_TIMEOUT_DETAIL = ("Correction indisponible : l'analyse a dépassé le délai "
                     "maximum. Réessayez dans un instant.")

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


def _extract_json(raw: str) -> dict:
    """Parse a grader reply that is *meant* to be JSON but may not be clean.

    _strip_fences alone only handles a reply that is exactly one fenced block.
    Models routinely wrap the JSON in a sentence ("Here is the analysis:"), add
    a trailing note, or emit a reasoning preamble — all of which made
    json.loads throw, which the caller turned into a generic "AI unavailable"
    with no clue that the provider had in fact answered. Falling back to the
    outermost balanced {...} recovers those replies instead of discarding them.
    """
    cleaned = _strip_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # Pull out the first balanced object, ignoring braces inside strings.
    start = cleaned.find("{")
    if start == -1:
        raise ValueError("grader reply contained no JSON object")
    depth, in_str, esc = 0, False, False
    for i, ch in enumerate(cleaned[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(cleaned[start:i + 1])
    raise ValueError("grader reply ended mid-JSON (likely truncated by max_tokens)")


# ----------------------------------------------------------------------------
# Multi-provider AI adapters. Each takes (model, system_prompt, user_text) and
# returns the raw text response. The grader dispatcher picks one by provider.
# ----------------------------------------------------------------------------
def _call_anthropic(model: str, system_prompt: str, user_text: str) -> str:
    from anthropic import Anthropic
    aclient = Anthropic(api_key=ANTHROPIC_API_KEY)
    resp = aclient.messages.create(
        model=model,
        max_tokens=GRADER_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_text}],
    )
    parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
    return "".join(parts)


def _call_openai(model: str, system_prompt: str, user_text: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=model,
        max_tokens=GRADER_MAX_TOKENS,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
    )
    return resp.choices[0].message.content or ""


def _call_gemini(model: str, system_prompt: str, user_text: str) -> str:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=GEMINI_API_KEY)
    resp = client.models.generate_content(
        model=model,
        contents=user_text,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=2000,
        ),
    )
    return resp.text or ""


def _call_openai_compatible(base_url: str, api_key: str, model: str,
                            system_prompt: str, user_text: str) -> str:
    """Shared adapter for any OpenAI-compatible endpoint (Groq, DeepSeek).

    A reasoning model can return HTTP 200 with an EMPTY content string: the
    thinking tokens exhaust max_tokens before it writes the answer, and the
    reply arrives with finish_reason='length' and content=''. Returning "" for
    that made the caller report "the AI refused the request (API key or quota)"
    while the key was fine and the request had succeeded. Never return an empty
    string silently — raise with the reason so it reaches the log and the
    Admin panel.
    """
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=base_url)
    resp = client.chat.completions.create(
        model=model,
        max_tokens=GRADER_MAX_TOKENS,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
    )
    choice = resp.choices[0]
    content = (choice.message.content or "").strip()
    if content:
        return content

    # Some providers put chain-of-thought in a sibling field and leave content
    # empty; the JSON we want may be in there.
    reasoning = (getattr(choice.message, "reasoning_content", None)
                 or getattr(choice.message, "reasoning", None) or "").strip()
    if reasoning:
        log.warning("%s returned empty content; using reasoning_content "
                    "(finish_reason=%s)", model, choice.finish_reason)
        return reasoning

    usage = getattr(resp, "usage", None)
    hint = ""
    if choice.finish_reason == "length":
        hint = (f" The {GRADER_MAX_TOKENS}-token budget was used up before any "
                f"answer was written — raise GRADER_MAX_TOKENS.")
    raise RuntimeError(
        f"{model} returned an empty completion "
        f"(finish_reason={choice.finish_reason}, usage={usage}).{hint}")


def _call_groq(model: str, system_prompt: str, user_text: str) -> str:
    return _call_openai_compatible(GROQ_BASE_URL, GROQ_API_KEY, model,
                                   system_prompt, user_text)


def _call_deepseek(model: str, system_prompt: str, user_text: str) -> str:
    return _call_openai_compatible(DEEPSEEK_BASE_URL, DEEPSEEK_API_KEY, model,
                                   system_prompt, user_text)


# provider -> (callable, key, model) for GRADING tasks
def _grader_backend(provider: str):
    if provider == "openai":
        return _call_openai, OPENAI_API_KEY, OPENAI_GRADER_MODEL
    if provider == "gemini":
        return _call_gemini, GEMINI_API_KEY, GEMINI_GRADER_MODEL
    if provider == "groq":
        return _call_groq, GROQ_API_KEY, GROQ_GRADER_MODEL
    if provider == "deepseek":
        return _call_deepseek, DEEPSEEK_API_KEY, DEEPSEEK_GRADER_MODEL
    # default anthropic
    return _call_anthropic, ANTHROPIC_API_KEY, ANTHROPIC_MODEL


# Substrings that cannot occur in a real provider key (they are alphanumeric
# plus dashes), so matching one means the .env value is still a template.
_PLACEHOLDER_KEY_HINTS = ("your_", "your-", "_here", "changeme", "replace_me")


def _key_is_usable(key: str) -> bool:
    """False for an empty key or an obvious .env placeholder value."""
    k = (key or "").strip().lower()
    if not k:
        return False
    return not any(h in k for h in _PLACEHOLDER_KEY_HINTS)


# Why each provider last failed, so the Admin panel can show the actual reason
# instead of a bare "AI unavailable". Errors from a provider API can quote the
# key back, so the text is scrubbed before it is ever returned over HTTP.
_PROVIDER_LAST_ERROR: Dict[str, str] = {}


def _scrub_secrets(text: str) -> str:
    """Remove anything key-shaped from a provider error before showing it."""
    out = str(text)
    for key in (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
                GROQ_API_KEY, DEEPSEEK_API_KEY, ASSEMBLYAI_API_KEY):
        if key and len(key) > 8:
            out = out.replace(key, "***")
    return re.sub(r"\b(sk|gsk)[-_][A-Za-z0-9\-_]{8,}", "***", out)[:400]


async def _grade_with_provider(provider: str, system_prompt: str,
                               user_text: str) -> Optional[str]:
    """Run a grading call on the chosen provider. Returns raw text or None."""
    fn, key, model = _grader_backend(provider)
    if not _key_is_usable(key):
        msg = ("No usable API key — the value in .env is empty or still a "
               "placeholder such as 'your_..._key'.")
        _PROVIDER_LAST_ERROR[provider] = msg
        log.warning("Missing or placeholder API key for grading provider '%s' "
                    "- set a real key in .env", provider)
        return None
    loop = asyncio.get_event_loop()
    last_exc = None
    for attempt in range(2):
        try:
            out = await loop.run_in_executor(None, fn, model, system_prompt, user_text)
            _PROVIDER_LAST_ERROR.pop(provider, None)
            return out
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.warning("Grading call failed (%s/%s attempt %s): %s",
                        provider, model, attempt + 1, exc)
            await asyncio.sleep(0.5)
    _PROVIDER_LAST_ERROR[provider] = f"{type(last_exc).__name__}: {_scrub_secrets(last_exc)}"
    return None


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
    # A missing score or level means the model did not really grade the text.
    # Defaulting to 0/A1 would tell a learner they are a beginner because of a
    # malformed response, so treat it as a parse failure instead.
    if data.get("overall_score") is None or data.get("tcf_level") is None:
        raise ValueError("grader response missing overall_score/tcf_level")
    try:
        score = max(0, min(100, int(data["overall_score"])))
    except (TypeError, ValueError):
        raise ValueError("grader returned a non-numeric overall_score")
    level = data["tcf_level"]
    if level not in set(CEFR_LEVELS):
        raise ValueError(f"grader returned an unknown level: {level!r}")
    return {
        "errors": errors,
        "overall_score": score,
        "tcf_level": level,
        "improvement_suggestions": [str(x) for x in (data.get("improvement_suggestions") or [])][:8],
        "linking_words": [str(x) for x in (data.get("linking_words") or [])][:12],
        "vocabulary_suggestions": [str(x) for x in (data.get("vocabulary_suggestions") or [])][:12],
    }


async def analyze_text_with_ai(text: str, topic: Optional[str] = None, db=None,
                               task_type: Optional[int] = None) -> dict:
    """Grade writing using the active provider (Admin panel overrides .env).

    `task_type` (1/2/3) enables the official TCF word-range cap; leave it None
    for free writing, where no official length applies.
    """
    spec = WRITING_TASKS.get(task_type or 0)
    header = f"Topic/consigne: {topic}\n\n" if topic else ""
    if spec:
        header += (f"This is TCF Canada {spec['name']}, which requires "
                   f"{spec['min_words']}-{spec['max_words']} words.\n\n")
    prompt = f"{header}Text to grade:\n{text}"
    provider = (await get_provider(db, "writing_grader_provider")) if db is not None else WRITING_GRADER_PROVIDER
    raw = await _grade_with_provider(provider, GRADER_SYSTEM, prompt)
    if raw is None:
        return dict(FALLBACK_ANALYSIS)
    try:
        data = _extract_json(raw)
        result = _validate_analysis(data)
        _, _, model = _grader_backend(provider)
        result["ai_provider"] = provider
        result["ai_model"] = model
        result = apply_error_cap(result)
        result = apply_writing_length_cap(result, text, task_type)
        return result
    except Exception as exc:  # noqa: BLE001
        # Log what actually came back. Without this the provider looks dead
        # when in fact it replied and only the shape was wrong.
        log.warning("Could not parse grading JSON (%s): %s | reply[:400]=%r",
                    provider, exc, _scrub_secrets(raw)[:400])
        _PROVIDER_LAST_ERROR[provider] = (
            f"Replied, but the response could not be parsed: {exc}")
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
                              category: str, db=None) -> str:
    """Batch-time MCQ distractor; falls back to a static map.

    Uses the active grader provider (e.g. Groq) rather than a hardcoded slow
    model, so it doesn't bottleneck speaking/writing analysis.
    """
    prompt = (f'A French learner wrote: "{error_text}". The correction is '
              f'"{correction}". Produce ONE plausible but INCORRECT alternative '
              f"a learner might choose (same length/style). Return ONLY the "
              f"alternative text, nothing else.")
    try:
        provider = (await get_provider(db, "writing_grader_provider")
                    if db is not None else WRITING_GRADER_PROVIDER)
        raw = await _grade_with_provider(
            provider, "You generate plausible incorrect French answer options.",
            prompt)
        if raw:
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
                          generate_distractors: bool = False):
    """Write each detected error into the per-user mistakes table.

    Distractors are NOT generated here by default. Doing so cost one sequential
    LLM round-trip per new error inside the request, which pushed the response
    past proxy timeouts on submissions with several errors. They are generated
    on demand the first time a mistake reaches the MCQ review instead.
    """
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
                err["error"], err["correction"], err["category"], db=db)
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
                             source: str = "practice",
                             consume: bool = True) -> dict:
    """Save a graded piece of work. `consume=False` for flows metered by their
    own allowance, so they do not also spend a monthly AI credit."""
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
        word_count=analysis.get("word_count") or len(text.split()),
        caps_applied=analysis.get("caps_applied") or [],
        source=source,
        created_at=now_utc(),
    )
    db.add(sub)
    await db.commit()
    await record_mistakes(db, user.user_id, source, sub.submission_id, analysis)
    if consume:
        await consume_credit(db, user.user_id)
    streak = await update_streak(db, user.user_id)
    out = _row_to_dict(sub)
    out["streak"] = streak
    return out



# ----------------------------------------------------------------------------
# Speaking grader (Phase 1)
# ----------------------------------------------------------------------------
SPEAKING_GRADER_SYSTEM = """You are a certified TEF/TCF Canada examiner evaluating a candidate's SPOKEN answer (provided as a transcript) to a French speaking task.

You receive the QUESTION (the task) and the TRANSCRIPT of what the candidate said. The transcript may contain small transcription errors; judge the language charitably where a word is clearly a transcription artifact, not a learner error.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{"answers_question": true, "relevance_comment": "one sentence (English) on whether and how well the answer addresses the task", "errors":[{"error":"wrong text","correction":"fixed","explanation":"why (English)","category":"prepositions|spelling|conjugation|gender_number|anglicism|improvement"}], "overall_score": 50, "tcf_level":"B1", "suggestions":["concrete English suggestion"], "vocabulary_suggestions":["French word/phrase"]}

Evaluate TWO things:
1. RELEVANCE - does the spoken answer actually address the question/task? Set answers_question true/false and explain in relevance_comment. An off-topic or incomplete answer should lower the score even if the French is correct.
2. LANGUAGE - grammar, vocabulary, fluency markers, using the same error categories and CEFR rubric as written grading.

CEFR scoring (overall_score 0-100, tcf_level one of A1,A2,B1,B2,C1,C2):
- A1 (5-19) A2 (20-39) B1 (40-54) B2 (55-69) C1 (70-84) C2 (85-100).
If the answer does not address the task, cap the score at B1.

suggestions: 3-5 concrete English tips to improve THIS spoken answer. vocabulary_suggestions: French words/phrases to enrich it. You are grading a transcript, so do NOT comment on pronunciation or accent."""


# ----------------------------------------------------------------------------
# Tache 2 - Exercice en Interaction: live two-way roleplay
# ----------------------------------------------------------------------------
# In the real exam the candidate ASKS the questions and an examiner plays the
# other party. The agent below is that other party, not a tutor: it must never
# correct the candidate mid-conversation (that happens in the grade afterwards).
INTERACTION_AGENT_SYSTEM = """Tu joues le rôle de l'interlocuteur dans un jeu de rôle de l'épreuve d'expression orale du TCF Canada (Tâche 2 : Exercice en Interaction).

Le candidat doit TE poser des questions pour obtenir des informations. Tu es la personne décrite dans la consigne (agent d'accueil, organisateur, employé, voisin, etc.).

RÈGLES ABSOLUES :
- Réponds UNIQUEMENT par ta réplique, en français parlé naturel. Jamais de préfixe de nom, jamais de guillemets, jamais de commentaire, jamais de JSON.
- Reste toujours dans le personnage. Ne corrige JAMAIS le français du candidat et ne parle jamais de son niveau : tu es un personnage, pas un professeur.
- Sois BREF : 1 à 3 phrases, comme dans une vraie conversation orale.
- Donne l'information PARTIELLEMENT, de façon plausible : invente des détails concrets (horaires, prix, dates, documents) mais n'énumère pas tout d'un coup. Le candidat doit devoir poser d'autres questions.
- Vouvoie le candidat, sauf si la consigne décrit clairement une situation informelle (ami, famille) — dans ce cas tutoie.
- Si le candidat te salue, réponds à la salutation puis invite-le à poser sa question.
- Si le candidat se tait, dit quelque chose d'incompréhensible ou s'écarte du sujet, relance-le gentiment DANS le personnage (« Pardon, je n'ai pas bien entendu, vous pouvez répéter ? », « Vous avez d'autres questions ? »).
- Ne pose pas toi-même une longue série de questions : c'est le candidat qui mène l'échange.
- N'utilise jamais l'anglais."""

INTERACTION_GRADER_SYSTEM = """You are a certified TCF Canada examiner grading Tâche 2 (Exercice en Interaction) - a two-way roleplay in which the CANDIDATE had to ask questions to obtain information from an agent.

You receive the CONSIGNE (the scenario) and the full DIALOGUE. Grade ONLY the candidate's turns. The transcript comes from speech recognition, so judge charitably where a word is clearly a transcription artifact rather than a learner error.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{"answers_question": true, "relevance_comment": "one sentence (English) on whether the candidate obtained the information the consigne asked for", "errors":[{"error":"wrong text","correction":"fixed","explanation":"why (English)","category":"prepositions|spelling|conjugation|gender_number|anglicism|improvement"}], "overall_score": 50, "tcf_level":"B1", "suggestions":["concrete English suggestion"], "vocabulary_suggestions":["French word/phrase"]}

Because this task is INTERACTION, weigh these alongside grammar and vocabulary:
1. QUESTION QUALITY - did the candidate actually ask questions, and were they well formed? Flat statements, or questions built only by raising intonation ("vous avez des places ?") where inversion or est-ce que is expected, are the single most common Tâche 2 weakness. Report them as errors.
2. COVERAGE - did the candidate obtain every piece of information the consigne listed? Set answers_question false if points were missed, and say which in relevance_comment.
3. REGISTER - consistent vouvoiement in a formal scenario (or tutoiement in an informal one), plus politeness formulas (bonjour, s'il vous plaît, je voudrais savoir, merci).
4. INTERACTION - did the candidate react to the agent's answers and follow up, or ignore them and read a list?

CEFR scoring (overall_score 0-100, tcf_level one of A1,A2,B1,B2,C1,C2):
- A1 (5-19) A2 (20-39) B1 (40-54) B2 (55-69) C1 (70-84) C2 (85-100).
Cap the score at B1 if the candidate asked fewer than three real questions or missed most of the required information.

suggestions: 3-5 concrete English tips for THIS conversation. vocabulary_suggestions: French phrases that would have made the asking more idiomatic. You are grading a transcript, so do NOT comment on pronunciation or accent."""

# Keeps one exchange bounded so a runaway session cannot grow the prompt forever.
MAX_DIALOGUE_TURNS = 40


def _render_dialogue(history: list, consigne: str) -> str:
    """Flatten the dialogue into the (system_prompt, user_text) shape every
    provider adapter already accepts, so no new multi-turn adapter is needed."""
    lines = [f"CONSIGNE (le scénario du jeu de rôle) :\n{consigne}", "", "DIALOGUE :"]
    for turn in history[-MAX_DIALOGUE_TURNS:]:
        who = "Candidat" if turn.get("role") == "candidate" else "Agent"
        text = str(turn.get("text", "")).strip()
        if text:
            lines.append(f"{who} : {text}")
    return "\n".join(lines)


async def interaction_reply(consigne: str, history: list, db=None) -> str:
    """Next in-character line from the agent. Empty string on provider failure."""
    prompt = (_render_dialogue(history, consigne) +
              "\n\nDonne maintenant la prochaine réplique de l'Agent, et rien d'autre.")
    provider = (await get_provider(db, "speaking_grader_provider")) if db is not None else SPEAKING_GRADER_PROVIDER
    raw = await _grade_with_provider(provider, INTERACTION_AGENT_SYSTEM, prompt)
    if not raw:
        return ""
    reply = _strip_fences(raw).strip()
    # Models occasionally prefix the speaker label despite the instruction.
    for prefix in ("Agent :", "Agent:", "AGENT :", "AGENT:"):
        if reply.startswith(prefix):
            reply = reply[len(prefix):].strip()
    return reply[:600]


async def grade_interaction(consigne: str, history: list, db=None) -> dict:
    """Grade a finished Tache 2 dialogue, returning the same shape as
    analyze_speaking_with_ai so the existing result UI renders unchanged."""
    said = [t for t in history if t.get("role") == "candidate" and str(t.get("text", "")).strip()]
    if not said:
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "No speech was detected during the conversation.",
                "suggestions": []}
    provider = (await get_provider(db, "speaking_grader_provider")) if db is not None else SPEAKING_GRADER_PROVIDER
    raw = await _grade_with_provider(provider, INTERACTION_GRADER_SYSTEM,
                                     _render_dialogue(history, consigne))
    if raw is None:
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "", "suggestions": []}
    try:
        result = _validate_speaking(_extract_json(raw))
        _, _, model = _grader_backend(provider)
        result["ai_provider"] = provider
        result["ai_model"] = model
        # Tâche 2 is the interaction task; grade only what the candidate said.
        spoken = " ".join(str(t.get("text", "")) for t in said)
        return apply_speaking_caps(result, spoken, 2)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not parse interaction JSON (%s): %s", provider, exc)
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "", "suggestions": []}


def _transcribe_openai(audio_bytes: bytes, filename: str) -> str:
    import io
    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)
    buf = io.BytesIO(audio_bytes)
    buf.name = filename or "audio.webm"
    resp = client.audio.transcriptions.create(
        model=OPENAI_TRANSCRIBE_MODEL, file=buf, language="fr")
    return (resp.text or "").strip()


def _transcribe_gemini(audio_bytes: bytes, filename: str) -> str:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=GEMINI_API_KEY)
    mime = "audio/webm"
    fn = (filename or "").lower()
    if fn.endswith(".mp3"):
        mime = "audio/mp3"
    elif fn.endswith(".wav"):
        mime = "audio/wav"
    elif fn.endswith(".m4a"):
        mime = "audio/mp4"
    resp = client.models.generate_content(
        model=GEMINI_TRANSCRIBE_MODEL,
        contents=[
            "Transcribe this French audio exactly. Return ONLY the transcript text.",
            types.Part.from_bytes(data=audio_bytes, mime_type=mime),
        ],
    )
    return (resp.text or "").strip()


def _transcribe_groq(audio_bytes: bytes, filename: str) -> str:
    """Transcribe with Groq Whisper (OpenAI-compatible audio endpoint)."""
    import io
    from openai import OpenAI
    client = OpenAI(api_key=GROQ_API_KEY, base_url=GROQ_BASE_URL)
    buf = io.BytesIO(audio_bytes)
    buf.name = filename or "audio.webm"
    resp = client.audio.transcriptions.create(
        model=GROQ_TRANSCRIBE_MODEL, file=buf, language="fr")
    return (resp.text or "").strip()


def _transcribe_assemblyai(audio_bytes: bytes, filename: str) -> str:
    """Transcribe with AssemblyAI: upload bytes, submit job, poll for result."""
    import time
    import requests
    headers = {"authorization": ASSEMBLYAI_API_KEY}
    # 1. Upload the raw audio bytes
    up = requests.post(f"{ASSEMBLYAI_BASE_URL}/v2/upload",
                       headers=headers, data=audio_bytes, timeout=60)
    up.raise_for_status()
    audio_url = up.json()["upload_url"]
    # 2. Submit the transcription job (French)
    body = {"audio_url": audio_url, "language_code": ASSEMBLYAI_LANGUAGE}
    sub = requests.post(f"{ASSEMBLYAI_BASE_URL}/v2/transcript",
                        json=body, headers=headers, timeout=30)
    sub.raise_for_status()
    tid = sub.json()["id"]
    # 3. Poll until complete (max ~60s)
    poll_url = f"{ASSEMBLYAI_BASE_URL}/v2/transcript/{tid}"
    for _ in range(40):
        pr = requests.get(poll_url, headers=headers, timeout=30)
        pr.raise_for_status()
        data = pr.json()
        status = data.get("status")
        if status == "completed":
            return (data.get("text") or "").strip()
        if status == "error":
            raise RuntimeError(data.get("error", "AssemblyAI transcription error"))
        time.sleep(1.5)
    raise RuntimeError("AssemblyAI transcription timed out")


async def transcribe_audio(audio_bytes: bytes, filename: str, db=None) -> str:
    """Transcribe using the active provider (Admin panel overrides .env)."""
    provider = (await get_provider(db, "transcribe_provider")) if db is not None else TRANSCRIBE_PROVIDER
    if provider == "gemini":
        fn, key = _transcribe_gemini, GEMINI_API_KEY
    elif provider == "groq":
        fn, key = _transcribe_groq, GROQ_API_KEY
    elif provider == "assemblyai":
        fn, key = _transcribe_assemblyai, ASSEMBLYAI_API_KEY
    else:
        fn, key = _transcribe_openai, OPENAI_API_KEY
        provider = "openai"
    if not key:
        log.warning("No API key set for transcription provider '%s'", provider)
        return ""
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, fn, audio_bytes, filename)
    except Exception as exc:  # noqa: BLE001
        log.warning("Transcription failed (%s): %s", provider, exc)
        return ""


def _validate_speaking(data: dict) -> dict:
    base = _validate_analysis(data)
    base["answers_question"] = bool(data.get("answers_question", False))
    base["relevance_comment"] = str(data.get("relevance_comment", ""))[:400]
    base["suggestions"] = [str(x) for x in (data.get("suggestions") or [])][:8]
    return base


async def analyze_speaking_with_ai(transcript: str, question: str, db=None,
                                   task_type: Optional[int] = None) -> dict:
    """Grade a spoken answer using the active provider (Admin overrides .env).

    `task_type` (1/2/3) enables the official TCF speaking caps.
    """
    if not transcript.strip():
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "No speech was detected in the recording.",
                "suggestions": []}
    spec = SPEAKING_TASKS.get(task_type or 0)
    header = f"QUESTION (task):\n{question}\n\n"
    if spec:
        header += (f"This is TCF Canada {spec['name']}, in which the candidate "
                   f"speaks for {spec['speak_seconds'] // 60} min "
                   f"{spec['speak_seconds'] % 60:02d} s.\n\n")
    prompt = f"{header}TRANSCRIPT of the candidate's spoken answer:\n{transcript}"
    provider = (await get_provider(db, "speaking_grader_provider")) if db is not None else SPEAKING_GRADER_PROVIDER
    raw = await _grade_with_provider(provider, SPEAKING_GRADER_SYSTEM, prompt)
    if raw is None:
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "", "suggestions": []}
    try:
        data = _extract_json(raw)
        result = _validate_speaking(data)
        _, _, model = _grader_backend(provider)
        result["ai_provider"] = provider
        result["ai_model"] = model
        return apply_speaking_caps(result, transcript, task_type)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not parse speaking JSON (%s): %s | reply[:400]=%r",
                    provider, exc, _scrub_secrets(raw)[:400])
        _PROVIDER_LAST_ERROR[provider] = (
            f"Replied, but the response could not be parsed: {exc}")
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "", "suggestions": []}


# ----------------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------------
class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    # bcrypt only hashes the first 72 bytes, so cap the input there too.
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class DialogueTurn(BaseModel):
    role: str = Field(pattern="^(candidate|agent)$")
    text: str = Field(max_length=2000)


class ConverseIn(BaseModel):
    consigne: str = Field(min_length=1, max_length=4000)
    history: List[DialogueTurn] = Field(default_factory=list, max_length=MAX_DIALOGUE_TURNS)


class ConverseGradeIn(BaseModel):
    consigne: str = Field(min_length=1, max_length=4000)
    history: List[DialogueTurn] = Field(default_factory=list, max_length=MAX_DIALOGUE_TURNS)
    # "tache1" (guided interview) and "tache2" (roleplay) are exam tasks and
    # spend a normal AI credit; "free" draws on the small open-ended
    # conversation allowance instead.
    mode: str = Field(default="tache2", pattern="^(tache1|tache2|free)$")


class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    prompt_id: Optional[str] = None
    topic: Optional[str] = Field(default=None, max_length=4000)
    label: Optional[str] = Field(default=None, max_length=300)  # paste / topic pages
    source: Optional[str] = "practice"  # practice | paste
    # 1/2/3 applies that tâche's official TCF word range; None = free writing.
    task_type: Optional[int] = Field(default=None, ge=1, le=3)


class SimulatorTask(BaseModel):
    prompt: str = Field(max_length=4000)
    text: str = Field(max_length=MAX_TEXT_CHARS)


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


class ExamSubmitIn(BaseModel):
    exam_type: str
    # question_id -> chosen option id
    answers: Dict[str, str] = Field(default_factory=dict)
    time_used_seconds: int = 0


class ReviewResult(BaseModel):
    mistake_id: str
    # What the learner picked. The server compares it with the stored
    # correction rather than trusting a client-sent `correct` flag, which made
    # XP, badges and streaks forgeable from the console.
    answer: Optional[str] = Field(default=None, max_length=600)
    # Self-assessment on a flashcard, where there is nothing to compare.
    self_rated_correct: Optional[bool] = None


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


async def seed_writing_themes(db) -> bool:
    """Rebuild the writing themes and their questions when the seed list has
    changed. Returns True if anything was written.

    Themes are content, not learner data, so seeding only on an empty table
    meant an existing database kept the old question bank forever. Nothing
    else references theme_id, so dropping and re-inserting loses no progress.
    Speaking themes are left alone — they have their own seeding block.
    """
    # Filtered in Python rather than SQL so a legacy row with a NULL skill is
    # still treated as a writing theme instead of surviving the rebuild.
    res = await db.execute(select(Theme))
    existing = [t for t in res.scalars().all() if t.skill != "speaking"]
    if sorted(t.name for t in existing) == sorted(n for n, *_ in SEED_THEMES):
        return False

    old_ids = [t.theme_id for t in existing]
    if old_ids:
        await db.execute(sa_delete(ThemeQuestion).where(
            ThemeQuestion.theme_id.in_(old_ids)))
        await db.execute(sa_delete(Theme).where(Theme.theme_id.in_(old_ids)))
        await db.commit()
        log.info("Replaced %d stale writing themes", len(old_ids))

    name_to_id = {}
    for name, emoji, premium, order, desc in SEED_THEMES:
        tid = new_id("theme")
        name_to_id[name] = tid
        db.add(Theme(
            theme_id=tid, name=name, emoji=emoji, description=desc,
            is_premium=premium, skill="writing", sort_order=order,
            is_active=True, created_at=now_utc()))
    await db.commit()

    for theme_name, task_type, prompt_text in SEED_THEME_QUESTIONS:
        tid = name_to_id.get(theme_name)
        if not tid:
            continue
        db.add(ThemeQuestion(
            question_id=new_id("tq"), theme_id=tid, task_type=task_type,
            prompt_text=prompt_text, is_active=True, created_at=now_utc()))
    await db.commit()
    log.info("Seeded %d writing themes and %d theme questions",
             len(SEED_THEMES), len(SEED_THEME_QUESTIONS))
    return True


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

        # Writing themes + theme questions
        await seed_writing_themes(db)

        # Seed SPEAKING themes (skill='speaking') separately so they can be
        # added even if writing themes already exist.
        speaking_count = await db.scalar(
            select(func.count()).select_from(Theme).where(
                Theme.skill == "speaking"))
        if not speaking_count:
            sp_name_to_id = {}
            for name, emoji, premium, order, desc in SEED_SPEAKING_THEMES:
                tid = new_id("theme")
                sp_name_to_id[name] = tid
                db.add(Theme(
                    theme_id=tid, name=name, emoji=emoji, description=desc,
                    is_premium=premium, skill="speaking", sort_order=order,
                    is_active=True, created_at=now_utc()))
            await db.commit()
            for theme_name, task_type, prompt_text in SEED_SPEAKING_QUESTIONS:
                tid = sp_name_to_id.get(theme_name)
                if not tid:
                    continue
                db.add(ThemeQuestion(
                    question_id=new_id("tq"), theme_id=tid, task_type=task_type,
                    prompt_text=prompt_text, is_active=True,
                    created_at=now_utc()))
            await db.commit()
            log.info("Seeded %d speaking themes and %d speaking questions",
                     len(SEED_SPEAKING_THEMES), len(SEED_SPEAKING_QUESTIONS))

        # Seed Task 2 (Exercice en Interaction) speaking questions onto the
        # existing speaking themes. Runs independently so it can be added even
        # if the speaking themes were seeded earlier.
        t2_count = await db.scalar(
            select(func.count()).select_from(ThemeQuestion)
            .join(Theme, Theme.theme_id == ThemeQuestion.theme_id)
            .where(Theme.skill == "speaking", ThemeQuestion.task_type == 2))
        if not t2_count:
            # Map speaking theme names -> id
            res = await db.execute(
                select(Theme).where(Theme.skill == "speaking"))
            sp_themes = {t.name: t.theme_id for t in res.scalars().all()}
            added = 0
            for theme_name, task_type, prompt_text in SEED_SPEAKING_QUESTIONS_T2:
                tid = sp_themes.get(theme_name)
                if not tid:
                    continue
                db.add(ThemeQuestion(
                    question_id=new_id("tq"), theme_id=tid, task_type=task_type,
                    prompt_text=prompt_text, is_active=True,
                    created_at=now_utc()))
                added += 1
            await db.commit()
            log.info("Seeded %d speaking Task 2 questions", added)


# ----------------------------------------------------------------------------
# Lifespan: create tables + migrate + seed
# ----------------------------------------------------------------------------
# create_all() only creates missing tables, so column changes on an existing
# database need an explicit statement. Each entry must be safe to re-run.
MIGRATIONS = [
    # combined_score was declared Integer but always receives a mean like 72.3,
    # which asyncpg rejects for an int4 parameter.
    "ALTER TABLE exam_attempts "
    "ALTER COLUMN combined_score TYPE double precision",
    # Per-user timezone, so streaks and the heatmap roll over at the learner's
    # midnight rather than UTC's.
    "ALTER TABLE users "
    "ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/Toronto'",
    # Awarded bonuses, so a one-off XP reward is not re-granted every session.
    "ALTER TABLE users "
    "ADD COLUMN IF NOT EXISTS awarded_bonuses VARCHAR[] DEFAULT '{}'",
    # Explanation of any TCF cap applied to a graded submission.
    "ALTER TABLE submissions "
    "ADD COLUMN IF NOT EXISTS caps_applied JSONB DEFAULT '[]'::jsonb",
]


async def run_migrations():
    from sqlalchemy import text as sa_text
    for stmt in MIGRATIONS:
        try:
            async with engine.begin() as conn:
                await conn.execute(sa_text(stmt))
        except Exception as exc:  # noqa: BLE001
            log.warning("Migration skipped (%s): %s", stmt[:60], exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_migrations()
    await run_seeds()
    yield
    await engine.dispose()


app = FastAPI(title="monfrançais API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in FRONTEND_URL.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------------
@app.get("/api/")
async def root():
    return {"message": "monfrancais API", "status": "healthy"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/tcf-spec")
async def tcf_spec():
    """The official TCF Canada constraints, so the UI and the grader can never
    drift apart on word ranges or timings."""
    return {
        "writing": {
            "total_seconds": WRITING_TOTAL_SECONDS,
            "tasks": {str(n): s for n, s in WRITING_TASKS.items()},
        },
        "speaking": {"tasks": {str(n): s for n, s in SPEAKING_TASKS.items()}},
        "free_monthly_limit": FREE_MONTHLY_LIMIT,
        "free_model_answer_limit": FREE_MODEL_ANSWER_LIMIT,
        "free_conversation_limit": FREE_CONVERSATION_LIMIT,
        "max_text_chars": MAX_TEXT_CHARS,
    }


@app.get("/api/speaking/diag")
async def speaking_diag(admin: User = Depends(get_admin_user)):
    """Diagnostics for the speaking pipeline: which providers are configured
    and whether their SDKs are importable. Visit /api/speaking/diag to debug.
    Does NOT reveal key values — only whether they are set."""
    def pkg_ok(mod: str) -> bool:
        try:
            __import__(mod)
            return True
        except Exception:
            return False

    return {
        "transcribe_provider": TRANSCRIBE_PROVIDER,
        "speaking_grader_provider": SPEAKING_GRADER_PROVIDER,
        # _key_is_usable, not bool(): a placeholder left in .env is truthy and
        # would otherwise be reported here as a configured key.
        "keys_set": {
            p: _provider_key_present(p)
            for p in ("openai", "anthropic", "gemini", "groq", "deepseek", "assemblyai")
        },
        "packages_installed": {
            "openai": pkg_ok("openai"),
            "anthropic": pkg_ok("anthropic"),
            "google-genai": pkg_ok("google.genai"),
            "python-multipart": pkg_ok("multipart"),
            "requests": pkg_ok("requests"),
        },
        "models": {
            "openai_transcribe": OPENAI_TRANSCRIBE_MODEL,
            "groq_transcribe": GROQ_TRANSCRIBE_MODEL,
            "anthropic": ANTHROPIC_MODEL,
            "groq_grader": GROQ_GRADER_MODEL,
            "deepseek_grader": DEEPSEEK_GRADER_MODEL,
        },
        "ready_for_speaking": (
            (bool(OPENAI_API_KEY) if TRANSCRIBE_PROVIDER == "openai"
             else bool(GROQ_API_KEY) if TRANSCRIBE_PROVIDER == "groq"
             else bool(ASSEMBLYAI_API_KEY) if TRANSCRIBE_PROVIDER == "assemblyai"
             else bool(GEMINI_API_KEY))
            and bool(_grader_backend(SPEAKING_GRADER_PROVIDER)[1])
            and pkg_ok("multipart")
        ),
    }


# ----------------------------------------------------------------------------
# Auth routes
# ----------------------------------------------------------------------------
@app.post("/api/auth/register")
async def register(body: RegisterIn, response: Response,
                   db: AsyncSession = Depends(get_db),
                   _rl=Depends(auth_rate_limit)):
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
                db: AsyncSession = Depends(get_db),
                _rl=Depends(auth_rate_limit)):
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
    _set_access_cookie(response, user_id)
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
STREAM_PING_SECONDS = 10.0
STREAM_MAX_WAIT_SECONDS = 180.0


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.post("/api/analyze/stream")
async def analyze_stream(body: AnalyzeIn,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db),
                         _rl=Depends(ai_rate_limit)):
    # The credit is claimed up front so two parallel tabs cannot both slip past
    # the limit, and refunded below if the text could not actually be graded.
    user = await reserve_credit(db, user)
    source = body.source if body.source in {"practice", "paste"} else "practice"

    async def gen():
        try:
            task = asyncio.create_task(
                analyze_text_with_ai(body.text, body.topic or body.label, db=db,
                                     task_type=body.task_type))
            for stage in STAGES:
                yield _sse("stage", {"stage": stage})
                await asyncio.sleep(0.6)
            # The stages take ~4s; the model can take far longer. Nginx and the
            # GCP load balancer drop an upstream that goes silent (default
            # proxy_read_timeout 60s), which would strand the client on the
            # spinner, so ping while we wait.
            waited = 0.0
            while True:
                try:
                    analysis = await asyncio.wait_for(
                        asyncio.shield(task), timeout=STREAM_PING_SECONDS)
                    break
                except asyncio.TimeoutError:
                    waited += STREAM_PING_SECONDS
                    if waited >= STREAM_MAX_WAIT_SECONDS:
                        task.cancel()
                        log.warning("Grading exceeded %ss - giving up",
                                    STREAM_MAX_WAIT_SECONDS)
                        await refund_credit(db, user)
                        yield _sse("error", {"detail": AI_TIMEOUT_DETAIL,
                                             "status": 504})
                        return
                    yield ": keep-alive\n\n"
            if analysis.get("ai_unavailable"):
                # Don't persist an empty correction or charge for it.
                await refund_credit(db, user)
                yield _sse("error", {"detail": AI_UNAVAILABLE_DETAIL,
                                     "status": 503})
                return
            # persist_submission can take a moment; keep the socket warm so a
            # proxy does not drop a connection whose work is already done.
            save = asyncio.create_task(persist_submission(
                db, user, body.text, body.prompt_id, analysis, source=source,
                consume=False))
            while True:
                try:
                    sub = await asyncio.wait_for(asyncio.shield(save),
                                                 timeout=STREAM_PING_SECONDS)
                    break
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
            yield _sse("complete", sub)
        except HTTPException as exc:
            await refund_credit(db, user)
            yield _sse("error", {"detail": exc.detail,
                                 "status": exc.status_code})
        except Exception:  # noqa: BLE001
            log.exception("Stream analysis failed")
            await refund_credit(db, user)
            yield _sse("error",
                       {"detail": "AI analysis temporarily unavailable"})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.post("/api/submissions")
async def create_submission(body: AnalyzeIn,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db),
                            _rl=Depends(ai_rate_limit)):
    user = await reserve_credit(db, user)
    source = body.source if body.source in {"practice", "paste"} else "practice"
    analysis = await analyze_text_with_ai(body.text, body.topic or body.label,
                                          db=db, task_type=body.task_type)
    if analysis.get("ai_unavailable"):
        await refund_credit(db, user)
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)
    return await persist_submission(db, user, body.text, body.prompt_id,
                                    analysis, source=source, consume=False)


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
                           db: AsyncSession = Depends(get_db),
                           _rl=Depends(ai_rate_limit)):
    user = await reserve_credit(db, user)
    attempt_id = new_id("att")
    tasks_out = {}
    scores = []
    levels = []
    graded_any = False
    for i, task in ((1, body.task1), (2, body.task2), (3, body.task3)):
        if task.text.strip():
            # task_type applies the official word range for this tâche.
            analysis = await analyze_text_with_ai(task.text, task.prompt, db=db,
                                                  task_type=i)
            if analysis.get("ai_unavailable"):
                # The grader is down. Charging for an ungraded exam and telling
                # the candidate they are A1 would be worse than failing loudly.
                await refund_credit(db, user)
                raise HTTPException(status_code=503,
                                    detail=AI_UNAVAILABLE_DETAIL)
            graded_any = True
        else:
            # Left blank: a real examiner scores an unattempted tâche at zero.
            analysis = {**dict(FALLBACK_ANALYSIS), "ai_unavailable": False,
                        "not_attempted": True}
        tasks_out[f"task{i}"] = {
            "prompt": task.prompt, "text": task.text, "analysis": analysis,
            "word_count": len(task.text.split()),
            "word_guide": list(WORD_GUIDE[i]),
        }
        scores.append(analysis["overall_score"])
        levels.append(analysis["tcf_level"])
        await record_mistakes(db, user.user_id, "simulator", attempt_id,
                              analysis)
    if not graded_any:
        await refund_credit(db, user)
        raise HTTPException(
            status_code=400,
            detail="Aucune tâche n'a été rédigée : rien à corriger.")
    combined = round(sum(scores) / 3, 1)
    tcf_level = CEFR_LEVELS[
        min(round(sum(CEFR_LEVELS.index(l) for l in levels) / 3), 5)]
    attempt = ExamAttempt(
        attempt_id=attempt_id, user_id=user.user_id,
        task1=tasks_out["task1"], task2=tasks_out["task2"],
        task3=tasks_out["task3"],
        combined_score=combined, tcf_level=tcf_level,
        time_used_seconds=body.time_used_seconds, created_at=now_utc(),
    )
    db.add(attempt)
    await db.commit()
    # The single credit for the run was already reserved before grading.
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
    """Activity per day, bucketed in the learner's timezone.

    Timestamps are stored in UTC, so an evening session in Montréal would land
    on tomorrow's square if it were bucketed as-is.
    """
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(user.timezone or "America/Toronto")
    except Exception:  # noqa: BLE001
        tz = timezone.utc
    since = now_utc() - timedelta(days=365)
    out: Dict[str, int] = {}

    def bump(d):
        if isinstance(d, datetime):
            local = d.astimezone(tz) if d.tzinfo else d.replace(tzinfo=timezone.utc).astimezone(tz)
            key = local.strftime("%Y-%m-%d")
        else:
            key = str(d)[:10]
        out[key] = out.get(key, 0) + 1

    res = await db.execute(
        select(Submission).where(Submission.user_id == user.user_id,
                                 Submission.created_at >= since))
    for s in res.scalars().all():
        bump(s.created_at)
    res = await db.execute(
        select(ReviewSession).where(ReviewSession.user_id == user.user_id,
                                    ReviewSession.created_at >= since))
    for r in res.scalars().all():
        bump(r.created_at)
    return {"heatmap": out, "timezone": user.timezone or "America/Toronto"}


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
    due = res.scalars().all()
    # Fill in any missing MCQ distractors now, concurrently, rather than one at
    # a time inside the grading request. The static fallback keeps this fast.
    pending = [m for m in due if not (m.distractor or "").strip()
               or m.distractor == "réponse incorrecte"]
    if pending:
        generated = await asyncio.gather(*[
            generate_distractor(m.error_text, m.correction, m.category, db=db)
            for m in pending], return_exceptions=True)
        for m, d in zip(pending, generated):
            if isinstance(d, str) and d.strip():
                m.distractor = d
        await db.commit()
    return {"due": [_row_to_dict(m) for m in due]}


@app.post("/api/review/submit")
async def review_submit(body: ReviewSubmitIn,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    xp = 0
    mastered_now: List[str] = []
    new_badges: List[str] = []
    graded: List[dict] = []
    for r in body.results:
        res = await db.execute(
            select(Mistake).where(Mistake.mistake_id == r.mistake_id,
                                  Mistake.user_id == user.user_id))
        m = res.scalar_one_or_none()
        if not m:
            continue
        # MCQ and sprint send the picked answer, which the server checks against
        # the stored correction. Flashcards have no comparable answer, so the
        # learner's own "I got it" is the only signal available there.
        if r.answer is not None:
            correct = normalize_error_text(r.answer) == normalize_error_text(m.correction)
        else:
            correct = bool(r.self_rated_correct)
        graded.append({"mistake_id": m.mistake_id, "correct": correct})
        if correct:
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
    # Clearing a category pays once. Re-checking every session meant the bonus
    # was granted again on every submission for the rest of the account's life.
    awarded = set(user_doc.awarded_bonuses or [])
    for cat in VALID_CATEGORIES:
        token = f"category_clear:{cat}"
        if token in awarded:
            continue
        remaining = await db.scalar(
            select(func.count()).select_from(Mistake).where(
                Mistake.user_id == user.user_id, Mistake.category == cat,
                Mistake.status != "mastered"))
        had_any = await db.scalar(
            select(func.count()).select_from(Mistake).where(
                Mistake.user_id == user.user_id, Mistake.category == cat))
        if had_any and not remaining:
            xp += XP_CATEGORY_CLEAR_BONUS
            awarded.add(token)
    badges.update(new_badges)
    session = ReviewSession(
        session_id=new_id("rev"), user_id=user.user_id, mode=body.mode,
        mistake_ids=[g["mistake_id"] for g in graded],
        results=graded,
        xp_earned=xp, created_at=now_utc(),
    )
    db.add(session)
    prev_xp = user_doc.xp or 0
    user_doc.xp = prev_xp + xp
    user_doc.badges = sorted(badges)
    user_doc.awarded_bonuses = sorted(awarded)
    await db.commit()
    streak = await update_streak(db, user.user_id)
    return {"session": _row_to_dict(session), "xp_earned": xp,
            "newly_mastered": mastered_now, "badges": new_badges,
            "total_xp": prev_xp + xp,
            "graded": graded,  # so the client can show what it actually got
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
    """Questions without the answer key — grading happens server-side."""
    if exam_type not in {"reading-comprehension", "oral-comprehension"}:
        raise HTTPException(status_code=404, detail="Unknown exam type")
    res = await db.execute(
        select(ExamQuestion).where(ExamQuestion.exam_type == exam_type,
                                   ExamQuestion.is_active == True))  # noqa: E712
    return {"questions": [_row_to_dict(q, drop=("correct_answer",))
                          for q in res.scalars().all()]}


@app.post("/api/exam/submit")
async def exam_submit(body: ExamSubmitIn,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    """Grade a mock exam and record it, so it counts towards streak and history.

    Shipping the answer key to the browser let anyone read it in DevTools, and
    scoring in the client meant a completed mock exam produced no data at all.
    """
    if body.exam_type not in {"reading-comprehension", "oral-comprehension"}:
        raise HTTPException(status_code=404, detail="Unknown exam type")
    res = await db.execute(
        select(ExamQuestion).where(ExamQuestion.exam_type == body.exam_type,
                                   ExamQuestion.is_active == True))  # noqa: E712
    questions = res.scalars().all()
    if not questions:
        raise HTTPException(status_code=503, detail="No questions available")
    key = {q.question_id: q.correct_answer for q in questions}
    corrections = {
        qid: {"correct_answer": answer,
              "picked": body.answers.get(qid),
              "is_correct": body.answers.get(qid) == answer}
        for qid, answer in key.items()
    }
    score = sum(1 for c in corrections.values() if c["is_correct"])
    attempt = MockExamAttempt(
        mock_attempt_id=new_id("mock"), user_id=user.user_id,
        exam_type=body.exam_type, answers=body.answers,
        score=score, total=len(questions),
        time_used_seconds=body.time_used_seconds, created_at=now_utc(),
    )
    db.add(attempt)
    await db.commit()
    streak = await update_streak(db, user.user_id)
    return {"score": score, "total": len(questions),
            "corrections": corrections, "streak": streak}


@app.get("/api/exam/attempts")
async def exam_attempts(user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(MockExamAttempt).where(MockExamAttempt.user_id == user.user_id)
        .order_by(MockExamAttempt.created_at.desc()).limit(50))
    return {"attempts": [_row_to_dict(a) for a in res.scalars().all()]}


# ----------------------------------------------------------------------------
# Speaking (stub)
# ----------------------------------------------------------------------------
@app.post("/api/speaking/analyze")
async def speaking_analyze(question: str = Form(...),
                           audio: UploadFile = File(...),
                           task_type: Optional[int] = Form(None),
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db),
                           _rl=Depends(ai_rate_limit)):
    user = await reserve_credit(db, user)
    audio_bytes = await audio.read()
    if not audio_bytes:
        await refund_credit(db, user)
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        await refund_credit(db, user)
        raise HTTPException(
            status_code=413,
            detail=f"Enregistrement trop volumineux (max {MAX_AUDIO_BYTES // (1024 * 1024)} Mo).")
    if task_type not in (1, 2, 3):
        task_type = None
    transcript = await transcribe_audio(audio_bytes, audio.filename or "audio.webm", db=db)
    analysis = await analyze_speaking_with_ai(transcript, question, db=db,
                                              task_type=task_type)
    if analysis.get("ai_unavailable"):
        await refund_credit(db, user)
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)
    analysis["transcript"] = transcript
    sub = await persist_submission(
        db, user, transcript or "(no speech detected)", None, analysis,
        source="speaking", consume=False)
    analysis["submission_id"] = sub.get("submission_id")
    analysis["streak"] = sub.get("streak")
    return analysis


@app.post("/api/speaking/turn/transcribe")
async def speaking_turn_transcribe(audio: UploadFile = File(...),
                                   user: User = Depends(get_current_user),
                                   db: AsyncSession = Depends(get_db),
                                   _rl=Depends(ai_rate_limit)):
    """Transcribe a single conversational turn. Used by browsers without live
    speech recognition; costs no credit because the graded unit is the whole
    conversation, not the turn."""
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Enregistrement trop volumineux.")
    text = await transcribe_audio(audio_bytes, audio.filename or "turn.webm", db=db)
    return {"text": text}


@app.post("/api/speaking/converse")
async def speaking_converse(body: ConverseIn,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db),
                            _rl=Depends(ai_rate_limit)):
    """One in-character reply from the roleplay partner (Tache 2)."""
    history = [t.model_dump() for t in body.history]
    reply = await interaction_reply(body.consigne, history, db=db)
    if not reply:
        raise HTTPException(status_code=503,
                            detail="L'interlocuteur IA est momentanément indisponible.")
    return {"reply": reply}


@app.post("/api/speaking/converse/grade")
async def speaking_converse_grade(body: ConverseGradeIn,
                                  user: User = Depends(get_current_user),
                                  db: AsyncSession = Depends(get_db),
                                  _rl=Depends(ai_rate_limit)):
    """Grade a finished conversation. Tache 2 spends one AI credit; open-ended
    practice draws on the separate free-conversation allowance."""
    free_mode = body.mode == "free"
    if free_mode:
        user = await enforce_free_conversation_limit(db, user)
    else:
        user = await reserve_credit(db, user)
    history = [t.model_dump() for t in body.history]
    analysis = await grade_interaction(body.consigne, history, db=db)
    if analysis.get("ai_unavailable"):
        if not free_mode:
            await refund_credit(db, user)
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_DETAIL)
    transcript = "\n".join(
        f"{'Candidat' if t['role'] == 'candidate' else 'Agent'} : {t['text']}"
        for t in history if str(t.get("text", "")).strip())
    analysis["transcript"] = transcript
    sub = await persist_submission(
        db, user, transcript or "(no speech detected)", None, analysis,
        source="conversation" if free_mode else "speaking",
        consume=False)  # the credit, if any, was reserved above
    analysis["submission_id"] = sub.get("submission_id")
    analysis["streak"] = sub.get("streak")
    return analysis


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
    """Topic detail. Never spends an unlock — merely opening a page must not
    cost the learner one of their three free model answers. The answer is
    returned only if already unlocked (or premium); otherwise the client shows
    a Reveal button that calls the POST below."""
    res = await db.execute(
        select(RecentTopic).where(RecentTopic.topic_id == topic_id,
                                  RecentTopic.is_active == True))  # noqa: E712
    t_obj = res.scalar_one_or_none()
    if not t_obj:
        raise HTTPException(status_code=404, detail="Topic not found")
    t = _row_to_dict(t_obj)
    model_answer = t.pop("model_answer", "")
    unlocked = user.model_answer_topic_ids or []
    premium = user.subscription_status == "premium"
    t["model_answers_remaining"] = (
        None if premium
        else max(0, FREE_MODEL_ANSWER_LIMIT - len(unlocked)))
    if premium or topic_id in unlocked:
        t["model_answer"] = model_answer
        t["model_answer_locked"] = False
    else:
        t["model_answer_locked"] = True
    return {"topic": t}


@app.post("/api/recent-topics/{topic_id}/reveal")
async def reveal_model_answer(topic_id: str,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """Deliberately spend one of the free model-answer unlocks."""
    res = await db.execute(
        select(RecentTopic).where(RecentTopic.topic_id == topic_id,
                                  RecentTopic.is_active == True))  # noqa: E712
    t_obj = res.scalar_one_or_none()
    if not t_obj:
        raise HTTPException(status_code=404, detail="Topic not found")
    unlocked = list(user.model_answer_topic_ids or [])
    premium = user.subscription_status == "premium"
    if not premium and topic_id not in unlocked:
        if len(unlocked) >= FREE_MODEL_ANSWER_LIMIT:
            raise HTTPException(
                status_code=402,
                detail=(f"Vous avez utilisé vos {FREE_MODEL_ANSWER_LIMIT} corrigés "
                        "modèles gratuits. Passez à la version Pro pour tous les voir."))
        user.model_answer_topic_ids = unlocked + [topic_id]
        user.model_answers_read = (user.model_answers_read or 0) + 1
        await db.commit()
        unlocked = user.model_answer_topic_ids
    return {"model_answer": t_obj.model_answer,
            "model_answers_remaining": (None if premium
                                        else max(0, FREE_MODEL_ANSWER_LIMIT - len(unlocked)))}


# ----------------------------------------------------------------------------
# Admin
# ----------------------------------------------------------------------------
# Allowed providers per task (for validation + to drive the Admin UI dropdowns)
PROVIDER_OPTIONS = {
    "transcribe_provider": ["groq", "assemblyai", "openai", "gemini"],
    "speaking_grader_provider": ["deepseek", "groq", "anthropic", "openai", "gemini"],
    "writing_grader_provider": ["deepseek", "groq", "anthropic", "openai", "gemini"],
}


def _provider_key(provider: str) -> str:
    return {
        "openai": OPENAI_API_KEY,
        "anthropic": ANTHROPIC_API_KEY,
        "gemini": GEMINI_API_KEY,
        "groq": GROQ_API_KEY,
        "deepseek": DEEPSEEK_API_KEY,
        "assemblyai": ASSEMBLYAI_API_KEY,
    }.get(provider, "")


def _provider_key_present(provider: str) -> bool:
    """Must agree with what grading actually accepts.

    This used to be bool(KEY), but a .env left as `GROQ_API_KEY=your_new_key`
    is a non-empty string and therefore truthy, so the Admin panel showed every
    provider as configured while _key_is_usable() rejected the same value and
    grading failed with no visible reason.
    """
    return _key_is_usable(_provider_key(provider))


@app.get("/api/admin/ai-providers")
async def admin_get_ai_providers(admin: User = Depends(get_admin_user),
                                 db: AsyncSession = Depends(get_db)):
    """Return current active provider per task, the available options, and
    which providers have an API key present in the environment."""
    current = {}
    for key in PROVIDER_OPTIONS:
        current[key] = await get_provider(db, key)
    keys_present = {
        p: _provider_key_present(p)
        for opts in PROVIDER_OPTIONS.values() for p in opts
    }
    return {
        "current": current,
        "options": PROVIDER_OPTIONS,
        "keys_present": keys_present,
        "env_defaults": _ENV_PROVIDER_DEFAULTS,
        "models": {p: _grader_backend(p)[2] for opts in PROVIDER_OPTIONS.values()
                   for p in opts if p != "assemblyai"},
        "last_errors": dict(_PROVIDER_LAST_ERROR),
    }


@app.post("/api/admin/ai-providers")
async def admin_set_ai_providers(body: dict,
                                 admin: User = Depends(get_admin_user),
                                 db: AsyncSession = Depends(get_db)):
    """Save the active provider per task. Body: {transcribe_provider, ...}."""
    saved = {}
    for key, allowed in PROVIDER_OPTIONS.items():
        if key not in body:
            continue
        value = str(body[key]).lower().strip()
        if value not in allowed:
            raise HTTPException(status_code=400,
                                detail=f"Invalid {key}: {value}")
        res = await db.execute(select(AppSetting).where(AppSetting.key == key))
        row = res.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
        saved[key] = value
    await db.commit()
    _invalidate_provider_cache()
    return {"saved": saved, "ok": True}


@app.post("/api/admin/ai-providers/test")
async def admin_test_ai_providers(admin: User = Depends(get_admin_user)):
    """Live-check every grading provider and report exactly why each fails.

    Without this, a misconfigured provider is invisible: grading just returns
    503 and the reason is buried in container logs. Each check is one tiny
    completion, so running it costs a fraction of a cent per provider.
    """
    async def check(provider: str) -> dict:
        fn, key, model = _grader_backend(provider)
        if not _key_is_usable(key):
            return {"ok": False, "model": model,
                    "error": "No usable API key — .env is empty or still holds "
                             "a placeholder like 'your_..._key'."}
        loop = asyncio.get_event_loop()
        try:
            out = await asyncio.wait_for(
                loop.run_in_executor(
                    None, fn, model,
                    "Reply with the single word: ok",
                    "Reply with the single word: ok"),
                timeout=30)
            return {"ok": True, "model": model, "sample": (out or "").strip()[:60]}
        except asyncio.TimeoutError:
            return {"ok": False, "model": model,
                    "error": "Timed out after 30s — provider unreachable from this host."}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "model": model,
                    "error": f"{type(exc).__name__}: {_scrub_secrets(exc)}"}

    graders = sorted({p for k, opts in PROVIDER_OPTIONS.items()
                      if k.endswith("grader_provider") for p in opts})
    results = await asyncio.gather(*(check(p) for p in graders))
    out = dict(zip(graders, results))
    for provider, res in out.items():
        if res["ok"]:
            _PROVIDER_LAST_ERROR.pop(provider, None)
        else:
            _PROVIDER_LAST_ERROR[provider] = res["error"]
    return {"results": out}


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
    author: Mapped[str] = mapped_column(String(120), default="monfrancais")
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
    author: Optional[str] = "monfrancais"
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
        author=body.author or "monfrancais",
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
    skill: Mapped[str] = mapped_column(String(16), default="writing", index=True)
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
                      skill: Optional[str] = None,
                      db: AsyncSession = Depends(get_db)):
    """List active themes, with the question count for a given tâche.

    Pass ?task_type=1 (or 2/3) to get the count of questions for that tâche.
    Pass ?skill=writing or ?skill=speaking to filter by skill area.
    Premium themes are returned too, marked is_premium=True so the UI can
    show a Pro badge / lock.

    Themes with no question for the requested tâche are left out. The official
    theme sets differ per tâche (tâche 1 has Ville/Quartier, tâche 2 has Santé
    and Technologie), and a theme card that opens onto an empty question list
    is worse than no card at all.
    """
    stmt = select(Theme).where(Theme.is_active == True)  # noqa: E712
    if skill in ("writing", "speaking"):
        stmt = stmt.where(Theme.skill == skill)
    stmt = stmt.order_by(Theme.sort_order.asc(), Theme.name.asc())
    res = await db.execute(stmt)
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
            if not count:
                continue
            d["question_count"] = count
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
#
# Tâches 1 and 2 each have their own official set of 7 themes, and the two sets
# only partly overlap — Ville/Quartier is a tâche 1 theme, while Santé and
# Technologie belong to tâche 2. This list is their union (9), and /api/themes
# hides the themes that hold no question for the tâche being asked for, so each
# tâche still shows exactly its own 7. Tâche 3 reuses the tâche 1 themes.
SEED_THEMES = [
    ("Logement & Vie quotidienne", "🏠", False, 1,
     "Déménagement, voisinage, colocation et vie quotidienne à la maison."),
    ("Travail & Études", "💼", False, 2,
     "Vie professionnelle, collègues, formation, cours et examens."),
    ("Voyage & Déplacements", "✈️", True, 3,
     "Vacances, transports, séjours et organisation de voyages."),
    ("Vie sociale & Événements", "🎉", True, 4,
     "Invitations, fêtes, célébrations et rencontres entre amis."),
    ("Loisirs, Culture & Sport", "🎭", True, 5,
     "Cinéma, musique, expositions, lecture et activités sportives."),
    ("Achats, Alimentation & Services", "🛒", True, 6,
     "Restaurants, cuisine, achats, commandes et service client."),
    ("Ville, Quartier & Vie locale", "🏙️", True, 7,
     "Quartier, sorties en ville, événements locaux et vie de voisinage."),
    ("Santé, Environnement & Mode de vie", "🌱", True, 8,
     "Habitudes saines, sport, écologie et changements de mode de vie."),
    ("Technologie, Achats & Services", "💻", True, 9,
     "Appareils, applications, achats en ligne et service client."),
]

# Each question: (theme_name, task_type, prompt_text)
SEED_THEME_QUESTIONS = [
    # ------------------------------------------------------------------
    # THÈME 1 — LOGEMENT & VIE QUOTIDIENNE — Tâche 1
    # ------------------------------------------------------------------
    ("Logement & Vie quotidienne", 1,
     "Vous allez déménager dans un nouvel appartement. Écrivez à un ami pour lui demander de l'aide et précisez la date et les tâches à faire. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez trouvé un appartement qui vous plaît beaucoup. Écrivez à votre ami pour lui décrire le logement et expliquer pourquoi vous l'avez choisi. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous cherchez un colocataire. Rédigez une annonce pour présenter votre logement et préciser le type de personne que vous recherchez. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Votre ami cherche un appartement dans votre quartier. Écrivez-lui pour lui recommander un logement et présenter ses avantages. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous venez de déménager dans un nouveau quartier. Écrivez à un ami pour lui décrire votre nouveau quartier et les services disponibles. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous organisez une crémaillère dans votre nouvel appartement. Écrivez à vos amis pour les inviter et donner les informations pratiques. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous devez quitter votre logement plus tôt que prévu. Écrivez à votre propriétaire pour expliquer la situation et proposer une nouvelle date. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez découvert un problème important dans votre appartement. Écrivez à votre propriétaire pour décrire le problème et demander une intervention. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez besoin d'aide pour monter des meubles chez vous. Écrivez à un ami pour lui demander de venir vous aider. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous souhaitez acheter de nouveaux meubles pour votre appartement. Écrivez à un ami pour lui demander conseil et expliquer ce dont vous avez besoin. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez visité une maison que vous envisagez de louer. Écrivez à un proche pour décrire la maison et demander son avis. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous allez accueillir un nouvel étudiant dans votre appartement en colocation. Écrivez-lui pour présenter le logement et expliquer les règles de la maison. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Votre ami vient passer quelques jours chez vous. Écrivez-lui pour lui expliquer où se trouve votre logement et lui donner quelques informations pratiques. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous devez vous absenter pendant quelques jours. Écrivez à votre voisin pour lui demander de surveiller votre appartement. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez acheté un nouvel appareil pour votre maison. Écrivez à votre ami pour lui présenter l'appareil et expliquer pourquoi vous l'avez acheté. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous souhaitez organiser une journée de rangement et de nettoyage chez vous. Écrivez à vos amis pour leur demander de participer. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez récemment changé votre routine quotidienne. Écrivez à un ami pour lui expliquer ce que vous avez changé et pourquoi. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous souhaitez proposer une activité à votre voisin pour mieux faire connaissance. Écrivez-lui un message pour présenter votre idée. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Votre ami souhaite vivre dans votre quartier. Écrivez-lui pour lui présenter les avantages et les inconvénients de ce quartier. (60 à 120 mots)"),
    ("Logement & Vie quotidienne", 1,
     "Vous avez besoin de quelqu'un pour garder votre animal pendant quelques jours. Écrivez à un ami ou à un voisin pour lui demander de l'aide. (60 à 120 mots)"),

    # ------------------------------------------------------------------
    # THÈME 2 — TRAVAIL & ÉTUDES — Tâche 1
    # ------------------------------------------------------------------
    ("Travail & Études", 1,
     "Vous commencez un nouvel emploi. Écrivez à un ami pour lui raconter votre première journée et présenter votre nouveau travail. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous souhaitez organiser un déjeuner avec vos collègues. Écrivez-leur pour proposer une date, un lieu et une organisation. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous devez vous absenter du travail pendant une journée. Écrivez à votre collègue pour l'informer et expliquer comment organiser vos tâches. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous avez changé de poste dans votre entreprise. Écrivez à un ami pour lui présenter vos nouvelles responsabilités. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous souhaitez organiser une activité entre collègues après le travail. Écrivez un message pour proposer une activité et demander qui souhaite participer. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Votre ami cherche un emploi dans votre entreprise. Écrivez-lui pour présenter les possibilités et expliquer comment il peut postuler. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous avez participé à une formation professionnelle intéressante. Écrivez à votre collègue pour raconter votre expérience et lui recommander cette formation. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous avez obtenu une promotion. Écrivez à vos amis pour leur annoncer la nouvelle et proposer de célébrer ensemble. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous souhaitez travailler à distance pendant quelques jours. Écrivez à votre responsable pour expliquer votre situation et proposer une organisation. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous devez remplacer un collègue pendant ses vacances. Écrivez-lui pour lui demander les informations nécessaires concernant son travail. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous commencez un nouveau cours de français. Écrivez à un ami pour présenter le cours, les horaires et votre première impression. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous cherchez un partenaire pour étudier avec vous. Écrivez un message pour présenter vos disponibilités et les matières que vous souhaitez travailler. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous préparez un examen important avec vos amis. Écrivez-leur pour proposer un programme de révision. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous avez découvert une bibliothèque idéale pour étudier. Écrivez à votre ami pour lui présenter le lieu et proposer d'y aller ensemble. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous devez modifier votre horaire de cours. Écrivez à votre professeur pour expliquer votre situation et proposer une solution. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Votre ami souhaite étudier dans votre ville. Écrivez-lui pour présenter les possibilités d'études et les informations importantes. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous organisez un groupe d'étude avant un examen. Écrivez à vos camarades pour proposer une date, un lieu et un programme. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous avez trouvé un professeur particulier excellent. Écrivez à votre ami pour lui présenter ce professeur et expliquer pourquoi vous le recommandez. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Vous avez obtenu de bons résultats à un examen. Écrivez à votre famille pour annoncer la nouvelle et raconter comment vous avez préparé l'examen. (60 à 120 mots)"),
    ("Travail & Études", 1,
     "Votre école ou votre entreprise organise une journée spéciale. Écrivez à vos collègues ou camarades pour présenter le programme et les inviter. (60 à 120 mots)"),

    # ------------------------------------------------------------------
    # THÈME 3 — VOYAGE & DÉPLACEMENTS — Tâche 1
    # ------------------------------------------------------------------
    ("Voyage & Déplacements", 1,
     "Votre ami souhaite visiter votre région. Écrivez-lui pour lui proposer des lieux intéressants à découvrir. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous venez de passer des vacances dans une autre ville. Écrivez à un ami pour raconter votre séjour et recommander quelques endroits. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous préparez un voyage avec des amis. Écrivez-leur pour présenter votre programme, les dates, le transport et les activités prévues. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous avez trouvé un hôtel intéressant pour vos prochaines vacances. Écrivez à vos amis pour leur présenter l'hôtel et proposer de le réserver. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Votre ami souhaite visiter votre pays pour la première fois. Écrivez-lui pour présenter les endroits qu'il devrait découvrir. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous avez effectué un voyage à la montagne. Écrivez à votre ami pour raconter votre séjour et lui conseiller cette destination. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous préparez un week-end à la campagne avec des amis. Écrivez-leur pour organiser le transport, l'hébergement et les activités. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Votre ami vient visiter votre ville. Écrivez-lui pour expliquer comment utiliser les transports publics et lui proposer un programme. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous avez réservé un logement pour un voyage avec vos amis. Écrivez-leur pour présenter le logement et expliquer pourquoi vous l'avez choisi. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez proposer un voyage à vos collègues pendant un long week-end. Écrivez un message pour présenter votre idée. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous avez découvert une magnifique plage pendant vos vacances. Écrivez à votre ami pour raconter votre expérience et lui conseiller cet endroit. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous préparez un voyage en groupe mais vous devez modifier le programme. Écrivez à vos amis pour expliquer le changement. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Votre ami vient vous rendre visite pendant ses vacances. Écrivez-lui pour proposer un programme de trois jours dans votre ville. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous avez participé à une excursion organisée. Écrivez à votre ami pour raconter votre journée et lui conseiller cette activité. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez partir en vacances avec votre famille. Écrivez à un proche pour proposer une destination et expliquer votre choix. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez organiser un trajet en covoiturage avec vos collègues. Écrivez un message pour proposer le trajet et préciser les horaires. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Votre voiture est en panne et vous devez demander de l'aide à un ami. Écrivez-lui pour expliquer la situation et proposer une solution. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez louer une voiture pour un week-end. Écrivez à une agence pour demander des informations sur les prix et les conditions. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous devez modifier l'heure de départ d'un voyage en groupe. Écrivez à vos amis pour expliquer le changement et proposer une nouvelle heure. (60 à 120 mots)"),
    ("Voyage & Déplacements", 1,
     "Vous avez découvert un moyen de transport pratique et économique. Écrivez à votre ami pour lui présenter cette solution et expliquer pourquoi vous la recommandez. (60 à 120 mots)"),

    # ------------------------------------------------------------------
    # THÈME 4 — VIE SOCIALE & ÉVÉNEMENTS — Tâche 1
    # ------------------------------------------------------------------
    ("Vie sociale & Événements", 1,
     "Vous organisez une fête pour votre anniversaire. Écrivez à vos amis pour les inviter et préciser la date, le lieu et l'heure. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Votre meilleur ami fête son anniversaire prochainement. Écrivez à votre groupe d'amis pour proposer un cadeau commun. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous organisez une fête de départ pour un collègue. Écrivez à vos collègues pour les inviter et expliquer l'organisation. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous préparez une fête surprise pour un ami. Écrivez aux participants pour leur donner les informations nécessaires. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une soirée entre anciens camarades de classe. Écrivez un message pour proposer la rencontre. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous organisez une fête de fin d'année avec vos amis. Invitez-les et présentez les activités prévues. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez célébrer une réussite professionnelle avec vos collègues. Écrivez un message pour les inviter à un repas. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Votre ami vient d'avoir un bébé. Écrivez à vos amis pour proposer un cadeau commun et organiser une visite. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous préparez une fête culturelle dans votre quartier. Écrivez un message aux habitants pour les inviter. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une soirée barbecue chez vous. Invitez vos amis et donnez les informations pratiques. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous organisez une soirée jeux de société. Écrivez à vos amis pour les inviter et expliquer ce qu'ils doivent apporter. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous préparez une fête costumée. Écrivez un message aux invités pour présenter le thème, la date et le lieu. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous voulez organiser un pique-nique pour célébrer une occasion spéciale. Invitez vos amis et précisez les détails. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous organisez une cérémonie familiale. Écrivez à un proche pour lui présenter le programme et demander sa présence. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une fête après un examen important. Écrivez à vos amis pour les inviter. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une réunion familiale après plusieurs années sans vous voir. Écrivez à votre famille pour proposer une date et un lieu. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous avez besoin de l'aide de vos amis pour organiser un événement. Écrivez-leur pour expliquer ce dont vous avez besoin. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une journée entre amis sans dépenser beaucoup d'argent. Écrivez-leur pour proposer plusieurs activités gratuites. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Vous avez participé à une activité communautaire. Écrivez à votre ami pour raconter ce que vous avez fait et lui proposer de participer à la prochaine activité. (60 à 120 mots)"),
    ("Vie sociale & Événements", 1,
     "Votre ami vient d'arriver dans votre ville. Écrivez-lui pour lui proposer de passer une journée ensemble et de lui faire découvrir la ville. (60 à 120 mots)"),

    # ------------------------------------------------------------------
    # THÈME 5 — LOISIRS, CULTURE & SPORT — Tâche 1
    # ------------------------------------------------------------------
    ("Loisirs, Culture & Sport", 1,
     "Vous avez vu un film que vous avez beaucoup aimé. Écrivez à votre ami pour lui raconter le film et lui conseiller de le regarder. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez aller à un concert avec vos amis. Écrivez-leur pour proposer le concert et donner les informations pratiques. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez visité une exposition intéressante. Écrivez à votre ami pour raconter votre visite et lui recommander cette exposition. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez organiser une sortie au cinéma. Écrivez à vos amis pour proposer un film, une date et un lieu. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez découvert un nouveau musée dans votre ville. Écrivez à votre ami pour lui présenter le musée. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous cherchez quelqu'un avec qui pratiquer une activité artistique. Rédigez une annonce pour trouver un partenaire. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez assisté à un festival culturel. Écrivez à votre ami pour raconter votre expérience. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez commencer à apprendre à jouer d'un instrument. Écrivez à votre ami pour lui demander des conseils. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez commencé un nouveau loisir. Écrivez à votre ami pour expliquer ce que vous faites et pourquoi cela vous plaît. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez organiser une soirée cinéma chez vous. Invitez vos amis et présentez le programme. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez lu un livre intéressant. Écrivez à votre ami pour lui présenter le livre et expliquer pourquoi vous le recommandez. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez découvert un théâtre dans votre ville. Écrivez à votre ami pour lui proposer d'y aller ensemble. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez commencer à faire du sport dans une salle. Écrivez à un ami pour lui demander des informations sur une salle qu'il connaît. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez commencé une nouvelle activité sportive. Écrivez à votre ami pour lui présenter cette activité et expliquer pourquoi vous l'aimez. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous cherchez un partenaire pour faire du sport régulièrement. Rédigez une annonce en précisant vos activités préférées et vos disponibilités. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous organisez une randonnée avec des amis. Écrivez-leur pour donner les informations sur le parcours et ce qu'ils doivent apporter. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez participé à une compétition sportive. Écrivez à vos amis pour raconter l'événement et annoncer votre résultat. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez découvert une piscine ou un centre sportif intéressant. Écrivez à votre ami pour présenter les installations et les horaires. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez organiser une journée sportive avec vos collègues. Écrivez un message pour proposer les activités. (60 à 120 mots)"),
    ("Loisirs, Culture & Sport", 1,
     "Votre ami veut commencer à courir. Écrivez-lui pour lui donner quelques conseils et lui proposer de courir ensemble. (60 à 120 mots)"),

    # ------------------------------------------------------------------
    # THÈME 6 — ACHATS, ALIMENTATION & SERVICES — Tâche 1
    # ------------------------------------------------------------------
    ("Achats, Alimentation & Services", 1,
     "Vous avez découvert un excellent restaurant dans votre ville. Écrivez à votre ami pour lui présenter le restaurant et lui proposer d'y aller ensemble. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser un dîner avec vos amis. Écrivez-leur pour proposer un restaurant, une date et une heure. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Votre ami vous demande une recette de votre plat préféré. Répondez-lui en expliquant comment vous le préparez. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser un repas chez vous. Invitez vos amis et expliquez ce qu'ils peuvent apporter. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez testé un nouveau restaurant végétarien. Écrivez à votre ami pour raconter votre expérience. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Votre ami vient visiter votre ville et souhaite découvrir la cuisine locale. Écrivez-lui pour recommander quelques spécialités. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous organisez un repas international avec vos collègues. Écrivez un message pour expliquer le principe et demander à chacun d'apporter un plat. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez participé à un cours de cuisine. Écrivez à votre ami pour raconter votre expérience et lui recommander le cours. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser un pique-nique. Écrivez à vos amis pour proposer le menu et répartir les tâches. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez acheté un cadeau pour un ami. Écrivez-lui pour lui présenter le cadeau et expliquer pourquoi vous l'avez choisi. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez vendre un vélo que vous n'utilisez plus. Rédigez une annonce pour décrire le vélo, son état et son prix. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez acheté un appareil électronique qui ne fonctionne pas correctement. Écrivez au magasin pour expliquer le problème. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez commandé un produit sur Internet mais la livraison est en retard. Écrivez au service client pour expliquer la situation. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez reçu un produit différent de celui que vous aviez commandé. Écrivez au vendeur pour demander un échange. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Votre ami souhaite acheter un ordinateur. Écrivez-lui pour lui recommander un modèle et expliquer votre choix. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez louer du matériel pour une fête. Écrivez à une entreprise pour demander les prix et les conditions. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez trouvé une boutique proposant des produits locaux. Écrivez à votre ami pour lui présenter cette boutique. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez acheter un cadeau commun pour un collègue. Écrivez à vos collègues pour proposer votre idée. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous avez eu une très bonne expérience dans un restaurant. Écrivez au restaurant pour remercier l'équipe et expliquer ce que vous avez apprécié. (60 à 120 mots)"),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser une sortie shopping avec vos amis. Écrivez-leur pour proposer un lieu, une date et un programme. (60 à 120 mots)"),

    # ------------------------------------------------------------------
    # THÈME 7 — VILLE, QUARTIER & VIE LOCALE — Tâche 1
    # ------------------------------------------------------------------
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami vient visiter votre ville. Écrivez-lui pour proposer un programme de découverte sur une journée. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un nouveau parc dans votre quartier. Écrivez à votre ami pour lui présenter cet endroit. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre quartier organise une journée communautaire. Écrivez à vos voisins pour les inviter et présenter le programme. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un marché local intéressant. Écrivez à votre ami pour lui proposer de le visiter ensemble. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ville organise un festival. Écrivez à vos amis pour les inviter et présenter les activités prévues. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une visite culturelle dans votre ville. Écrivez à vos amis pour proposer une date et un programme. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami cherche un bon endroit pour passer une journée tranquille. Écrivez-lui pour recommander un lieu dans votre ville. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez proposer une promenade dans votre quartier à un ami qui vient vous rendre visite. Écrivez-lui pour présenter le parcours. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un nouveau centre de loisirs dans votre ville. Écrivez à votre ami pour lui présenter les activités disponibles. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre quartier organise une activité sportive gratuite. Écrivez à vos voisins pour les informer et les inviter. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une journée de nettoyage dans votre quartier. Écrivez à vos voisins pour demander leur participation. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un lieu historique près de chez vous. Écrivez à votre ami pour lui proposer de le visiter. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ville propose une nouvelle activité culturelle. Écrivez à vos amis pour leur présenter l'activité. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une sortie en famille dans votre ville. Écrivez à un proche pour présenter votre programme. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami vous demande quels sont les meilleurs endroits pour sortir dans votre ville. Répondez-lui avec quelques recommandations. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un nouveau café dans votre quartier. Écrivez à votre ami pour lui présenter le café et proposer d'y aller ensemble. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une activité pour rencontrer vos voisins. Écrivez-leur pour présenter votre idée et proposer une date. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez participé à un événement organisé par votre mairie. Écrivez à votre ami pour raconter votre expérience. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez proposer à vos voisins de créer un groupe pour organiser des activités locales. Écrivez un message pour expliquer votre idée. (60 à 120 mots)"),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami souhaite s'installer dans votre ville. Écrivez-lui pour présenter les avantages de votre ville et lui recommander quelques quartiers. (60 à 120 mots)"),

    # ==================================================================
    # TÂCHE 2 — article / blog (120 à 150 mots) — 7 thèmes x 20 sujets
    # ==================================================================

    # --- THÈME 1 — VIE QUOTIDIENNE & LOGEMENT ---
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment déménagé dans un nouveau logement. Racontez cette expérience sur votre blog et expliquez pourquoi vous avez décidé de changer de logement. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez vécu une expérience particulière avec un voisin. Racontez cette situation et expliquez comment vous avez réagi. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment commencé une nouvelle routine quotidienne. Écrivez un article pour expliquer ce qui a changé dans votre vie et comment vous vous sentez maintenant. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez vécu pendant quelques mois dans une autre ville. Racontez votre expérience et expliquez ce que vous avez apprécié dans cette nouvelle façon de vivre. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment aménagé votre appartement. Présentez cette expérience sur votre blog et expliquez comment vous avez organisé votre logement. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez décidé de vivre en colocation. Racontez votre expérience et présentez les avantages et les difficultés de cette situation. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment acheté un objet important pour votre maison. Présentez votre achat et expliquez pourquoi vous en êtes satisfait(e). (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez eu un problème important dans votre logement, mais vous avez finalement trouvé une solution. Racontez cette expérience et expliquez comment vous avez résolu le problème. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez accueilli un ami ou un membre de votre famille chez vous pendant plusieurs jours. Racontez cette expérience et expliquez ce que vous avez fait ensemble. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment changé une habitude dans votre vie quotidienne. Écrivez un article pour expliquer pourquoi vous avez fait ce changement et quels résultats vous avez obtenus. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez passé une journée très différente de vos journées habituelles. Racontez cette journée et expliquez pourquoi elle vous a marqué(e). (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez décidé de mieux organiser votre temps. Racontez comment vous avez changé votre organisation et expliquez si cette nouvelle méthode est efficace. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment découvert un endroit très agréable près de chez vous. Présentez cet endroit sur votre blog et expliquez pourquoi vous le recommandez. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez aidé un voisin ou un proche dans une situation difficile. Racontez cette expérience et expliquez ce que vous en avez pensé. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment fait quelque chose pour améliorer votre maison. Présentez ce que vous avez fait et expliquez pourquoi vous avez pris cette décision. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez passé quelques jours seul(e) chez vous pendant l'absence de votre famille ou de vos colocataires. Racontez cette expérience et donnez vos impressions. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment rencontré une personne qui habite dans votre quartier et qui vous a beaucoup aidé(e). Racontez votre rencontre et expliquez pourquoi vous l'avez appréciée. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez participé à une activité organisée dans votre immeuble ou votre quartier. Racontez votre expérience et expliquez ce que vous avez aimé. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez décidé de simplifier votre vie quotidienne. Écrivez un article pour expliquer les changements que vous avez faits et leurs effets. (120 à 150 mots)"),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment réalisé une tâche que vous trouviez difficile, comme déménager, réorganiser votre logement ou faire des travaux. Racontez votre expérience et expliquez ce que vous avez appris. (120 à 150 mots)"),

    # --- THÈME 2 — TRAVAIL & ÉTUDES ---
    ("Travail & Études", 2,
     "Vous avez commencé un nouvel emploi. Écrivez un article pour raconter votre première semaine et expliquer vos premières impressions. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez participé à une formation professionnelle qui vous a beaucoup appris. Racontez cette expérience et expliquez pourquoi vous la recommandez. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez rencontré une personne intéressante dans votre environnement professionnel. Racontez cette rencontre et expliquez pourquoi elle vous a marqué(e). (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez récemment changé de poste ou de service. Présentez cette expérience et expliquez comment votre vie professionnelle a changé. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez vécu une journée particulièrement difficile au travail, mais vous avez réussi à résoudre les problèmes. Racontez cette journée et expliquez ce que vous avez appris. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez participé à un projet avec plusieurs collègues. Racontez votre expérience et expliquez ce que vous avez apprécié dans le travail en équipe. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez reçu une promotion ou une bonne nouvelle professionnelle. Écrivez à un ami pour raconter ce qui s'est passé et expliquer ce que cela représente pour vous. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez décidé de changer votre façon de travailler. Racontez les changements que vous avez faits et expliquez leurs résultats. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez travaillé à distance pendant plusieurs semaines. Racontez votre expérience et expliquez les avantages et les difficultés que vous avez rencontrés. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez participé à un événement organisé par votre entreprise. Écrivez un article pour raconter cette expérience et donner vos impressions. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez commencé à apprendre une nouvelle langue. Racontez votre expérience et expliquez pourquoi vous avez décidé de l'apprendre. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez récemment commencé une nouvelle formation ou un nouveau cours. Présentez cette expérience et expliquez ce qui vous plaît le plus. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez obtenu de bons résultats à un examen important. Racontez comment vous vous êtes préparé(e) et expliquez ce que vous avez ressenti. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez rencontré un professeur qui a beaucoup influencé votre façon d'apprendre. Racontez cette rencontre et expliquez pourquoi cette personne vous a marqué(e). (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez participé à un projet scolaire ou universitaire avec d'autres étudiants. Racontez votre expérience et expliquez les difficultés que vous avez rencontrées. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez découvert une méthode d'apprentissage particulièrement efficace. Présentez cette méthode et expliquez comment elle vous a aidé(e). (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez dû travailler ou étudier sous pression. Racontez cette expérience et expliquez comment vous avez réussi à gérer la situation. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez changé votre programme d'études ou votre orientation professionnelle. Expliquez ce qui vous a poussé(e) à faire ce choix et racontez votre expérience. (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez aidé un collègue ou un camarade à résoudre un problème. Racontez la situation et expliquez comment vous vous êtes senti(e). (120 à 150 mots)"),
    ("Travail & Études", 2,
     "Vous avez participé à une activité organisée par votre école, votre université ou votre entreprise. Racontez cette expérience et expliquez pourquoi vous l'avez appréciée. (120 à 150 mots)"),

    # --- THÈME 3 — VOYAGES & DÉCOUVERTES ---
    ("Voyage & Déplacements", 2,
     "Vous avez récemment fait un voyage qui vous a beaucoup marqué(e). Racontez cette expérience sur votre blog et expliquez pourquoi vous vous en souvenez encore. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert une ville pour la première fois. Présentez votre voyage et expliquez ce que vous avez particulièrement apprécié. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez passé des vacances dans un endroit différent de vos habitudes. Racontez votre séjour et donnez vos impressions. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez fait un voyage avec des amis. Racontez cette expérience et expliquez ce qui a rendu ce voyage spécial. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez voyagé seul(e) pour la première fois. Racontez votre expérience et expliquez ce que vous avez appris. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert une région de votre pays que vous ne connaissiez pas. Présentez cette découverte et expliquez pourquoi vous la recommandez. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez vécu une aventure inattendue pendant un voyage. Racontez ce qui s'est passé et expliquez comment vous avez réagi. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez rencontré une personne intéressante pendant un voyage. Racontez votre rencontre et expliquez pourquoi elle vous a marqué(e). (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert une tradition culturelle pendant vos vacances. Présentez cette expérience et expliquez ce que vous avez appris. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez essayé une activité inhabituelle pendant un voyage. Racontez votre expérience et expliquez si vous la recommandez. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez passé un week-end dans une petite ville ou à la campagne. Racontez votre séjour et expliquez ce que vous avez apprécié. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez visité un lieu historique ou culturel pendant un voyage. Présentez votre visite et donnez vos impressions. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez eu un problème pendant un voyage, mais vous avez trouvé une solution. Racontez cette expérience et expliquez comment vous avez géré la situation. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert un restaurant ou une spécialité locale pendant un voyage. Racontez votre expérience et expliquez pourquoi vous avez apprécié cette découverte. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez fait un voyage qui ne s'est pas déroulé comme prévu. Racontez ce qui s'est passé et expliquez ce que vous en avez appris. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez participé à une excursion organisée. Racontez votre journée et expliquez si vous recommanderiez cette activité. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez récemment voyagé dans un pays étranger. Écrivez un article pour présenter votre expérience et les principales différences culturelles que vous avez remarquées. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert un endroit naturel exceptionnel pendant vos vacances. Présentez ce lieu et expliquez pourquoi il vous a impressionné(e). (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez organisé vous-même un voyage pour plusieurs personnes. Racontez comment vous avez préparé ce voyage et expliquez comment il s'est déroulé. (120 à 150 mots)"),
    ("Voyage & Déplacements", 2,
     "Vous avez réalisé un voyage dont vous rêviez depuis longtemps. Racontez cette expérience et expliquez si elle a répondu à vos attentes. (120 à 150 mots)"),

    # --- THÈME 4 — VIE SOCIALE & ÉVÉNEMENTS ---
    ("Vie sociale & Événements", 2,
     "Vous avez récemment organisé une fête pour vos amis. Racontez cette expérience et expliquez pourquoi vous avez décidé d'organiser cet événement. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une fête ou à une célébration traditionnelle. Écrivez un article pour raconter votre expérience et présenter ce que vous avez apprécié. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez rencontré une personne intéressante lors d'un événement. Racontez cette rencontre et expliquez pourquoi elle vous a marqué(e). (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à un événement familial important. Racontez ce moment et donnez vos impressions. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une fête surprise pour quelqu'un. Racontez comment vous avez préparé cette surprise et expliquez comment la personne a réagi. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez retrouvé un ancien ami après plusieurs années. Racontez votre rencontre et expliquez ce que vous avez ressenti. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une activité avec vos voisins. Racontez cette expérience et expliquez pourquoi vous aimeriez la refaire. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez récemment fait une nouvelle connaissance qui est devenue importante pour vous. Racontez votre rencontre et expliquez pourquoi. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une sortie avec un groupe d'amis. Racontez cette journée et expliquez ce que vous avez particulièrement apprécié. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une activité bénévole. Écrivez un article pour raconter votre expérience et expliquer pourquoi vous avez décidé d'y participer. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez aidé une personne de votre communauté. Racontez ce qui s'est passé et expliquez comment cette expérience vous a fait réfléchir. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez assisté à une célébration dans un autre pays ou une autre région. Présentez cette expérience et expliquez ce qui vous a surpris(e). (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une réunion entre anciens camarades. Racontez comment la rencontre s'est déroulée et donnez vos impressions. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez reçu une invitation à un événement que vous n'oublierez jamais. Racontez cette expérience et expliquez pourquoi elle était spéciale. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une activité qui vous a permis de rencontrer beaucoup de nouvelles personnes. Racontez votre expérience et expliquez ce que vous en avez pensé. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une activité pour accueillir une nouvelle personne dans votre groupe. Racontez cette expérience et expliquez comment elle s'est déroulée. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une journée communautaire dans votre quartier. Écrivez un article pour raconter les activités et donner votre opinion. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez vécu un moment particulièrement émouvant avec votre famille ou vos amis. Racontez cette expérience et expliquez pourquoi elle vous a marqué(e). (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez fait quelque chose pour remercier une personne qui vous avait beaucoup aidé(e). Racontez ce que vous avez organisé et expliquez votre motivation. (120 à 150 mots)"),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à un événement qui vous a permis de mieux connaître les personnes de votre quartier. Racontez cette expérience et expliquez ce que vous avez découvert. (120 à 150 mots)"),

    # --- THÈME 5 — LOISIRS, CULTURE & SPORT ---
    ("Loisirs, Culture & Sport", 2,
     "Vous avez récemment commencé une nouvelle activité sportive. Racontez votre expérience et expliquez pourquoi vous avez décidé de pratiquer ce sport. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez assisté à un concert exceptionnel. Écrivez un article pour raconter la soirée et donner vos impressions. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez vu un film qui vous a beaucoup marqué(e). Présentez cette expérience et expliquez pourquoi vous recommandez ce film. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez lu un livre qui a changé votre façon de penser. Racontez votre expérience et expliquez ce que vous avez appris. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez visité un musée pour la première fois. Racontez votre visite et expliquez ce que vous avez particulièrement apprécié. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à un festival culturel. Écrivez un article pour présenter l'événement et raconter votre expérience. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez découvert un nouveau loisir grâce à un ami. Racontez comment vous avez commencé et expliquez pourquoi vous continuez à pratiquer cette activité. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à une compétition sportive. Racontez cette expérience et expliquez comment vous vous êtes préparé(e). (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez essayé une activité sportive que vous n'aviez jamais pratiquée auparavant. Racontez votre expérience et donnez vos impressions. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez assisté à un spectacle qui vous a beaucoup plu. Présentez cette expérience et expliquez pourquoi vous la recommandez. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez commencé à jouer d'un instrument de musique. Racontez votre expérience et expliquez ce qui vous plaît dans cette activité. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à un atelier artistique. Racontez votre expérience et expliquez ce que vous avez appris. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez découvert un artiste ou un écrivain que vous ne connaissiez pas. Présentez votre découverte et expliquez pourquoi vous l'appréciez. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez organisé une journée sportive avec des amis. Racontez comment la journée s'est déroulée et expliquez ce que vous avez aimé. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez passé une journée dans un parc d'attractions. Racontez votre expérience et présentez les activités que vous avez préférées. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à une randonnée particulièrement intéressante. Écrivez un article pour raconter cette expérience et expliquer pourquoi vous la recommandez. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez découvert une activité culturelle gratuite dans votre ville. Racontez votre expérience et expliquez pourquoi vous conseillez cette activité. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez repris une activité que vous pratiquiez quand vous étiez plus jeune. Racontez votre expérience et expliquez comment vous vous êtes senti(e). (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez passé une journée sans téléphone ni Internet en pratiquant différentes activités. Racontez votre expérience et donnez votre opinion. (120 à 150 mots)"),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez convaincu un ami de pratiquer une activité avec vous et vous avez finalement beaucoup apprécié cette expérience. Racontez ce qui s'est passé. (120 à 150 mots)"),

    # --- THÈME 6 — SANTÉ, ENVIRONNEMENT & MODE DE VIE ---
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de commencer à faire du sport régulièrement. Racontez votre expérience et expliquez les changements que vous avez remarqués. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez changé votre alimentation pour avoir un mode de vie plus sain. Écrivez un article pour raconter votre expérience. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de réduire votre utilisation de la voiture. Racontez ce changement et expliquez pourquoi vous avez pris cette décision. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de nettoyage d'un parc ou d'une plage. Racontez votre expérience et expliquez pourquoi vous avez apprécié cette activité. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à utiliser davantage les transports publics. Présentez votre expérience et expliquez les avantages que vous avez constatés. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de protection de l'environnement. Racontez ce que vous avez fait et expliquez pourquoi cette expérience vous a marqué(e). (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de réduire votre consommation de plastique. Racontez les changements que vous avez faits et expliquez si cela a été facile. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à pratiquer la méditation ou le yoga. Racontez votre expérience et expliquez les effets que vous avez remarqués. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez adopté une nouvelle habitude pour mieux dormir. Présentez votre expérience et expliquez si cette habitude vous aide. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une journée sans voiture organisée dans votre ville. Racontez cette expérience et donnez votre opinion. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez récemment passé plusieurs jours dans la nature. Écrivez un article pour raconter votre expérience et expliquer comment vous vous êtes senti(e). (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de passer moins de temps devant les écrans. Racontez votre expérience et expliquez ce que vous avez changé dans votre quotidien. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à acheter davantage de produits locaux. Présentez cette nouvelle habitude et expliquez pourquoi vous avez fait ce choix. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de sensibilisation à l'environnement. Racontez ce que vous avez découvert et expliquez ce qui vous a surpris(e). (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez réussi à changer une mauvaise habitude. Racontez votre expérience et expliquez les difficultés que vous avez rencontrées. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à marcher davantage au lieu d'utiliser les transports. Racontez cette expérience et expliquez les effets sur votre quotidien. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de jardinage ou de plantation d'arbres. Racontez cette expérience et expliquez pourquoi vous l'avez appréciée. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez passé une semaine en suivant un mode de vie plus sain. Écrivez un article pour raconter cette expérience et donner vos impressions. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez découvert une activité qui vous aide à réduire votre stress. Présentez cette activité et expliquez pourquoi vous la recommandez. (120 à 150 mots)"),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à un projet visant à améliorer votre environnement local. Racontez votre expérience et expliquez ce que vous avez appris. (120 à 150 mots)"),

    # --- THÈME 7 — TECHNOLOGIE, ACHATS & SERVICES ---
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un appareil électronique qui vous facilite beaucoup la vie. Présentez votre achat et expliquez pourquoi vous en êtes satisfait(e). (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert une application très utile. Écrivez un article pour présenter cette application et expliquer comment elle vous aide. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un produit sur Internet pour la première fois. Racontez votre expérience et expliquez ce que vous en avez pensé. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez eu une mauvaise expérience avec un service client. Racontez ce qui s'est passé et expliquez comment le problème a été résolu. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert un site Internet qui vous aide dans vos études ou votre travail. Présentez votre découverte et expliquez pourquoi vous le recommandez. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un cadeau en ligne pour quelqu'un. Racontez votre expérience et expliquez pourquoi vous avez choisi ce cadeau. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez utilisé une nouvelle application pour organiser votre quotidien. Racontez votre expérience et expliquez pourquoi vous continuez à l'utiliser. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez eu un problème avec une commande en ligne. Racontez ce qui s'est passé et expliquez comment vous avez trouvé une solution. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert un nouveau moyen de paiement. Présentez votre expérience et expliquez pourquoi vous trouvez ce système pratique. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez utilisé un service de livraison particulièrement efficace. Écrivez un article pour raconter votre expérience et expliquer pourquoi vous le recommandez. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un produit après avoir lu plusieurs avis sur Internet. Racontez votre expérience et expliquez si vous êtes satisfait(e) de votre choix. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez vendu un objet que vous n'utilisiez plus sur Internet. Racontez cette expérience et expliquez comment la vente s'est déroulée. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez suivi un cours en ligne pour la première fois. Racontez votre expérience et expliquez ce que vous avez apprécié ou moins apprécié. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez participé à un événement organisé entièrement en ligne. Présentez cette expérience et donnez vos impressions. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert un outil numérique qui vous permet de gagner du temps. Écrivez un article pour présenter cet outil et expliquer comment vous l'utilisez. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez décidé de réduire votre utilisation des réseaux sociaux. Racontez votre expérience et expliquez les changements que vous avez remarqués. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez recommandé un produit ou un service à un ami, mais son expérience a été différente de la vôtre. Racontez cette situation et expliquez ce que vous en pensez. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez récemment changé de téléphone ou d'ordinateur. Présentez votre expérience et expliquez pourquoi vous avez choisi ce nouvel appareil. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez utilisé une plateforme en ligne pour réserver un voyage, un logement ou une activité. Racontez votre expérience et expliquez si vous la recommandez. (120 à 150 mots)"),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert une nouvelle technologie qui a changé votre façon de travailler ou d'étudier. Racontez votre expérience et expliquez les avantages que vous avez constatés. (120 à 150 mots)"),

    # ------------------------------------------------------------------
    # TÂCHE 3 — texte argumentatif (120 à 180 mots)
    # ------------------------------------------------------------------
    ("Logement & Vie quotidienne", 3,
     "« Il vaut mieux louer son logement que de l'acheter. » Comparez les deux points de vue et donnez votre opinion. (120 à 180 mots)"),
    ("Travail & Études", 3,
     "« Le télétravail devrait devenir la norme. » Comparez les avantages du bureau et du télétravail, puis donnez votre opinion. (120 à 180 mots)"),
    ("Voyage & Déplacements", 3,
     "« Voyager seul est plus enrichissant que voyager en groupe. » Comparez les deux façons de voyager et donnez votre avis. (120 à 180 mots)"),
    ("Voyage & Déplacements", 3,
     "« Le tourisme de masse nuit aux destinations. » Présentez les deux points de vue et défendez le vôtre. (120 à 180 mots)"),
    ("Vie sociale & Événements", 3,
     "« Les réseaux sociaux rapprochent les gens. » D'autres affirment qu'ils nous isolent. Présentez les deux positions et défendez la vôtre. (120 à 180 mots)"),
    ("Loisirs, Culture & Sport", 3,
     "« Les livres papier sont meilleurs que les livres numériques. » Comparez les deux et défendez votre position. (120 à 180 mots)"),
    ("Loisirs, Culture & Sport", 3,
     "« La technologie nuit à notre santé. » Présentez les deux points de vue et défendez votre position. (120 à 180 mots)"),
    ("Achats, Alimentation & Services", 3,
     "« Il vaut mieux acheter dans les commerces de quartier que dans les grandes surfaces. » Comparez les deux points de vue et donnez votre opinion. (120 à 180 mots)"),
    ("Ville, Quartier & Vie locale", 3,
     "« Vivre en ville est préférable à vivre à la campagne. » Présentez les avantages des deux modes de vie et défendez votre position. (120 à 180 mots)"),
    ("Ville, Quartier & Vie locale", 3,
     "« Les individus, et non les gouvernements, sont responsables de la protection de l'environnement. » Comparez les deux points de vue et donnez votre avis. (120 à 180 mots)"),
]

# ----------------------------------------------------------------------------
# SPEAKING THEMES (skill='speaking'), all topics under Tâche 3 (task_type=3).
# First 2 themes free, remaining 8 Pro. 10 themes x 15 topics = 150 questions.
# ----------------------------------------------------------------------------
# Each theme: (name, emoji, is_premium, sort_order, description)
SEED_SPEAKING_THEMES = [
    ('Immigration et Intégration', '🌍', False, 101, "15 sujets d'expression orale — Immigration et Intégration."),
    ('Monde du Travail et Économie', '💼', False, 102, "15 sujets d'expression orale — Monde du Travail et Économie."),
    ('Environnement et Transition Écologique', '♻️', True, 103, "15 sujets d'expression orale — Environnement et Transition Écologique."),
    ('Éducation et Jeunesse', '🎓', True, 104, "15 sujets d'expression orale — Éducation et Jeunesse."),
    ('Nouvelles Technologies et Réseaux Sociaux', '📱', True, 105, "15 sujets d'expression orale — Nouvelles Technologies et Réseaux Sociaux."),
    ('Voyages, Tourisme et Transport', '🧳', True, 106, "15 sujets d'expression orale — Voyages, Tourisme et Transport."),
    ('Société et Consommation', '🛒', True, 107, "15 sujets d'expression orale — Société et Consommation."),
    ('Culture, Langue et Patrimoine', '🎭', True, 108, "15 sujets d'expression orale — Culture, Langue et Patrimoine."),
    ('Santé, Sport et Bien-être', '🩺', True, 109, "15 sujets d'expression orale — Santé, Sport et Bien-être."),
    ('Vie Sociale, Famille et Démographie', '👨\u200d👩\u200d👧', True, 110, "15 sujets d'expression orale — Vie Sociale, Famille et Démographie."),
]

# Each question: (theme_name, task_type, prompt_text) — all task_type=3
SEED_SPEAKING_QUESTIONS = [
    # --- Immigration et Intégration ---
    ('Immigration et Intégration', 3, 'Partir s’installer à l’étranger est plus simple quand on est jeune.'),
    ('Immigration et Intégration', 3, "L'obligation d'atteindre un niveau linguistique avant l'obtention de la résidence permanente."),
    ('Immigration et Intégration', 3, 'Écrire à un ami pour décrire vos premières impressions après votre arrivée au Canada.'),
    ('Immigration et Intégration', 3, 'Le concept du multiculturalisme favorise-t-il la cohésion ou la division sociale ?'),
    ('Immigration et Intégration', 3, 'Les défis psychologiques du "choc culturel" et l\'isolement des nouveaux arrivants.'),
    ('Immigration et Intégration', 3, 'Demander des conseils par courriel concernant la recherche de logement à un expatrié installé.'),
    ('Immigration et Intégration', 3, 'La reconnaissance des diplômes étrangers par les ordres professionnels locaux.'),
    ('Immigration et Intégration', 3, "Les programmes de parrainage communautaire pour aider l'intégration des réfugiés."),
    ('Immigration et Intégration', 3, 'Faut-il vivre dans un pays pour en comprendre réellement la culture ?'),
    ('Immigration et Intégration', 3, "L'impact de l'immigration économique sur le dynamisme des petites municipalités."),
    ('Immigration et Intégration', 3, 'Raconter votre première démarche administrative réussie dans votre nouveau pays.'),
    ('Immigration et Intégration', 3, 'Le vote aux élections locales devrait-il être accordé aux résidents permanents non-citoyens ?'),
    ('Immigration et Intégration', 3, "Les cours de citoyenneté obligatoire favorisent-ils l'assimilation forcée ou l'intégration ?"),
    ('Immigration et Intégration', 3, "L'apprentissage de l'histoire locale doit-il être un prérequis à l'immigration ?"),
    ('Immigration et Intégration', 3, 'Écrire un message pour inviter un collègue canadien à célébrer une fête nationale de votre pays d’origine.'),
    # --- Monde du Travail et Économie ---
    ('Monde du Travail et Économie', 3, 'Le télétravail obligatoire : symbole de liberté ou facteur d’isolement social ?'),
    ('Monde du Travail et Économie', 3, 'Annoncer à un ancien collègue votre récente promotion et décrire vos nouvelles tâches.'),
    ('Monde du Travail et Économie', 3, "L'automatisation et l'intelligence artificielle vont-elles détruire plus d'emplois qu'elles n'en créent ?"),
    ('Monde du Travail et Économie', 3, 'La semaine de travail de quatre jours augmente-t-elle la productivité des entreprises ?'),
    ('Monde du Travail et Économie', 3, 'Rédiger une lettre ouverte pour dénoncer le manque de flexibilité des horaires de bureau.'),
    ('Monde du Travail et Économie', 3, "La parité homme-femme obligatoire dans les conseils d'administration des grandes entreprises."),
    ('Monde du Travail et Économie', 3, "Demander des informations détaillées sur les conditions de stage au sein d'une start-up."),
    ('Monde du Travail et Économie', 3, "L'entrepreneuriat chez les jeunes : une solution viable face au chômage ou un risque excessif ?"),
    ('Monde du Travail et Économie', 3, 'L\'importance grandissante des "soft skills" (compétences douces) face aux compétences techniques.'),
    ('Monde du Travail et Économie', 3, 'Le concept du "revenu universel de base" pour pallier la précarité de l\'emploi moderne.'),
    ('Monde du Travail et Économie', 3, "Raconter un conflit marquant survenu au travail et la façon dont vous l'avez résolu."),
    ('Monde du Travail et Économie', 3, "Faut-il interdire l'accès aux courriels professionnels après les heures de bureau standard ?"),
    ('Monde du Travail et Économie', 3, "Le salaire des dirigeants d'entreprises devrait-il être plafonné par des lois strictes ?"),
    ('Monde du Travail et Économie', 3, 'Les espaces de coworking favorisent-ils la créativité ou perturbent-ils la concentration ?'),
    ('Monde du Travail et Économie', 3, 'Écrire une lettre de recommandation pour un collègue qui postule à un nouvel emploi.'),
    # --- Environnement et Transition Écologique ---
    ('Environnement et Transition Écologique', 3, "L'interdiction totale des véhicules thermiques dans les centres-villes d'ici cinq ans."),
    ('Environnement et Transition Écologique', 3, "Écrire un article pour donner votre opinion sur l'augmentation des espaces verts urbains."),
    ('Environnement et Transition Écologique', 3, 'La responsabilité de la crise climatique repose-t-elle sur le consommateur ou sur les industries ?'),
    ('Environnement et Transition Écologique', 3, 'Faut-il taxer lourdement les produits importés pour encourager massivement la consommation locale ?'),
    ('Environnement et Transition Écologique', 3, "Raconter votre participation à une journée de nettoyage bénévole d'une plage ou d'un parc."),
    ('Environnement et Transition Écologique', 3, "L'impact environnemental du secteur du numérique et le stockage massif des données (Cloud)."),
    ('Environnement et Transition Écologique', 3, 'Demander des détails à votre municipalité concernant la mise en place du compostage obligatoire.'),
    ('Environnement et Transition Écologique', 3, "Le développement de l'énergie nucléaire reste-t-il indispensable pour atteindre la neutralité carbone ?"),
    ('Environnement et Transition Écologique', 3, "L'introduction de quotas de voyage en avion par citoyen pour limiter l'empreinte carbone collective."),
    ('Environnement et Transition Écologique', 3, 'Le suremballage plastique dans la grande distribution : faut-il passer aux sanctions financières ?'),
    ('Environnement et Transition Écologique', 3, 'Proposer par écrit un projet de covoiturage à l’échelle de votre quartier résidentiel.'),
    ('Environnement et Transition Écologique', 3, "L'écotourisme est-il une véritable alternative durable ou une simple stratégie de communication ?"),
    ('Environnement et Transition Écologique', 3, "L'interdiction de la publicité pour les produits à forte empreinte écologique (comme les SUV)."),
    ('Environnement et Transition Écologique', 3, "L'éducation environnementale devrait-elle devenir une matière principale dès l'école primaire ?"),
    ('Environnement et Transition Écologique', 3, 'Écrire à un ami pour lui décrire votre transition vers un mode de vie zéro déchet.'),
    # --- Éducation et Jeunesse ---
    ('Éducation et Jeunesse', 3, "Le port de l'uniforme scolaire obligatoire favorise-t-il l'égalité entre les élèves ?"),
    ('Éducation et Jeunesse', 3, "L'apprentissage d'un instrument de musique devrait-il être imposé à tous les enfants."),
    ('Éducation et Jeunesse', 3, "Écrire à un enseignant pour le remercier de l'impact positif qu'il a eu sur votre parcours."),
    ('Éducation et Jeunesse', 3, "L'interdiction stricte des smartphones au sein de tous les établissements scolaires."),
    ('Éducation et Jeunesse', 3, "Les cours magistraux à l'université doivent-ils être définitivement remplacés par des formations en ligne ?"),
    ('Éducation et Jeunesse', 3, "Donner de l'argent de poche aux adolescents est un mauvais service que nous leur rendons."),
    ('Éducation et Jeunesse', 3, "Demander des précisions sur le programme d'une formation linguistique intensive."),
    ('Éducation et Jeunesse', 3, "L'abaissement du droit de vote des citoyens à l'âge de seize ans."),
    ('Éducation et Jeunesse', 3, 'Le système de notation traditionnel par notes chiffrées nuit-il à la motivation des élèves ?'),
    ('Éducation et Jeunesse', 3, "Les années sabbatiques avant l'entrée à l'université : perte de temps ou gain d'autonomie ?"),
    ('Éducation et Jeunesse', 3, 'Raconter un souvenir marquant lié à un projet de groupe durant vos études secondaires.'),
    ('Éducation et Jeunesse', 3, "L'enseignement de l'informatique et du code doit-il remplacer les cours de dessin ou d'arts plastiques ?"),
    ('Éducation et Jeunesse', 3, 'Les devoirs à la maison devraient-ils être interdits pour préserver le bien-être familial ?'),
    ('Éducation et Jeunesse', 3, "Le financement public des universités doit-il dépendre du taux d'insertion professionnelle de leurs diplômés ?"),
    ('Éducation et Jeunesse', 3, "Inviter des parents d'élèves par message à organiser la kermesse de fin d'année scolaire."),
    # --- Nouvelles Technologies et Réseaux Sociaux ---
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Les sites de rencontres nous éloignent-ils plus qu’ils ne nous rapprochent de la réalité ?'),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "Raconter une expérience où vous avez décidé de faire une détox numérique complète d'une semaine."),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "L'anonymat sur Internet devrait-il être supprimé pour lutter contre la cybercriminalité ?"),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Les réseaux sociaux représentent-ils un grave danger pour la santé mentale des jeunes ?'),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Écrire un message à un ami pour lui conseiller une application mobile qui a changé votre quotidien.'),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Les livres électroniques vont-ils faire disparaître définitivement le format papier ?'),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "Demander des informations à un service client à la suite d'une panne prolongée de votre connexion internet."),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "L'intelligence artificielle générative menace-t-elle l'authenticité des créations artistiques ?"),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "La surveillance de l'espace public par reconnaissance faciale est-elle une atteinte intolérable aux libertés ?"),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "Le télétravail dans le métavers : l'avenir des réunions professionnelles à distance."),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "Rédiger un court message d'annonce pour vendre votre ordinateur portable d'occasion."),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Les algorithmes de recommandation limitent-ils notre ouverture culturelle et notre curiosité ?'),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, "L'impact de la dépendance aux écrans sur les relations de communication intra-familiales."),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Faut-il punir légalement les influenceurs qui partagent de fausses informations à leur communauté ?'),
    ('Nouvelles Technologies et Réseaux Sociaux', 3, 'Écrire un courriel de réclamation suite au piratage de vos données personnelles sur un site marchand.'),
    # --- Voyages, Tourisme et Transport ---
    ('Voyages, Tourisme et Transport', 3, "Les voyages organisés sont-ils incompatibles avec la découverte réelle d'un pays ?"),
    ('Voyages, Tourisme et Transport', 3, 'Écrire à une agence de voyages pour demander des détails sur les excursions incluses dans un forfait.'),
    ('Voyages, Tourisme et Transport', 3, 'Le surtourisme dégrade-t-il irréversiblement les sites classés au patrimoine mondial ?'),
    ('Voyages, Tourisme et Transport', 3, 'Les transports en commun urbains devraient-ils devenir totalement gratuits pour les résidents ?'),
    ('Voyages, Tourisme et Transport', 3, "Décrire vos impressions négatives sur un séjour à l'hôtel dans un avis publié sur un forum."),
    ('Voyages, Tourisme et Transport', 3, "Voyager seul est-ce le meilleur moyen d'apprendre à mieux se connaître ?"),
    ('Voyages, Tourisme et Transport', 3, 'Inviter un ami par courriel à partir en voyage à vélo à travers la campagne pendant le week-end.'),
    ('Voyages, Tourisme et Transport', 3, "L'essor des plateformes de location de courte durée nuit-il à l'accès au logement pour les locaux ?"),
    ('Voyages, Tourisme et Transport', 3, "Faut-il interdire l'usage des vols courts internes lorsqu'une alternative en train rapide existe ?"),
    ('Voyages, Tourisme et Transport', 3, 'Le concept du "Slow Travel" (voyager lentement) face à la consommation frénétique de destinations.'),
    ('Voyages, Tourisme et Transport', 3, "Raconter un imprévu survenu lors d'un voyage et comment vous avez réussi à gérer la situation."),
    ('Voyages, Tourisme et Transport', 3, "Est-il indispensable de maîtriser les bases de la langue du pays avant de s'y rendre ?"),
    ('Voyages, Tourisme et Transport', 3, 'Le développement du tourisme spatial est-il une aberration éthique et environnementale ?'),
    ('Voyages, Tourisme et Transport', 3, 'Le passeport numérique universel facilitera-t-il ou segmentera-t-il davantage les flux migratoires ?'),
    ('Voyages, Tourisme et Transport', 3, 'Demander des conseils à un ami concernant les meilleurs quartiers à visiter à Montréal.'),
    # --- Société et Consommation ---
    ('Société et Consommation', 3, 'La société de consommation moderne transforme-t-elle les citoyens en simples acheteurs passifs ?'),
    ('Société et Consommation', 3, "Écrire un message pour organiser un cadeau commun pour le départ à la retraite d'un collègue."),
    ('Société et Consommation', 3, 'Le boycott des marques non éthiques est-il une arme politique efficace pour le citoyen ?'),
    ('Société et Consommation', 3, 'La publicité ciblée en ligne constitue-t-elle une violation agressive de notre vie privée ?'),
    ('Société et Consommation', 3, "Raconter votre dernière expérience d'achat dans une friperie ou un marché de seconde main."),
    ('Société et Consommation', 3, 'Les commerces de proximité traditionnels peuvent-ils survivre face aux géants du e-commerce ?'),
    ('Société et Consommation', 3, "Rédiger une lettre de réclamation à la suite d'une facturation abusive d'un opérateur téléphonique."),
    ('Société et Consommation', 3, 'Le véganisme : choix de consommation éthique nécessaire ou tendance alimentaire marginale ?'),
    ('Société et Consommation', 3, 'La généralisation des caisses automatiques dans les supermarchés détruit-elle le lien social de proximité ?'),
    ('Société et Consommation', 3, "Le minimalisme matériel permet-il d'atteindre une forme de liberté et de bonheur réel ?"),
    ('Société et Consommation', 3, 'Demander des détails par écrit sur les conditions d’abonnement annuel d’une salle de sport.'),
    ('Société et Consommation', 3, "L'obsolescence programmée des appareils électroniques devrait-elle être sévèrement punie pénalement ?"),
    ('Société et Consommation', 3, "L'affichage obligatoire de l'indice de réparabilité sur tous les objets de consommation courante."),
    ('Société et Consommation', 3, "L'influence des tendances de mode éphémères (Fast Fashion) sur les comportements des adolescents."),
    ('Société et Consommation', 3, 'Écrire à un ami pour lui prêter votre logement durant ses vacances et lui lister les règles de la maison.'),
    # --- Culture, Langue et Patrimoine ---
    ('Culture, Langue et Patrimoine', 3, "La culture et l'accès aux musées nationaux devraient être complètement gratuits pour tous."),
    ('Culture, Langue et Patrimoine', 3, 'Écrire un courriel pour confirmer votre présence à un mariage et demander des détails sur la liste de cadeaux.'),
    ('Culture, Langue et Patrimoine', 3, "L'omniprésence de la langue anglaise menace-t-elle la diversité culturelle et linguistique mondiale ?"),
    ('Culture, Langue et Patrimoine', 3, "Les œuvres d'art acquises durant la colonisation doivent-elles être restituées à leur pays d'origine ?"),
    ('Culture, Langue et Patrimoine', 3, 'Raconter vos impressions après avoir assisté à un festival de cinéma indépendant ou une pièce de théâtre.'),
    ('Culture, Langue et Patrimoine', 3, 'Le street-art (art urbain) doit-il être considéré comme un art majeur ou une dégradation publique ?'),
    ('Culture, Langue et Patrimoine', 3, "Proposer une sortie culturelle par message à un groupe d'amis pour visiter une exposition d'art contemporain."),
    ('Culture, Langue et Patrimoine', 3, 'La numérisation complète du patrimoine mondial va-t-elle tuer le désir de visiter les sites physiques ?'),
    ('Culture, Langue et Patrimoine', 3, "La gastronomie locale fait-elle partie intégrante de l'identité nationale d'un peuple ?"),
    ('Culture, Langue et Patrimoine', 3, 'Les subventions publiques accordées aux artistes indépendants sont-elles un investissement nécessaire ?'),
    ('Culture, Langue et Patrimoine', 3, 'Demander par écrit des renseignements sur les tarifs de groupe pour un festival de musique d’été.'),
    ('Culture, Langue et Patrimoine', 3, "Le développement de la lecture chez les jeunes passe-t-il par l'acceptation des bandes dessinées et mangas à l'école ?"),
    ('Culture, Langue et Patrimoine', 3, "Les monuments historiques doivent-ils être préservés à tout prix, même s'ils bloquent le développement urbain ?"),
    ('Culture, Langue et Patrimoine', 3, "L'adaptation des œuvres littéraires classiques au cinéma dénature-t-elle le message de l'auteur ?"),
    ('Culture, Langue et Patrimoine', 3, "Écrire à un correspondant pour lui faire part d'une tradition culturelle unique propre à votre région d'origine."),
    # --- Santé, Sport et Bien-être ---
    ('Santé, Sport et Bien-être', 3, 'Faut-il arrêter de prescrire des médicaments de façon systématique pour se tourner vers des alternatives ?'),
    ('Santé, Sport et Bien-être', 3, "Rédiger un message à l'attention de vos collègues pour proposer des séances hebdomadaires de yoga au bureau."),
    ('Santé, Sport et Bien-être', 3, "Les sportifs professionnels de haut niveau gagnent-ils trop d'argent par rapport à leur utilité sociale ?"),
    ('Santé, Sport et Bien-être', 3, "La taxe nutritionnelle sur la restauration rapide (Fast-food) est-elle efficace pour lutter contre l'obésité ?"),
    ('Santé, Sport et Bien-être', 3, "Raconter le déroulement d'une course à pied caritative à laquelle vous avez participé activement."),
    ('Santé, Sport et Bien-être', 3, 'La chirurgie esthétique de confort devrait-elle être interdite ou strictement encadrée chez les mineurs ?'),
    ('Santé, Sport et Bien-être', 3, "Demander des informations détaillées concernant les horaires d'ouverture d'un centre de rééducation médicale."),
    ('Santé, Sport et Bien-être', 3, "Les thérapies basées sur l'intelligence artificielle peuvent-elles remplacer un suivi psychologique humain ?"),
    ('Santé, Sport et Bien-être', 3, "L'introduction d'heures de sport quotidiennes obligatoires dans l'ensemble des universités et entreprises."),
    ('Santé, Sport et Bien-être', 3, "Le burn-out (épuisement professionnel) doit-il être reconnu d'office comme une maladie professionnelle ?"),
    ('Santé, Sport et Bien-être', 3, "Rédiger un message pour chercher un partenaire de sport pour vous entraîner en vue d'un marathon."),
    ('Santé, Sport et Bien-être', 3, "La légalisation de l'usage récréatif du cannabis : avancée en matière de santé publique ou dérive sociale ?"),
    ('Santé, Sport et Bien-être', 3, "L'impact du manque de sommeil chronique sur les performances et la santé globale de la population."),
    ('Santé, Sport et Bien-être', 3, 'Le système de santé universel gratuit pour tous est-il un modèle viable économiquement à long terme ?'),
    ('Santé, Sport et Bien-être', 3, "Écrire un courriel à un proche pour l'encourager à modifier ses habitudes de vie pour préserver sa santé."),
    # --- Vie Sociale, Famille et Démographie ---
    ('Vie Sociale, Famille et Démographie', 3, 'Envoyer les personnes âgées en maison de retraite est-ce un drame ou une nécessité moderne ?'),
    ('Vie Sociale, Famille et Démographie', 3, "Rédiger une invitation informelle à vos voisins pour un repas de quartier partagé dans la cour de l'immeuble."),
    ('Vie Sociale, Famille et Démographie', 3, 'Les personnes âgées de plus de 70 ans devraient-elles obligatoirement repasser leur permis de conduire ?'),
    ('Vie Sociale, Famille et Démographie', 3, 'Le modèle de la famille nucléaire traditionnelle est-il devenu obsolète dans nos sociétés contemporaines ?'),
    ('Vie Sociale, Famille et Démographie', 3, 'Raconter un événement familial marquant et décrire les émotions vécues durant cette journée.'),
    ('Vie Sociale, Famille et Démographie', 3, "L'isolement social des jeunes adultes dans les grandes métropoles urbaines hyperconnectées."),
    ('Vie Sociale, Famille et Démographie', 3, "Demander des conseils à un ami concernant le choix d'un cadeau pour une fête de crémaillère."),
    ('Vie Sociale, Famille et Démographie', 3, 'Les congés parentaux payés devraient-ils être répartis de manière strictement égale entre les deux parents ?'),
    ('Vie Sociale, Famille et Démographie', 3, 'Le vieillissement accéléré de la population va-t-il paralyser la croissance économique mondiale ?'),
    ('Vie Sociale, Famille et Démographie', 3, 'Les réseaux de solidarité locale de quartier sont-ils le meilleur moyen de lutter contre la solitude ?'),
    ('Vie Sociale, Famille et Démographie', 3, "Écrire à un ami proche pour annoncer la naissance de votre enfant ou l'adoption d'un animal de compagnie."),
    ('Vie Sociale, Famille et Démographie', 3, 'Le bénévolat associatif doit-il donner droit à des avantages fiscaux ou à des trimestres de retraite ?'),
    ('Vie Sociale, Famille et Démographie', 3, 'Les applications de communication modernes ont-elles détruit la spontanéité des relations humaines ?'),
    ('Vie Sociale, Famille et Démographie', 3, "L'instauration d'un service citoyen obligatoire pour renforcer le sentiment d'appartenance nationale."),
    ('Vie Sociale, Famille et Démographie', 3, 'Écrire un court message pour proposer de garder les animaux de compagnie de votre voisin pendant ses vacances.'),
]

# Task 2 speaking questions (task_type=2) for the same 10 speaking themes.
SEED_SPEAKING_QUESTIONS_T2 = [
    # --- Immigration et Intégration ---
    ('Immigration et Intégration', 2, "Vous voulez vous inscrire à un programme de parrainage de bénévoles locaux pour vous aider à vous installer. Vous interrogez l'agent d'un centre d'accueil pour nouveaux arrivants. (critères d'éligibilité, durée de l'accompagnement, activités proposées, etc.)"),
    ('Immigration et Intégration', 2, "Vous souhaitez participer à un atelier de préparation aux entretiens d'embauche au Canada. Vous demandez les détails d'organisation à l’organisateur. (dates disponibles, documents à apporter, profil des formateurs, etc.)"),
    ('Immigration et Intégration', 2, "Une association propose des cours de perfectionnement de la langue française pour les professionnels étrangers. Vous demandez des précisions sur les critères d'accès. (niveau linguistique requis, horaires des cours, examens de niveau, etc.)"),
    ('Immigration et Intégration', 2, "Vous êtes intéressé(e) par une séance d'information gratuite sur les démarches administratives d'immigration. Vous posez des questions sur le contenu et l'inscription. (plateforme de diffusion, thèmes abordés, limite d'inscriptions, etc.)"),
    ('Immigration et Intégration', 2, 'Vous souhaitez rejoindre un club de discussion interculturel dans votre nouvelle ville. Vous demandez au responsable comment se déroulent les réunions. (fréquence des rencontres, taille des groupes, thèmes de conversation, etc.)'),
    ('Immigration et Intégration', 2, "Vous voulez obtenir l’aide d’un conseiller pour faire évaluer vos diplômes étrangers. Vous appelez un organisme d'aide à l'intégration. (délais de traitement, frais administratifs, équivalences obtenues, etc.)"),
    ('Immigration et Intégration', 2, 'Une fête des voisins multiculturelle est organisée dans votre quartier. Vous demandez au coordinateur comment vous pouvez participer et aider. (lieu de rassemblement, plats à apporter, matériel à fournir, etc.)'),
    ('Immigration et Intégration', 2, "Vous cherchez des informations sur les bourses d'études disponibles pour les résidents permanents récemment arrivés. Vous vous renseignez auprès d'un conseiller académique. (montant de l'aide, conditions de ressources, date limite de dépôt, etc.)"),
    ('Immigration et Intégration', 2, "Vous voulez inscrire vos enfants à un programme d'intégration scolaire d'été. Vous interrogez le directeur du centre communautaire. (tranches d'âge acceptées, activités au programme, tarifs des inscriptions, etc.)"),
    ('Immigration et Intégration', 2, 'Une association locale organise une sortie culturelle pour faire découvrir la région aux nouveaux arrivants. Vous demandez les modalités pratiques. (moyen de transport, itinéraire prévu, équipement à prévoir, etc.)'),
    ('Immigration et Intégration', 2, "Vous lisez une annonce pour un atelier d'aide administrative pour remplir les formulaires de visa. Vous posez vos questions au secrétariat. (tarifs de l'atelier, durée de la séance, rendez-vous individuels, etc.)"),
    ('Immigration et Intégration', 2, 'Vous souhaitez devenir bénévole pour une association qui aide les expatriés. Vous interrogez le responsable sur les tâches à accomplir. (disponibilité hebdomadaire requise, formations internes fournies, types de public aidés, etc.)'),
    ('Immigration et Intégration', 2, "Vous voulez louer un stand lors d’un festival culturel pour présenter l'artisanat de votre pays. Vous vous renseignez auprès des organisateurs. (dimensions de l'emplacement, prix de la location, matériel technique fourni, etc.)"),
    ('Immigration et Intégration', 2, "Vous cherchez un avocat en immigration pour un conseil juridique. Vous appelez un cabinet d'avocats pour connaître leurs tarifs et services. (coût de la consultation, spécialités du cabinet, délais de rendez-vous, etc.)"),
    ('Immigration et Intégration', 2, "Vous êtes intéressé(e) par une colocation avec d'autres étudiants internationaux. Vous contactez la personne qui a posté l'annonce pour poser vos questions sur l'ambiance et les règles. (montant des charges, partage des tâches, taille de la chambre, etc.)"),
    # --- Monde du Travail et Économie ---
    ('Monde du Travail et Économie', 2, "Vous voyez une offre de stage en marketing au sein d'une start-up locale. Vous appelez le recruteur pour obtenir des précisions sur le poste. (missions confiées, montant de l'indemnité, perspectives d'embauche, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous êtes intéressé(e) par un espace de coworking dans votre quartier. Vous interrogez le gérant sur les tarifs et les équipements disponibles. (vitesse internet, accès aux salles, formules d'abonnement, etc.)"),
    ('Monde du Travail et Économie', 2, 'Vous souhaitez suivre une formation professionnelle pour apprendre à utiliser un nouveau logiciel de gestion. Vous demandez les modalités au centre de formation. (durée du programme, prérequis nécessaires, certifications obtenues, etc.)'),
    ('Monde du Travail et Économie', 2, "Vous voulez postuler à une offre d'emploi à temps partiel dans une librairie. Vous interrogez le responsable du magasin sur les horaires et les missions. (jours de travail, tâches quotidiennes, flexibilité du planning, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous souhaitez organiser une réunion d'information syndicale ou professionnelle dans votre entreprise. Vous demandez l'autorisation et les détails logistiques au directeur des ressources humaines. (disponibilité des salles, horaires autorisés, matériel de projection, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous voulez lancer votre micro-entreprise et cherchez un accompagnement. Vous interrogez un conseiller d'un organisme d'aide aux jeunes entrepreneurs. (subventions disponibles, ateliers juridiques proposés, suivi individuel, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous êtes invité(e) à participer à un salon de l'emploi et du recrutement. Vous contactez l'organisateur pour savoir comment optimiser votre visite. (liste des entreprises, ateliers de coaching, badges d'accès, etc.)"),
    ('Monde du Travail et Économie', 2, 'Vous souhaitez négocier une formule de télétravail hybride avec votre employeur. Vous demandez un entretien avec votre manager pour poser vos conditions. (nombre de jours, matériel fourni, horaires de présence, etc.)'),
    ('Monde du Travail et Économie', 2, "Vous recherchez un mentor professionnel dans votre domaine d'activité. Vous interrogez le responsable d'un réseau de mise en relation d'affaires. (critères de sélection, fréquence des rendez-vous, objectifs du programme, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous souhaitez louer une salle de conférence pour présenter un projet à des clients. Vous appelez un hôtel pour connaître les prestations. (capacité d'accueil, service de restauration, équipements techniques, etc.)"),
    ('Monde du Travail et Économie', 2, "Une agence d'intérim propose des missions courtes dans votre secteur. Vous demandez à un conseiller comment fonctionne leur plateforme de placement. (délais de paiement, types de contrats, réactivité des offres, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous souhaitez participer à un atelier de rédaction de CV et de lettre de motivation. Vous vous renseignez auprès de l'accueil de votre club de recherche d'emploi. (nombre de participants, correction individuelle, tarifs d'inscription, etc.)"),
    ('Monde du Travail et Économie', 2, "Vous voulez vendre des créations artisanales sur les marchés de votre région. Vous interrogez le responsable de la mairie sur l'obtention d'un permis de vente. (coût de la place, documents administratifs, calendrier des marchés, etc.)"),
    ('Monde du Travail et Économie', 2, 'Vous cherchez à sous-traiter la comptabilité de votre petite entreprise. Vous interrogez un comptable indépendant sur ses méthodes et ses honoraires. (tarifs mensuels, logiciels compatibles, délais de bilan, etc.)'),
    ('Monde du Travail et Économie', 2, "Vous postulez pour un poste d'assistant de direction bilingue. Vous contactez l'agence de recrutement pour obtenir des détails complémentaires sur l'entreprise qui recrute. (secteur d'activité, taille de l'équipe, avantages sociaux, etc.)"),
    # --- Environnement et Transition Écologique ---
    ('Environnement et Transition Écologique', 2, 'Votre municipalité met en place un nouveau système de compostage obligatoire dans les immeubles. Vous appelez le service environnement de la mairie pour savoir comment obtenir votre bac. (délais de livraison, consignes de tri, entretien du bac, etc.)'),
    ('Environnement et Transition Écologique', 2, "Vous souhaitez participer à une journée bénévole de nettoyage d'une forêt locale. Vous interrogez l'association organisatrice sur le point de rendez-vous et le matériel à apporter. (horaires exacts, gants fournis, repas du midi, etc.)"),
    ('Environnement et Transition Écologique', 2, "Vous voulez installer des panneaux solaires sur le toit de votre maison. Vous interrogez un technicien spécialisé sur le coût, les subventions et les délais de pose. (prix de l'installation, aides financières, rendement énergétique, etc.)"),
    ('Environnement et Transition Écologique', 2, 'Une épicerie "zéro déchet" vient d\'ouvrir près de chez vous. Vous demandez au gérant comment fonctionne l\'achat en vrac et s\'il faut apporter ses propres contenants. (types de produits, pesée des sacs, tarifs au kilo, etc.)'),
    ('Environnement et Transition Écologique', 2, "Vous souhaitez acheter un vélo électrique grâce à une aide financière de la ville. Vous vous renseignez auprès d'un conseiller municipal sur la procédure de remboursement. (montant de la prime, critères d'éligibilité, factures à fournir, etc.)"),
    ('Environnement et Transition Écologique', 2, 'Vous voulez proposer un projet de covoiturage à vos collègues de bureau. Vous interrogez le responsable des transports de votre entreprise pour obtenir son soutien logistique. (plateforme interne, places de parking, partage des frais, etc.)'),
    ('Environnement et Transition Écologique', 2, "Vous êtes intéressé(e) par un abonnement à un service de voitures partagées (autopartage). Vous demandez au conseiller client les conditions d'utilisation et les prix. (tarifs horaires, assurance comprise, localisation des stations, etc.)"),
    ('Environnement et Transition Écologique', 2, "Vous souhaitez inscrire votre enfant à un stage d'été axé sur la découverte de la nature et de la biodiversité. Vous interrogez le responsable de la ferme pédagogique. (âge minimum, thèmes des journées, encadrement des animateurs, etc.)"),
    ('Environnement et Transition Écologique', 2, "Vous voulez faire auditer l'isolation thermique de votre appartement. Vous contactez une agence de rénovation énergétique pour connaître le déroulement du diagnostic. (coût du bilan, durée de l'intervention, solutions proposées, etc.)"),
    ('Environnement et Transition Écologique', 2, "Une association propose des ateliers gratuits pour apprendre à réparer ses appareils électroménagers en panne. Vous demandez les détails d'inscription au bénévole d'accueil. (outils disponibles, types d'appareils acceptés, calendrier des sessions, etc.)"),
    ('Environnement et Transition Écologique', 2, "Vous voulez participer à la création d'un potager partagé dans votre quartier. Vous interrogez le président du comité de riverains sur la répartition des tâches. (outils nécessaires, planning d'arrosage, partage des récoltes, etc.)"),
    ('Environnement et Transition Écologique', 2, 'Vous souhaitez acheter des produits alimentaires en circuit court directement auprès des agriculteurs (système AMAP). Vous vous renseignez auprès du responsable du point de distribution. (prix du panier, jours de retrait, engagement annuel, etc.)'),
    ('Environnement et Transition Écologique', 2, 'Votre entreprise organise un défi "zéro plastique" pendant un mois. Vous demandez à la chargée de communication interne quels sont les critères de participation. (règles du jeu, récompenses prévues, pesée des déchets, etc.)'),
    ('Environnement et Transition Écologique', 2, "Vous voulez remplacer votre ancienne chaudière par un système de chauffage écologique. Vous posez vos questions à un conseiller en énergie. (crédits d'impôt, économies réalisées, durée des travaux, etc.)"),
    ('Environnement et Transition Écologique', 2, "Vous préparez des vacances écotouristiques en pleine nature. Vous appelez le guide d'une réserve naturelle pour connaître les règles d'impact environnemental minimum à respecter. (gestion des déchets, campings autorisés, restrictions de sentiers, etc.)"),
    # --- Éducation et Jeunesse ---
    ('Éducation et Jeunesse', 2, "Vous souhaitez inscrire votre enfant à des cours de soutien scolaire en mathématiques. Vous interrogez le directeur d'une agence de tutorat à domicile. (tarifs horaires, profil des tuteurs, suivi pédagogique, etc.)"),
    ('Éducation et Jeunesse', 2, "Une école de musique propose des cours d'éveil musical pour les jeunes enfants. Vous demandez au secrétariat quels sont les instruments étudiés et les tarifs. (durée de la séance, coût annuel, location d'instruments, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous voulez obtenir des informations sur le programme d'échange universitaire Erasmus ou international. Vous posez vos questions au bureau des relations internationales de la faculté. (bourses d'études, pays partenaires, niveau de langue requis, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous cherchez une place en crèche ou chez une assistante maternelle pour votre bébé. Vous interrogez la responsable du relais petite enfance de votre commune. (délais d'attente, horaires d'ouverture, justificatifs de revenus, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous souhaitez que votre adolescent participe à un camp de vacances linguistique à l'étranger. Vous demandez des détails sur l'encadrement à l'agent de voyage spécialisé. (hébergement en famille, nombre de cours, activités sportives, etc.)"),
    ('Éducation et Jeunesse', 2, "Une association propose des ateliers de codage et d'informatique pour les collégiens. Vous demandez au formateur quel est le niveau requis pour débuter. (logiciels utilisés, matériel à fournir, projets réalisés, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous voulez inscrire votre enfant à l'aide aux devoirs organisée après l'école. Vous interrogez l'instituteur ou le directeur de l'établissement scolaire. (jours de la semaine, nombre d'encadrants, tarifs mensuels, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous souhaitez inscrire votre adolescent à un club de théâtre pour développer sa confiance en soi. Vous demandez au professeur comment se déroulent les auditions. (pièces étudiées, jours de répétition, spectacle de fin d'année, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous voulez vous renseigner sur les modalités d'inscription au baccalauréat en candidat libre. Vous appelez le rectorat ou le centre des examens. (frais de dossier, date limite d'envoi, épreuves obligatoires, etc.)"),
    ('Éducation et Jeunesse', 2, "Une école alternative (type Montessori) ouvre ses portes dans votre ville. Vous interrogez l'équipe pédagogique lors de la journée portes ouvertes sur leur méthode. (rythme de l'enfant, effectifs par classe, coût de la scolarité, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous souhaitez financer les études de votre enfant grâce à un prêt étudiant. Vous interrogez votre conseiller bancaire sur les taux d'intérêt et les modalités de remboursement. (durée du différé, garanties exigées, montant maximum, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous voulez participer en tant que parent bénévole à l'organisation de la kermesse de fin d'année. Vous demandez au président de l'association de parents d'élèves ce qu'il reste à faire. (stands à installer, horaires d'ouverture, collecte de lots, etc.)"),
    ('Éducation et Jeunesse', 2, "Votre enfant souhaite intégrer une section sport-études de football. Vous interrogez l'entraîneur sur le rythme des entraînements et le niveau scolaire exigé. (critères sportifs, aménagement du planning, hébergement en internat, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous cherchez une formation en alternance pour votre enfant de 16 ans. Vous posez des questions à un conseiller d'orientation du Centre de Formation des Apprentis (CFA). (entreprises partenaires, rythme des cours, rémunération prévue, etc.)"),
    ('Éducation et Jeunesse', 2, "Vous voulez louer une chambre d'étudiant dans une résidence universitaire. Vous vous renseignez auprès du secrétariat du CROUS ou du gestionnaire sur les critères d'attribution. (montant du loyer, éligibilité aux aides, mobilier inclus, etc.)"),
    # --- Nouvelles Technologies et Réseaux Sociaux ---
    ('Nouvelles Technologies et Réseaux Sociaux', 2, 'Vous rencontrez un problème avec votre nouvel abonnement à la fibre internet. Vous appelez le service technique de votre opérateur pour obtenir une assistance immédiate. (délais de dépannage, nature de la panne, dédommagement prévu, etc.)'),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, 'Vous souhaitez participer à une formation pour seniors intitulée "Maîtriser les outils numériques de base". Vous demandez les horaires à l’animateur du centre social. (nombre de séances, thèmes abordés, niveau requis, etc.)'),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous voulez faire réparer l'écran cassé de votre smartphone. Vous interrogez un technicien en boutique de réparation sur le coût, la garantie et le délai d’attente. (prix des pièces, durée de réparation, prêt de téléphone, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous êtes intéressé(e) par l’achat d’un ordinateur portable d’occasion reconditionné. Vous demandez au vendeur des détails sur l’état de la batterie et les logiciels inclus. (durée de la garantie, prix d'origine, accessoires fournis, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, 'Vous souhaitez installer un système de domotique (maison connectée) chez vous. Vous interrogez un installateur professionnel sur la sécurité des données et les fonctionnalités. (coût global, application de contrôle, pannes de courant, etc.)'),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Une agence propose un service de protection de la réputation en ligne et de suppression des données privées. Vous demandez à un conseiller comment se déroule l’audit. (tarifs des services, délais d'effacement, résultats garantis, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous souhaitez inscrire votre enfant à un atelier de création de jeux vidéo simples. Vous interrogez le responsable du club d'informatique sur le matériel requis. (âge minimum, logiciels utilisés, jours de l'atelier, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous envisagez de louer un casque de réalité virtuelle pour une soirée d'anniversaire. Vous demandez les tarifs et le catalogue de jeux au gérant de la boutique de location. (montant de la caution, durée de location, câbles fournis, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, 'Vous voulez créer un site internet professionnel pour votre activité et cherchez un hébergeur web. Vous posez des questions au support technique sur les différentes formules. (espace de stockage, adresses courriel incluses, prix annuel, etc.)'),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous voulez participer à une conférence en ligne (webinaire) sur les dangers du cyberharcèlement chez les jeunes. Vous demandez les modalités d'accès à l'organisateur. (lien de connexion, horaire exact, intervenants présents, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, 'Vous souhaitez utiliser une application bancaire sur votre téléphone mais craignez pour la sécurité. Vous interrogez votre conseiller bancaire sur les protocoles de protection. (double authentification, blocage de carte, assurance piratage, etc.)'),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, 'Vous souhaitez parrainer un projet de financement participatif (crowdfunding) pour un gadget innovant. Vous contactez le créateur du projet pour en savoir plus sur la date de livraison. (contreparties offertes, risques financiers, étapes de fabrication, etc.)'),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous cherchez un logiciel de contrôle parental efficace pour les tablettes de vos enfants. Vous demandez des conseils à un conseiller de vente en magasin spécialisé. (limite de temps, blocage de sites, prix de l'abonnement, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous souhaitez configurer un réseau Wi-Fi sécurisé pour vos clients dans votre café. Vous appelez un technicien réseau pour obtenir un devis d’installation. (coût de la main-d'œuvre, couverture du signal, conformité légale, etc.)"),
    ('Nouvelles Technologies et Réseaux Sociaux', 2, "Vous voulez vous inscrire sur une plateforme de cours de langue en ligne avec des tuteurs natifs. Vous demandez au service client comment fonctionne la politique d’annulation des cours. (délais de remboursement, choix du professeur, durée d'une leçon, etc.)"),
    # --- Voyages, Tourisme et Transport ---
    ('Voyages, Tourisme et Transport', 2, 'Vous lisez une annonce pour une excursion de deux jours en canoë-kayak dans un parc naturel. Vous contactez le guide pour connaître le niveau physique requis. (matériel fourni, repas inclus, lieu de bivouac, etc.)'),
    ('Voyages, Tourisme et Transport', 2, "Vous êtes à l'hôtel et votre chambre ne correspond pas à votre réservation (pas de climatisation, vue sur rue). Vous descendez à la réception pour régler le problème. (changement de chambre, geste commercial, surclassement disponible, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous voulez acheter une carte d'abonnement annuel pour les trains régionaux. Vous interrogez l'agent au guichet de la gare sur les réductions applicables. (justificatifs à fournir, prix annuel, validité le week-end, etc.)"),
    ('Voyages, Tourisme et Transport', 2, 'Vous souhaitez louer un camping-car pour vos prochaines vacances en famille. Vous demandez au loueur des précisions sur le permis requis et les assurances incluses. (montant de la caution, kilométrage autorisé, équipements de cuisine, etc.)'),
    ('Voyages, Tourisme et Transport', 2, "Vous visitez une ville et cherchez une visite guidée historique à pied. Vous demandez les horaires, les tarifs et les langues parlées à l'agent de l'Office de Tourisme. (point de départ, durée du parcours, réservation obligatoire, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous voulez organiser un voyage de groupe pour 15 personnes et louer un minibus avec chauffeur. Vous demandez un devis détaillé à une compagnie de transport. (tarif à la journée, frais d'essence, pauses prévues, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous avez perdu votre sac de voyage dans l'autobus de la ville. Vous appelez le service des objets trouvés de la compagnie de transport pour savoir s'il a été rapporté. (description du sac, numéro de la ligne, horaires de retrait, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous souhaitez séjourner dans une maison d'hôtes rurale (un gîte). Vous contactez le propriétaire pour savoir si les repas du soir sont faits maison et inclus. (prix de la nuitée, activités aux alentours, présence d'animaux, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous voulez réserver un billet d'avion multi-destinations complexe. Vous vous rendez dans une agence de voyages pour demander conseil sur les escales les plus économiques. (compagnies aériennes, temps d'escale, conditions d'annulation, etc.)"),
    ('Voyages, Tourisme et Transport', 2, 'Vous préparez un voyage à vélo le long d\'un canal et cherchez des hébergements labellisés "Accueil Vélo". Vous posez vos questions à l\'association de cyclotourisme. (services de réparation, abris sécurisés, cartes des pistes, etc.)'),
    ('Voyages, Tourisme et Transport', 2, "Vous devez annuler un séjour à cause d'un imprévu médical. Vous appelez le service client de la plateforme de réservation pour connaître les conditions de remboursement. (frais de dossier, justificatif de médecin, délais bancaires, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous souhaitez passer un week-end sur une île et prendre le ferry avec votre voiture. Vous vous renseignez au guichet maritime sur les formalités d'embarquement. (heure d'arrivée conseillée, suppléments bagages, tarifs véhicule, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous cherchez un hôtel qui accepte les animaux de compagnie de grande taille. Vous contactez l'établissement pour vérifier les conditions et les frais supplémentaires. (supplément par nuit, accès au restaurant, espaces verts à proximité, etc.)"),
    ('Voyages, Tourisme et Transport', 2, "Vous voulez faire un safari photo éco-responsable. Vous interrogez l'agence de voyage sur l'engagement de leurs guides envers la protection de la faune sauvage. (taille du groupe, véhicules utilisés, labels environnementaux, etc.)"),
    ('Voyages, Tourisme et Transport', 2, 'Vous souhaitez louer un bateau sans permis pour une journée sur un lac. Vous demandez au loueur des consignes de sécurité et la carte des zones de navigation. (tarifs de location, gilets de sauvetage, carburant inclus, etc.)'),
    # --- Société et Consommation ---
    ('Société et Consommation', 2, "Vous voulez résilier votre contrat d'abonnement à une salle de sport car vous déménagez. Vous demandez au gérant la procédure à suivre et le délai de préavis. (frais de résiliation, pièces justificatives, restitution du badge, etc.)"),
    ('Société et Consommation', 2, "Vous avez acheté un appareil électroménager qui est tombé en panne après seulement deux semaines d'utilisation. Vous retournez au magasin pour demander un échange ou un remboursement sous garantie. (ticket de caisse, délais de réparation, modèle de remplacement, etc.)"),
    ('Société et Consommation', 2, "Vous souhaitez faire l'acquisition d'un vêtement sur mesure pour un événement important. Vous interrogez un couturier indépendant sur ses délais de fabrication et ses tarifs. (choix des tissus, nombre d'essayages, acompte demandé, etc.)"),
    ('Société et Consommation', 2, "Vous êtes intéressé(e) par l'achat d'un panier de légumes hebdomadaire vendu directement par un groupement de producteurs locaux (AMAP). Vous interrogez le coordinateur de l'association sur l'abonnement. (prix du panier, lieu de distribution, variété des légumes, etc.)"),
    ('Société et Consommation', 2, "Vous voulez organiser un vide-grenier ou une brocante de quartier dans votre rue. Vous appelez le service d'urbanisme de votre mairie pour connaître les autorisations administratives nécessaires. (frais d'occupation, date limite d'inscription, métrage maximum, etc.)"),
    ('Société et Consommation', 2, "Vous souhaitez faire des dons de vêtements et de meubles à une association caritative (type Emmaüs). Vous appelez le centre pour savoir s'ils effectuent des collectes gratuites à domicile. (jours de passage, état des meubles requis, prise de rendez-vous, etc.)"),
    ('Société et Consommation', 2, "Vous constatez une erreur importante sur votre dernière facture d'électricité. Vous appelez le service client du fournisseur d'énergie pour contester le montant et demander une régularisation. (relevé de compteur, délais d'étude, mode de remboursement, etc.)"),
    ('Société et Consommation', 2, "Vous souhaitez vous inscrire à un atelier de cuisine végétale ou végane. Vous interrogez le chef cuisinier de l'école de cuisine sur le calendrier des cours et les ingrédients utilisés. (durée de l'atelier, prix par personne, matériel de cuisine, etc.)"),
    ('Société et Consommation', 2, 'Vous voulez offrir une carte-cadeau dans un institut de beauté pour l’anniversaire d’un proche. Vous demandez les différentes formules de soins disponibles à la réceptionniste. (durée de validité, tarifs des massages, prise de rendez-vous, etc.)'),
    ('Société et Consommation', 2, "Vous cherchez à acheter des fournitures de bureau en grande quantité pour votre entreprise. Vous négociez une réduction tarifaire globale avec le responsable commercial d'un grossiste. (délais de livraison, franco de port, facilités de paiement, etc.)"),
    ('Société et Consommation', 2, 'Vous souhaitez louer un costume ou une tenue de soirée de créateur pour un gala. Vous posez des questions sur le montant de la caution et les frais de nettoyage à sec au gérant de la boutique. (durée de location, retouches possibles, pénalités de retard, etc.)'),
    ('Société et Consommation', 2, "Vous voulez participer à une coopérative d'achat alimentaire autogérée par les consommateurs. Vous demandez à un membre actif comment fonctionne l'obligation de bénévolat mensuel. (horaires d'ouverture, types de produits, parts sociales à acheter, etc.)"),
    ('Société et Consommation', 2, "Vous avez commandé un article en ligne qui est arrivé endommagé. Vous contactez le service après-vente (SAV) de la plateforme e-commerce pour organiser un retour gratuit. (photos du colis, étiquette de transport, délais d'échange, etc.)"),
    ('Société et Consommation', 2, "Vous cherchez un artisan ébéniste pour restaurer un meuble ancien de famille. Vous l'interrogez sur sa méthode de travail, le type de vernis utilisé et la durée des travaux. (coût du devis, transport du meuble, techniques traditionnelles, etc.)"),
    ('Société et Consommation', 2, 'Vous souhaitez adhérer à une association locale d’échange local de services (système SEL). Vous demandez au secrétaire de l\'association comment fonctionne le système de comptabilisation en "temps" ou "points". (frais d\'adhésion, catalogue des offres, réunions d\'accueil, etc.)'),
    # --- Culture, Langue et Patrimoine ---
    ('Culture, Langue et Patrimoine', 2, "Vous souhaitez organiser une visite privée d’un musée d’art pour un groupe d’étudiants. Vous interrogez le responsable des réservations du musée sur les tarifs et la présence d'un guide. (taille maximale du groupe, durée de la visite, gratuité enseignants, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous êtes intéressé(e) par un abonnement annuel au théâtre municipal. Vous demandez à la billetterie les avantages inclus. (choix des sièges, réductions abonnés, politique d'annulation, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous voulez inscrire votre groupe de musique amateur à un tremplin ou festival musical local. Vous demandez au programmateur culturel les conditions techniques de sélection. (date limite d'envoi, matériel sono fourni, durée du concert, etc.)"),
    ('Culture, Langue et Patrimoine', 2, 'Vous souhaitez louer une salle dans un château ou un monument historique pour organiser une réception privée. Vous contactez le gestionnaire du patrimoine pour obtenir le règlement intérieur. (capacité de la salle, horaires de fermeture, prestataires imposés, etc.)'),
    ('Culture, Langue et Patrimoine', 2, "Vous voulez suivre des cours du soir d'histoire de l’art ou d’archéologie. Vous interrogez le secrétariat de l'université populaire sur le programme et l’évaluation. (tarifs du trimestre, jours de cours, diplômes délivrés, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Une association propose d’apprendre les danses traditionnelles de votre région d’accueil. Vous demandez au professeur s'il faut venir en couple et quelle tenue est recommandée. (âge minimum, niveau débutant accepté, calendrier des bals, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous souhaitez faire un don de livres anciens à la bibliothèque municipale. Vous appelez le bibliothécaire pour savoir quels types d'ouvrages sont acceptés et s'ils manquent de place. (état des livres, genres recherchés, horaires de dépôt, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous voulez participer en tant que figurant bénévole à un grand spectacle historique en plein air. Vous interrogez le directeur artistique sur le planning des répétitions durant l'été. (costumes fournis, profil recherché, disponibilité requise, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous souhaitez inscrire votre enfant à un atelier de poterie ou de sculpture pendant les vacances. Vous posez des questions sur la sécurité et le matériel à l'artisan qui anime l'atelier. (tarifs de la semaine, nombre d'enfants, cuisson des pièces, etc.)"),
    ('Culture, Langue et Patrimoine', 2, 'Vous cherchez un guide touristique conférencier privé pour faire visiter le centre historique de la ville à des amis étrangers. Vous contactez un professionnel indépendant pour fixer le parcours. (prix forfaitaire, langues de visite, durée de marche, etc.)'),
    ('Culture, Langue et Patrimoine', 2, "Vous voulez emprunter des œuvres d'art originales dans une artothèque municipale. Vous demandez au responsable le fonctionnement de l'emprunt et les conditions d'assurance requises. (durée du prêt, abonnement annuel, transport des cadres, etc.)"),
    ('Culture, Langue et Patrimoine', 2, 'Vous souhaitez participer à un club de lecture mensuel organisé dans une librairie indépendante. Vous interrogez le libraire sur la liste des prochains livres à lire. (horaires des rencontres, thèmes littéraires, participation financière, etc.)'),
    ('Culture, Langue et Patrimoine', 2, "Vous apprenez qu’un bâtiment historique du quartier va être démoli. Vous interrogez le président d'une association de sauvegarde du patrimoine sur les actions de protestation en cours. (pétition en ligne, rassemblements prévus, recours juridiques, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous souhaitez assister à une projection de cinéma en plein air, mais craignez les intempéries. Vous appelez les organisateurs pour savoir si une solution de repli en intérieur est prévue. (chaises fournies, tarifs d'entrée, buvette sur place, etc.)"),
    ('Culture, Langue et Patrimoine', 2, "Vous voulez inscrire votre adolescent à un stage intensif de calligraphie ou d'écriture créative. Vous demandez des précisions sur le profil de l'animateur et les productions finales attendues. (fournitures incluses, horaires de journée, nombre de stagiaires, etc.)"),
    # --- Santé, Sport et Bien-être ---
    ('Santé, Sport et Bien-être', 2, 'Vous souhaitez vous inscrire à un club de randonnée en montagne. Vous demandez au guide de l’association quels équipements techniques (chaussures, bâtons) sont obligatoires. (difficulté des parcours, covoiturage organisé, certificat médical, etc.)'),
    ('Santé, Sport et Bien-être', 2, "Vous voulez prendre rendez-vous avec un nutritionniste pour modifier votre alimentation. Vous l'interrogez par téléphone sur le déroulement de la première consultation et le suivi. (tarifs de la séance, remboursement mutuelle, analyses à apporter, etc.)"),
    ('Santé, Sport et Bien-être', 2, 'Vous souhaitez inscrire votre enfant à des cours de natation individuels pour vaincre sa peur de l’eau. Vous posez des questions au maître-nageur de la piscine municipale. (durée de la leçon, nombre de séances, présence des parents, etc.)'),
    ('Santé, Sport et Bien-être', 2, 'Vous êtes intéressé(e) par des séances de sophrologie ou de gestion du stress en groupe. Vous demandez des détails pratiques à la secrétaire du centre de bien-être. (horaires disponibles, taille du groupe, tapis fournis, etc.)'),
    ('Santé, Sport et Bien-être', 2, 'Vous souhaitez louer un court de tennis de manière régulière dans un club privé. Vous interrogez le responsable du complexe sur les horaires de réservation prioritaires. (prix horaire, éclairage inclus, surface du terrain, etc.)'),
    ('Santé, Sport et Bien-être', 2, "Vous voulez participer à une course à pied solidaire (marathon caritatif). Vous contactez le comité d'organisation pour savoir comment collecter des fonds auprès de vos proches. (frais d'inscription, retrait des dossards, ravitaillements prévus, etc.)"),
    ('Santé, Sport et Bien-être', 2, 'Vous cherchez à acheter un vélo de course adapté à votre morphologie. Vous demandez conseil à un vendeur spécialisé en magasin de sport sur la taille du cadre et les réglages. (matériaux disponibles, poids du vélo, budget à prévoir, etc.)'),
    ('Santé, Sport et Bien-être', 2, "Vous souhaitez faire une cure thermale ou de thalassothérapie d'une semaine. Vous appelez le centre pour obtenir des informations sur l'hébergement et la prise en charge des soins. (options de pension, planning des massages, accès au sauna, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous voulez introduire des séances de massage sur chaise (massage Amma assis) pour vos employés de bureau. Vous interrogez un praticien indépendant sur les tarifs entreprises. (durée d'un massage, matériel à installer, espace minimum requis, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous souhaitez acheter des compléments alimentaires naturels ou des plantes médicinales. Vous demandez des conseils d'utilisation personnalisés à un herboriste ou pharmacien. (contre-indications éventuelles, durée de la cure, posologie quotidienne, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous voulez inscrire votre enfant à des cours de judo ou de karaté. Vous interrogez le professeur du dojo sur les valeurs éducatives enseignées et le coût du kimono officiel. (jours d'entraînement, compétitions prévues, licence annuelle, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous cherchez un entraîneur personnel (coach sportif) à domicile pour vous remettre en forme après une blessure. Vous l'interrogez sur ses diplômes et sa méthode de réadaptation. (tarifs à l'heure, matériel apporté, fréquence conseillée, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous voulez organiser un tournoi de football amateur entre plusieurs entreprises locales. Vous demandez l'autorisation et les conditions de réservation des terrains à la mairie. (disponibilité des vestiaires, assurance requise, frais d'arbitrage, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous souhaitez participer à une retraite de yoga et méditation en silence pendant un week-end. Vous contactez le centre de gestion pour connaître l'emploi du temps quotidien. (type d'hébergement, repas végétariens, niveau de pratique exigé, etc.)"),
    ('Santé, Sport et Bien-être', 2, "Vous voulez installer une station de fitness ou de street-workout en plein air dans le parc de votre copropriété. Vous interrogez le syndic de l'immeuble sur la faisabilité du projet. (coût des agrès, normes de sécurité, vote en assemblée, etc.)"),
    # --- Vie Sociale, Famille et Démographie ---
    ('Vie Sociale, Famille et Démographie', 2, 'Vous cherchez une baby-sitter de confiance pour garder vos enfants en soirée de manière régulière. Vous passez un entretien à une étudiante pour vérifier son expérience. (tarif horaire demandé, aides aux devoirs, références à fournir, etc.)'),
    ('Vie Sociale, Famille et Démographie', 2, "Vous souhaitez inscrire votre parent âgé à des activités de loisirs dans un club du troisième âge. Vous interrogez l'animateur social sur les ateliers créatifs et les sorties. (prix de la cotisation, transport adapté, planning mensuel, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, 'Vous voulez organiser une fête de quartier (fête des voisins) dans la cour commune de votre immeuble. Vous interrogez le syndic ou le concierge sur le règlement de sécurité. (horaire limite de bruit, tables à prêter, assurance obligatoire, etc.)'),
    ('Vie Sociale, Famille et Démographie', 2, 'Vous êtes à la recherche d’une salle des fêtes à louer pour célébrer un anniversaire familial important (50 personnes). Vous contactez le secrétariat de la mairie pour connaître le tarif. (caution demandée, vaisselle incluse, parking disponible, etc.)'),
    ('Vie Sociale, Famille et Démographie', 2, "Vous souhaitez adopter un animal de compagnie (un chien ou un chat) dans un refuge pour animaux (SPA). Vous interrogez l'agent d'accueil sur la procédure d'adoption et les frais vétérinaires. (justificatifs de logement, puce électronique incluse, période d'essai, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, "Vous voulez organiser une pendaison de crémaillère surprise pour un ami proche qui vient de déménager. Vous contactez son colocataire pour planifier la logistique en secret. (nombre d'invités, liste de cadeaux, organisation du buffet, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, "Vous souhaitez louer des jeux de société géants pour animer une fête de famille en extérieur. Vous demandez les tarifs de location et la caution au responsable d'une ludothèque. (durée du prêt, transport du matériel, pénalités de casse, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, "Vous cherchez une solution de garde partagée pour votre enfant avec une autre famille du quartier. Vous rencontrez les parents pour discuter des horaires et du partage des frais. (lieu d'accueil alterné, salaire de la nounou, jours de vacances, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, "Vous souhaitez devenir bénévole dans une association de parrainage de jeunes en difficulté scolaire. Vous interrogez le coordinateur sur le temps hebdomadaire nécessaire. (formations initiales, profil des enfants, réunions d'équipe, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, 'Vous voulez réserver un gîte familial de grande capacité pour célébrer Noël en famille élargie. Vous contactez le propriétaire pour savoir si la cuisine est équipée pour 20 personnes. (supplément chauffage, draps fournis, présence de commerces, etc.)'),
    ('Vie Sociale, Famille et Démographie', 2, "Vous apprenez qu’un de vos voisins âgés a des difficultés pour faire ses courses de première nécessité. Vous contactez l'assistante sociale de la commune pour proposer votre aide. (fréquence des visites, démarches administratives, coordination associative, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, 'Vous souhaitez inscrire votre famille à un atelier d’artisanat parent-enfant (ex: fabrication de pain traditionnel). Vous demandez les disponibilités à l’animateur de l’atelier. (âge minimum des enfants, tarif familial, durée de la cuisson, etc.)'),
    ('Vie Sociale, Famille et Démographie', 2, "Vous voulez organiser un voyage de retrouvailles avec vos anciens camarades de classe universitaire. Vous contactez un agent de voyage pour obtenir un tarif préférentiel pour les réservations d'hôtels groupées. (conditions d'annulation, activités communes, dates disponibles, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, "Vous souhaitez réserver une table pour un grand repas de famille (30 personnes) dans un restaurant traditionnel. Vous négociez un menu unique fixe avec le directeur de l'établissement. (montant des arrhes, options végétariennes, boissons incluses, etc.)"),
    ('Vie Sociale, Famille et Démographie', 2, "Vous voulez faire appel à un service de traiteur à domicile pour organiser un dîner important de célébration de mariage. Vous l'interrogez sur les options de menus pour les personnes ayant des régimes alimentaires spécifiques. (frais de service, vaisselle propre fournie, acompte de réservation, etc.)"),
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