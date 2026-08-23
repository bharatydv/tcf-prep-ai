"""
prepfrancais — FastAPI backend (PostgreSQL edition)
French exam-preparation platform for TCF Canada.
All routes are prefixed with /api.

Database layer: SQLAlchemy 2.0 (async) + asyncpg.
Business logic, API routes, AI prompts and grading are unchanged from the
original MongoDB version — only persistence was migrated.
""" 
import os
import re
import time
import json
import uuid
import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone, date
from typing import Optional, List, Dict, Any, Tuple

import bcrypt
import base64
import functools
import hashlib
import hmac
import secrets
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException, Depends, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field

from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Text, ForeignKey, func, select,
    update as sa_update, delete as sa_delete, case,
)
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship,
)

import reading_bank
import exam_sets

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
# The origin used to build links inside emails. The first entry of FRONTEND_URL
# is the canonical site when several origins are allowed.
PUBLIC_URL = os.environ.get(
    "PUBLIC_URL", FRONTEND_URL.split(",")[0].strip()).rstrip("/")

# Account recovery. Reset links are deliberately short-lived; verification
# links can be longer because they grant nothing on their own.
RESET_TTL_MINUTES = int(os.environ.get("RESET_TTL_MINUTES", "60"))
VERIFY_TTL_HOURS = int(os.environ.get("VERIFY_TTL_HOURS", "48"))

# SMTP. With no host configured the link is written to the log instead of
# being sent, which keeps local development working without a mail provider.
# In production that would mean reset links nobody receives, so the boot check
# below warns loudly and /auth/forgot-password answers 503 rather than
# pretending a message went out.
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "prepfrancais <bonjour@prepfrancais.com>")
SMTP_STARTTLS = os.environ.get("SMTP_STARTTLS", "true").lower() != "false"

# SMS, the second confirmation channel. Twilio is the only provider wired up.
# With no credentials the code is logged rather than sent — the same bargain
# SMTP makes above — so local development needs no account, while production
# simply does not offer the SMS option unless it can actually deliver one.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_FROM", "")
SMS_ENABLED = bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM)
PHONE_CODE_TTL_MINUTES = int(os.environ.get("PHONE_CODE_TTL_MINUTES", "10"))
# Six digits fall to brute force in a way a 32-byte link never does, so a code
# dies after a handful of wrong guesses rather than waiting out its TTL.
PHONE_CODE_MAX_ATTEMPTS = 5

# Only trust X-Forwarded-For when the request actually arrives through a proxy
# we run. Reading it unconditionally let an anonymous caller rotate the header
# and land in a fresh rate-limit bucket on every attempt, which defeated the
# login limiter entirely. Set to a comma-separated list of proxy addresses, or
# "*" when the platform guarantees the header (a managed load balancer).
TRUSTED_PROXIES = {p.strip() for p in
                   os.environ.get("TRUSTED_PROXIES", "").split(",") if p.strip()}

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
# Every provider SDK defaults to waiting forever on a stalled socket. That is
# the difference between one slow grade and a worker thread lost for the life
# of the process: the stream handler's 180s guard cancels the coroutine that is
# awaiting the executor, and cannot interrupt the thread already blocked inside
# it. Enough of those and AI grading stops for every user at once.
AI_HTTP_TIMEOUT = float(os.environ.get("AI_HTTP_TIMEOUT", "60"))
# Grading and transcription block on network I/O, not on CPU, so the pool can
# safely far exceed the core count. asyncio's default executor is
# min(32, cpu_count + 4) — six threads on a 2-vCPU box, which capped the whole
# product at six people being graded at once.
AI_MAX_CONCURRENCY = int(os.environ.get("AI_MAX_CONCURRENCY", "32"))

# The free trial is granted once per account and never refills. It is split by
# skill so one appetite cannot eat the other's share, and tâche 2 carries its
# own ceiling inside the speaking share: the live roleplay is several AI calls
# per attempt, far and away the most expensive thing here to give away.
FREE_WRITING_LIMIT = 3
FREE_SPEAKING_LIMIT = 3
FREE_SPEAKING_TACHE2_LIMIT = 1
FREE_TRIAL_TOTAL = FREE_WRITING_LIMIT + FREE_SPEAKING_LIMIT
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

    The refresh runs on its own short-lived session and commits immediately.
    Reading through the caller's session left a transaction open — SELECT
    starts one and nothing here ended it — so on a cache miss the request held
    a connection *idle in transaction* for the whole 5-30 second AI call, and
    enough concurrent misses exhausted the pool for the entire application.
    """
    global _provider_cache, _provider_cache_ts
    import time as _t
    now = _t.time()
    if now - _provider_cache_ts > _PROVIDER_CACHE_TTL:
        # Claim the refresh before awaiting, so a burst of concurrent misses
        # issues one query rather than one each.
        _provider_cache_ts = now
        try:
            async with SessionLocal() as session:
                res = await session.execute(select(AppSetting))
                _provider_cache = {r.key: r.value for r in res.scalars().all()}
                await session.commit()
        except Exception:  # noqa: BLE001
            _provider_cache = {}
    val = _provider_cache.get(key)
    if val:
        return val.lower()
    return _ENV_PROVIDER_DEFAULTS.get(key, "").lower()


def _invalidate_provider_cache():
    global _provider_cache_ts
    _provider_cache_ts = 0.0

# f-strings cannot contain a backslash escape, and the email bodies below are
# built with them.
NEWLINE = chr(10)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tcf-prep-ai")

if IS_PROD and not SMTP_HOST:
    # Not fatal — everything except account recovery works without it — but it
    # must not pass unnoticed, because the symptom is silent: people ask for a
    # reset link and simply never get one.
    log.error("SMTP_HOST is not set. Password reset and email verification "
              "cannot deliver anything; /api/auth/forgot-password will answer "
              "503 until it is configured.")

# ----------------------------------------------------------------------------
# AI worker pool
# ----------------------------------------------------------------------------
# An explicit pool, rather than asyncio's default one. See AI_MAX_CONCURRENCY.
_ai_executor = ThreadPoolExecutor(max_workers=AI_MAX_CONCURRENCY,
                                  thread_name_prefix="ai")


async def run_ai(fn, *args):
    """Run a blocking provider call on the AI pool."""
    return await asyncio.get_running_loop().run_in_executor(_ai_executor, fn, *args)


# ----------------------------------------------------------------------------
# Provider clients
# ----------------------------------------------------------------------------
# Each call used to construct its own client, so no HTTPS connection was ever
# reused: a DNS lookup, TCP handshake and TLS negotiation on every grade,
# transcription and roleplay turn, and the clients were never closed. They are
# built once and shared; the SDK clients are thread-safe.
_clients: Dict[str, Any] = {}
_clients_lock = threading.Lock()


def _client(key: str, factory):
    """Cached client for `key`, built by `factory` on first use."""
    got = _clients.get(key)
    if got is not None:
        return got
    with _clients_lock:
        got = _clients.get(key)
        if got is None:
            got = factory()
            _clients[key] = got
        return got


def _anthropic_client():
    from anthropic import Anthropic
    return _client("anthropic",
                   lambda: Anthropic(api_key=ANTHROPIC_API_KEY,
                                     timeout=AI_HTTP_TIMEOUT, max_retries=0))


def _openai_client(name: str, api_key: str, base_url: Optional[str] = None):
    from openai import OpenAI
    def build():
        kwargs = {"api_key": api_key, "timeout": AI_HTTP_TIMEOUT, "max_retries": 0}
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAI(**kwargs)
    return _client(name, build)


def _gemini_client():
    from google import genai
    from google.genai import types as genai_types
    return _client(
        "gemini",
        lambda: genai.Client(
            api_key=GEMINI_API_KEY,
            http_options=genai_types.HttpOptions(
                timeout=int(AI_HTTP_TIMEOUT * 1000))))  # milliseconds


def _requests_session():
    import requests
    def build():
        sess = requests.Session()
        sess.headers.update({"authorization": ASSEMBLYAI_API_KEY})
        return sess
    return _client("assemblyai", build)

# ----------------------------------------------------------------------------
# Database engine / session
# ----------------------------------------------------------------------------
# Sized explicitly rather than inheriting SQLAlchemy's 5 + 10. AI requests
# hold a session across a call that can run for half a minute, so the default
# left very little headroom before unrelated requests — /auth/me included —
# started queueing on pool_timeout.
DB_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "20"))
DB_MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", "20"))
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=int(os.environ.get("DB_POOL_TIMEOUT", "30")),
    # Recycle before any proxy or Postgres idle timeout can close a pooled
    # connection underneath us.
    pool_recycle=int(os.environ.get("DB_POOL_RECYCLE", "1800")),
)
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
    # Lifetime total, kept in step with the two counters below so the admin
    # table and the older "attempts used" labels keep meaning something.
    free_submissions_used: Mapped[int] = mapped_column(Integer, default=0)
    # The free trial, spent once and never refilled.
    free_writing_used: Mapped[int] = mapped_column(Integer, default=0)
    free_speaking_used: Mapped[int] = mapped_column(Integer, default=0)
    free_speaking_tache2_used: Mapped[int] = mapped_column(Integer, default=0)
    subscription_status: Mapped[str] = mapped_column(String(20), default="free")
    # When the current paid cycle runs out. NULL means "does not expire", which
    # is what a manual or seeded grant gets; a paid subscription always sets it.
    premium_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)
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
    # Bumped on logout and on a password change. Refresh tokens carry the value
    # they were minted with, so raising it invalidates every one already out
    # there. Without this, logging out cleared the cookies and left the refresh
    # token valid for its full seven days with no way to revoke it.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    # Proves the address belongs to whoever typed it.
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)
    # The second channel. Optional, and the account is considered confirmed
    # once EITHER channel is: many learners abroad read SMS long before they
    # find a mail from an unfamiliar domain in their spam folder.
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)


class AuthToken(Base):
    """A single-use link token for password reset or email verification.

    Only the SHA-256 of the token is stored, so a leaked database backup does
    not hand over working reset links. Rows are consumed by setting used_at,
    never by trusting the client to stop presenting them.
    """
    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    purpose: Mapped[str] = mapped_column(String(20), index=True)  # reset | verify | phone
    # Six digits is guessable by brute force in a way a 32-byte link is not, so
    # SMS codes carry an attempt count and burn out after a handful of tries.
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)
    used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)


class Subscriber(Base):
    """Newsletter sign-up. The footer form used to show a success toast and
    throw the address away, which told people they had subscribed when nothing
    had happened."""
    __tablename__ = "subscribers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(40), default="footer")


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


class ReadingQuestion(Base):
    """One compréhension écrite item, belonging to a numbered test of 40.

    Separate from ExamQuestion: a mock-exam item is a bare stem plus options,
    whereas a reading-practice item carries the teaching material — a level, the
    per-option explanation of why each distractor fails, the line that decides
    the answer, and its vocabulary. Overloading ExamQuestion would have left
    most columns null for every mock-exam row.
    """
    __tablename__ = "reading_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reading_question_id: Mapped[str] = mapped_column(
        String(64), unique=True, index=True)
    test_number: Mapped[int] = mapped_column(Integer, index=True)   # 1-10
    position: Mapped[int] = mapped_column(Integer)                  # 1-40
    level: Mapped[str] = mapped_column(String(4))                   # A1-C2
    band: Mapped[str] = mapped_column(String(40), default="")
    doc_type: Mapped[str] = mapped_column(String(120), default="")
    text: Mapped[str] = mapped_column(Text)
    question_fr: Mapped[str] = mapped_column(Text)
    question_en: Mapped[str] = mapped_column(Text, default="")
    # [{id, text, text_en, explanation}] — the explanation is withheld from the
    # question endpoint and only returned once the learner has answered.
    options: Mapped[Any] = mapped_column(JSONB)
    correct_answer: Mapped[str] = mapped_column(String(8))
    key_line_fr: Mapped[str] = mapped_column(Text, default="")
    key_line_en: Mapped[str] = mapped_column(Text, default="")
    vocabulary: Mapped[Any] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReadingAttempt(Base):
    """A completed reading test, graded on the server."""
    __tablename__ = "reading_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reading_attempt_id: Mapped[str] = mapped_column(
        String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.user_id"), index=True)
    test_number: Mapped[int] = mapped_column(Integer, index=True)
    answers: Mapped[Any] = mapped_column(JSONB, default=dict)
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    time_used_seconds: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True)


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
        "premium": is_premium(u),
        "premium_until": u.premium_until,
        "monthly_reset_date": u.monthly_reset_date,
        "current_streak": u.current_streak or 0,
        "longest_streak": u.longest_streak or 0,
        "last_activity_date": u.last_activity_date,
        "xp": u.xp or 0,
        "badges": u.badges or [],
        "model_answers_read": u.model_answers_read or 0,
        "timezone": u.timezone or "America/Toronto",
        "email_verified": bool(u.email_verified),
        "phone": u.phone,
        "phone_verified": bool(u.phone_verified),
        # Either channel confirms the account; the banner clears on the first.
        "verified": bool(u.email_verified) or bool(u.phone_verified),
        # Shown before the editor, so nobody writes 150 words only to be told
        # afterwards that they had no attempts left.
        "trial": trial_state(u),
        "credits_remaining": (
            None if is_premium(u)
            else max(0, FREE_TRIAL_TOTAL - ((u.free_writing_used or 0)
                                            + (u.free_speaking_used or 0)))),
        "free_trial_total": FREE_TRIAL_TOTAL,
        # Older bundles read this name; it is the same number.
        "free_monthly_limit": FREE_TRIAL_TOTAL,
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


# Compared against when no account matches, so a login attempt for an unknown
# address costs the same ~100ms of bcrypt as a real one.
_DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"prepfrancais-timing-equaliser",
                                     bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str, kind: str, minutes: int = 0, days: int = 0,
               token_version: int = 0) -> str:
    exp = now_utc() + timedelta(minutes=minutes, days=days)
    return jwt.encode(
        {"sub": user_id, "type": kind, "exp": exp, "iat": now_utc(),
         "tv": token_version},
        JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str, expected: str) -> Optional[str]:
    """The subject of a valid token of the expected kind, or None.

    Signature and expiry only. Callers that need revocation to apply must also
    compare the token's `tv` claim with the account's current token_version —
    see decode_token_claims and get_current_user.
    """
    claims = decode_token_claims(token, expected)
    return claims.get("sub") if claims else None


def decode_token_claims(token: str, expected: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != expected:
            return None
        return payload
    except jwt.PyJWTError:
        return None


def token_is_current(claims: dict, user: "User") -> bool:
    """False once the account's token_version has moved past the token's.

    Tokens minted before the column existed carry no `tv`; they are treated as
    version 0, which is what every existing account starts at, so a deploy does
    not sign everybody out.
    """
    return int(claims.get("tv", 0) or 0) >= int(user.token_version or 0)


# ---------------------------------------------------------- link tokens -----
def _hash_link_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def issue_link_token(db: AsyncSession, user_id: str, purpose: str,
                           ttl: timedelta) -> str:
    """Mint a single-use link token and store only its hash.

    Any unused token of the same purpose is retired first, so asking for a
    second reset link immediately invalidates the first.
    """
    await db.execute(
        sa_update(AuthToken)
        .where(AuthToken.user_id == user_id, AuthToken.purpose == purpose,
               AuthToken.used_at.is_(None))
        .values(used_at=now_utc()))
    raw = secrets.token_urlsafe(32)
    db.add(AuthToken(
        token_hash=_hash_link_token(raw), user_id=user_id, purpose=purpose,
        created_at=now_utc(), expires_at=now_utc() + ttl, used_at=None))
    await db.commit()
    return raw


async def issue_phone_code(db: AsyncSession, user_id: str) -> str:
    """Mint a six-digit SMS code, storing only its hash.

    The hash covers the user id as well as the digits: token_hash is unique,
    and two people are going to be sent the same six digits eventually.
    """
    await db.execute(
        sa_update(AuthToken)
        .where(AuthToken.user_id == user_id, AuthToken.purpose == "phone",
               AuthToken.used_at.is_(None))
        .values(used_at=now_utc()))
    code = f"{secrets.randbelow(1000000):06d}"
    db.add(AuthToken(
        token_hash=_hash_link_token(f"{user_id}:{code}"), user_id=user_id,
        purpose="phone", created_at=now_utc(),
        expires_at=now_utc() + timedelta(minutes=PHONE_CODE_TTL_MINUTES),
        used_at=None, attempts=0))
    await db.commit()
    return code


async def consume_phone_code(db: AsyncSession, user_id: str, code: str) -> bool:
    """Spend the outstanding code, or record a failed guess against it."""
    res = await db.execute(
        select(AuthToken).where(
            AuthToken.user_id == user_id, AuthToken.purpose == "phone",
            AuthToken.used_at.is_(None),
            AuthToken.expires_at > now_utc())
        # issue_phone_code retires the previous code, but two requests racing
        # can still leave two live rows — and scalar_one_or_none() raises on
        # that rather than returning either. Newest wins, which is the one the
        # learner is reading off their phone.
        .order_by(AuthToken.created_at.desc()).limit(1))
    row = res.scalars().first()
    if row is None:
        return False
    if _hash_link_token(f"{user_id}:{(code or '').strip()}") != row.token_hash:
        row.attempts = (row.attempts or 0) + 1
        # Burn it rather than leaving a five-guess window open for the next
        # caller to keep chipping at.
        if row.attempts >= PHONE_CODE_MAX_ATTEMPTS:
            row.used_at = now_utc()
        await db.commit()
        return False
    row.used_at = now_utc()
    await db.commit()
    return True


async def consume_link_token(db: AsyncSession, raw: str,
                             purpose: str) -> Optional[str]:
    """Spend a link token, returning the user it belongs to, or None.

    The row is marked used inside the same UPDATE that checks it is unused, so
    two simultaneous clicks cannot both succeed.
    """
    if not raw:
        return None
    res = await db.execute(
        sa_update(AuthToken)
        .where(AuthToken.token_hash == _hash_link_token(raw),
               AuthToken.purpose == purpose,
               AuthToken.used_at.is_(None),
               AuthToken.expires_at > now_utc())
        .values(used_at=now_utc())
        .returning(AuthToken.user_id))
    user_id = res.scalar_one_or_none()
    await db.commit()
    return user_id


# Readable by JavaScript on purpose, and carrying nothing but the fact that a
# session exists. The app used to probe /auth/me on every page load, including
# for anonymous visitors on the landing page, and pay for a 401 plus a failed
# refresh before the marketing copy settled.
SESSION_HINT_COOKIE = "mf_session"


def _set_access_cookie(resp: Response, user_id: str, token_version: int = 0):
    """Secure in production so the cookie is never sent over plain HTTP."""
    resp.set_cookie("access_token",
                    make_token(user_id, "access", minutes=ACCESS_TTL_MIN,
                               token_version=token_version),
                    httponly=True, samesite="lax", secure=IS_PROD,
                    path="/", max_age=ACCESS_TTL_MIN * 60)


def set_auth_cookies(resp: Response, user_id: str, token_version: int = 0):
    _set_access_cookie(resp, user_id, token_version)
    resp.set_cookie("refresh_token",
                    make_token(user_id, "refresh", days=REFRESH_TTL_DAYS,
                               token_version=token_version),
                    httponly=True, samesite="lax", secure=IS_PROD,
                    path="/", max_age=REFRESH_TTL_DAYS * 86400)
    resp.set_cookie(SESSION_HINT_COOKIE, "1",
                    httponly=False, samesite="lax", secure=IS_PROD,
                    path="/", max_age=REFRESH_TTL_DAYS * 86400)


def clear_auth_cookies(resp: Response):
    resp.delete_cookie("access_token", path="/")
    resp.delete_cookie("refresh_token", path="/")
    resp.delete_cookie(SESSION_HINT_COOKIE, path="/")


# ----------------------------------------------------------------------------
# Email
# ----------------------------------------------------------------------------
def _send_email_sync(to: str, subject: str, body: str):
    """Send one plain-text message over SMTP, or log it when unconfigured."""
    if not SMTP_HOST:
        # Development convenience. In production the boot check below refuses
        # to start without SMTP, so this branch cannot silently swallow a
        # password reset in front of real users.
        log.warning("SMTP not configured - %s link for %s:%s%s",
                    subject, to, NEWLINE, body)
        return

    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        if SMTP_STARTTLS:
            smtp.starttls()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> bool:
    """Send off the event loop. A failure is logged, never raised: the caller
    must answer identically whether or not delivery worked, or the endpoint
    becomes a way to test which addresses are registered."""
    try:
        await run_ai(_send_email_sync, to, subject, body)
        return True
    except Exception as exc:  # noqa: BLE001
        log.error("Email send failed (%s): %s", subject, exc)
        return False


def reset_email_body(name: str, link: str) -> str:
    return (f"Bonjour {name},{NEWLINE}{NEWLINE}"
            f"Vous avez demandé à réinitialiser votre mot de passe prepfrancais."
            f"{NEWLINE}Ouvrez ce lien pour en choisir un nouveau :{NEWLINE}{NEWLINE}"
            f"{link}{NEWLINE}{NEWLINE}"
            f"Le lien est valable {RESET_TTL_MINUTES} minutes et ne fonctionne "
            f"qu'une fois.{NEWLINE}{NEWLINE}"
            f"Si vous n'êtes pas à l'origine de cette demande, ignorez ce "
            f"message : votre mot de passe reste inchangé.{NEWLINE}{NEWLINE}"
            f"— prepfrancais")


def normalize_phone(raw: str) -> str:
    """Best-effort E.164. Keeps one leading +, drops spaces, dashes and dots.

    No country is assumed: a number typed without an international prefix is
    rejected rather than silently guessed at, because guessing wrong sends the
    code to a stranger.
    """
    cleaned = re.sub(r"[^\d+]", "", raw or "")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+") or not (8 <= len(cleaned) <= 16):
        raise HTTPException(
            status_code=400,
            detail=("Indiquez le numéro au format international, indicatif "
                    "compris — par exemple +33 6 12 34 56 78."))
    return cleaned


def _send_sms_sync(to: str, body: str):
    """One message through Twilio, or logged when unconfigured."""
    if not SMS_ENABLED:
        log.warning("SMS not configured - message for %s:%s%s", to, NEWLINE, body)
        return

    import requests
    resp = requests.post(
        f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}"
        "/Messages.json",
        auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        data={"From": TWILIO_FROM, "To": to, "Body": body},
        timeout=20)
    resp.raise_for_status()


async def send_sms(to: str, body: str) -> bool:
    """Send off the event loop. Like send_email, a failure is logged and never
    raised: the endpoint must answer the same either way, or it becomes a way
    to test which numbers are registered."""
    try:
        await run_ai(_send_sms_sync, to, body)
        return True
    except Exception as exc:  # noqa: BLE001
        log.error("SMS send failed: %s", exc)
        return False


def phone_code_body(code: str) -> str:
    return (f"{code} est votre code de confirmation prepfrancais. "
            f"Il expire dans {PHONE_CODE_TTL_MINUTES} minutes.")


def verify_email_body(name: str, link: str) -> str:
    return (f"Bonjour {name},{NEWLINE}{NEWLINE}"
            f"Confirmez votre adresse e-mail pour sécuriser votre compte "
            f"prepfrancais :{NEWLINE}{NEWLINE}{link}{NEWLINE}{NEWLINE}"
            f"Le lien est valable {VERIFY_TTL_HOURS} heures.{NEWLINE}{NEWLINE}"
            f"— prepfrancais")


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
    """Who to meter. An authenticated caller is metered on their own account.

    Keying on the IP alone made the budget shared: testing as admin spent the
    allowance the next account to sign in inherited, and everyone behind one
    NAT or proxy — a school, an office, a phone network — competed for a single
    bucket. The access token is read here rather than via get_current_user
    because a dependency cannot depend on another one that may 401, and the
    signature check alone is enough to trust the id for metering.

    Anonymous callers still fall back to the IP; that is all they have.
    """
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        user_id = decode_token(token, "access")
        if user_id:
            return f"user:{user_id}"
    return f"ip:{client_ip(request)}"


def client_ip(request: Request) -> str:
    """The caller's address, trusting X-Forwarded-For only behind our proxy.

    Reading the header unconditionally made the limiter useless against the
    attack it exists to stop: an unauthenticated caller could send a different
    value on every request and never fill a bucket.
    """
    peer = request.client.host if request.client else "unknown"
    if TRUSTED_PROXIES and ("*" in TRUSTED_PROXIES or peer in TRUSTED_PROXIES):
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return peer


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """Dependency factory: at most `limit` calls per `window_seconds` per
    caller — per account when signed in, per IP otherwise."""
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


# Auth is brute-forceable; AI calls cost money. Both are capped per caller.
auth_rate_limit = rate_limit("auth", limit=10, window_seconds=300)
ai_rate_limit = rate_limit("ai", limit=20, window_seconds=300)
# A live conversation spends one request per spoken turn — two on a browser
# without live speech recognition, which also posts the audio to be
# transcribed. A 3½-minute tâche 2 runs 15–30 requests, so metering it on the
# 20-per-5-minutes grading budget cut the candidate off mid-exchange. Turns get
# their own, wider bucket; grading the finished conversation still costs a
# credit and still goes through ai_rate_limit.
turn_rate_limit = rate_limit("turn", limit=120, window_seconds=300)


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
    claims = decode_token_claims(token, "access")
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await get_user_by_id(db, claims.get("sub"))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # A token minted before a logout or a password change is no longer valid,
    # even though its signature and expiry still check out.
    if not token_is_current(claims, user):
        raise HTTPException(status_code=401, detail="Session ended")
    return user


async def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ----------------------------------------------------------------------------
# Freemium limits & streaks
# ----------------------------------------------------------------------------
def is_premium(user: User) -> bool:
    """Premium *and* not expired.

    Every gate used to read subscription_status alone, so once payment set it
    to "premium" there was nothing that could ever take it away again. A NULL
    premium_until still means unlimited - that is the seeded admin and any
    manual grant - but a paid cycle always carries its expiry.
    """
    if (user.subscription_status or "free") != "premium":
        return False
    return user.premium_until is None or user.premium_until > now_utc()


def trial_state(user: User) -> dict:
    """What is left of the free trial, in the shape the paywall renders."""
    premium = is_premium(user)
    w = user.free_writing_used or 0
    sp = user.free_speaking_used or 0
    t2 = user.free_speaking_tache2_used or 0
    return {
        "premium": premium,
        "one_time": True,          # the trial is granted once and never refills
        "writing": {"used": w, "limit": FREE_WRITING_LIMIT,
                    "left": None if premium else max(0, FREE_WRITING_LIMIT - w)},
        "speaking": {"used": sp, "limit": FREE_SPEAKING_LIMIT,
                     "left": None if premium else max(0, FREE_SPEAKING_LIMIT - sp)},
        "speaking_tache2": {
            "used": t2, "limit": FREE_SPEAKING_TACHE2_LIMIT,
            "left": None if premium else max(0, FREE_SPEAKING_TACHE2_LIMIT - t2)},
        "premium_until": user.premium_until,
    }


# What each exhausted allowance says, in the learner's own terms.
_TRIAL_MSG = {
    "writing": (f"Vous avez utilisé vos {FREE_WRITING_LIMIT} corrections "
                "écrites gratuites."),
    "speaking": (f"Vous avez utilisé vos {FREE_SPEAKING_LIMIT} évaluations "
                 "orales gratuites."),
    "speaking_tache2": ("L'essai gratuit comprend un seul exercice en "
                        "interaction (tâche 2)."),
}


def trial_exhausted(kind: str, user: User) -> HTTPException:
    """The 402 every metered endpoint raises once the trial is spent.

    The detail is an object rather than a sentence so the frontend can name the
    allowance that ran out and offer the plans in place, instead of showing the
    learner an API error. `msg` carries the plain sentence, which is what every
    existing toast already reads out of a FastAPI error.
    """
    return HTTPException(status_code=402, detail={
        "code": "trial_exhausted",
        "kind": kind,                       # writing | speaking | speaking_tache2
        "msg": _TRIAL_MSG.get(kind, _TRIAL_MSG["writing"]),
        "trial": trial_state(user),
    })


async def enforce_free_conversation_limit(db: AsyncSession, user: User) -> User:
    """Free-conversation allowance, counted from the conversations already
    graded this month. Derived from the submissions table rather than a new
    user column, so this needs no migration on an existing database."""
    if is_premium(user):
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
        raise HTTPException(status_code=402, detail={
            "code": "conversation_limit",
            "kind": "conversation",
            "msg": (f"Vous avez utilisé vos {FREE_CONVERSATION_LIMIT} conversations "
                    "gratuites ce mois-ci."),
            "trial": trial_state(user),
        })
    return user


async def consume_credit(db: AsyncSession, user_id: str):
    await db.execute(
        sa_update(User).where(User.user_id == user_id)
        .values(free_submissions_used=User.free_submissions_used + 1))
    await db.commit()


async def reserve_credit(db: AsyncSession, user: User, kind: str = "writing",
                         *, tache2: bool = False) -> User:
    """Atomically claim one trial attempt of `kind`, or 402 if none are left.

    Checking the count and incrementing it in two statements lets two parallel
    requests both pass the check, so the increment carries the limits in its
    WHERE clause and the row lock decides the winner. A tâche 2 roleplay claims
    two allowances at once — the speaking one and its own — and doing it in a
    single statement means it can never take one without the other.

    Whatever is claimed here must be handed back with the SAME arguments via
    refund_credit() if the work then fails to grade.
    """
    if is_premium(user):
        return user
    speaking = kind == "speaking"
    conds = ([User.free_speaking_used < FREE_SPEAKING_LIMIT] if speaking
             else [User.free_writing_used < FREE_WRITING_LIMIT])
    values = ({"free_speaking_used": User.free_speaking_used + 1} if speaking
              else {"free_writing_used": User.free_writing_used + 1})
    if speaking and tache2:
        conds.append(
            User.free_speaking_tache2_used < FREE_SPEAKING_TACHE2_LIMIT)
        values["free_speaking_tache2_used"] = User.free_speaking_tache2_used + 1
    values["free_submissions_used"] = User.free_submissions_used + 1
    res = await db.execute(
        sa_update(User).where(User.user_id == user.user_id, *conds)
        .values(**values).returning(User.free_submissions_used))
    if res.scalar_one_or_none() is None:
        await db.rollback()
        # Which of the two ceilings stopped a tâche 2 attempt decides what the
        # paywall says, so read the row back rather than guessing.
        await db.refresh(user)
        if (speaking and tache2
                and (user.free_speaking_tache2_used or 0) >= FREE_SPEAKING_TACHE2_LIMIT):
            raise trial_exhausted("speaking_tache2", user)
        raise trial_exhausted("speaking" if speaking else "writing", user)
    await db.commit()
    await db.refresh(user)
    return user


async def refund_credit(db: AsyncSession, user: User, kind: str = "writing",
                        *, tache2: bool = False):
    """Give a reserved attempt back when the work could not be graded.

    Must mirror the reserve_credit() call that claimed it, or the learner is
    quietly charged for an attempt the AI never delivered.
    """
    if is_premium(user):
        return
    speaking = kind == "speaking"
    col = User.free_speaking_used if speaking else User.free_writing_used
    values = ({"free_speaking_used": User.free_speaking_used - 1} if speaking
              else {"free_writing_used": User.free_writing_used - 1})
    if speaking and tache2:
        values["free_speaking_tache2_used"] = case(
            (User.free_speaking_tache2_used > 0,
             User.free_speaking_tache2_used - 1), else_=0)
    values["free_submissions_used"] = case(
        (User.free_submissions_used > 0, User.free_submissions_used - 1),
        else_=0)
    await db.execute(
        sa_update(User).where(User.user_id == user.user_id, col > 0)
        .values(**values))
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
#
# The default is well above what a grade needs because the reasoning models now
# used for grading draw their thinking from this same budget: 4000 was enough
# for the answer and not always enough for the thinking that precedes it, and
# what came back was a reply cut off mid-JSON. Unused budget costs nothing —
# only the tokens actually generated are billed.
GRADER_MAX_TOKENS = int(os.environ.get("GRADER_MAX_TOKENS", "8000"))

AI_UNAVAILABLE_DETAIL = ("Correction indisponible : le correcteur IA a refusé la "
                         "requête (clé API ou quota du fournisseur). "
                         "Réessayez dans un instant.")
AI_TIMEOUT_DETAIL = ("Correction indisponible : l'analyse a dépassé le délai "
                     "maximum. Réessayez dans un instant.")
# A reply that arrived but could not be read is not a key or quota problem.
# Both used to share AI_UNAVAILABLE_DETAIL, which sent people to their billing
# page over a JSON the model had truncated.
AI_BAD_REPLY_DETAIL = ("Correction indisponible : le correcteur IA a répondu, "
                       "mais sa réponse était incomplète ou illisible. "
                       "Réessayez dans un instant.")


# Which provider and model graded an answer is operational detail: it is kept
# on the analysis so the Admin panel and the logs can use it, but it has no
# business in a learner's result. The writing endpoints never leaked it —
# persist_submission returns DB columns and these are not columns — but the
# speaking ones return the analysis dict itself, so they did.
_INTERNAL_ANALYSIS_KEYS = ("ai_provider", "ai_model", "ai_error")


def public_analysis(analysis: dict) -> dict:
    """The analysis with internal grading metadata removed."""
    return {k: v for k, v in analysis.items()
            if k not in _INTERNAL_ANALYSIS_KEYS}


def public_attempt(attempt: dict) -> dict:
    """An exam attempt with grading metadata stripped from each tâche.

    Applied on read as well as on write: attempts saved before this existed
    still carry ai_provider/ai_model inside their task JSON columns.
    """
    out = dict(attempt)
    for key in ("task1", "task2", "task3"):
        task = out.get(key)
        if isinstance(task, dict) and isinstance(task.get("analysis"), dict):
            out[key] = {**task, "analysis": public_analysis(task["analysis"])}
    return out


def ai_error_detail(analysis: dict) -> str:
    """The message matching what actually failed, not a catch-all."""
    if analysis.get("ai_error") == "bad_reply":
        return AI_BAD_REPLY_DETAIL
    return AI_UNAVAILABLE_DETAIL
# Returned with 422 when a recording produced no transcript. The credit is
# refunded first, so the message can promise that plainly.
NO_SPEECH_DETAIL = ("Aucune parole n'a été détectée dans cet enregistrement. "
                    "Votre crédit vous a été rendu — vérifiez votre micro et "
                    "réessayez.")

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
    resp = _anthropic_client().messages.create(
        model=model,
        max_tokens=GRADER_MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_text}],
    )
    parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
    out = "".join(parts).strip()
    if out:
        return out
    # Same trap _call_openai_compatible documents: an empty 200 is not a key or
    # quota failure, but returning "" made the caller report one.
    stop = getattr(resp, "stop_reason", None)
    hint = ""
    if stop == "max_tokens":
        hint = (f" The {GRADER_MAX_TOKENS}-token budget was used up before any "
                f"answer was written - raise GRADER_MAX_TOKENS.")
    raise RuntimeError(
        f"{model} returned an empty completion "
        f"(stop_reason={stop}, usage={getattr(resp, 'usage', None)}).{hint}")


def _call_openai(model: str, system_prompt: str, user_text: str) -> str:
    resp = _openai_client("openai", OPENAI_API_KEY).chat.completions.create(
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
    hint = ""
    if choice.finish_reason == "length":
        hint = (f" The {GRADER_MAX_TOKENS}-token budget was used up before any "
                f"answer was written - raise GRADER_MAX_TOKENS.")
    raise RuntimeError(
        f"{model} returned an empty completion "
        f"(finish_reason={choice.finish_reason}, "
        f"usage={getattr(resp, 'usage', None)}).{hint}")


def _call_gemini(model: str, system_prompt: str, user_text: str) -> str:
    from google.genai import types
    resp = _gemini_client().models.generate_content(
        model=model,
        contents=user_text,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            # This was pinned at 2000 while every other provider used
            # GRADER_MAX_TOKENS, so Gemini alone still had the bug that
            # constant was introduced to fix: a long Tache 3 reply ran past the
            # budget and arrived truncated mid-JSON. The 2.5 models make it
            # worse - thinking tokens are drawn from this same budget, so it
            # can be spent before a single character of the answer is written.
            # Either way the reply is unparseable, and the learner was told the
            # API key or quota was at fault.
            max_output_tokens=GRADER_MAX_TOKENS,
        ),
    )
    # .text is a property that raises when the reply carries no candidate.
    try:
        text = (resp.text or "").strip()
    except Exception:  # noqa: BLE001
        text = ""
    if text:
        return text
    cand = (getattr(resp, "candidates", None) or [None])[0]
    finish = getattr(cand, "finish_reason", None)
    hint = ""
    if "MAX_TOKENS" in str(finish):
        hint = (f" The {GRADER_MAX_TOKENS}-token budget was used up before any "
                f"answer was written - raise GRADER_MAX_TOKENS.")
    raise RuntimeError(
        f"{model} returned an empty completion (finish_reason={finish}, "
        f"prompt_feedback={getattr(resp, 'prompt_feedback', None)}, "
        f"usage={getattr(resp, 'usage_metadata', None)}).{hint}")


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
    client = _openai_client(f"compat:{base_url}", api_key, base_url)
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
    # empty; the JSON we want may be in there. But a thinking model that ran
    # out of budget mid-thought ALSO arrives this way, and handing that prose
    # back turned a diagnosable "raise GRADER_MAX_TOKENS" into an unreadable
    # reply the learner was told to retry. Only pass it on when it actually
    # carries the answer.
    reasoning = (getattr(choice.message, "reasoning_content", None)
                 or getattr(choice.message, "reasoning", None) or "").strip()
    if reasoning and "{" in reasoning:
        log.warning("%s returned empty content; using reasoning_content "
                    "(finish_reason=%s)", model, choice.finish_reason)
        return reasoning

    usage = getattr(resp, "usage", None)
    hint = ""
    if choice.finish_reason == "length":
        hint = (f" The {GRADER_MAX_TOKENS}-token budget was used up before any "
                f"answer was written — raise GRADER_MAX_TOKENS.")
        if reasoning:
            hint += (f" It was spent thinking: {len(reasoning)} characters of "
                     f"reasoning arrived and no answer.")
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


# Provider errors that will fail again however many times they are retried.
_TERMINAL_ERROR_HINTS = (
    "invalid_api_key", "invalid api key", "incorrect api key",
    "insufficient_quota", "insufficient balance", "insufficient_balance",
    "billing", "unauthorized", "permission_denied", "api key not valid",
)


def _is_terminal_provider_error(exc: Exception) -> bool:
    """True for a key/billing rejection, false for a transient failure."""
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status in (401, 403):
        return True
    blob = f"{type(exc).__name__} {exc}".lower()
    return any(h in blob for h in _TERMINAL_ERROR_HINTS)


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
    last_exc = None
    attempts = 2
    for attempt in range(attempts):
        try:
            started = time.monotonic()
            out = await run_ai(fn, model, system_prompt, user_text)
            # "Why is this taking so long?" is unanswerable without a number.
            # The whole visible wait is this one call: the progress stages the
            # browser shows are on a fixed 0.6s tick and finish long before it.
            log.info("Graded with %s/%s in %.1fs (%d chars in, %d out)",
                     provider, model, time.monotonic() - started,
                     len(user_text), len(out or ""))
            _PROVIDER_LAST_ERROR.pop(provider, None)
            return out
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.warning("Grading call failed (%s/%s attempt %s): %s",
                        provider, model, attempt + 1, exc)
            # A rejected key or an exhausted quota is not transient: retrying
            # buys nothing and doubles the failed calls against the account.
            if _is_terminal_provider_error(exc):
                break
            if attempt < attempts - 1:
                await asyncio.sleep(0.5)
    _PROVIDER_LAST_ERROR[provider] = f"{type(last_exc).__name__}: {_scrub_secrets(last_exc)}"
    return None


_LEVEL_RE = re.compile(r"\b([ABC][12])\b")


def _normalise_level(raw) -> Optional[str]:
    """The CEFR level inside whatever the grader wrote, or None."""
    hit = _LEVEL_RE.search(str(raw).upper())
    return hit.group(1) if hit and hit.group(1) in CEFR_LEVELS else None


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
        score = max(0, min(100, int(float(str(data["overall_score"]).strip()
                                         .split("/")[0].replace("%", "")))))
    except (TypeError, ValueError):
        raise ValueError("grader returned a non-numeric overall_score")
    # "b1", "B1+", "Niveau B2" and "B2 (autonome)" all mean a level this
    # rubric has. Rejecting them threw away a correction the model had in
    # fact produced, and told the learner its reply was illegible.
    level = _normalise_level(data["tcf_level"])
    if level is None:
        raise ValueError(
            f"grader returned an unknown level: {data['tcf_level']!r}")
    return {
        "errors": errors,
        "overall_score": score,
        "tcf_level": level,
        "improvement_suggestions": [str(x) for x in (data.get("improvement_suggestions") or [])][:8],
        "linking_words": [str(x) for x in (data.get("linking_words") or [])][:12],
        "vocabulary_suggestions": [str(x) for x in (data.get("vocabulary_suggestions") or [])][:12],
    }


# Appended to the prompt on the single retry an unreadable reply earns.
JSON_RETRY_NUDGE = ("\n\nIMPORTANT: your previous reply could not be parsed. "
                    "Return ONLY the JSON object - start with { and end with }, "
                    "no markdown fence, no preamble, no commentary.")


async def _graded_json(provider: str, system_prompt: str, prompt: str,
                       validate) -> Tuple[Optional[dict], Optional[str]]:
    """Grade, read the JSON back, and re-ask once if it cannot be read.

    A grader that wraps its object in a sentence or stops mid-JSON has almost
    always made a formatting slip rather than refused the work, and asking
    again usually gets a clean reply. It used to get one attempt, so a slip
    cost the learner the whole correction and the credit that paid for it.

    Returns (analysis, None) on success, or (None, reason) where reason is
    "unavailable" when the provider never answered and "bad_reply" when it
    answered with something unreadable twice. The detail is left on
    _PROVIDER_LAST_ERROR and in the log either way.
    """
    last_exc = None
    for attempt in range(2):
        raw = await _grade_with_provider(
            provider, system_prompt,
            prompt if attempt == 0 else prompt + JSON_RETRY_NUDGE)
        # No reply at all is a key, quota or network problem, and _grade_with_
        # provider has already recorded which. Re-asking cannot help.
        if raw is None:
            return None, "unavailable"
        try:
            return validate(_extract_json(raw)), None
        except Exception as exc:  # noqa: BLE001
            # Log what actually came back. Without this the provider looks dead
            # when in fact it replied and only the shape was wrong.
            last_exc = exc
            log.warning("Could not parse grading JSON (%s, attempt %s/2): %s "
                        "| reply[:400]=%r", provider, attempt + 1, exc,
                        _scrub_secrets(raw)[:400])
    _PROVIDER_LAST_ERROR[provider] = (
        f"Replied, but the response could not be parsed: {last_exc}")
    return None, "bad_reply"


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

    # The caps run inside the parse step on purpose: they are part of turning a
    # reply into a grade, so a retry that produces a readable reply gets them
    # applied too.
    def build(data: dict) -> dict:
        result = _validate_analysis(data)
        result = apply_error_cap(result)
        return apply_writing_length_cap(result, text, task_type)

    result, reason = await _graded_json(provider, GRADER_SYSTEM, prompt, build)
    if result is None:
        return ({**dict(FALLBACK_ANALYSIS), "ai_error": "bad_reply"}
                if reason == "bad_reply" else dict(FALLBACK_ANALYSIS))
    _, _, model = _grader_backend(provider)
    result["ai_provider"] = provider
    result["ai_model"] = model
    return result


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
    fresh = []
    for err in analysis.get("errors", []):
        if err["category"] == "improvement":
            continue  # improvements are not mistakes
        fresh.append((normalize_error_text(err["error"]), err))
    if not fresh:
        return

    # One query for every error in the submission, instead of one SELECT and
    # one COMMIT each: a 15-error essay cost about thirty sequential round
    # trips and fifteen transactions, all inside the request the learner was
    # waiting on.
    res = await db.execute(
        select(Mistake).where(
            Mistake.user_id == user_id,
            Mistake.normalized_error.in_([norm for norm, _ in fresh])))
    by_key = {(m.category, m.normalized_error): m for m in res.scalars().all()}

    seen = now_utc()
    for norm, err in fresh:
        existing = by_key.get((err["category"], norm))
        if existing:
            # Meeting a mastered mistake again puts it back into rotation.
            existing.status = ("new" if existing.status == "mastered"
                               else (existing.status or "new"))
            existing.times_repeated = (existing.times_repeated or 0) + 1
            existing.last_seen_at = seen
            continue
        distractor = STATIC_DISTRACTORS.get(err["category"],
                                            "réponse incorrecte")
        if generate_distractors:
            distractor = await generate_distractor(
                err["error"], err["correction"], err["category"], db=db)
        new_row = Mistake(
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
            created_at=seen,
            last_seen_at=seen,
            status="new",
            times_repeated=1,
            srs_interval_index=0,
            srs_due_at=seen,
            srs_consecutive_got_it=0,
        )
        db.add(new_row)
        # The same error can appear twice in one submission; keep the row that
        # was just added so the second occurrence increments it.
        by_key[(err["category"], norm)] = new_row

    # A single transaction for the whole submission.
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
- N'utilise jamais l'anglais.
- Écris comme on PARLE, pas comme on écrit : phrases courtes, ponctuation généreuse (virgules, points) — ta réplique est lue à voix haute par une synthèse vocale, et la ponctuation EST le rythme et les pauses.
- Tu peux ouvrir par un petit mot naturel quand c'est justifié (« Alors, », « Eh bien, », « Bien sûr, », « Ah, »), mais pas à chaque réplique. Jamais d'hésitations écrites (« euh », « hmm »), jamais de didascalies (*sourire*), jamais d'émojis."""

# Tâche 2 only. The agent's job there is to be a wall the candidate has to
# question, so a helpful reply is a broken one: listing what else it could tell
# them hands over the very questions the exam asks the candidate to find. Tâche
# 1 and free practice keep the base persona, where the agent does lead.
INTERACTION_AGENT_TACHE2_EXTRA = """

TÂCHE 2 — RÈGLES SUPPLÉMENTAIRES (c'est le candidat qui mène, pas toi) :
- Ultra bref : 1 à 2 phrases courtes, 25 mots maximum. UNE seule information par réplique.
- Réponds SEULEMENT à ce qui vient d'être demandé. N'ajoute aucun détail que le candidat n'a pas réclamé, même s'il te semble utile.
- Ne souffle JAMAIS la suite : pas de « Voulez-vous aussi savoir… », pas de « Il y a aussi… », pas de « N'hésitez pas à demander… », pas de liste d'options, pas d'annonce de ce que tu peux fournir. Trouver les bonnes questions fait partie de l'épreuve.
- Ne termine pas par une question, SAUF si le candidat s'est tu, est incompréhensible ou part hors sujet : dans ce cas, une seule relance neutre (« Pardon, vous pouvez répéter ? »).
- Ta toute première réplique est une ouverture de service minimale, sans aucun détail : par exemple « Bonjour, je vous écoute. »"""

INTERACTION_GRADER_SYSTEM = """You are a certified TCF Canada examiner grading Tâche 2 (Exercice en Interaction) - a two-way roleplay in which the CANDIDATE had to ask questions to obtain information from an agent.

You receive the CONSIGNE (the scenario) and the full DIALOGUE. Grade ONLY the candidate's turns. The transcript comes from speech recognition, so judge charitably where a word is clearly a transcription artifact rather than a learner error.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{"answers_question": true, "relevance_comment": "one sentence (English) on whether the candidate obtained the information the consigne asked for", "errors":[{"error":"wrong text","correction":"fixed","explanation":"why (English)","category":"prepositions|spelling|conjugation|gender_number|anglicism|improvement"}], "overall_score": 50, "tcf_level":"B1", "suggestions":["concrete English suggestion"], "vocabulary_suggestions":["French word/phrase"], "missed_questions":[{"question":"question in French the candidate should have asked","why":"what it would have obtained (English)"}]}

Because this task is INTERACTION, weigh these alongside grammar and vocabulary:
1. QUESTION QUALITY - did the candidate actually ask questions, and were they well formed? Flat statements, or questions built only by raising intonation ("vous avez des places ?") where inversion or est-ce que is expected, are the single most common Tâche 2 weakness. Report them as errors.
2. COVERAGE - did the candidate obtain every piece of information the consigne listed? Set answers_question false if points were missed, and say which in relevance_comment.
3. REGISTER - consistent vouvoiement in a formal scenario (or tutoiement in an informal one), plus politeness formulas (bonjour, s'il vous plaît, je voudrais savoir, merci).
4. INTERACTION - did the candidate react to the agent's answers and follow up, or ignore them and read a list?

CEFR scoring (overall_score 0-100, tcf_level one of A1,A2,B1,B2,C1,C2):
- A1 (5-19) A2 (20-39) B1 (40-54) B2 (55-69) C1 (70-84) C2 (85-100).
Cap the score at B1 if the candidate asked fewer than three real questions or missed most of the required information.

suggestions: 3-5 concrete English tips for THIS conversation. vocabulary_suggestions: French phrases that would have made the asking more idiomatic.

missed_questions - "What more could you have asked?". List 2 to 5 questions, WORD FOR WORD IN FRENCH and ready to speak, that the candidate did not ask but should have. Draw them first from the points the consigne lists and the candidate skipped, then from the openings the agent left unexplored (a price mentioned without conditions, a date without a deadline). Never repeat a question the candidate already asked, even in other words. If the candidate genuinely covered everything, return the questions that would have deepened the exchange rather than an empty list.

You are grading a transcript, so do NOT comment on pronunciation or accent."""

INTERVIEW_GRADER_SYSTEM = """You are a certified TCF Canada examiner grading Tâche 1 (Entretien dirigé) - a guided interview in which the EXAMINER asks and the CANDIDATE answers questions about themselves: who they are, their studies or work, their daily life, their interests and their plans.

You receive the BRIEF and the full DIALOGUE. Grade ONLY the candidate's turns. The transcript comes from speech recognition, so judge charitably where a word is clearly a transcription artifact rather than a learner error.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{"answers_question": true, "relevance_comment": "one sentence (English) on whether the candidate answered what was asked", "errors":[{"error":"wrong text","correction":"fixed","explanation":"why (English)","category":"prepositions|spelling|conjugation|gender_number|anglicism|improvement"}], "overall_score": 50, "tcf_level":"B1", "suggestions":["concrete English suggestion"], "vocabulary_suggestions":["French word/phrase"]}

This task is a PRESENTATION, not an interaction. The candidate is NOT expected to ask questions, and must never be penalised for not asking any. Weigh instead:
1. ANSWERING - did the candidate actually answer each question, rather than talking past it?
2. DEVELOPMENT - are the answers developed with a reason, an example or a detail, or are they bare one-liners?
3. RANGE - varied tenses (present, past, future and plans), connectors, and vocabulary beyond the most basic.
4. FLUENCY OF DISCOURSE - does the answer hold together, or is it a list of disconnected sentences?

CEFR scoring (overall_score 0-100, tcf_level one of A1,A2,B1,B2,C1,C2):
- A1 (5-19) A2 (20-39) B1 (40-54) B2 (55-69) C1 (70-84) C2 (85-100).
Cap the score at B1 if the candidate answered only in short bare phrases with no development.

suggestions: 3-5 concrete English tips for THIS interview. vocabulary_suggestions: French words and phrases that would have made the self-presentation richer. You are grading a transcript, so do NOT comment on pronunciation or accent."""

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


async def interaction_reply(consigne: str, history: list, db=None,
                            mode: str = "tache2") -> str:
    """Next in-character line from the agent. Empty string on provider failure.

    `mode` picks the persona's brief: tâche 2 answers narrowly and never
    signposts what could be asked next, because finding the questions is the
    thing being examined. Tâche 1 and free practice keep the base persona.
    """
    prompt = (_render_dialogue(history, consigne) +
              "\n\nDonne maintenant la prochaine réplique de l'Agent, et rien d'autre.")
    provider = (await get_provider(db, "speaking_grader_provider")) if db is not None else SPEAKING_GRADER_PROVIDER
    system = INTERACTION_AGENT_SYSTEM + (INTERACTION_AGENT_TACHE2_EXTRA if mode == "tache2" else "")
    raw = await _grade_with_provider(provider, system, prompt)
    if not raw:
        return ""
    reply = _strip_fences(raw).strip()
    # Models occasionally prefix the speaker label despite the instruction.
    for prefix in ("Agent :", "Agent:", "AGENT :", "AGENT:"):
        if reply.startswith(prefix):
            reply = reply[len(prefix):].strip()
    return reply[:600]


async def grade_interaction(consigne: str, history: list, db=None,
                            task_type: Optional[int] = 2) -> dict:
    """Grade a finished spoken dialogue, returning the same shape as
    analyze_speaking_with_ai so the existing result UI renders unchanged.

    `task_type` picks the examiner. Tâche 1 is a guided interview in which the
    candidate ANSWERS questions about themselves; tâche 2 is a roleplay in which
    they ASK them. Grading both with the interaction examiner — as this did
    until now — scored a tâche 1 self-presentation on "did the candidate ask
    questions", which it is not supposed to contain, and capped a good answer at
    B1. Pass None for open-ended practice, which is not an exam task and so
    takes no exam caps.
    """
    said = [t for t in history if t.get("role") == "candidate" and str(t.get("text", "")).strip()]
    if not said:
        # Handing in before saying anything is a normal thing to do — the
        # learner ends the roleplay early, or the microphone caught nothing.
        # It used to fall through FALLBACK_ANALYSIS, whose ai_unavailable flag
        # made the endpoint answer 503 "the AI interlocutor is unavailable":
        # false, alarming, and it threw away the attempt. Say what actually
        # happened instead, and let the caller give the credit back.
        return {**dict(FALLBACK_ANALYSIS), "ai_unavailable": False,
                "no_speech": True, "answers_question": False,
                "relevance_comment": ("Nothing was recorded, so there is no "
                                      "answer to grade. Start the roleplay "
                                      "again and ask the agent your first "
                                      "question."),
                "suggestions": [], "missed_questions": []}
    provider = (await get_provider(db, "speaking_grader_provider")) if db is not None else SPEAKING_GRADER_PROVIDER
    grader = (INTERVIEW_GRADER_SYSTEM if task_type == 1
              else INTERACTION_GRADER_SYSTEM)
    raw = await _grade_with_provider(provider, grader,
                                     _render_dialogue(history, consigne))
    if raw is None:
        return {**dict(FALLBACK_ANALYSIS), "answers_question": False,
                "relevance_comment": "", "suggestions": []}
    try:
        result = _validate_speaking(_extract_json(raw))
        _, _, model = _grader_backend(provider)
        result["ai_provider"] = provider
        result["ai_model"] = model
        # Grade only what the candidate said, under their own tâche's caps.
        spoken = " ".join(str(t.get("text", "")) for t in said)
        if task_type != 2:
            # "What more could you have asked?" is a tâche 2 idea: there is
            # nothing to ask in a self-presentation or in free practice.
            result["missed_questions"] = []
        return apply_speaking_caps(result, spoken, task_type)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not parse interaction JSON (%s): %s", provider, exc)
        _PROVIDER_LAST_ERROR[provider] = (
            f"Replied, but the response could not be parsed: {exc}")
        return {**dict(FALLBACK_ANALYSIS), "ai_error": "bad_reply",
                "answers_question": False,
                "relevance_comment": "", "suggestions": []}


# Extension -> MIME, used only when the client did not send the real type.
# Safari records MP4 and every other browser records WebM, so guessing from a
# hardcoded ".webm" name is exactly how iOS recordings used to fail.
_AUDIO_MIME_BY_EXT = {
    "webm": "audio/webm", "m4a": "audio/mp4", "mp4": "audio/mp4",
    "mp3": "audio/mpeg", "mpga": "audio/mpeg", "wav": "audio/wav",
    "ogg": "audio/ogg", "oga": "audio/ogg", "aac": "audio/aac",
    "flac": "audio/flac", "caf": "audio/x-caf",
}
_ALLOWED_AUDIO_MIME = set(_AUDIO_MIME_BY_EXT.values())


def resolve_audio_mime(filename: str, declared: Optional[str]) -> str:
    """The recording's real container.

    The browser now sends what MediaRecorder actually produced; fall back to
    the extension only when it did not, and to WebM when neither is usable.
    """
    got = (declared or "").split(";")[0].strip().lower()
    if got in _ALLOWED_AUDIO_MIME:
        return got
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    return _AUDIO_MIME_BY_EXT.get(ext, "audio/webm")


def _transcribe_openai(audio_bytes: bytes, filename: str, mime: str = "") -> str:
    import io
    del mime  # the OpenAI SDK infers the format from buf.name
    client = _openai_client("openai", OPENAI_API_KEY)
    buf = io.BytesIO(audio_bytes)
    buf.name = filename or "audio.webm"
    resp = client.audio.transcriptions.create(
        model=OPENAI_TRANSCRIBE_MODEL, file=buf, language="fr")
    return (resp.text or "").strip()


def _transcribe_gemini(audio_bytes: bytes, filename: str, mime: str = "") -> str:
    from google.genai import types
    client = _gemini_client()
    mime = mime or resolve_audio_mime(filename, None)
    resp = client.models.generate_content(
        model=GEMINI_TRANSCRIBE_MODEL,
        contents=[
            "Transcribe this French audio exactly. Return ONLY the transcript text.",
            types.Part.from_bytes(data=audio_bytes, mime_type=mime),
        ],
    )
    return (resp.text or "").strip()


def _transcribe_groq(audio_bytes: bytes, filename: str, mime: str = "") -> str:
    """Transcribe with Groq Whisper (OpenAI-compatible audio endpoint)."""
    import io
    del mime  # same as OpenAI: the filename carries the format
    client = _openai_client(f"compat:{GROQ_BASE_URL}", GROQ_API_KEY, GROQ_BASE_URL)
    buf = io.BytesIO(audio_bytes)
    buf.name = filename or "audio.webm"
    resp = client.audio.transcriptions.create(
        model=GROQ_TRANSCRIBE_MODEL, file=buf, language="fr")
    return (resp.text or "").strip()


async def _transcribe_assemblyai_async(audio_bytes: bytes, filename: str,
                                       mime: str = "") -> str:
    """Transcribe with AssemblyAI: upload bytes, submit job, poll for result.

    Async because the poll loop waits up to a minute. Done with time.sleep on a
    worker thread, choosing AssemblyAI in the Admin panel silently cut the
    server's concurrent-grading capacity: each transcription held one of the
    pool's threads for the whole wait while doing nothing. asyncio.sleep costs
    no thread at all.
    """
    del mime  # AssemblyAI sniffs the container from the uploaded bytes
    session = _requests_session()

    def post_upload():
        r = session.post(f"{ASSEMBLYAI_BASE_URL}/v2/upload",
                         data=audio_bytes, timeout=AI_HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()["upload_url"]

    def post_job(audio_url):
        r = session.post(f"{ASSEMBLYAI_BASE_URL}/v2/transcript",
                         json={"audio_url": audio_url,
                               "language_code": ASSEMBLYAI_LANGUAGE},
                         timeout=AI_HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()["id"]

    def poll(url):
        r = session.get(url, timeout=AI_HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()

    audio_url = await run_ai(post_upload)
    tid = await run_ai(post_job, audio_url)
    poll_url = f"{ASSEMBLYAI_BASE_URL}/v2/transcript/{tid}"
    for _ in range(40):
        data = await run_ai(poll, poll_url)
        status = data.get("status")
        if status == "completed":
            return (data.get("text") or "").strip()
        if status == "error":
            raise RuntimeError(data.get("error", "AssemblyAI transcription error"))
        await asyncio.sleep(1.5)
    raise RuntimeError("AssemblyAI transcription timed out")


async def transcribe_audio(audio_bytes: bytes, filename: str, db=None,
                           mime: str = "") -> str:
    """Transcribe using the active provider (Admin panel overrides .env).

    Returns "" when transcription fails or produces nothing. Callers that spend
    a credit MUST treat an empty transcript as a failure and refund it: an
    empty string was previously graded as if it were an answer.
    """
    provider = (await get_provider(db, "transcribe_provider")) if db is not None else TRANSCRIBE_PROVIDER
    if provider == "gemini":
        fn, key = _transcribe_gemini, GEMINI_API_KEY
    elif provider == "groq":
        fn, key = _transcribe_groq, GROQ_API_KEY
    elif provider == "assemblyai":
        fn, key = None, ASSEMBLYAI_API_KEY   # async, dispatched below
    else:
        fn, key = _transcribe_openai, OPENAI_API_KEY
        provider = "openai"
    if not _key_is_usable(key):
        log.warning("No usable API key for transcription provider '%s'", provider)
        return ""
    try:
        if provider == "assemblyai":
            return await _transcribe_assemblyai_async(audio_bytes, filename, mime)
        return await run_ai(fn, audio_bytes, filename, mime)
    except Exception as exc:  # noqa: BLE001
        log.warning("Transcription failed (%s): %s", provider, _scrub_secrets(exc))
        return ""


def _validate_speaking(data: dict) -> dict:
    base = _validate_analysis(data)
    base["answers_question"] = bool(data.get("answers_question", False))
    base["relevance_comment"] = str(data.get("relevance_comment", ""))[:400]
    base["suggestions"] = [str(x) for x in (data.get("suggestions") or [])][:8]
    # "What more could you have asked?" — tâche 2 only, empty elsewhere. Models
    # sometimes return bare strings instead of the {question, why} object, so
    # both shapes are accepted rather than dropping the whole section.
    missed = []
    for item in (data.get("missed_questions") or [])[:5]:
        if isinstance(item, dict):
            question = str(item.get("question", "")).strip()
            why = str(item.get("why", "")).strip()
        else:
            question, why = str(item).strip(), ""
        if question:
            missed.append({"question": question[:200], "why": why[:300]})
    base["missed_questions"] = missed
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
        return {**dict(FALLBACK_ANALYSIS), "ai_error": "bad_reply",
                "answers_question": False,
                "relevance_comment": "", "suggestions": []}


# ----------------------------------------------------------------------------
# Billing models
# ----------------------------------------------------------------------------
class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Our id, and the one Cashfree is told to use, so a webhook can be matched
    # back to a row without trusting anything the browser sent.
    subscription_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    plan_id: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    cf_subscription_id: Mapped[Optional[str]] = mapped_column(
        String(128), nullable=True)
    current_period_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BillingEvent(Base):
    """Every webhook Cashfree sends, kept whole.

    The unique event_key is what makes the webhook idempotent: Cashfree retries
    until it gets a 2xx, and without this a retried payment notification would
    grant a second month for one charge.
    """
    __tablename__ = "billing_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_key: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    subscription_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ----------------------------------------------------------------------------
# Billing — Cashfree recurring subscriptions
# ----------------------------------------------------------------------------
# Card details never reach this server: /billing/subscribe creates a mandate at
# Cashfree and hands back their authorisation link, the learner authorises it
# there, and the webhook below is what actually grants premium. The browser is
# never trusted to report a payment — a POST from the client can be forged, a
# signed webhook cannot.
CASHFREE_APP_ID = os.environ.get("CASHFREE_APP_ID", "")
CASHFREE_SECRET_KEY = os.environ.get("CASHFREE_SECRET_KEY", "")
CASHFREE_ENV = os.environ.get("CASHFREE_ENV", "sandbox").lower()
CASHFREE_API_VERSION = os.environ.get("CASHFREE_API_VERSION", "2025-01-01")
CASHFREE_BASE_URL = os.environ.get(
    "CASHFREE_BASE_URL",
    "https://api.cashfree.com/pg" if CASHFREE_ENV in {"production", "prod"}
    else "https://sandbox.cashfree.com/pg")
# Cashfree signs webhooks with the same client secret unless a separate one is
# configured in the dashboard.
CASHFREE_WEBHOOK_SECRET = (os.environ.get("CASHFREE_WEBHOOK_SECRET", "")
                           or CASHFREE_SECRET_KEY)
# Cashfree subscription plans are INR by default and non-INR needs the
# international product enabled on the account. Kept as one env var so a
# currency that the account cannot actually charge is a config change, not a
# code change.
BILLING_CURRENCY = os.environ.get("BILLING_CURRENCY", "USD").upper()
# The mandate is authorised with a small charge that is refunded immediately.
BILLING_AUTH_AMOUNT = float(os.environ.get("BILLING_AUTH_AMOUNT", "1"))
# How many cycles a mandate is allowed to run before the learner must re-authorise.
BILLING_MAX_CYCLES = int(os.environ.get("BILLING_MAX_CYCLES", "60"))


def _billing_price(name: str, default: str) -> float:
    return float(os.environ.get(f"BILLING_PRICE_{name.upper()}", default))


def _billing_first_price(name: str, default: str) -> float:
    return float(os.environ.get(f"BILLING_FIRST_{name.upper()}", default))


# The catalogue lives here, not in the frontend: an amount the browser sends is
# an amount the browser can change. frontend/src/lib/plans.js renders whatever
# GET /api/billing/plans returns.
#
# `first_amount` is the introductory rate for an account that has never paid.
# It is not a first-cycle-only discount: whoever takes it keeps that rate for
# as long as the subscription runs, which is the one shape Cashfree's immutable
# plans model natively - one plan per price, no mid-mandate amount change.
BILLING_PLANS = {
    "week": {"name": "1 Week",
             "amount": _billing_price("week", "20"),
             "first_amount": _billing_first_price("week", "15"),
             "interval_type": "week", "intervals": 1, "bonus": 3},
    "month": {"name": "1 Month",
              "amount": _billing_price("month", "80"),
              "first_amount": _billing_first_price("month", "60"),
              "interval_type": "month", "intervals": 1, "bonus": 8},
    "quarter": {"name": "3 Months",
                "amount": _billing_price("quarter", "220"),
                "first_amount": _billing_first_price("quarter", "180"),
                "interval_type": "month", "intervals": 3, "bonus": 15},
}

# How long one paid cycle grants premium for. Kept beside the plan rather than
# derived from the webhook, which does not always carry a period end.
_PLAN_PERIOD = {
    "day": lambda n: timedelta(days=n),
    "week": lambda n: timedelta(weeks=n),
    "month": lambda n: timedelta(days=30 * n),
    "year": lambda n: timedelta(days=365 * n),
}


def plan_period(plan: dict) -> timedelta:
    fn = _PLAN_PERIOD.get(plan["interval_type"], _PLAN_PERIOD["month"])
    return fn(plan["intervals"])


def billing_configured() -> bool:
    return bool(CASHFREE_APP_ID and CASHFREE_SECRET_KEY)


def _cf_request_sync(method: str, path: str, payload: Optional[dict] = None) -> dict:
    import requests
    resp = requests.request(
        method, f"{CASHFREE_BASE_URL}{path}",
        headers={
            "x-client-id": CASHFREE_APP_ID,
            "x-client-secret": CASHFREE_SECRET_KEY,
            "x-api-version": CASHFREE_API_VERSION,
            "Content-Type": "application/json",
        },
        json=payload, timeout=30)
    try:
        data = resp.json()
    except ValueError:
        data = {"raw": resp.text[:2000]}
    if resp.status_code >= 400:
        # Cashfree puts the useful part in `message`; the status alone says
        # nothing about which field was rejected.
        raise RuntimeError(
            f"Cashfree {method} {path} -> {resp.status_code}: "
            f"{data.get('message') or data.get('raw') or data}")
    return data


async def cf_request(method: str, path: str, payload: Optional[dict] = None) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, functools.partial(_cf_request_sync, method, path, payload))


def verify_cashfree_signature(raw_body: bytes, signature: str,
                              timestamp: str) -> bool:
    """Cashfree signs base64(HMAC-SHA256(timestamp + rawBody, secret)).

    Compared with compare_digest so a wrong signature cannot be recovered one
    byte at a time from the response timing.
    """
    if not (signature and timestamp and CASHFREE_WEBHOOK_SECRET):
        return False
    mac = hmac.new(CASHFREE_WEBHOOK_SECRET.encode("utf-8"),
                   timestamp.encode("utf-8") + raw_body, hashlib.sha256)
    expected = base64.b64encode(mac.digest()).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def _dig(data: Any, *names: str) -> Any:
    """First value found under any of `names`, at any depth.

    Cashfree's subscription payloads have moved fields between the top level
    and nested objects across API versions, and the webhook body is not the
    same shape as the create response. Searching by name survives that.
    """
    if isinstance(data, dict):
        for name in names:
            if data.get(name) not in (None, ""):
                return data[name]
        for value in data.values():
            found = _dig(value, *names)
            if found is not None:
                return found
    elif isinstance(data, list):
        for item in data:
            found = _dig(item, *names)
            if found is not None:
                return found
    return None


async def has_paid_before(db: AsyncSession, user_id: str) -> bool:
    """Has this account ever completed a payment?

    Keyed on current_period_end, which only the payment-success branch of the
    webhook ever writes. Counting subscription rows instead would have burned
    the introductory rate on someone who opened a checkout and abandoned it.
    """
    n = await db.scalar(
        select(func.count()).select_from(Subscription)
        .where(Subscription.user_id == user_id,
               Subscription.current_period_end.isnot(None)))
    return bool(n)


def plan_price(plan: dict, first_time: bool) -> float:
    """What this buyer actually pays. Never read from the request."""
    if first_time and plan.get("first_amount"):
        return float(plan["first_amount"])
    return float(plan["amount"])


def cf_plan_id(plan_key: str, amount: float) -> str:
    """The plan's id at Cashfree, for a given price.

    The price is part of the id on purpose, twice over. A Cashfree plan is
    immutable once created, so if a price changes and the id does not, every
    new subscriber keeps being charged the old amount by a plan that silently
    no longer matches the pricing page. It also gives the introductory rate its
    own plan for free, which is what makes that rate hold for the life of the
    mandate rather than needing a mid-mandate amount change Cashfree cannot do.
    """
    cents = f"{amount:.2f}".replace(".", "_")
    return f"pf_{plan_key}_{BILLING_CURRENCY.lower()}_{cents}"


async def cf_ensure_plan(plan_key: str, plan: dict, amount: float) -> str:
    """Create the plan at Cashfree unless it is already there.

    Subscriptions reference a plan by id; passing the details inline fails with
    plan_not_found. Registering lazily on first purchase means no deploy step
    to forget, and it is idempotent, so it costs one extra GET per checkout.
    """
    plan_id = cf_plan_id(plan_key, amount)
    try:
        await cf_request("GET", f"/plans/{plan_id}")
        return plan_id
    except Exception:  # noqa: BLE001
        pass                      # not there yet - create it below
    try:
        await cf_request("POST", "/plans", {
            "plan_id": plan_id,
            "plan_name": plan["name"],
            "plan_type": "PERIODIC",
            "plan_currency": BILLING_CURRENCY,
            "plan_recurring_amount": amount,
            "plan_max_amount": amount,
            "plan_max_cycles": BILLING_MAX_CYCLES,
            "plan_intervals": plan["intervals"],
            # Cashfree rejects lowercase here: "should be DAY WEEK MONTH YEAR".
            "plan_interval_type": plan["interval_type"].upper(),
        })
    except Exception as exc:  # noqa: BLE001
        # Two checkouts at once can both miss the GET and both try to create.
        # The loser of that race is fine - the plan it wanted now exists.
        if "exist" not in str(exc).lower():
            raise
    return plan_id


async def grant_premium(db: AsyncSession, user: User, period: timedelta,
                        bonus: int = 0) -> None:
    """Extend premium by one paid cycle.

    Extends from the current expiry when one is still in the future, so paying
    early adds time instead of throwing away what is left.
    """
    base = user.premium_until
    if base is None or base <= now_utc():
        base = now_utc()
    user.premium_until = base + period
    user.subscription_status = "premium"
    if bonus:
        user.xp = (user.xp or 0) + bonus
    await db.commit()


# ----------------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------------
class SubscribeIn(BaseModel):
    plan_id: str = Field(min_length=1, max_length=32)


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    # bcrypt only hashes the first 72 bytes, so cap the input there too.
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    # Capped like RegisterIn: bcrypt only reads the first 72 bytes, and an
    # uncapped field let an arbitrarily large body through validation.
    password: str = Field(max_length=72)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    password: str = Field(min_length=8, max_length=72)


class VerifyEmailIn(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class PhoneSendIn(BaseModel):
    phone: str = Field(min_length=6, max_length=24)


class PhoneVerifyIn(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class ChangeEmailIn(BaseModel):
    email: EmailStr
    # Changing where the confirmation lands is an account takeover if a stolen
    # session can do it alone, so the password is asked for again.
    password: str = Field(max_length=72)


class SubscribeIn(BaseModel):
    email: EmailStr


class DialogueTurn(BaseModel):
    role: str = Field(pattern="^(candidate|agent)$")
    text: str = Field(max_length=2000)


class ConverseIn(BaseModel):
    consigne: str = Field(min_length=1, max_length=4000)
    history: List[DialogueTurn] = Field(default_factory=list, max_length=MAX_DIALOGUE_TURNS)
    # Same vocabulary as ConverseGradeIn: here it picks which persona brief the
    # roleplay partner speaks under.
    mode: str = Field(default="tache2", pattern="^(tache1|tache2|free)$")


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
    # --- Compréhension orale, climbing A1 → C1 -------------------------
    # The audio is not recorded yet, so each item carries the transcript the
    # learner reads instead; mock.transcriptNote says so on the page.
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Le magasin ferme dans quinze minutes. Merci de vous diriger vers les caisses. »",
        "question": "Que doivent faire les clients ?",
        "options": [{"id": "a", "text": "Aller payer"},
                    {"id": "b", "text": "Revenir demain"},
                    {"id": "c", "text": "Attendre quinze minutes"},
                    {"id": "d", "text": "Sortir sans payer"}],
        "correct_answer": "a",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Allô, c'est le garage. Votre voiture est prête, vous pouvez venir la chercher avant 18 h. »",
        "question": "Pourquoi le garage appelle-t-il ?",
        "options": [{"id": "a", "text": "Pour annoncer un retard"},
                    {"id": "b", "text": "Pour dire que la voiture est réparée"},
                    {"id": "c", "text": "Pour demander de l'argent"},
                    {"id": "d", "text": "Pour proposer un rendez-vous"}],
        "correct_answer": "b",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Pardon, vous savez où est la poste ? — Oui, prenez la deuxième rue à droite, c'est juste après la pharmacie. »",
        "question": "Où se trouve la poste ?",
        "options": [{"id": "a", "text": "Avant la pharmacie"},
                    {"id": "b", "text": "Dans la première rue"},
                    {"id": "c", "text": "Après la pharmacie"},
                    {"id": "d", "text": "À gauche"}],
        "correct_answer": "c",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Je te préviens, il pleut beaucoup ce matin. Prends un parapluie si tu sors. »",
        "question": "Que conseille cette personne ?",
        "options": [{"id": "a", "text": "De rester à la maison"},
                    {"id": "b", "text": "De partir plus tôt"},
                    {"id": "c", "text": "De prendre un parapluie"},
                    {"id": "d", "text": "De prendre le bus"}],
        "correct_answer": "c",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Votre commande sera livrée mardi entre 9 h et 13 h. Si personne n'est présent, elle sera déposée au point relais. »",
        "question": "Que se passe-t-il si le client est absent ?",
        "options": [{"id": "a", "text": "La commande est annulée"},
                    {"id": "b", "text": "Elle est laissée au point relais"},
                    {"id": "c", "text": "Elle est livrée mercredi"},
                    {"id": "d", "text": "Il faut payer un supplément"}],
        "correct_answer": "b",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Nous recherchons un serveur pour la saison d'été. Aucune expérience n'est demandée, mais il faut être disponible le week-end. »",
        "question": "Quelle est la condition pour ce poste ?",
        "options": [{"id": "a", "text": "Avoir de l'expérience"},
                    {"id": "b", "text": "Parler deux langues"},
                    {"id": "c", "text": "Travailler le week-end"},
                    {"id": "d", "text": "Habiter sur place"}],
        "correct_answer": "c",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « En raison de travaux sur la voie, le train de 8 h 12 est supprimé. Un autocar assure la liaison, départ devant la gare. »",
        "question": "Comment les voyageurs peuvent-ils partir ?",
        "options": [{"id": "a", "text": "En prenant un autre train"},
                    {"id": "b", "text": "En autocar devant la gare"},
                    {"id": "c", "text": "Ils ne peuvent pas partir"},
                    {"id": "d", "text": "En taxi remboursé"}],
        "correct_answer": "b",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Franchement, le film était magnifique visuellement, mais l'histoire m'a laissée complètement indifférente. Je ne le reverrais pas. »",
        "question": "Quelle est l'opinion de cette personne ?",
        "options": [{"id": "a", "text": "Elle a tout aimé"},
                    {"id": "b", "text": "Elle a détesté les images"},
                    {"id": "c", "text": "Elle a aimé l'image mais pas l'histoire"},
                    {"id": "d", "text": "Elle veut le revoir"}],
        "correct_answer": "c",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « On a testé la semaine de quatre jours pendant six mois. Les résultats sont stables, mais les journées sont devenues nettement plus denses. »",
        "question": "Quel bilan cette personne tire-t-elle ?",
        "options": [{"id": "a", "text": "Les résultats ont baissé"},
                    {"id": "b", "text": "Le travail est plus intense malgré des résultats stables"},
                    {"id": "c", "text": "L'essai a été abandonné"},
                    {"id": "d", "text": "Les employés travaillent moins"}],
        "correct_answer": "b",
    },
    {
        "exam_type": "oral-comprehension",
        "text": "(Transcription) « Ce que l'on reproche à ce dispositif, ce n'est pas son coût, c'est qu'il n'a jamais été évalué. On dépense sans savoir ce que l'on obtient. »",
        "question": "Que critique cette personne ?",
        "options": [{"id": "a", "text": "Le prix du dispositif"},
                    {"id": "b", "text": "L'absence d'évaluation"},
                    {"id": "c", "text": "Le nombre de bénéficiaires"},
                    {"id": "d", "text": "La lenteur de sa mise en place"}],
        "correct_answer": "b",
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

    # Compare the questions too, not only the theme names. Editing a question
    # without adding or renaming a theme is the common case — rewording a
    # consigne, fixing a typo — and matching on names alone left every existing
    # database serving the old text forever.
    old_ids = [t.theme_id for t in existing]
    stored = set()
    if old_ids:
        res = await db.execute(
            select(ThemeQuestion.task_type, ThemeQuestion.prompt_text,
                   ThemeQuestion.title, ThemeQuestion.doc_1)
            .where(ThemeQuestion.theme_id.in_(old_ids)))
        stored = {tuple(row) for row in res.all()}
    wanted = {(t, p, None, None) for _, t, p in SEED_THEME_QUESTIONS}
    wanted |= {(3, TACHE3_CONSIGNE, title, doc_1)
               for _, title, doc_1, _ in SEED_TACHE3_SUBJECTS}
    if (sorted(t.name for t in existing) == sorted(n for n, *_ in SEED_THEMES)
            and stored == wanted):
        return False

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

    # Tâche 3 carries the exam's two documents alongside a shared consigne.
    for theme_name, title, doc_1, doc_2 in SEED_TACHE3_SUBJECTS:
        tid = name_to_id.get(theme_name)
        if not tid:
            continue
        db.add(ThemeQuestion(
            question_id=new_id("tq"), theme_id=tid, task_type=3,
            prompt_text=TACHE3_CONSIGNE, title=title, doc_1=doc_1, doc_2=doc_2,
            is_active=True, created_at=now_utc()))
    await db.commit()
    log.info("Seeded %d writing themes, %d theme questions and %d tâche 3 subjects",
             len(SEED_THEMES), len(SEED_THEME_QUESTIONS),
             len(SEED_TACHE3_SUBJECTS))
    return True


async def seed_reading_questions(db) -> int:
    """Sync the reading_questions table with the bank on disk.

    The bank is static content that only ever changes with a deploy, and there
    is no admin surface editing these rows, so the table is rebuilt from it
    rather than diffed. Question ids are derived from test and position, so they
    survive the rebuild and a recorded attempt keeps pointing at real questions.
    """
    problems = reading_bank.validate()
    if problems:
        # Refuse to seed a malformed bank: a question whose key names no option
        # would reach a learner as an unanswerable exercise.
        for p in problems[:10]:
            log.error("Reading bank invalid: %s", p)
        log.error("Reading bank has %d problem(s); skipping reading seed",
                  len(problems))
        return 0

    rows = []
    for number, questions in reading_bank.READING_TESTS.items():
        for position, q in enumerate(questions, start=1):
            rows.append(ReadingQuestion(
                reading_question_id=f"rq_{number:02d}_{position:02d}",
                test_number=number, position=position,
                level=q["level"], band=q.get("band", ""),
                doc_type=q.get("doc_type", ""), text=q["text"],
                question_fr=q["question_fr"], question_en=q.get("question_en", ""),
                options=q["options"], correct_answer=q["correct_answer"],
                key_line_fr=q.get("key_line_fr", ""),
                key_line_en=q.get("key_line_en", ""),
                vocabulary=q.get("vocabulary", []),
                is_active=True, created_at=now_utc()))
    if not rows:
        return 0

    existing = await db.scalar(
        select(func.count()).select_from(ReadingQuestion))
    await db.execute(sa_delete(ReadingQuestion))
    db.add_all(rows)
    await db.commit()
    log.info("Seeded %d reading questions across %d test(s) (was %d rows)",
             len(rows),
             sum(1 for qs in reading_bank.READING_TESTS.values() if qs),
             existing or 0)
    return len(rows)


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
        # Seed whenever the bank has grown, not only when the table is empty.
        # Seeding on empty alone meant every question added after the first
        # deploy stayed on disk and never reached a learner.
        if (count or 0) < len(SEED_EXAM_QUESTIONS):
            res = await db.execute(select(ExamQuestion.question))
            already = {row[0] for row in res.all()}
            added = 0
            for q in SEED_EXAM_QUESTIONS:
                if q["question"] in already:
                    continue
                db.add(ExamQuestion(
                    question_id=new_id("q"), created_at=now_utc(),
                    is_active=True, **q))
                added += 1
            await db.commit()
            if added:
                log.info("Seeded %d exam question(s)", added)

        # Writing themes + theme questions
        await seed_writing_themes(db)

        # Compréhension écrite papers
        await seed_reading_questions(db)

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
    # Paid cycles expire; manual grants (NULL) do not. See is_premium().
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until "
    "TIMESTAMP WITH TIME ZONE",
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
    # Tâche 3 subjects carry a title and the exam's two opposing documents.
    "ALTER TABLE theme_questions ADD COLUMN IF NOT EXISTS title VARCHAR(160)",
    "ALTER TABLE theme_questions ADD COLUMN IF NOT EXISTS doc_1 TEXT",
    "ALTER TABLE theme_questions ADD COLUMN IF NOT EXISTS doc_2 TEXT",
    # Refresh-token revocation. Existing sessions start at 0 and stay valid.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0",
    # Email confirmation. Accounts that predate it are treated as unverified,
    # which only shows a banner — it never blocks anyone from working.
    "ALTER TABLE users "
    "ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users "
    "ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
    # SMS confirmation, the second channel.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32)",
    "ALTER TABLE users "
    "ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ",
    "ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0",
    # The free trial, split by skill. Deliberately added WITHOUT a default, so
    # that NULL means "not yet backfilled": the UPDATEs below then run once and
    # are a no-op on every later boot, which an unconditional UPDATE would not
    # be. The default is attached afterwards, for rows inserted from here on.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS free_writing_used INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS free_speaking_used INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS free_speaking_tache2_used INTEGER",
    # Existing accounts keep what they have already spent, so the upgrade hands
    # nobody a second trial. The split is read from their submissions: anything
    # not spoken was written.
    f"UPDATE users u SET free_writing_used = LEAST({FREE_WRITING_LIMIT}, "
    "(SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.user_id "
    "AND COALESCE(s.source, '') NOT IN ('speaking', 'conversation'))) "
    "WHERE u.free_writing_used IS NULL",
    f"UPDATE users u SET free_speaking_used = LEAST({FREE_SPEAKING_LIMIT}, "
    "(SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.user_id "
    "AND COALESCE(s.source, '') IN ('speaking', 'conversation'))) "
    "WHERE u.free_speaking_used IS NULL",
    # No record survives of which speaking attempts were tâche 2, so the
    # generous reading wins: an existing account keeps its roleplay attempt.
    "UPDATE users SET free_speaking_tache2_used = 0 "
    "WHERE free_speaking_tache2_used IS NULL",
    "ALTER TABLE users ALTER COLUMN free_writing_used SET DEFAULT 0",
    "ALTER TABLE users ALTER COLUMN free_speaking_used SET DEFAULT 0",
    "ALTER TABLE users ALTER COLUMN free_speaking_tache2_used SET DEFAULT 0",
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


ALLOWED_ORIGINS = [o.strip() for o in FRONTEND_URL.split(",") if o.strip()]

app = FastAPI(title="prepfrancais API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    """Log an unhandled crash with enough context to find it.

    Without this, an unexpected exception left the browser holding a bare 500:
    no route, no account, no traceback, and nothing in the reply that could be
    matched against a log line. Diagnosing a report of "it fails for my users
    but not for me" then had nothing to go on.

    The traceback goes to the server log only. The reply carries a short id so
    a learner can quote it and it can be grepped straight out of the log — the
    exception text itself is never sent, since it can carry a query, a path or
    a provider key.
    """
    error_id = uuid.uuid4().hex[:8]
    user_id = "anonymous"
    token = request.cookies.get("access_token")
    if token:
        user_id = decode_token(token, "access") or "invalid-token"
    log.error("[%s] Unhandled error on %s %s (user=%s)",
              error_id, request.method, request.url.path, user_id, exc_info=exc)
    # This handler runs inside Starlette's error middleware, which sits outside
    # CORSMiddleware — so on a split-origin deployment the browser blocked the
    # body and the learner saw an opaque network error instead of the reference
    # code that was carefully generated for them. Add the headers here.
    headers = {}
    origin = request.headers.get("origin")
    if origin and origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=500,
        headers=headers,
        content={"detail": f"Erreur interne du serveur (réf. {error_id})."})


# ----------------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------------
@app.get("/api/")
async def root():
    return {"message": "prepfrancais API", "status": "healthy"}


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
        "free_trial": {
            "writing": FREE_WRITING_LIMIT,
            "speaking": FREE_SPEAKING_LIMIT,
            "speaking_tache2": FREE_SPEAKING_TACHE2_LIMIT,
            "one_time": True,
        },
        "free_monthly_limit": FREE_TRIAL_TOTAL,
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
        token_version=0, email_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    set_auth_cookies(response, user.user_id, user.token_version or 0)
    # Confirmation is offered, never enforced: blocking practice behind a link
    # that may land in spam would cost more accounts than it protects.
    await _send_verification_email(db, user)
    return {"user": public_user(user)}


async def _send_verification_email(db: AsyncSession, user: User) -> bool:
    raw = await issue_link_token(db, user.user_id, "verify",
                                 timedelta(hours=VERIFY_TTL_HOURS))
    link = f"{PUBLIC_URL}/verify-email?token={raw}"
    return await send_email(user.email, "Confirmez votre adresse prepfrancais",
                            verify_email_body(user.name or "", link))


@app.post("/api/auth/login")
async def login(body: LoginIn, response: Response,
                db: AsyncSession = Depends(get_db),
                _rl=Depends(auth_rate_limit)):
    user = await get_user_by_email(db, body.email.lower())
    # bcrypt runs either way. Short-circuiting on a missing account answered in
    # about a millisecond instead of the ~100ms a real comparison costs, which
    # made membership readable from the response time alone.
    ok = await run_ai(verify_password, body.password,
                      user.password_hash if user else _DUMMY_PASSWORD_HASH)
    if not user or not ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    set_auth_cookies(response, user.user_id, user.token_version or 0)
    return {"user": public_user(user)}


@app.post("/api/auth/refresh")
async def refresh(request: Request, response: Response,
                  db: AsyncSession = Depends(get_db),
                  _rl=Depends(auth_rate_limit)):
    token = request.cookies.get("refresh_token")
    claims = decode_token_claims(token, "refresh") if token else None
    if not claims:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await get_user_by_id(db, claims.get("sub"))
    if not user:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="User not found")
    if not token_is_current(claims, user):
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Session ended")
    _set_access_cookie(response, user.user_id, user.token_version or 0)
    response.set_cookie(SESSION_HINT_COOKIE, "1",
                        httponly=False, samesite="lax", secure=IS_PROD,
                        path="/", max_age=REFRESH_TTL_DAYS * 86400)
    return {"user": public_user(user)}


@app.get("/api/auth/me")
async def me(response: Response,
             user: User = Depends(get_current_user),
             db: AsyncSession = Depends(get_db)):
    # Refresh the readable session hint on the way out, so a session that
    # predates the cookie stops probing after one successful load.
    response.set_cookie(SESSION_HINT_COOKIE, "1",
                        httponly=False, samesite="lax", secure=IS_PROD,
                        path="/", max_age=REFRESH_TTL_DAYS * 86400)
    return {"user": public_user(user)}


@app.post("/api/auth/logout")
async def logout(request: Request, response: Response,
                 db: AsyncSession = Depends(get_db)):
    """Clear the cookies and revoke the tokens they carried.

    Clearing cookies alone left the refresh token valid for its full seven
    days: anyone holding a copy — from a shared computer, a captured log, an
    old backup — kept access, and there was no way to cut it off. Raising
    token_version ends every session for the account, which is the honest
    behaviour when there is no per-device session record to end instead.
    """
    token = request.cookies.get("access_token") or request.cookies.get("refresh_token")
    for kind in ("access", "refresh"):
        claims = decode_token_claims(token, kind) if token else None
        if claims and claims.get("sub"):
            await db.execute(
                sa_update(User).where(User.user_id == claims["sub"])
                .values(token_version=User.token_version + 1))
            await db.commit()
            break
    clear_auth_cookies(response)
    return {"detail": "Logged out"}


# ----------------------------------------------------------------------------
# Account recovery
# ----------------------------------------------------------------------------
@app.post("/api/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn,
                          db: AsyncSession = Depends(get_db),
                          _rl=Depends(auth_rate_limit)):
    """Send a reset link, if the address has an account.

    The reply is identical either way. Reporting "no such account" would turn
    this into a membership oracle for anyone holding a list of addresses — and
    for an immigration-related service that list is sensitive on its own.
    """
    if IS_PROD and not SMTP_HOST:
        raise HTTPException(
            status_code=503,
            detail=("La réinitialisation par e-mail n'est pas encore "
                    "disponible. Écrivez-nous et nous rétablirons votre accès."))
    user = await get_user_by_email(db, body.email.lower())
    if user:
        raw = await issue_link_token(db, user.user_id, "reset",
                                     timedelta(minutes=RESET_TTL_MINUTES))
        link = f"{PUBLIC_URL}/reset-password?token={raw}"
        await send_email(user.email,
                         "Réinitialisez votre mot de passe prepfrancais",
                         reset_email_body(user.name or "", link))
    return {"detail": "If that address has an account, a reset link is on its way."}


@app.post("/api/auth/reset-password")
async def reset_password(body: ResetPasswordIn, response: Response,
                         db: AsyncSession = Depends(get_db),
                         _rl=Depends(auth_rate_limit)):
    """Set a new password from a single-use link, and sign the user in."""
    user_id = await consume_link_token(db, body.token, "reset")
    if not user_id:
        raise HTTPException(
            status_code=400,
            detail="Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Compte introuvable.")

    new_hash = await run_ai(hash_password, body.password)
    # Every session minted before the change is revoked: whoever prompted the
    # reset must not still be holding a working token.
    await db.execute(
        sa_update(User).where(User.user_id == user_id)
        .values(password_hash=new_hash,
                token_version=User.token_version + 1,
                # Following a link sent to the address proves it works.
                email_verified=True,
                email_verified_at=now_utc()))
    await db.commit()
    await db.refresh(user)
    set_auth_cookies(response, user.user_id, user.token_version or 0)
    return {"user": public_user(user)}


@app.post("/api/auth/verify-email")
async def verify_email(body: VerifyEmailIn,
                       db: AsyncSession = Depends(get_db),
                       _rl=Depends(auth_rate_limit)):
    user_id = await consume_link_token(db, body.token, "verify")
    if not user_id:
        raise HTTPException(
            status_code=400,
            detail="Ce lien de confirmation a expiré. Demandez-en un nouveau.")
    await db.execute(
        sa_update(User).where(User.user_id == user_id)
        .values(email_verified=True, email_verified_at=now_utc()))
    await db.commit()
    return {"detail": "Email confirmed"}


@app.post("/api/auth/resend-verification")
async def resend_verification(user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db),
                              _rl=Depends(auth_rate_limit)):
    if user.email_verified:
        return {"detail": "Already verified"}
    await _send_verification_email(db, user)
    return {"detail": "Confirmation link sent"}


@app.post("/api/auth/change-email")
async def change_email(body: ChangeEmailIn, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db),
                       _rl=Depends(auth_rate_limit)):
    """Correct the address the account was registered with, and confirm the new
    one. Typing it wrong at sign-up used to be unrecoverable: the confirmation
    went to an address nobody reads, and nothing in the product let you change
    where it was sent.
    """
    email = body.email.lower()
    ok = await run_ai(verify_password, body.password, user.password_hash)
    if not ok:
        raise HTTPException(status_code=401, detail="Mot de passe incorrect.")
    if email == (user.email or "").lower():
        return {"user": public_user(user)}
    existing = await get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400,
                            detail="Cette adresse est déjà utilisée.")
    await db.execute(
        sa_update(User).where(User.user_id == user.user_id)
        .values(email=email, email_verified=False, email_verified_at=None))
    await db.commit()
    await db.refresh(user)
    await _send_verification_email(db, user)
    return {"user": public_user(user)}


@app.post("/api/auth/phone/send")
async def phone_send(body: PhoneSendIn, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db),
                     _rl=Depends(auth_rate_limit)):
    """Attach a number to the account and text it a confirmation code.

    Also the way to correct a wrong number: sending again replaces both the
    number and the outstanding code.
    """
    if IS_PROD and not SMS_ENABLED:
        raise HTTPException(
            status_code=503,
            detail=("La confirmation par SMS n'est pas encore disponible. "
                    "Confirmez votre adresse e-mail pour l'instant."))
    phone = normalize_phone(body.phone)
    # A number confirms one account, not many: without this, one handset could
    # verify an unlimited supply of trial accounts.
    taken = await db.scalar(
        select(func.count()).select_from(User).where(
            User.phone == phone, User.phone_verified == True,  # noqa: E712
            User.user_id != user.user_id))
    if taken:
        raise HTTPException(
            status_code=400,
            detail="Ce numéro est déjà associé à un autre compte.")
    await db.execute(
        sa_update(User).where(User.user_id == user.user_id)
        .values(phone=phone, phone_verified=False, phone_verified_at=None))
    await db.commit()
    await db.refresh(user)
    code = await issue_phone_code(db, user.user_id)
    await send_sms(phone, phone_code_body(code))
    return {"detail": "Code sent", "phone": phone,
            "expires_in_minutes": PHONE_CODE_TTL_MINUTES}


@app.post("/api/auth/phone/verify")
async def phone_verify(body: PhoneVerifyIn, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db),
                       _rl=Depends(auth_rate_limit)):
    if not user.phone:
        raise HTTPException(status_code=400,
                            detail="Aucun numéro à confirmer.")
    if not await consume_phone_code(db, user.user_id, body.code):
        raise HTTPException(
            status_code=400,
            detail="Code incorrect ou expiré. Demandez-en un nouveau.")
    await db.execute(
        sa_update(User).where(User.user_id == user.user_id)
        .values(phone_verified=True, phone_verified_at=now_utc()))
    await db.commit()
    await db.refresh(user)
    return {"user": public_user(user)}


# ----------------------------------------------------------------------------
# Newsletter
# ----------------------------------------------------------------------------
@app.post("/api/newsletter")
async def subscribe(body: SubscribeIn, db: AsyncSession = Depends(get_db),
                    _rl=Depends(auth_rate_limit)):
    """Record a footer newsletter sign-up.

    Signing up twice is not an error worth showing anyone, so a repeat is
    accepted silently.
    """
    email = body.email.lower().strip()
    existing = await db.scalar(
        select(Subscriber.id).where(Subscriber.email == email))
    if existing is None:
        db.add(Subscriber(email=email, created_at=now_utc(), source="footer"))
        await db.commit()
    return {"detail": "Subscribed"}


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
                yield _sse("error", {"detail": ai_error_detail(analysis),
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
        raise HTTPException(status_code=503, detail=ai_error_detail(analysis))
    return await persist_submission(db, user, body.text, body.prompt_id,
                                    analysis, source=source, consume=False)


@app.get("/api/submissions")
async def list_submissions(user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """The history list: one row per attempt, without the essay itself.

    This used to return 100 complete rows — every essay and every error array —
    to fill a table showing four columns. The detail page already fetches the
    full row from /api/submissions/{id} when it is actually needed.
    """
    rows = (await db.execute(
        select(Submission.submission_id, Submission.created_at,
               Submission.tcf_level, Submission.overall_score,
               Submission.word_count, Submission.source,
               func.coalesce(func.jsonb_array_length(Submission.errors), 0))
        .where(Submission.user_id == user.user_id)
        .order_by(Submission.created_at.desc()).limit(100))).all()
    return {"submissions": [
        {"submission_id": sid, "created_at": created, "tcf_level": level,
         "overall_score": score, "word_count": words, "source": source,
         "error_count": int(n or 0)}
        for sid, created, level, score, words, source, n in rows]}


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
@app.get("/api/simulator/sets")
async def simulator_sets():
    """The numbered writing sittings, for the chooser."""
    return {"sets": [
        {"set_number": n,
         "task2": exam_sets.WRITING_EXAM_SETS[n - 1][1],
         "task3_preview": exam_sets.WRITING_EXAM_SETS[n - 1][2]["doc_1"][:160]}
        for n in range(1, len(exam_sets.WRITING_EXAM_SETS) + 1)]}


@app.get("/api/simulator/start")
async def simulator_start(set_number: Optional[int] = None,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """The three tâches of one sitting.

    With ?set_number=N it returns that fixed paper, so a set means the same
    three tâches every time and two attempts at it can be compared. Without it
    the old behaviour stands — one random prompt per tâche — which is kept only
    so existing links do not break.
    """
    if set_number is not None:
        if not 1 <= set_number <= len(exam_sets.WRITING_EXAM_SETS):
            raise HTTPException(status_code=404, detail="Unknown exam set")
        return exam_sets.writing_set(set_number)
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
                                    detail=ai_error_detail(analysis))
            graded_any = True
        else:
            # Left blank: a real examiner scores an unattempted tâche at zero.
            analysis = {**dict(FALLBACK_ANALYSIS), "ai_unavailable": False,
                        "not_attempted": True}
        tasks_out[f"task{i}"] = {
            "prompt": task.prompt, "text": task.text,
            "analysis": public_analysis(analysis),
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
    out = public_attempt(_row_to_dict(attempt))
    out["streak"] = streak
    return {"attempt": out}


@app.get("/api/simulator/attempts")
async def simulator_attempts(user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ExamAttempt).where(ExamAttempt.user_id == user.user_id)
        .order_by(ExamAttempt.created_at.desc()).limit(50))
    return [public_attempt(_row_to_dict(a)) for a in res.scalars().all()]


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
    # An admin opening an attempt for support wants to know which model graded
    # it; the candidate who wrote it has no use for that.
    row = _row_to_dict(a)
    return row if user.role == "admin" else public_attempt(row)


# ----------------------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------------------
@app.get("/api/dashboard/stats")
async def dashboard_stats(user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Totals, error breakdown and the last ten scores.

    Every figure is computed in Postgres. Loading every submission the learner
    had ever made — full essay text and all — to produce an average and ten
    dates meant the most engaged users got the slowest dashboard, which is
    exactly backwards.
    """
    from sqlalchemy import text as sa_text

    total, avg_raw = (await db.execute(
        select(func.count(), func.avg(Submission.overall_score))
        .where(Submission.user_id == user.user_id))).one()
    total = int(total or 0)
    avg = round(float(avg_raw), 1) if avg_raw is not None else 0.0

    breakdown = {c: 0 for c in VALID_CATEGORIES}
    rows = await db.execute(sa_text(
        "SELECT e.val->>'category' AS category, COUNT(*) AS n "
        "FROM submissions s, "
        "     LATERAL jsonb_array_elements(coalesce(s.errors, '[]'::jsonb)) AS e(val) "
        "WHERE s.user_id = :uid GROUP BY 1"), {"uid": user.user_id})
    for category, n in rows.all():
        breakdown[category or "spelling"] = (
            breakdown.get(category or "spelling", 0) + int(n))

    # Ten newest, then reversed: the chart reads left to right in time order.
    recent = (await db.execute(
        select(Submission.created_at, Submission.overall_score)
        .where(Submission.user_id == user.user_id)
        .order_by(Submission.created_at.desc()).limit(10))).all()
    trend = [{"date": created.strftime("%Y-%m-%d")
              if isinstance(created, datetime) else str(created)[:10],
              "score": score} for created, score in reversed(recent)]
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

    # Only the timestamp column is read. Selecting whole entities pulled a
    # year of essay text across the wire to count squares on a grid.
    for table in (Submission, ReviewSession):
        rows = await db.execute(
            select(table.created_at).where(table.user_id == user.user_id,
                                           table.created_at >= since))
        for (created,) in rows.all():
            bump(created)
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
    """Per-category totals, monthly error rate, and the worst repeat offenders.

    Every aggregate is computed in Postgres. This used to load the learner's
    entire mistakes table and their entire submissions table — full essay text
    included — into Python, and then loop over both. The learners with the most
    practice had the slowest dashboard.
    """
    from sqlalchemy import text as sa_text

    uid = {"uid": user.user_id}

    # per_category counts repeats, not rows: a mistake made five times weighs
    # five. status_counts counts rows.
    per_cat = {c: 0 for c in VALID_CATEGORIES if c != "improvement"}
    rows = await db.execute(
        select(Mistake.category,
               func.sum(func.coalesce(Mistake.times_repeated, 1)),
               func.count())
        .where(Mistake.user_id == user.user_id)
        .group_by(Mistake.category))
    for category, repeats, _rows in rows.all():
        per_cat[category] = per_cat.get(category, 0) + int(repeats or 0)

    # Grouped on the bare column, with the NULL folded into "new" here rather
    # than in SQL. Selecting coalesce(status, 'new') and grouping by the same
    # call reads as equivalent, but asyncpg binds each literal to its own
    # placeholder — $1 in the select list, $2 in the GROUP BY — so Postgres saw
    # two different expressions and rejected the query outright.
    status_counts = {"new": 0, "reviewing": 0, "mastered": 0}
    rows = await db.execute(
        select(Mistake.status, func.count())
        .where(Mistake.user_id == user.user_id)
        .group_by(Mistake.status))
    for status, n in rows.all():
        status = status or "new"
        status_counts[status] = status_counts.get(status, 0) + int(n)

    # Monthly error rate. The per-submission error count is a scalar subquery
    # rather than a lateral join, because joining one row per error would
    # multiply that submission's word count by its number of errors and quietly
    # inflate the denominator.
    monthly_sql = sa_text(
        "SELECT month, SUM(errs) AS errors, SUM(words) AS words FROM ("
        "  SELECT to_char(s.created_at, 'YYYY-MM') AS month,"
        "         (SELECT COUNT(*)"
        "            FROM jsonb_array_elements(coalesce(s.errors, '[]'::jsonb)) AS e(val)"
        "           WHERE e.val->>'category' IS DISTINCT FROM 'improvement') AS errs,"
        "         COALESCE(NULLIF(s.word_count, 0),"
        "                  COALESCE(array_length("
        r"                      regexp_split_to_array(NULLIF(btrim(s.original_text), ''), '\s+'), 1), 0)"
        "         ) AS words"
        "  FROM submissions s WHERE s.user_id = :uid"
        ") t GROUP BY month ORDER BY month")
    trend = []
    for month, errors, words in (await db.execute(monthly_sql, uid)).all():
        errors, words = int(errors or 0), int(words or 0)
        trend.append({
            "month": month,
            "errors_per_100_words": round(errors / words * 100, 2) if words else 0,
        })

    repeat_leaders = (await db.execute(
        select(Mistake).where(Mistake.user_id == user.user_id)
        .order_by(func.coalesce(Mistake.times_repeated, 1).desc()).limit(5)
    )).scalars().all()

    weak = sorted(((c, n) for c, n in per_cat.items() if n > 0),
                  key=lambda x: -x[1])[:3]

    # "Category X down N% over your last 5 submissions" — needs the ten newest
    # attempts, and only their error arrays and word counts.
    narrative = None
    subs = (await db.execute(
        select(Submission.errors, Submission.word_count)
        .where(Submission.user_id == user.user_id)
        .order_by(Submission.created_at.desc()).limit(10))).all()
    if len(subs) >= 6:
        def rate(group, cat):
            errs = sum(len([e for e in (errors or [])
                            if e.get("category") == cat]) for errors, _ in group)
            words = sum(wc or 1 for _, wc in group) or 1
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
# Expression orale — Test Mode: the three tâches of one sitting, in order
# ----------------------------------------------------------------------------
@app.get("/api/speaking/exam-sets")
async def speaking_exam_sets():
    """The numbered sittings, with just enough to render the chooser.

    Public and unmetered: the exam itself is free, so there is nothing to gate
    here either. Grading each tâche still goes through the existing speaking
    endpoints, which is where any charging decision lives.
    """
    return {"sets": [
        {"set_number": n,
         "task2_theme": s["task2"]["theme"],
         "task3_theme": s["task3"]["theme"],
         "task3_question": s["task3"]["question"]}
        for n, s in ((i, exam_sets.speaking_set(i))
                     for i in range(1, len(exam_sets.SPEAKING_EXAM_SETS) + 1))]}


@app.get("/api/speaking/exam-sets/{set_number}")
async def speaking_exam_set(set_number: int):
    if not 1 <= set_number <= len(exam_sets.SPEAKING_EXAM_SETS):
        raise HTTPException(status_code=404, detail="Unknown exam set")
    spec = exam_sets.speaking_set(set_number)
    # The official timings travel with the paper so the runner never has to
    # keep its own copy of them.
    spec["timings"] = {str(n): {"prep_seconds": s["prep_seconds"],
                                "speak_seconds": s["speak_seconds"],
                                "name": s["name"]}
                       for n, s in SPEAKING_TASKS.items()}
    return spec


# ----------------------------------------------------------------------------
# Compréhension écrite — numbered practice/test papers
# ----------------------------------------------------------------------------
class ReadingSubmitIn(BaseModel):
    # Unanswered questions may be sent as null rather than omitted.
    answers: Dict[str, Optional[str]] = Field(default_factory=dict)
    time_used_seconds: int = Field(default=0, ge=0)


class ReadingCheckIn(BaseModel):
    picked: Optional[str] = None


def _reading_question_public(q: ReadingQuestion) -> dict:
    """The question as the learner sees it before answering.

    Both the answer key and the per-option explanations are stripped: the
    explanations name the correct option outright, so shipping them with the
    paper would hand over the answers in DevTools.

    The question itself is French only, like the real paper — the English
    glosses stay in the bank and in question_en / text_en, but are not served
    here, so a candidate reads the document without a translation beside it.
    """
    return {
        "reading_question_id": q.reading_question_id,
        "test_number": q.test_number,
        "position": q.position,
        "level": q.level,
        "band": q.band,
        "doc_type": q.doc_type,
        "text": q.text,
        "question_fr": q.question_fr,
        "options": [{"id": o["id"], "text": o["text"]} for o in q.options],
    }


def _reading_correction(q: ReadingQuestion, picked: Optional[str]) -> dict:
    """The full teaching payload, returned only once an answer is in.

    The options stay French, as in the question; the explanations, the key
    line's translation and the vocabulary glosses are the teaching layer and are
    bilingual on purpose.
    """
    return {
        "reading_question_id": q.reading_question_id,
        "position": q.position,
        "level": q.level,
        "picked": picked,
        "correct_answer": q.correct_answer,
        "is_correct": picked == q.correct_answer,
        "options": [{"id": o["id"], "text": o["text"],
                     "explanation": o.get("explanation", ""),
                     "is_correct": o["id"] == q.correct_answer}
                    for o in q.options],
        "key_line_fr": q.key_line_fr,
        "key_line_en": q.key_line_en,
        "vocabulary": q.vocabulary or [],
    }


@app.get("/api/reading/tests")
async def reading_tests(db: AsyncSession = Depends(get_db)):
    """The ten papers, with how many questions each currently holds.

    Tests still being written are returned with question_count 0 so the page can
    show them as coming soon rather than hiding them — the learner sees the full
    programme either way.
    """
    res = await db.execute(
        select(ReadingQuestion.test_number,
               func.count(ReadingQuestion.id),
               func.min(ReadingQuestion.level),
               func.max(ReadingQuestion.level))
        .where(ReadingQuestion.is_active == True)  # noqa: E712
        .group_by(ReadingQuestion.test_number))
    counts = {row[0]: {"question_count": row[1],
                       "level_from": row[2], "level_to": row[3]}
              for row in res.all()}
    return {"tests": [
        {"test_number": n,
         "question_count": counts.get(n, {}).get("question_count", 0),
         "level_from": counts.get(n, {}).get("level_from") or "A1",
         "level_to": counts.get(n, {}).get("level_to") or "C2",
         "is_ready": counts.get(n, {}).get("question_count", 0) > 0}
        for n in sorted(reading_bank.READING_TESTS)]}


@app.get("/api/reading/tests/{test_number}")
async def reading_test_questions(test_number: int,
                                 db: AsyncSession = Depends(get_db)):
    if test_number not in reading_bank.READING_TESTS:
        raise HTTPException(status_code=404, detail="Unknown test")
    res = await db.execute(
        select(ReadingQuestion)
        .where(ReadingQuestion.test_number == test_number,
               ReadingQuestion.is_active == True)  # noqa: E712
        .order_by(ReadingQuestion.position.asc()))
    questions = res.scalars().all()
    if not questions:
        raise HTTPException(status_code=503,
                            detail="This test is not available yet")
    return {"test_number": test_number,
            "total": len(questions),
            "questions": [_reading_question_public(q) for q in questions]}


@app.post("/api/reading/questions/{reading_question_id}/check")
async def reading_check_one(reading_question_id: str, body: ReadingCheckIn,
                            db: AsyncSession = Depends(get_db)):
    """Practice mode: mark a single question and explain it straight away.

    Deliberately open to signed-out visitors — practice is the free surface, and
    the answer key still never leaves the server unasked.
    """
    res = await db.execute(
        select(ReadingQuestion).where(
            ReadingQuestion.reading_question_id == reading_question_id,
            ReadingQuestion.is_active == True))  # noqa: E712
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"correction": _reading_correction(q, body.picked)}


@app.post("/api/reading/tests/{test_number}/submit")
async def reading_submit(test_number: int, body: ReadingSubmitIn,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Grade a whole paper, record it, and return every explanation."""
    if test_number not in reading_bank.READING_TESTS:
        raise HTTPException(status_code=404, detail="Unknown test")
    res = await db.execute(
        select(ReadingQuestion)
        .where(ReadingQuestion.test_number == test_number,
               ReadingQuestion.is_active == True)  # noqa: E712
        .order_by(ReadingQuestion.position.asc()))
    questions = res.scalars().all()
    if not questions:
        raise HTTPException(status_code=503,
                            detail="This test is not available yet")

    corrections = [_reading_correction(q, body.answers.get(q.reading_question_id))
                   for q in questions]
    score = sum(1 for c in corrections if c["is_correct"])
    # Per-level breakdown: a candidate who is solid to B1 and collapses at B2
    # learns far more from that shape than from a bare total.
    by_level = {}
    for c in corrections:
        stat = by_level.setdefault(c["level"], {"correct": 0, "total": 0})
        stat["total"] += 1
        stat["correct"] += 1 if c["is_correct"] else 0

    attempt = ReadingAttempt(
        reading_attempt_id=new_id("rda"), user_id=user.user_id,
        test_number=test_number, answers=body.answers, score=score,
        total=len(questions), time_used_seconds=body.time_used_seconds,
        created_at=now_utc())
    db.add(attempt)
    await db.commit()
    streak = await update_streak(db, user.user_id)
    return {"score": score, "total": len(questions), "by_level": by_level,
            "corrections": corrections, "streak": streak}


@app.get("/api/reading/attempts")
async def reading_attempts(user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(ReadingAttempt).where(ReadingAttempt.user_id == user.user_id)
        .order_by(ReadingAttempt.created_at.desc()).limit(50))
    return {"attempts": [_row_to_dict(a) for a in res.scalars().all()]}


# ----------------------------------------------------------------------------
# Speaking (stub)
# ----------------------------------------------------------------------------
async def read_audio_upload(audio: UploadFile) -> bytes:
    """Read an upload, refusing anything over the ceiling before buffering it.

    `await audio.read()` pulled the whole body into memory and only then
    checked the size, so the 25 MB limit was enforced after 25 MB had already
    been allocated — ten simultaneous uploads was 250 MB of transient memory in
    a single-process server. Reading in chunks stops at the first byte over.
    """
    chunks: List[bytes] = []
    total = 0
    while True:
        chunk = await audio.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(f"Enregistrement trop volumineux "
                        f"(max {MAX_AUDIO_BYTES // (1024 * 1024)} Mo)."))
        chunks.append(chunk)
    return b"".join(chunks)


# Grading a spoken answer is transcription plus a model call, either of which
# can stall. Without a ceiling the request outlived any proxy read timeout and
# left the client on a spinner with no error.
SPEAKING_MAX_WAIT_SECONDS = float(os.environ.get("SPEAKING_MAX_WAIT_SECONDS", "180"))


@app.post("/api/speaking/analyze")
async def speaking_analyze(question: str = Form(...),
                           audio: UploadFile = File(...),
                           task_type: Optional[int] = Form(None),
                           mime_type: Optional[str] = Form(None),
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db),
                           _rl=Depends(ai_rate_limit)):
    # The size guard runs before the credit is claimed, so an oversized upload
    # is refused without touching the allowance.
    audio_bytes = await read_audio_upload(audio)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if task_type not in (1, 2, 3):
        task_type = None
    filename = audio.filename or "audio.webm"
    mime = resolve_audio_mime(filename, mime_type or audio.content_type)

    # Tâche 2 is the interaction, whichever way it was recorded, so it draws on
    # the same single free roleplay as the live one.
    is_tache2 = task_type == 2
    user = await reserve_credit(db, user, "speaking", tache2=is_tache2)
    try:
        transcript = await asyncio.wait_for(
            transcribe_audio(audio_bytes, filename, db=db, mime=mime),
            timeout=SPEAKING_MAX_WAIT_SECONDS)
    except asyncio.TimeoutError:
        await refund_credit(db, user, "speaking", tache2=is_tache2)
        raise HTTPException(status_code=504, detail=AI_TIMEOUT_DETAIL)

    # Nothing was said, or the recording could not be read. Either way there is
    # nothing to grade, so return the credit instead of persisting an empty
    # attempt and charging for it — which is what every iOS recording used to
    # do, because its MP4 audio was uploaded labelled as WebM.
    if not (transcript or "").strip():
        await refund_credit(db, user, "speaking", tache2=is_tache2)
        raise HTTPException(status_code=422, detail=NO_SPEECH_DETAIL)

    try:
        analysis = await asyncio.wait_for(
            analyze_speaking_with_ai(transcript, question, db=db,
                                     task_type=task_type),
            timeout=SPEAKING_MAX_WAIT_SECONDS)
    except asyncio.TimeoutError:
        await refund_credit(db, user, "speaking", tache2=is_tache2)
        raise HTTPException(status_code=504, detail=AI_TIMEOUT_DETAIL)
    if analysis.get("ai_unavailable"):
        await refund_credit(db, user, "speaking", tache2=is_tache2)
        raise HTTPException(status_code=503, detail=ai_error_detail(analysis))
    analysis["transcript"] = transcript
    sub = await persist_submission(
        db, user, transcript, None, analysis,
        source="speaking", consume=False)
    analysis["submission_id"] = sub.get("submission_id")
    analysis["streak"] = sub.get("streak")
    return public_analysis(analysis)


@app.post("/api/speaking/turn/transcribe")
async def speaking_turn_transcribe(audio: UploadFile = File(...),
                                   mime_type: Optional[str] = Form(None),
                                   user: User = Depends(get_current_user),
                                   db: AsyncSession = Depends(get_db),
                                   _rl=Depends(turn_rate_limit)):
    """Transcribe a single conversational turn. Used by browsers without live
    speech recognition; costs no credit because the graded unit is the whole
    conversation, not the turn."""
    audio_bytes = await read_audio_upload(audio)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    filename = audio.filename or "turn.webm"
    mime = resolve_audio_mime(filename, mime_type or audio.content_type)
    try:
        text = await asyncio.wait_for(
            transcribe_audio(audio_bytes, filename, db=db, mime=mime),
            timeout=SPEAKING_MAX_WAIT_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=AI_TIMEOUT_DETAIL)
    return {"text": text}


@app.post("/api/speaking/converse")
async def speaking_converse(body: ConverseIn,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db),
                            _rl=Depends(turn_rate_limit)):
    """One in-character reply from the roleplay partner."""
    history = [t.model_dump() for t in body.history]
    reply = await interaction_reply(body.consigne, history, db=db, mode=body.mode)
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
    # The roleplay is the one tâche the trial hands out only once.
    is_tache2 = body.mode == "tache2"
    if free_mode:
        user = await enforce_free_conversation_limit(db, user)
    else:
        user = await reserve_credit(db, user, "speaking", tache2=is_tache2)
    history = [t.model_dump() for t in body.history]
    # The mode was validated on the way in and then thrown away, so a tâche 1
    # interview reached the tâche 2 examiner. Carry it through.
    task_type = {"tache1": 1, "tache2": 2}.get(body.mode)
    analysis = await grade_interaction(body.consigne, history, db=db,
                                       task_type=task_type)
    if analysis.get("ai_unavailable"):
        if not free_mode:
            await refund_credit(db, user, "speaking", tache2=is_tache2)
        raise HTTPException(status_code=503, detail=ai_error_detail(analysis))
    if analysis.get("no_speech"):
        # Nothing was said, so nothing was graded: give the credit back rather
        # than charging for an empty attempt, and still return 200 so the
        # learner reads why instead of an unexplained failure.
        if not free_mode:
            await refund_credit(db, user, "speaking", tache2=is_tache2)
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
    return public_analysis(analysis)


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
    premium = is_premium(user)
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
    premium = is_premium(user)
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
# ----------------------------------------------------------------------------
# Billing endpoints
# ----------------------------------------------------------------------------
@app.get("/api/billing/plans")
async def billing_plans():
    """The catalogue the pricing page renders.

    Public, and the only source of truth for prices. The frontend used to hold
    them, which meant the amount charged came from whatever the browser sent.
    """
    return {
        "currency": BILLING_CURRENCY,
        "configured": billing_configured(),
        "plans": [{"id": pid, "name": p["name"], "amount": p["amount"],
                   "first_amount": p.get("first_amount"),
                   "interval_type": p["interval_type"],
                   "intervals": p["intervals"], "bonus": p["bonus"]}
                  for pid, p in BILLING_PLANS.items()],
    }


@app.get("/api/billing/subscription")
async def billing_my_subscription(user: User = Depends(get_current_user),
                                  db: AsyncSession = Depends(get_db)):
    """The learner's most recent subscription, plus where premium stands."""
    res = await db.execute(
        select(Subscription).where(Subscription.user_id == user.user_id)
        .order_by(Subscription.created_at.desc()).limit(1))
    row = res.scalar_one_or_none()
    return {
        "premium": is_premium(user),
        "premium_until": user.premium_until,
        # Drives which price the pricing page shows. Advisory only - the amount
        # actually charged is recomputed server-side at checkout.
        "first_time_eligible": not await has_paid_before(db, user.user_id),
        "subscription": _row_to_dict(row) if row else None,
    }


@app.post("/api/billing/subscribe")
async def billing_subscribe(body: SubscribeIn,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """Open a Cashfree mandate and hand back the link that authorises it.

    Nothing is granted here. The learner authorises at Cashfree and the signed
    webhook is what turns premium on - a reply to this call cannot be trusted,
    because the browser it goes to is the one thing an attacker controls.
    """
    if not billing_configured():
        raise HTTPException(
            status_code=503,
            detail="Les paiements ne sont pas encore configurés.")
    plan = BILLING_PLANS.get(body.plan_id.strip().lower())
    if not plan:
        raise HTTPException(status_code=400,
                            detail=f"Formule inconnue : {body.plan_id}")

    # Cashfree rejects a mandate with no phone. A placeholder would be worse
    # than a clear error, so ask for the number instead.
    if not user.phone:
        raise HTTPException(
            status_code=400,
            detail="Ajoutez un numéro de téléphone à votre compte avant de payer.")

    plan_key = body.plan_id.strip().lower()
    # Decided here, from the database, and never from the request: a discount
    # the browser can ask for is a discount anyone can take twice.
    first_time = not await has_paid_before(db, user.user_id)
    amount = plan_price(plan, first_time)
    try:
        cf_plan = await cf_ensure_plan(plan_key, plan, amount)
    except Exception:  # noqa: BLE001
        log.exception("Cashfree plan registration failed for %s", plan_key)
        raise HTTPException(
            status_code=502,
            detail="La formule n'a pas pu être ouverte chez le prestataire.")

    sub_id = new_id("sub")
    payload = {
        "subscription_id": sub_id,
        "customer_details": {
            "customer_name": user.name or "Learner",
            "customer_email": user.email,
            "customer_phone": user.phone,
        },
        # The plan is referenced, not described: sending the details inline
        # fails with plan_not_found however complete they are.
        "plan_details": {"plan_id": cf_plan},
        "authorization_details": {
            "authorization_amount": BILLING_AUTH_AMOUNT,
            "authorization_amount_refund": True,
            "payment_methods": ["card"],
        },
        "subscription_meta": {
            "return_url": f"{ALLOWED_ORIGINS[0]}/billing/return?sub={sub_id}",
        },
    }

    try:
        data = await cf_request("POST", "/subscriptions", payload)
    except Exception:  # noqa: BLE001
        log.exception("Cashfree subscription create failed for %s", user.user_id)
        raise HTTPException(
            status_code=502,
            detail="Le prestataire de paiement n'a pas répondu. Réessayez.")

    # Logged whole: the field names move between Cashfree API versions, and
    # without the raw reply a missing link is undiagnosable.
    log.info("Cashfree subscription %s created: %s", sub_id, _scrub_secrets(data))
    now = now_utc()
    db.add(Subscription(
        subscription_id=sub_id, user_id=user.user_id,
        plan_id=body.plan_id.strip().lower(), status="pending",
        currency=BILLING_CURRENCY, amount=amount,
        cf_subscription_id=str(_dig(data, "cf_subscription_id") or ""),
        created_at=now, updated_at=now))
    await db.commit()
    return {
        "subscription_id": sub_id,
        "amount": amount,
        "first_time": first_time,
        "auth_link": _dig(data, "authorization_link", "authorisation_link",
                          "auth_link", "subscription_link"),
        "session_id": _dig(data, "subscription_session_id"),
    }


@app.post("/api/billing/cancel")
async def billing_cancel(user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Stop future charges. Premium already paid for runs to its expiry."""
    res = await db.execute(
        select(Subscription).where(Subscription.user_id == user.user_id,
                                   Subscription.status.in_(("pending", "active")))
        .order_by(Subscription.created_at.desc()).limit(1))
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404,
                            detail="Aucun abonnement actif à résilier.")
    try:
        await cf_request("POST", f"/subscriptions/{row.subscription_id}/manage",
                         {"action": "CANCEL"})
    except Exception:  # noqa: BLE001
        log.exception("Cashfree cancel failed for %s", row.subscription_id)
        raise HTTPException(
            status_code=502,
            detail="La résiliation n'a pas pu être transmise. Réessayez.")
    row.status = "cancelled"
    row.cancelled_at = now_utc()
    row.updated_at = now_utc()
    await db.commit()
    return {"cancelled": True, "premium_until": user.premium_until}


# Webhook event names carry the outcome in the string rather than a field, and
# they have changed spelling across Cashfree API versions, so match on both
# halves instead of an exact list.
def _is_payment_success(event_type: str) -> bool:
    e = event_type.upper()
    return "PAYMENT" in e and "SUCCESS" in e


def _is_cancellation(event_type: str, status: str) -> bool:
    blob = f"{event_type} {status}".upper()
    return "CANCEL" in blob


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Cashfree's notification. The only thing that grants premium.

    Returns 2xx for anything it has already handled or does not recognise:
    Cashfree retries until it gets one, and retrying an event we understood
    perfectly well the first time is how one payment becomes two months.
    """
    raw = await request.body()
    if not verify_cashfree_signature(
            raw,
            request.headers.get("x-webhook-signature", ""),
            request.headers.get("x-webhook-timestamp", "")):
        log.warning("Rejected a Cashfree webhook with an invalid signature")
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        event = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed body")

    event_type = str(event.get("type") or _dig(event, "type") or "UNKNOWN")
    sub_id = _dig(event, "subscription_id")
    status = str(_dig(event, "subscription_status", "payment_status") or "")
    # No single id is present on every event, so the key is built from what is.
    marker = (_dig(event, "cf_payment_id", "payment_id", "event_id",
                   "cf_subscription_id") or request.headers.get(
                       "x-webhook-timestamp", ""))
    event_key = f"{event_type}:{sub_id}:{marker}"[:200]

    db.add(BillingEvent(event_key=event_key, event_type=event_type,
                        subscription_id=str(sub_id) if sub_id else None,
                        payload=event, created_at=now_utc()))
    try:
        await db.commit()
    except Exception:  # noqa: BLE001
        # Unique violation: this is a retry of an event already applied.
        await db.rollback()
        log.info("Ignored duplicate Cashfree webhook %s", event_key)
        return {"ok": True, "duplicate": True}

    if not sub_id:
        log.info("Cashfree webhook %s carried no subscription_id", event_type)
        return {"ok": True, "ignored": "no subscription_id"}

    res = await db.execute(select(Subscription)
                           .where(Subscription.subscription_id == str(sub_id)))
    row = res.scalar_one_or_none()
    if not row:
        log.warning("Cashfree webhook for unknown subscription %s", sub_id)
        return {"ok": True, "ignored": "unknown subscription"}

    res = await db.execute(select(User).where(User.user_id == row.user_id))
    user = res.scalar_one_or_none()
    if not user:
        log.warning("Subscription %s has no user %s", sub_id, row.user_id)
        return {"ok": True, "ignored": "unknown user"}

    plan = BILLING_PLANS.get(row.plan_id) or BILLING_PLANS["month"]
    row.updated_at = now_utc()

    if _is_payment_success(event_type):
        # The charge landed: add one cycle. The amount is read from our own
        # catalogue, never from the webhook, so a forged or replayed body
        # cannot buy a longer period than the plan sells.
        await grant_premium(db, user, plan_period(plan), bonus=plan["bonus"])
        row.status = "active"
        row.current_period_end = user.premium_until
        await db.commit()
        log.info("Premium extended to %s for %s (plan %s)",
                 user.premium_until, user.user_id, row.plan_id)
        return {"ok": True, "granted": True}

    if _is_cancellation(event_type, status):
        row.status = "cancelled"
        row.cancelled_at = now_utc()
        await db.commit()
        return {"ok": True, "cancelled": True}

    if status:
        row.status = status.lower()[:32]
    await db.commit()
    return {"ok": True}


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


# ----------------------------------------------------------------------------
# "How much credit is left?"
# ----------------------------------------------------------------------------
# Only DeepSeek answers that over the API. OpenAI, Anthropic, Gemini and Groq
# expose spend in their billing consoles but have no key-readable balance, so
# for those the only programmatic signal is what a live call reports back:
# 401 means the key is rejected, 429 + insufficient_quota means the account is
# out of credit, and 429 without it means the request was merely too fast.
# Distinguishing those three is the difference between "top up" and "wait".
BALANCE_UNSUPPORTED = ("This provider has no key-readable balance endpoint - "
                       "check its billing console. The live probe still tells "
                       "you whether the key is rejected or out of credit.")


def _deepseek_balance_sync() -> dict:
    import requests
    root = DEEPSEEK_BASE_URL.rstrip("/")
    for suffix in ("/v1", "/beta"):
        if root.endswith(suffix):
            root = root[: -len(suffix)]
    resp = requests.get(f"{root}/user/balance",
                        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                        timeout=15)
    resp.raise_for_status()
    data = resp.json()
    infos = data.get("balance_infos") or []
    first = infos[0] if infos else {}
    return {
        "supported": True,
        "is_available": bool(data.get("is_available")),
        "currency": first.get("currency"),
        "total": first.get("total_balance"),
        "granted": first.get("granted_balance"),
        "topped_up": first.get("topped_up_balance"),
    }


async def provider_balance(provider: str) -> dict:
    """Account balance for `provider`, when it publishes one."""
    if provider != "deepseek":
        return {"supported": False, "note": BALANCE_UNSUPPORTED}
    if not _key_is_usable(DEEPSEEK_API_KEY):
        return {"supported": True, "error": "No usable DeepSeek API key."}
    try:
        return await asyncio.wait_for(run_ai(_deepseek_balance_sync), timeout=20)
    except Exception as exc:  # noqa: BLE001
        return {"supported": True,
                "error": f"{type(exc).__name__}: {_scrub_secrets(exc)}"}


def classify_provider_error(exc: Exception) -> str:
    """Turn a provider exception into a reason the Admin panel can act on."""
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    blob = f"{type(exc).__name__} {exc}".lower()
    if "insufficient_quota" in blob or "insufficient balance" in blob \
            or "exceeded your current quota" in blob or "billing" in blob:
        return "no_credit"
    if status in (401, 403) or "invalid_api_key" in blob \
            or "incorrect api key" in blob or "api key not valid" in blob \
            or "unauthorized" in blob or "permission_denied" in blob:
        return "bad_key"
    if status == 429 or "rate limit" in blob or "rate_limit" in blob:
        return "rate_limited"
    if "empty completion" in blob:
        return "empty_reply"
    if status == 404 or "model_not_found" in blob or "does not exist" in blob:
        return "bad_model"
    return "other"


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
            return {"ok": False, "model": model, "reason": "no_key",
                    "balance": {"supported": provider == "deepseek",
                                "error": "No usable API key."},
                    "error": "No usable API key — .env is empty or still holds "
                             "a placeholder like 'your_..._key'."}
        # The balance call is independent of the completion, so a rejected key
        # still reports whichever of the two answers.
        balance = await provider_balance(provider)
        try:
            out = await asyncio.wait_for(
                run_ai(fn, model,
                       "Reply with the single word: ok",
                       "Reply with the single word: ok"),
                timeout=30)
            return {"ok": True, "model": model, "balance": balance,
                    "sample": (out or "").strip()[:60]}
        except asyncio.TimeoutError:
            return {"ok": False, "model": model, "reason": "timeout",
                    "balance": balance,
                    "error": "Timed out after 30s — provider unreachable from this host."}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "model": model,
                    "reason": classify_provider_error(exc),
                    "balance": balance,
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
                      limit: int = Query(200, ge=1, le=1000),
                      offset: int = Query(0, ge=0),
                      db: AsyncSession = Depends(get_db)):
    """Newest accounts first. Paged, so the response cannot grow without bound
    as the user base does."""
    total = await db.scalar(select(func.count()).select_from(User))
    res = await db.execute(
        select(User).order_by(User.created_at.desc())
        .limit(limit).offset(offset))
    return {"users": [strip_user(u) for u in res.scalars().all()],
            "total": total or 0, "limit": limit, "offset": offset}


@app.get("/api/admin/submissions")
async def admin_submissions(admin: User = Depends(get_admin_user),
                            db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Submission).order_by(Submission.created_at.desc()).limit(200))
    return {"submissions": [_row_to_dict(s) for s in res.scalars().all()]}


@app.get("/api/admin/analytics")
async def admin_analytics(admin: User = Depends(get_admin_user),
                          db: AsyncSession = Depends(get_db)):
    """Platform totals and the most repeated errors.

    Counted in Postgres. This used to run a bare `select(Submission)` — the
    whole table, full essay text and JSONB error arrays, materialised into a
    single-process server and looped over in Python. It is the Admin panel's
    default tab, so it fired on every visit, and at scale it would take the
    site down with it.
    """
    from sqlalchemy import text as sa_text

    total_users = await db.scalar(select(func.count()).select_from(User))
    total_submissions = await db.scalar(
        select(func.count()).select_from(Submission))

    breakdown = {c: 0 for c in VALID_CATEGORIES}
    rows = await db.execute(sa_text(
        "SELECT e.val->>'category' AS category, COUNT(*) AS n "
        "FROM submissions s, "
        "     LATERAL jsonb_array_elements(coalesce(s.errors, '[]'::jsonb)) AS e(val) "
        "GROUP BY 1"))
    for category, n in rows.all():
        breakdown[category or "spelling"] = (
            breakdown.get(category or "spelling", 0) + int(n))

    rows = await db.execute(sa_text(
        "SELECT btrim(e.val->>'error') AS err, COUNT(*) AS n "
        "FROM submissions s, "
        "     LATERAL jsonb_array_elements(coalesce(s.errors, '[]'::jsonb)) AS e(val) "
        "WHERE btrim(coalesce(e.val->>'error', '')) <> '' "
        "GROUP BY 1 ORDER BY n DESC LIMIT 10"))
    top = [{"error": err, "count": int(n)} for err, n in rows.all()]

    return {"total_users": total_users or 0,
            "total_submissions": total_submissions or 0,
            "error_breakdown": breakdown,
            "top_errors": top}


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
    author: Mapped[str] = mapped_column(String(120), default="prepfrancais")
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
    author: Optional[str] = "prepfrancais"
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
        author=body.author or "prepfrancais",
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
    # Tâche 3 only. The real exam hands the candidate a titled subject and two
    # opposing documents, and asks for one continuous 120-180 word reply; the
    # documents are not part of that count. They are stored apart from
    # prompt_text (which holds the consigne) so the page can label and separate
    # them the way the exam paper does. NULL for tâches 1 and 2.
    title: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    doc_1: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    doc_2: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    title: Optional[str] = None
    doc_1: Optional[str] = None
    doc_2: Optional[str] = None


class ThemeQuestionUpdate(BaseModel):
    theme_id: Optional[str] = None
    task_type: Optional[int] = Field(default=None, ge=1, le=3)
    prompt_text: Optional[str] = None
    title: Optional[str] = None
    doc_1: Optional[str] = None
    doc_2: Optional[str] = None
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
# Tâches 1, 2 and 3 each have their own official set of themes, and the sets
# only partly overlap — Ville/Quartier is a tâche 1 theme, while Santé and
# Technologie belong to tâche 2, and tâche 3 argues over eight broad societal
# themes of its own. This list is their union (17), and /api/themes hides the
# themes that hold no question for the tâche being asked for, so tâches 1 and 2
# still show exactly their own 7 and tâche 3 shows exactly its own 8.
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

    # --- Tâche 3 only: the eight argumentative themes (15 subjects each) ---
    # First two free, the rest Pro, matching how the tâche 1/2 themes open up.
    ("Travail & Vie professionnelle", "💼", False, 11,
     "15 sujets argumentatifs — télétravail, horaires, carrière et salaire."),
    ("Éducation & Enfants", "🎓", False, 12,
     "15 sujets argumentatifs — école, devoirs, examens et éducation des enfants."),
    ("Technologie & Société", "📱", True, 13,
     "15 sujets argumentatifs — réseaux sociaux, écrans, IA et vie privée."),
    ("Environnement & Transports", "🌍", True, 14,
     "15 sujets argumentatifs — pollution, voiture, énergie et consommation."),
    ("Santé & Mode de vie", "🩺", True, 15,
     "15 sujets argumentatifs — alimentation, sport, sommeil et prévention."),
    ("Ville, Logement & Vie quotidienne", "🏙️", True, 16,
     "15 sujets argumentatifs — ville ou campagne, logement et vie de quartier."),
    ("Culture, Loisirs & Voyages", "🎭", True, 17,
     "15 sujets argumentatifs — culture, tourisme, sport et temps libre."),
    ("Société, Famille & Consommation", "👨‍👩‍👧", True, 18,
     "15 sujets argumentatifs — famille, argent, solidarité et consommation."),
]

# Each question: (theme_name, task_type, prompt_text)
SEED_THEME_QUESTIONS = [
    # ------------------------------------------------------------------
    # THÈME 1 — LOGEMENT & VIE QUOTIDIENNE — Tâche 1
    # ------------------------------------------------------------------
    ("Logement & Vie quotidienne", 1,
     "Vous allez déménager dans un nouvel appartement. Écrivez à un ami pour lui demander de l'aide et précisez la date et les tâches à faire."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez trouvé un appartement qui vous plaît beaucoup. Écrivez à votre ami pour lui décrire le logement et expliquer pourquoi vous l'avez choisi."),
    ("Logement & Vie quotidienne", 1,
     "Vous cherchez un colocataire. Rédigez une annonce pour présenter votre logement et préciser le type de personne que vous recherchez."),
    ("Logement & Vie quotidienne", 1,
     "Votre ami cherche un appartement dans votre quartier. Écrivez-lui pour lui recommander un logement et présenter ses avantages."),
    ("Logement & Vie quotidienne", 1,
     "Vous venez de déménager dans un nouveau quartier. Écrivez à un ami pour lui décrire votre nouveau quartier et les services disponibles."),
    ("Logement & Vie quotidienne", 1,
     "Vous organisez une crémaillère dans votre nouvel appartement. Écrivez à vos amis pour les inviter et donner les informations pratiques."),
    ("Logement & Vie quotidienne", 1,
     "Vous devez quitter votre logement plus tôt que prévu. Écrivez à votre propriétaire pour expliquer la situation et proposer une nouvelle date."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez découvert un problème important dans votre appartement. Écrivez à votre propriétaire pour décrire le problème et demander une intervention."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez besoin d'aide pour monter des meubles chez vous. Écrivez à un ami pour lui demander de venir vous aider."),
    ("Logement & Vie quotidienne", 1,
     "Vous souhaitez acheter de nouveaux meubles pour votre appartement. Écrivez à un ami pour lui demander conseil et expliquer ce dont vous avez besoin."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez visité une maison que vous envisagez de louer. Écrivez à un proche pour décrire la maison et demander son avis."),
    ("Logement & Vie quotidienne", 1,
     "Vous allez accueillir un nouvel étudiant dans votre appartement en colocation. Écrivez-lui pour présenter le logement et expliquer les règles de la maison."),
    ("Logement & Vie quotidienne", 1,
     "Votre ami vient passer quelques jours chez vous. Écrivez-lui pour lui expliquer où se trouve votre logement et lui donner quelques informations pratiques."),
    ("Logement & Vie quotidienne", 1,
     "Vous devez vous absenter pendant quelques jours. Écrivez à votre voisin pour lui demander de surveiller votre appartement."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez acheté un nouvel appareil pour votre maison. Écrivez à votre ami pour lui présenter l'appareil et expliquer pourquoi vous l'avez acheté."),
    ("Logement & Vie quotidienne", 1,
     "Vous souhaitez organiser une journée de rangement et de nettoyage chez vous. Écrivez à vos amis pour leur demander de participer."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez récemment changé votre routine quotidienne. Écrivez à un ami pour lui expliquer ce que vous avez changé et pourquoi."),
    ("Logement & Vie quotidienne", 1,
     "Vous souhaitez proposer une activité à votre voisin pour mieux faire connaissance. Écrivez-lui un message pour présenter votre idée."),
    ("Logement & Vie quotidienne", 1,
     "Votre ami souhaite vivre dans votre quartier. Écrivez-lui pour lui présenter les avantages et les inconvénients de ce quartier."),
    ("Logement & Vie quotidienne", 1,
     "Vous avez besoin de quelqu'un pour garder votre animal pendant quelques jours. Écrivez à un ami ou à un voisin pour lui demander de l'aide."),

    # ------------------------------------------------------------------
    # THÈME 2 — TRAVAIL & ÉTUDES — Tâche 1
    # ------------------------------------------------------------------
    ("Travail & Études", 1,
     "Vous commencez un nouvel emploi. Écrivez à un ami pour lui raconter votre première journée et présenter votre nouveau travail."),
    ("Travail & Études", 1,
     "Vous souhaitez organiser un déjeuner avec vos collègues. Écrivez-leur pour proposer une date, un lieu et une organisation."),
    ("Travail & Études", 1,
     "Vous devez vous absenter du travail pendant une journée. Écrivez à votre collègue pour l'informer et expliquer comment organiser vos tâches."),
    ("Travail & Études", 1,
     "Vous avez changé de poste dans votre entreprise. Écrivez à un ami pour lui présenter vos nouvelles responsabilités."),
    ("Travail & Études", 1,
     "Vous souhaitez organiser une activité entre collègues après le travail. Écrivez un message pour proposer une activité et demander qui souhaite participer."),
    ("Travail & Études", 1,
     "Votre ami cherche un emploi dans votre entreprise. Écrivez-lui pour présenter les possibilités et expliquer comment il peut postuler."),
    ("Travail & Études", 1,
     "Vous avez participé à une formation professionnelle intéressante. Écrivez à votre collègue pour raconter votre expérience et lui recommander cette formation."),
    ("Travail & Études", 1,
     "Vous avez obtenu une promotion. Écrivez à vos amis pour leur annoncer la nouvelle et proposer de célébrer ensemble."),
    ("Travail & Études", 1,
     "Vous souhaitez travailler à distance pendant quelques jours. Écrivez à votre responsable pour expliquer votre situation et proposer une organisation."),
    ("Travail & Études", 1,
     "Vous devez remplacer un collègue pendant ses vacances. Écrivez-lui pour lui demander les informations nécessaires concernant son travail."),
    ("Travail & Études", 1,
     "Vous commencez un nouveau cours de français. Écrivez à un ami pour présenter le cours, les horaires et votre première impression."),
    ("Travail & Études", 1,
     "Vous cherchez un partenaire pour étudier avec vous. Écrivez un message pour présenter vos disponibilités et les matières que vous souhaitez travailler."),
    ("Travail & Études", 1,
     "Vous préparez un examen important avec vos amis. Écrivez-leur pour proposer un programme de révision."),
    ("Travail & Études", 1,
     "Vous avez découvert une bibliothèque idéale pour étudier. Écrivez à votre ami pour lui présenter le lieu et proposer d'y aller ensemble."),
    ("Travail & Études", 1,
     "Vous devez modifier votre horaire de cours. Écrivez à votre professeur pour expliquer votre situation et proposer une solution."),
    ("Travail & Études", 1,
     "Votre ami souhaite étudier dans votre ville. Écrivez-lui pour présenter les possibilités d'études et les informations importantes."),
    ("Travail & Études", 1,
     "Vous organisez un groupe d'étude avant un examen. Écrivez à vos camarades pour proposer une date, un lieu et un programme."),
    ("Travail & Études", 1,
     "Vous avez trouvé un professeur particulier excellent. Écrivez à votre ami pour lui présenter ce professeur et expliquer pourquoi vous le recommandez."),
    ("Travail & Études", 1,
     "Vous avez obtenu de bons résultats à un examen. Écrivez à votre famille pour annoncer la nouvelle et raconter comment vous avez préparé l'examen."),
    ("Travail & Études", 1,
     "Votre école ou votre entreprise organise une journée spéciale. Écrivez à vos collègues ou camarades pour présenter le programme et les inviter."),

    # ------------------------------------------------------------------
    # THÈME 3 — VOYAGE & DÉPLACEMENTS — Tâche 1
    # ------------------------------------------------------------------
    ("Voyage & Déplacements", 1,
     "Votre ami souhaite visiter votre région. Écrivez-lui pour lui proposer des lieux intéressants à découvrir."),
    ("Voyage & Déplacements", 1,
     "Vous venez de passer des vacances dans une autre ville. Écrivez à un ami pour raconter votre séjour et recommander quelques endroits."),
    ("Voyage & Déplacements", 1,
     "Vous préparez un voyage avec des amis. Écrivez-leur pour présenter votre programme, les dates, le transport et les activités prévues."),
    ("Voyage & Déplacements", 1,
     "Vous avez trouvé un hôtel intéressant pour vos prochaines vacances. Écrivez à vos amis pour leur présenter l'hôtel et proposer de le réserver."),
    ("Voyage & Déplacements", 1,
     "Votre ami souhaite visiter votre pays pour la première fois. Écrivez-lui pour présenter les endroits qu'il devrait découvrir."),
    ("Voyage & Déplacements", 1,
     "Vous avez effectué un voyage à la montagne. Écrivez à votre ami pour raconter votre séjour et lui conseiller cette destination."),
    ("Voyage & Déplacements", 1,
     "Vous préparez un week-end à la campagne avec des amis. Écrivez-leur pour organiser le transport, l'hébergement et les activités."),
    ("Voyage & Déplacements", 1,
     "Votre ami vient visiter votre ville. Écrivez-lui pour expliquer comment utiliser les transports publics et lui proposer un programme."),
    ("Voyage & Déplacements", 1,
     "Vous avez réservé un logement pour un voyage avec vos amis. Écrivez-leur pour présenter le logement et expliquer pourquoi vous l'avez choisi."),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez proposer un voyage à vos collègues pendant un long week-end. Écrivez un message pour présenter votre idée."),
    ("Voyage & Déplacements", 1,
     "Vous avez découvert une magnifique plage pendant vos vacances. Écrivez à votre ami pour raconter votre expérience et lui conseiller cet endroit."),
    ("Voyage & Déplacements", 1,
     "Vous préparez un voyage en groupe mais vous devez modifier le programme. Écrivez à vos amis pour expliquer le changement."),
    ("Voyage & Déplacements", 1,
     "Votre ami vient vous rendre visite pendant ses vacances. Écrivez-lui pour proposer un programme de trois jours dans votre ville."),
    ("Voyage & Déplacements", 1,
     "Vous avez participé à une excursion organisée. Écrivez à votre ami pour raconter votre journée et lui conseiller cette activité."),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez partir en vacances avec votre famille. Écrivez à un proche pour proposer une destination et expliquer votre choix."),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez organiser un trajet en covoiturage avec vos collègues. Écrivez un message pour proposer le trajet et préciser les horaires."),
    ("Voyage & Déplacements", 1,
     "Votre voiture est en panne et vous devez demander de l'aide à un ami. Écrivez-lui pour expliquer la situation et proposer une solution."),
    ("Voyage & Déplacements", 1,
     "Vous souhaitez louer une voiture pour un week-end. Écrivez à une agence pour demander des informations sur les prix et les conditions."),
    ("Voyage & Déplacements", 1,
     "Vous devez modifier l'heure de départ d'un voyage en groupe. Écrivez à vos amis pour expliquer le changement et proposer une nouvelle heure."),
    ("Voyage & Déplacements", 1,
     "Vous avez découvert un moyen de transport pratique et économique. Écrivez à votre ami pour lui présenter cette solution et expliquer pourquoi vous la recommandez."),

    # ------------------------------------------------------------------
    # THÈME 4 — VIE SOCIALE & ÉVÉNEMENTS — Tâche 1
    # ------------------------------------------------------------------
    ("Vie sociale & Événements", 1,
     "Vous organisez une fête pour votre anniversaire. Écrivez à vos amis pour les inviter et préciser la date, le lieu et l'heure."),
    ("Vie sociale & Événements", 1,
     "Votre meilleur ami fête son anniversaire prochainement. Écrivez à votre groupe d'amis pour proposer un cadeau commun."),
    ("Vie sociale & Événements", 1,
     "Vous organisez une fête de départ pour un collègue. Écrivez à vos collègues pour les inviter et expliquer l'organisation."),
    ("Vie sociale & Événements", 1,
     "Vous préparez une fête surprise pour un ami. Écrivez aux participants pour leur donner les informations nécessaires."),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une soirée entre anciens camarades de classe. Écrivez un message pour proposer la rencontre."),
    ("Vie sociale & Événements", 1,
     "Vous organisez une fête de fin d'année avec vos amis. Invitez-les et présentez les activités prévues."),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez célébrer une réussite professionnelle avec vos collègues. Écrivez un message pour les inviter à un repas."),
    ("Vie sociale & Événements", 1,
     "Votre ami vient d'avoir un bébé. Écrivez à vos amis pour proposer un cadeau commun et organiser une visite."),
    ("Vie sociale & Événements", 1,
     "Vous préparez une fête culturelle dans votre quartier. Écrivez un message aux habitants pour les inviter."),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une soirée barbecue chez vous. Invitez vos amis et donnez les informations pratiques."),
    ("Vie sociale & Événements", 1,
     "Vous organisez une soirée jeux de société. Écrivez à vos amis pour les inviter et expliquer ce qu'ils doivent apporter."),
    ("Vie sociale & Événements", 1,
     "Vous préparez une fête costumée. Écrivez un message aux invités pour présenter le thème, la date et le lieu."),
    ("Vie sociale & Événements", 1,
     "Vous voulez organiser un pique-nique pour célébrer une occasion spéciale. Invitez vos amis et précisez les détails."),
    ("Vie sociale & Événements", 1,
     "Vous organisez une cérémonie familiale. Écrivez à un proche pour lui présenter le programme et demander sa présence."),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une fête après un examen important. Écrivez à vos amis pour les inviter."),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une réunion familiale après plusieurs années sans vous voir. Écrivez à votre famille pour proposer une date et un lieu."),
    ("Vie sociale & Événements", 1,
     "Vous avez besoin de l'aide de vos amis pour organiser un événement. Écrivez-leur pour expliquer ce dont vous avez besoin."),
    ("Vie sociale & Événements", 1,
     "Vous souhaitez organiser une journée entre amis sans dépenser beaucoup d'argent. Écrivez-leur pour proposer plusieurs activités gratuites."),
    ("Vie sociale & Événements", 1,
     "Vous avez participé à une activité communautaire. Écrivez à votre ami pour raconter ce que vous avez fait et lui proposer de participer à la prochaine activité."),
    ("Vie sociale & Événements", 1,
     "Votre ami vient d'arriver dans votre ville. Écrivez-lui pour lui proposer de passer une journée ensemble et de lui faire découvrir la ville."),

    # ------------------------------------------------------------------
    # THÈME 5 — LOISIRS, CULTURE & SPORT — Tâche 1
    # ------------------------------------------------------------------
    ("Loisirs, Culture & Sport", 1,
     "Vous avez vu un film que vous avez beaucoup aimé. Écrivez à votre ami pour lui raconter le film et lui conseiller de le regarder."),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez aller à un concert avec vos amis. Écrivez-leur pour proposer le concert et donner les informations pratiques."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez visité une exposition intéressante. Écrivez à votre ami pour raconter votre visite et lui recommander cette exposition."),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez organiser une sortie au cinéma. Écrivez à vos amis pour proposer un film, une date et un lieu."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez découvert un nouveau musée dans votre ville. Écrivez à votre ami pour lui présenter le musée."),
    ("Loisirs, Culture & Sport", 1,
     "Vous cherchez quelqu'un avec qui pratiquer une activité artistique. Rédigez une annonce pour trouver un partenaire."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez assisté à un festival culturel. Écrivez à votre ami pour raconter votre expérience."),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez commencer à apprendre à jouer d'un instrument. Écrivez à votre ami pour lui demander des conseils."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez commencé un nouveau loisir. Écrivez à votre ami pour expliquer ce que vous faites et pourquoi cela vous plaît."),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez organiser une soirée cinéma chez vous. Invitez vos amis et présentez le programme."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez lu un livre intéressant. Écrivez à votre ami pour lui présenter le livre et expliquer pourquoi vous le recommandez."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez découvert un théâtre dans votre ville. Écrivez à votre ami pour lui proposer d'y aller ensemble."),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez commencer à faire du sport dans une salle. Écrivez à un ami pour lui demander des informations sur une salle qu'il connaît."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez commencé une nouvelle activité sportive. Écrivez à votre ami pour lui présenter cette activité et expliquer pourquoi vous l'aimez."),
    ("Loisirs, Culture & Sport", 1,
     "Vous cherchez un partenaire pour faire du sport régulièrement. Rédigez une annonce en précisant vos activités préférées et vos disponibilités."),
    ("Loisirs, Culture & Sport", 1,
     "Vous organisez une randonnée avec des amis. Écrivez-leur pour donner les informations sur le parcours et ce qu'ils doivent apporter."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez participé à une compétition sportive. Écrivez à vos amis pour raconter l'événement et annoncer votre résultat."),
    ("Loisirs, Culture & Sport", 1,
     "Vous avez découvert une piscine ou un centre sportif intéressant. Écrivez à votre ami pour présenter les installations et les horaires."),
    ("Loisirs, Culture & Sport", 1,
     "Vous souhaitez organiser une journée sportive avec vos collègues. Écrivez un message pour proposer les activités."),
    ("Loisirs, Culture & Sport", 1,
     "Votre ami veut commencer à courir. Écrivez-lui pour lui donner quelques conseils et lui proposer de courir ensemble."),

    # ------------------------------------------------------------------
    # THÈME 6 — ACHATS, ALIMENTATION & SERVICES — Tâche 1
    # ------------------------------------------------------------------
    ("Achats, Alimentation & Services", 1,
     "Vous avez découvert un excellent restaurant dans votre ville. Écrivez à votre ami pour lui présenter le restaurant et lui proposer d'y aller ensemble."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser un dîner avec vos amis. Écrivez-leur pour proposer un restaurant, une date et une heure."),
    ("Achats, Alimentation & Services", 1,
     "Votre ami vous demande une recette de votre plat préféré. Répondez-lui en expliquant comment vous le préparez."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser un repas chez vous. Invitez vos amis et expliquez ce qu'ils peuvent apporter."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez testé un nouveau restaurant végétarien. Écrivez à votre ami pour raconter votre expérience."),
    ("Achats, Alimentation & Services", 1,
     "Votre ami vient visiter votre ville et souhaite découvrir la cuisine locale. Écrivez-lui pour recommander quelques spécialités."),
    ("Achats, Alimentation & Services", 1,
     "Vous organisez un repas international avec vos collègues. Écrivez un message pour expliquer le principe et demander à chacun d'apporter un plat."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez participé à un cours de cuisine. Écrivez à votre ami pour raconter votre expérience et lui recommander le cours."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser un pique-nique. Écrivez à vos amis pour proposer le menu et répartir les tâches."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez acheté un cadeau pour un ami. Écrivez-lui pour lui présenter le cadeau et expliquer pourquoi vous l'avez choisi."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez vendre un vélo que vous n'utilisez plus. Rédigez une annonce pour décrire le vélo, son état et son prix."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez acheté un appareil électronique qui ne fonctionne pas correctement. Écrivez au magasin pour expliquer le problème."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez commandé un produit sur Internet mais la livraison est en retard. Écrivez au service client pour expliquer la situation."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez reçu un produit différent de celui que vous aviez commandé. Écrivez au vendeur pour demander un échange."),
    ("Achats, Alimentation & Services", 1,
     "Votre ami souhaite acheter un ordinateur. Écrivez-lui pour lui recommander un modèle et expliquer votre choix."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez louer du matériel pour une fête. Écrivez à une entreprise pour demander les prix et les conditions."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez trouvé une boutique proposant des produits locaux. Écrivez à votre ami pour lui présenter cette boutique."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez acheter un cadeau commun pour un collègue. Écrivez à vos collègues pour proposer votre idée."),
    ("Achats, Alimentation & Services", 1,
     "Vous avez eu une très bonne expérience dans un restaurant. Écrivez au restaurant pour remercier l'équipe et expliquer ce que vous avez apprécié."),
    ("Achats, Alimentation & Services", 1,
     "Vous souhaitez organiser une sortie shopping avec vos amis. Écrivez-leur pour proposer un lieu, une date et un programme."),

    # ------------------------------------------------------------------
    # THÈME 7 — VILLE, QUARTIER & VIE LOCALE — Tâche 1
    # ------------------------------------------------------------------
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami vient visiter votre ville. Écrivez-lui pour proposer un programme de découverte sur une journée."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un nouveau parc dans votre quartier. Écrivez à votre ami pour lui présenter cet endroit."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre quartier organise une journée communautaire. Écrivez à vos voisins pour les inviter et présenter le programme."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un marché local intéressant. Écrivez à votre ami pour lui proposer de le visiter ensemble."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ville organise un festival. Écrivez à vos amis pour les inviter et présenter les activités prévues."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une visite culturelle dans votre ville. Écrivez à vos amis pour proposer une date et un programme."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami cherche un bon endroit pour passer une journée tranquille. Écrivez-lui pour recommander un lieu dans votre ville."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez proposer une promenade dans votre quartier à un ami qui vient vous rendre visite. Écrivez-lui pour présenter le parcours."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un nouveau centre de loisirs dans votre ville. Écrivez à votre ami pour lui présenter les activités disponibles."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre quartier organise une activité sportive gratuite. Écrivez à vos voisins pour les informer et les inviter."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une journée de nettoyage dans votre quartier. Écrivez à vos voisins pour demander leur participation."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un lieu historique près de chez vous. Écrivez à votre ami pour lui proposer de le visiter."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ville propose une nouvelle activité culturelle. Écrivez à vos amis pour leur présenter l'activité."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une sortie en famille dans votre ville. Écrivez à un proche pour présenter votre programme."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami vous demande quels sont les meilleurs endroits pour sortir dans votre ville. Répondez-lui avec quelques recommandations."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez découvert un nouveau café dans votre quartier. Écrivez à votre ami pour lui présenter le café et proposer d'y aller ensemble."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez organiser une activité pour rencontrer vos voisins. Écrivez-leur pour présenter votre idée et proposer une date."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous avez participé à un événement organisé par votre mairie. Écrivez à votre ami pour raconter votre expérience."),
    ("Ville, Quartier & Vie locale", 1,
     "Vous souhaitez proposer à vos voisins de créer un groupe pour organiser des activités locales. Écrivez un message pour expliquer votre idée."),
    ("Ville, Quartier & Vie locale", 1,
     "Votre ami souhaite s'installer dans votre ville. Écrivez-lui pour présenter les avantages de votre ville et lui recommander quelques quartiers."),

    # ==================================================================
    # TÂCHE 2 — article / blog (120 à 150 mots) — 7 thèmes x 20 sujets
    # ==================================================================

    # --- THÈME 1 — VIE QUOTIDIENNE & LOGEMENT ---
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment déménagé dans un nouveau logement. Racontez cette expérience sur votre blog et expliquez pourquoi vous avez décidé de changer de logement."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez vécu une expérience particulière avec un voisin. Racontez cette situation et expliquez comment vous avez réagi."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment commencé une nouvelle routine quotidienne. Écrivez un article pour expliquer ce qui a changé dans votre vie et comment vous vous sentez maintenant."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez vécu pendant quelques mois dans une autre ville. Racontez votre expérience et expliquez ce que vous avez apprécié dans cette nouvelle façon de vivre."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment aménagé votre appartement. Présentez cette expérience sur votre blog et expliquez comment vous avez organisé votre logement."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez décidé de vivre en colocation. Racontez votre expérience et présentez les avantages et les difficultés de cette situation."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment acheté un objet important pour votre maison. Présentez votre achat et expliquez pourquoi vous en êtes satisfait(e)."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez eu un problème important dans votre logement, mais vous avez finalement trouvé une solution. Racontez cette expérience et expliquez comment vous avez résolu le problème."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez accueilli un ami ou un membre de votre famille chez vous pendant plusieurs jours. Racontez cette expérience et expliquez ce que vous avez fait ensemble."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment changé une habitude dans votre vie quotidienne. Écrivez un article pour expliquer pourquoi vous avez fait ce changement et quels résultats vous avez obtenus."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez passé une journée très différente de vos journées habituelles. Racontez cette journée et expliquez pourquoi elle vous a marqué(e)."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez décidé de mieux organiser votre temps. Racontez comment vous avez changé votre organisation et expliquez si cette nouvelle méthode est efficace."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment découvert un endroit très agréable près de chez vous. Présentez cet endroit sur votre blog et expliquez pourquoi vous le recommandez."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez aidé un voisin ou un proche dans une situation difficile. Racontez cette expérience et expliquez ce que vous en avez pensé."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment fait quelque chose pour améliorer votre maison. Présentez ce que vous avez fait et expliquez pourquoi vous avez pris cette décision."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez passé quelques jours seul(e) chez vous pendant l'absence de votre famille ou de vos colocataires. Racontez cette expérience et donnez vos impressions."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment rencontré une personne qui habite dans votre quartier et qui vous a beaucoup aidé(e). Racontez votre rencontre et expliquez pourquoi vous l'avez appréciée."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez participé à une activité organisée dans votre immeuble ou votre quartier. Racontez votre expérience et expliquez ce que vous avez aimé."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez décidé de simplifier votre vie quotidienne. Écrivez un article pour expliquer les changements que vous avez faits et leurs effets."),
    ("Logement & Vie quotidienne", 2,
     "Vous avez récemment réalisé une tâche que vous trouviez difficile, comme déménager, réorganiser votre logement ou faire des travaux. Racontez votre expérience et expliquez ce que vous avez appris."),

    # --- THÈME 2 — TRAVAIL & ÉTUDES ---
    ("Travail & Études", 2,
     "Vous avez commencé un nouvel emploi. Écrivez un article pour raconter votre première semaine et expliquer vos premières impressions."),
    ("Travail & Études", 2,
     "Vous avez participé à une formation professionnelle qui vous a beaucoup appris. Racontez cette expérience et expliquez pourquoi vous la recommandez."),
    ("Travail & Études", 2,
     "Vous avez rencontré une personne intéressante dans votre environnement professionnel. Racontez cette rencontre et expliquez pourquoi elle vous a marqué(e)."),
    ("Travail & Études", 2,
     "Vous avez récemment changé de poste ou de service. Présentez cette expérience et expliquez comment votre vie professionnelle a changé."),
    ("Travail & Études", 2,
     "Vous avez vécu une journée particulièrement difficile au travail, mais vous avez réussi à résoudre les problèmes. Racontez cette journée et expliquez ce que vous avez appris."),
    ("Travail & Études", 2,
     "Vous avez participé à un projet avec plusieurs collègues. Racontez votre expérience et expliquez ce que vous avez apprécié dans le travail en équipe."),
    ("Travail & Études", 2,
     "Vous avez reçu une promotion ou une bonne nouvelle professionnelle. Écrivez à un ami pour raconter ce qui s'est passé et expliquer ce que cela représente pour vous."),
    ("Travail & Études", 2,
     "Vous avez décidé de changer votre façon de travailler. Racontez les changements que vous avez faits et expliquez leurs résultats."),
    ("Travail & Études", 2,
     "Vous avez travaillé à distance pendant plusieurs semaines. Racontez votre expérience et expliquez les avantages et les difficultés que vous avez rencontrés."),
    ("Travail & Études", 2,
     "Vous avez participé à un événement organisé par votre entreprise. Écrivez un article pour raconter cette expérience et donner vos impressions."),
    ("Travail & Études", 2,
     "Vous avez commencé à apprendre une nouvelle langue. Racontez votre expérience et expliquez pourquoi vous avez décidé de l'apprendre."),
    ("Travail & Études", 2,
     "Vous avez récemment commencé une nouvelle formation ou un nouveau cours. Présentez cette expérience et expliquez ce qui vous plaît le plus."),
    ("Travail & Études", 2,
     "Vous avez obtenu de bons résultats à un examen important. Racontez comment vous vous êtes préparé(e) et expliquez ce que vous avez ressenti."),
    ("Travail & Études", 2,
     "Vous avez rencontré un professeur qui a beaucoup influencé votre façon d'apprendre. Racontez cette rencontre et expliquez pourquoi cette personne vous a marqué(e)."),
    ("Travail & Études", 2,
     "Vous avez participé à un projet scolaire ou universitaire avec d'autres étudiants. Racontez votre expérience et expliquez les difficultés que vous avez rencontrées."),
    ("Travail & Études", 2,
     "Vous avez découvert une méthode d'apprentissage particulièrement efficace. Présentez cette méthode et expliquez comment elle vous a aidé(e)."),
    ("Travail & Études", 2,
     "Vous avez dû travailler ou étudier sous pression. Racontez cette expérience et expliquez comment vous avez réussi à gérer la situation."),
    ("Travail & Études", 2,
     "Vous avez changé votre programme d'études ou votre orientation professionnelle. Expliquez ce qui vous a poussé(e) à faire ce choix et racontez votre expérience."),
    ("Travail & Études", 2,
     "Vous avez aidé un collègue ou un camarade à résoudre un problème. Racontez la situation et expliquez comment vous vous êtes senti(e)."),
    ("Travail & Études", 2,
     "Vous avez participé à une activité organisée par votre école, votre université ou votre entreprise. Racontez cette expérience et expliquez pourquoi vous l'avez appréciée."),

    # --- THÈME 3 — VOYAGES & DÉCOUVERTES ---
    ("Voyage & Déplacements", 2,
     "Vous avez récemment fait un voyage qui vous a beaucoup marqué(e). Racontez cette expérience sur votre blog et expliquez pourquoi vous vous en souvenez encore."),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert une ville pour la première fois. Présentez votre voyage et expliquez ce que vous avez particulièrement apprécié."),
    ("Voyage & Déplacements", 2,
     "Vous avez passé des vacances dans un endroit différent de vos habitudes. Racontez votre séjour et donnez vos impressions."),
    ("Voyage & Déplacements", 2,
     "Vous avez fait un voyage avec des amis. Racontez cette expérience et expliquez ce qui a rendu ce voyage spécial."),
    ("Voyage & Déplacements", 2,
     "Vous avez voyagé seul(e) pour la première fois. Racontez votre expérience et expliquez ce que vous avez appris."),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert une région de votre pays que vous ne connaissiez pas. Présentez cette découverte et expliquez pourquoi vous la recommandez."),
    ("Voyage & Déplacements", 2,
     "Vous avez vécu une aventure inattendue pendant un voyage. Racontez ce qui s'est passé et expliquez comment vous avez réagi."),
    ("Voyage & Déplacements", 2,
     "Vous avez rencontré une personne intéressante pendant un voyage. Racontez votre rencontre et expliquez pourquoi elle vous a marqué(e)."),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert une tradition culturelle pendant vos vacances. Présentez cette expérience et expliquez ce que vous avez appris."),
    ("Voyage & Déplacements", 2,
     "Vous avez essayé une activité inhabituelle pendant un voyage. Racontez votre expérience et expliquez si vous la recommandez."),
    ("Voyage & Déplacements", 2,
     "Vous avez passé un week-end dans une petite ville ou à la campagne. Racontez votre séjour et expliquez ce que vous avez apprécié."),
    ("Voyage & Déplacements", 2,
     "Vous avez visité un lieu historique ou culturel pendant un voyage. Présentez votre visite et donnez vos impressions."),
    ("Voyage & Déplacements", 2,
     "Vous avez eu un problème pendant un voyage, mais vous avez trouvé une solution. Racontez cette expérience et expliquez comment vous avez géré la situation."),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert un restaurant ou une spécialité locale pendant un voyage. Racontez votre expérience et expliquez pourquoi vous avez apprécié cette découverte."),
    ("Voyage & Déplacements", 2,
     "Vous avez fait un voyage qui ne s'est pas déroulé comme prévu. Racontez ce qui s'est passé et expliquez ce que vous en avez appris."),
    ("Voyage & Déplacements", 2,
     "Vous avez participé à une excursion organisée. Racontez votre journée et expliquez si vous recommanderiez cette activité."),
    ("Voyage & Déplacements", 2,
     "Vous avez récemment voyagé dans un pays étranger. Écrivez un article pour présenter votre expérience et les principales différences culturelles que vous avez remarquées."),
    ("Voyage & Déplacements", 2,
     "Vous avez découvert un endroit naturel exceptionnel pendant vos vacances. Présentez ce lieu et expliquez pourquoi il vous a impressionné(e)."),
    ("Voyage & Déplacements", 2,
     "Vous avez organisé vous-même un voyage pour plusieurs personnes. Racontez comment vous avez préparé ce voyage et expliquez comment il s'est déroulé."),
    ("Voyage & Déplacements", 2,
     "Vous avez réalisé un voyage dont vous rêviez depuis longtemps. Racontez cette expérience et expliquez si elle a répondu à vos attentes."),

    # --- THÈME 4 — VIE SOCIALE & ÉVÉNEMENTS ---
    ("Vie sociale & Événements", 2,
     "Vous avez récemment organisé une fête pour vos amis. Racontez cette expérience et expliquez pourquoi vous avez décidé d'organiser cet événement."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une fête ou à une célébration traditionnelle. Écrivez un article pour raconter votre expérience et présenter ce que vous avez apprécié."),
    ("Vie sociale & Événements", 2,
     "Vous avez rencontré une personne intéressante lors d'un événement. Racontez cette rencontre et expliquez pourquoi elle vous a marqué(e)."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à un événement familial important. Racontez ce moment et donnez vos impressions."),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une fête surprise pour quelqu'un. Racontez comment vous avez préparé cette surprise et expliquez comment la personne a réagi."),
    ("Vie sociale & Événements", 2,
     "Vous avez retrouvé un ancien ami après plusieurs années. Racontez votre rencontre et expliquez ce que vous avez ressenti."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une activité avec vos voisins. Racontez cette expérience et expliquez pourquoi vous aimeriez la refaire."),
    ("Vie sociale & Événements", 2,
     "Vous avez récemment fait une nouvelle connaissance qui est devenue importante pour vous. Racontez votre rencontre et expliquez pourquoi."),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une sortie avec un groupe d'amis. Racontez cette journée et expliquez ce que vous avez particulièrement apprécié."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une activité bénévole. Écrivez un article pour raconter votre expérience et expliquer pourquoi vous avez décidé d'y participer."),
    ("Vie sociale & Événements", 2,
     "Vous avez aidé une personne de votre communauté. Racontez ce qui s'est passé et expliquez comment cette expérience vous a fait réfléchir."),
    ("Vie sociale & Événements", 2,
     "Vous avez assisté à une célébration dans un autre pays ou une autre région. Présentez cette expérience et expliquez ce qui vous a surpris(e)."),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une réunion entre anciens camarades. Racontez comment la rencontre s'est déroulée et donnez vos impressions."),
    ("Vie sociale & Événements", 2,
     "Vous avez reçu une invitation à un événement que vous n'oublierez jamais. Racontez cette expérience et expliquez pourquoi elle était spéciale."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une activité qui vous a permis de rencontrer beaucoup de nouvelles personnes. Racontez votre expérience et expliquez ce que vous en avez pensé."),
    ("Vie sociale & Événements", 2,
     "Vous avez organisé une activité pour accueillir une nouvelle personne dans votre groupe. Racontez cette expérience et expliquez comment elle s'est déroulée."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à une journée communautaire dans votre quartier. Écrivez un article pour raconter les activités et donner votre opinion."),
    ("Vie sociale & Événements", 2,
     "Vous avez vécu un moment particulièrement émouvant avec votre famille ou vos amis. Racontez cette expérience et expliquez pourquoi elle vous a marqué(e)."),
    ("Vie sociale & Événements", 2,
     "Vous avez fait quelque chose pour remercier une personne qui vous avait beaucoup aidé(e). Racontez ce que vous avez organisé et expliquez votre motivation."),
    ("Vie sociale & Événements", 2,
     "Vous avez participé à un événement qui vous a permis de mieux connaître les personnes de votre quartier. Racontez cette expérience et expliquez ce que vous avez découvert."),

    # --- THÈME 5 — LOISIRS, CULTURE & SPORT ---
    ("Loisirs, Culture & Sport", 2,
     "Vous avez récemment commencé une nouvelle activité sportive. Racontez votre expérience et expliquez pourquoi vous avez décidé de pratiquer ce sport."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez assisté à un concert exceptionnel. Écrivez un article pour raconter la soirée et donner vos impressions."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez vu un film qui vous a beaucoup marqué(e). Présentez cette expérience et expliquez pourquoi vous recommandez ce film."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez lu un livre qui a changé votre façon de penser. Racontez votre expérience et expliquez ce que vous avez appris."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez visité un musée pour la première fois. Racontez votre visite et expliquez ce que vous avez particulièrement apprécié."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à un festival culturel. Écrivez un article pour présenter l'événement et raconter votre expérience."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez découvert un nouveau loisir grâce à un ami. Racontez comment vous avez commencé et expliquez pourquoi vous continuez à pratiquer cette activité."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à une compétition sportive. Racontez cette expérience et expliquez comment vous vous êtes préparé(e)."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez essayé une activité sportive que vous n'aviez jamais pratiquée auparavant. Racontez votre expérience et donnez vos impressions."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez assisté à un spectacle qui vous a beaucoup plu. Présentez cette expérience et expliquez pourquoi vous la recommandez."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez commencé à jouer d'un instrument de musique. Racontez votre expérience et expliquez ce qui vous plaît dans cette activité."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à un atelier artistique. Racontez votre expérience et expliquez ce que vous avez appris."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez découvert un artiste ou un écrivain que vous ne connaissiez pas. Présentez votre découverte et expliquez pourquoi vous l'appréciez."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez organisé une journée sportive avec des amis. Racontez comment la journée s'est déroulée et expliquez ce que vous avez aimé."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez passé une journée dans un parc d'attractions. Racontez votre expérience et présentez les activités que vous avez préférées."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez participé à une randonnée particulièrement intéressante. Écrivez un article pour raconter cette expérience et expliquer pourquoi vous la recommandez."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez découvert une activité culturelle gratuite dans votre ville. Racontez votre expérience et expliquez pourquoi vous conseillez cette activité."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez repris une activité que vous pratiquiez quand vous étiez plus jeune. Racontez votre expérience et expliquez comment vous vous êtes senti(e)."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez passé une journée sans téléphone ni Internet en pratiquant différentes activités. Racontez votre expérience et donnez votre opinion."),
    ("Loisirs, Culture & Sport", 2,
     "Vous avez convaincu un ami de pratiquer une activité avec vous et vous avez finalement beaucoup apprécié cette expérience. Racontez ce qui s'est passé."),

    # --- THÈME 6 — SANTÉ, ENVIRONNEMENT & MODE DE VIE ---
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de commencer à faire du sport régulièrement. Racontez votre expérience et expliquez les changements que vous avez remarqués."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez changé votre alimentation pour avoir un mode de vie plus sain. Écrivez un article pour raconter votre expérience."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de réduire votre utilisation de la voiture. Racontez ce changement et expliquez pourquoi vous avez pris cette décision."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de nettoyage d'un parc ou d'une plage. Racontez votre expérience et expliquez pourquoi vous avez apprécié cette activité."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à utiliser davantage les transports publics. Présentez votre expérience et expliquez les avantages que vous avez constatés."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de protection de l'environnement. Racontez ce que vous avez fait et expliquez pourquoi cette expérience vous a marqué(e)."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de réduire votre consommation de plastique. Racontez les changements que vous avez faits et expliquez si cela a été facile."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à pratiquer la méditation ou le yoga. Racontez votre expérience et expliquez les effets que vous avez remarqués."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez adopté une nouvelle habitude pour mieux dormir. Présentez votre expérience et expliquez si cette habitude vous aide."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une journée sans voiture organisée dans votre ville. Racontez cette expérience et donnez votre opinion."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez récemment passé plusieurs jours dans la nature. Écrivez un article pour raconter votre expérience et expliquer comment vous vous êtes senti(e)."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez décidé de passer moins de temps devant les écrans. Racontez votre expérience et expliquez ce que vous avez changé dans votre quotidien."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à acheter davantage de produits locaux. Présentez cette nouvelle habitude et expliquez pourquoi vous avez fait ce choix."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de sensibilisation à l'environnement. Racontez ce que vous avez découvert et expliquez ce qui vous a surpris(e)."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez réussi à changer une mauvaise habitude. Racontez votre expérience et expliquez les difficultés que vous avez rencontrées."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez commencé à marcher davantage au lieu d'utiliser les transports. Racontez cette expérience et expliquez les effets sur votre quotidien."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à une activité de jardinage ou de plantation d'arbres. Racontez cette expérience et expliquez pourquoi vous l'avez appréciée."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez passé une semaine en suivant un mode de vie plus sain. Écrivez un article pour raconter cette expérience et donner vos impressions."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez découvert une activité qui vous aide à réduire votre stress. Présentez cette activité et expliquez pourquoi vous la recommandez."),
    ("Santé, Environnement & Mode de vie", 2,
     "Vous avez participé à un projet visant à améliorer votre environnement local. Racontez votre expérience et expliquez ce que vous avez appris."),

    # --- THÈME 7 — TECHNOLOGIE, ACHATS & SERVICES ---
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un appareil électronique qui vous facilite beaucoup la vie. Présentez votre achat et expliquez pourquoi vous en êtes satisfait(e)."),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert une application très utile. Écrivez un article pour présenter cette application et expliquer comment elle vous aide."),
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un produit sur Internet pour la première fois. Racontez votre expérience et expliquez ce que vous en avez pensé."),
    ("Technologie, Achats & Services", 2,
     "Vous avez eu une mauvaise expérience avec un service client. Racontez ce qui s'est passé et expliquez comment le problème a été résolu."),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert un site Internet qui vous aide dans vos études ou votre travail. Présentez votre découverte et expliquez pourquoi vous le recommandez."),
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un cadeau en ligne pour quelqu'un. Racontez votre expérience et expliquez pourquoi vous avez choisi ce cadeau."),
    ("Technologie, Achats & Services", 2,
     "Vous avez utilisé une nouvelle application pour organiser votre quotidien. Racontez votre expérience et expliquez pourquoi vous continuez à l'utiliser."),
    ("Technologie, Achats & Services", 2,
     "Vous avez eu un problème avec une commande en ligne. Racontez ce qui s'est passé et expliquez comment vous avez trouvé une solution."),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert un nouveau moyen de paiement. Présentez votre expérience et expliquez pourquoi vous trouvez ce système pratique."),
    ("Technologie, Achats & Services", 2,
     "Vous avez utilisé un service de livraison particulièrement efficace. Écrivez un article pour raconter votre expérience et expliquer pourquoi vous le recommandez."),
    ("Technologie, Achats & Services", 2,
     "Vous avez acheté un produit après avoir lu plusieurs avis sur Internet. Racontez votre expérience et expliquez si vous êtes satisfait(e) de votre choix."),
    ("Technologie, Achats & Services", 2,
     "Vous avez vendu un objet que vous n'utilisiez plus sur Internet. Racontez cette expérience et expliquez comment la vente s'est déroulée."),
    ("Technologie, Achats & Services", 2,
     "Vous avez suivi un cours en ligne pour la première fois. Racontez votre expérience et expliquez ce que vous avez apprécié ou moins apprécié."),
    ("Technologie, Achats & Services", 2,
     "Vous avez participé à un événement organisé entièrement en ligne. Présentez cette expérience et donnez vos impressions."),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert un outil numérique qui vous permet de gagner du temps. Écrivez un article pour présenter cet outil et expliquer comment vous l'utilisez."),
    ("Technologie, Achats & Services", 2,
     "Vous avez décidé de réduire votre utilisation des réseaux sociaux. Racontez votre expérience et expliquez les changements que vous avez remarqués."),
    ("Technologie, Achats & Services", 2,
     "Vous avez recommandé un produit ou un service à un ami, mais son expérience a été différente de la vôtre. Racontez cette situation et expliquez ce que vous en pensez."),
    ("Technologie, Achats & Services", 2,
     "Vous avez récemment changé de téléphone ou d'ordinateur. Présentez votre expérience et expliquez pourquoi vous avez choisi ce nouvel appareil."),
    ("Technologie, Achats & Services", 2,
     "Vous avez utilisé une plateforme en ligne pour réserver un voyage, un logement ou une activité. Racontez votre expérience et expliquez si vous la recommandez."),
    ("Technologie, Achats & Services", 2,
     "Vous avez découvert une nouvelle technologie qui a changé votre façon de travailler ou d'étudier. Racontez votre expérience et expliquez les avantages que vous avez constatés."),

    # Tâche 3 is not seeded from this list — its subjects carry two documents
    # and live in SEED_TACHE3_SUBJECTS below.
]

# ----------------------------------------------------------------------------
# TÂCHE 3 — texte argumentatif. 8 themes x 15 subjects = 120.
# ----------------------------------------------------------------------------
# The exam hands the candidate a titled subject and two documents defending
# opposite positions, then asks for ONE continuous reply of 120-180 words. The
# two documents are deliberately NOT counted in that range, so they are stored
# in their own columns rather than folded into the consigne — otherwise the word
# counter and the grader would both read them as part of the candidate's text.
#
# Provenance: thèmes 1-3 and the first subject of thème 4 are the official
# paper, transcribed verbatim. The remaining 74 subjects of thèmes 4-8 were
# written to the same pattern (two ~75-word documents, opposing positions,
# B1-B2 register) and should be replaced as the official text becomes available.
#
# Each subject: (theme_name, title, document_1, document_2)
TACHE3_CONSIGNE = ("Lisez les deux documents. Comparez les deux points de vue "
                   "et donnez votre opinion.")

SEED_TACHE3_SUBJECTS = [
    # ==================================================================
    # THÈME 1 — TRAVAIL & VIE PROFESSIONNELLE
    # ==================================================================
    ("Travail & Vie professionnelle", "Le télétravail",
     "De plus en plus d'entreprises permettent à leurs employés de travailler depuis chez eux. Pour beaucoup de salariés, cette organisation améliore considérablement la qualité de vie. Ils n'ont plus besoin de passer plusieurs heures dans les transports et peuvent consacrer davantage de temps à leur famille ou à leurs activités personnelles. Le télétravail permet également de travailler dans un environnement plus calme et d'organiser sa journée avec davantage de liberté. Selon certains employés, ils sont même plus concentrés et plus efficaces lorsqu'ils travaillent à distance.",
     "Même si le télétravail présente certains avantages, il ne convient pas à tout le monde. Les employés peuvent se sentir isolés lorsqu'ils passent plusieurs jours seuls chez eux. Les échanges avec les collègues sont également moins spontanés et certains problèmes sont plus difficiles à résoudre à distance. De plus, certaines personnes ont du mal à séparer leur vie professionnelle de leur vie privée et continuent à travailler après leurs horaires habituels. Pour ces raisons, le travail au bureau reste important pour maintenir une bonne communication et une véritable cohésion d'équipe."),

    ("Travail & Vie professionnelle", "Une semaine de travail plus courte",
     "Réduire la durée de la semaine de travail pourrait améliorer la vie des salariés. Avec une journée libre supplémentaire, les employés pourraient passer plus de temps avec leur famille, pratiquer des activités sportives ou simplement se reposer. Des travailleurs moins fatigués pourraient également être plus motivés et plus efficaces pendant leurs heures de travail. Certaines entreprises qui ont expérimenté une semaine plus courte constatent même une meilleure satisfaction de leurs employés. Pour ces raisons, une réduction du temps de travail pourrait être bénéfique pour les salariés comme pour les entreprises.",
     "Une semaine de travail plus courte ne serait pas nécessairement une bonne solution pour toutes les entreprises. Dans certains secteurs, les clients doivent être accueillis tous les jours et les services doivent fonctionner pendant de longues heures. Réduire le temps de travail pourrait obliger les entreprises à recruter davantage de personnel, ce qui augmenterait leurs coûts. Les employés pourraient aussi devoir travailler plus rapidement pour accomplir les mêmes tâches en moins de temps. Avant de généraliser cette mesure, il faudrait donc tenir compte des différences entre les secteurs professionnels."),

    ("Travail & Vie professionnelle", "Travailler en équipe ou seul",
     "Le travail en équipe présente de nombreux avantages dans une entreprise. Lorsque plusieurs personnes travaillent sur le même projet, elles peuvent partager leurs connaissances et proposer différentes idées. Un problème qui semble difficile pour une personne peut être facilement résolu grâce aux compétences d'un collègue. Le travail collectif permet également de développer les relations professionnelles et de créer une meilleure ambiance dans l'entreprise. Pour les personnes qui aiment échanger et collaborer, travailler avec une équipe peut donc être plus motivant et plus enrichissant.",
     "Pour certains employés, travailler seul est beaucoup plus efficace. Ils peuvent organiser leur journée selon leurs propres besoins et se concentrer sans être interrompus par des réunions ou des discussions. Les décisions sont également prises plus rapidement lorsqu'une seule personne est responsable d'un projet. Certaines personnes sont plus créatives lorsqu'elles travaillent dans le calme et préfèrent avoir une grande autonomie. Selon elles, les entreprises devraient donc laisser leurs employés choisir entre le travail individuel et le travail en équipe lorsque cela est possible."),

    ("Travail & Vie professionnelle", "Changer de métier",
     "Changer complètement de métier peut être une excellente décision lorsqu'une personne n'est plus satisfaite de sa carrière. Après plusieurs années dans le même domaine, certaines personnes découvrent qu'elles souhaitent faire quelque chose de différent. Une nouvelle profession peut leur apporter davantage de motivation et leur permettre de développer de nouvelles compétences. Même si une reconversion demande du temps et des efforts, elle peut finalement améliorer la qualité de vie et donner un nouveau sens au travail. Pour certains, il vaut donc mieux prendre un risque que rester dans un emploi qui ne leur convient plus.",
     "Une reconversion professionnelle comporte cependant de nombreux risques. Une personne qui change de domaine doit parfois recommencer sa carrière avec un salaire moins élevé et moins de responsabilités. Elle peut également avoir des difficultés à trouver un emploi parce qu'elle possède peu d'expérience dans son nouveau secteur. Avant de prendre une telle décision, il serait donc préférable d'examiner toutes les possibilités d'améliorer sa situation actuelle. Changer de poste ou suivre une formation complémentaire peut parfois être une solution moins risquée qu'un changement complet de carrière."),

    ("Travail & Vie professionnelle", "L'expérience ou le diplôme",
     "Pour certains employeurs, l'expérience professionnelle est plus importante qu'un diplôme. Une personne qui travaille depuis plusieurs années connaît déjà les réalités du monde professionnel et sait généralement résoudre des problèmes concrets. Elle peut être rapidement autonome et n'a pas besoin d'une longue période d'adaptation. Dans certains métiers, les compétences pratiques sont donc beaucoup plus utiles que les connaissances théoriques. Les entreprises devraient par conséquent accorder davantage d'importance à ce qu'un candidat sait réellement faire plutôt qu'au nombre de diplômes qu'il possède.",
     "Les diplômes restent indispensables dans de nombreux secteurs professionnels. Ils montrent qu'une personne a suivi une formation sérieuse et possède des connaissances précises dans son domaine. Pour certaines professions, comme celles de médecin, d'ingénieur ou d'enseignant, les qualifications sont absolument nécessaires. Un jeune diplômé qui possède peu d'expérience peut également apporter des connaissances récentes et une nouvelle manière de travailler. Les entreprises ne devraient donc pas négliger les diplômes lorsqu'elles recrutent, même si l'expérience professionnelle reste également importante."),

    ("Travail & Vie professionnelle", "Travailler pendant ses études",
     "Avoir un emploi pendant ses études peut être une expérience très positive pour un jeune. Un travail à temps partiel lui permet de gagner son propre argent et de devenir plus indépendant de sa famille. Il apprend également à respecter des horaires, à travailler avec d'autres personnes et à gérer ses responsabilités. Cette expérience peut être utile plus tard lorsqu'il cherchera son premier emploi à temps plein. Pour certains étudiants, travailler quelques heures par semaine est donc une excellente manière de se préparer à la vie professionnelle.",
     "Travailler pendant ses études peut cependant avoir des conséquences négatives sur les résultats scolaires. Les étudiants ont besoin de temps pour assister aux cours, faire leurs devoirs et préparer leurs examens. Après plusieurs heures de travail, ils peuvent être trop fatigués pour étudier efficacement. Un emploi peut également provoquer du stress et réduire le temps consacré au sommeil ou aux activités personnelles. Selon certains enseignants, les étudiants devraient donc se concentrer principalement sur leurs études et chercher un emploi seulement lorsqu'ils en ont réellement besoin."),

    ("Travail & Vie professionnelle", "Le salaire est-il le plus important ?",
     "Lorsqu'une personne choisit un emploi, le salaire reste un élément essentiel. Un bon revenu permet de payer facilement les dépenses quotidiennes, d'épargner pour l'avenir et de réaliser certains projets personnels. Dans une période où le coût de la vie augmente, il est normal de rechercher une situation financière stable. Pour certaines personnes, accepter un emploi mieux payé peut également permettre de soutenir leur famille ou d'améliorer leur logement. Le salaire représente donc une motivation importante lorsqu'on choisit ou qu'on change de travail.",
     "Un salaire élevé ne garantit pas nécessairement le bonheur professionnel. Une personne peut gagner beaucoup d'argent tout en étant stressée, fatiguée ou insatisfaite de ses tâches. L'ambiance de travail, les horaires, les relations avec les collègues et les possibilités d'évolution sont également importantes. Certains salariés préfèrent gagner un peu moins mais avoir davantage de temps libre et exercer un métier qui les intéresse. Selon eux, le salaire doit donc être considéré comme un élément parmi d'autres lorsqu'on évalue la qualité d'un emploi."),

    ("Travail & Vie professionnelle", "Les réunions au travail",
     "Les réunions sont indispensables dans de nombreuses entreprises. Elles permettent aux employés de partager des informations, de discuter des difficultés et de prendre des décisions collectivement. Une réunion bien organisée peut éviter les malentendus et permettre à toute l'équipe de comprendre les objectifs d'un projet. Elle est également utile pour donner la parole aux employés et recueillir leurs idées. Pour cette raison, certaines entreprises considèrent les réunions régulières comme un outil essentiel pour améliorer la communication et l'organisation du travail.",
     "De nombreux employés pensent cependant que les entreprises organisent trop de réunions. Certaines rencontres durent longtemps sans aboutir à une décision concrète. Les employés doivent alors interrompre leurs tâches et perdent du temps qu'ils pourraient consacrer à leur travail. Beaucoup d'informations peuvent également être transmises rapidement par courriel ou par un outil de communication interne. Les entreprises devraient donc organiser des réunions uniquement lorsqu'elles sont réellement nécessaires et privilégier les échanges courts pour les questions simples."),

    ("Travail & Vie professionnelle", "Prendre des vacances régulièrement",
     "Prendre régulièrement des vacances est essentiel pour rester en bonne santé et conserver sa motivation professionnelle. Après plusieurs mois de travail, les employés ont besoin de se reposer et de changer d'environnement. Quelques jours de vacances peuvent permettre de réduire le stress et de retrouver de l'énergie. Lorsqu'ils reviennent au travail, ils peuvent être plus concentrés et plus productifs. Les entreprises devraient donc encourager leurs employés à utiliser leurs jours de congé au lieu de travailler constamment sans prendre suffisamment de repos.",
     "Même si les vacances sont importantes, il n'est pas toujours possible de prendre de longues périodes de congé. Dans certaines entreprises, les employés ont beaucoup de responsabilités et leur absence peut compliquer l'organisation du travail. Certaines personnes préfèrent également prendre plusieurs petits congés plutôt qu'une longue période. Elles peuvent ainsi se reposer régulièrement sans interrompre leurs projets professionnels pendant trop longtemps. L'essentiel serait donc de trouver un équilibre entre les besoins de l'entreprise et les besoins personnels de chaque salarié."),

    ("Travail & Vie professionnelle", "Travailler près de chez soi",
     "Pour beaucoup de personnes, la distance entre le domicile et le lieu de travail est un critère essentiel. Travailler près de chez soi permet de réduire les trajets quotidiens et d'économiser du temps et de l'argent. Les employés arrivent également moins fatigués au travail et peuvent consacrer davantage de temps à leur famille ou à leurs loisirs. Dans les grandes villes, où les transports peuvent être très longs, un emploi proche du domicile peut donc améliorer considérablement la qualité de vie.",
     "La distance ne devrait cependant pas être le principal critère lorsqu'on choisit un emploi. Un poste intéressant, bien payé et offrant de bonnes possibilités d'évolution peut justifier un trajet plus long. Certaines personnes acceptent également de voyager davantage pendant quelques années afin d'acquérir une expérience importante pour leur carrière. Avec le télétravail partiel ou des horaires flexibles, les longs trajets peuvent aussi être moins difficiles à supporter. Il serait donc préférable de considérer l'ensemble des avantages d'un emploi avant de regarder uniquement sa localisation."),

    ("Travail & Vie professionnelle", "L'âge de la retraite",
     "De nombreuses personnes pensent qu'il faudrait permettre aux travailleurs de prendre leur retraite plus tôt. Après plusieurs décennies de travail, ils souhaitent profiter de leur famille, voyager et pratiquer des activités qu'ils n'avaient pas le temps de faire auparavant. Une retraite plus longue permettrait également aux personnes âgées de consacrer davantage de temps à leurs proches et à leurs loisirs. Pour ces personnes, continuer à travailler pendant de nombreuses années après l'âge actuel de la retraite n'est pas forcément nécessaire, surtout lorsque leur santé commence à se détériorer.",
     "D'autres personnes pensent au contraire qu'il faut travailler plus longtemps. L'espérance de vie augmente et de nombreuses personnes âgées restent en bonne santé beaucoup plus longtemps qu'avant. Continuer à travailler permettrait de conserver leur expérience dans les entreprises et de réduire les dépenses liées aux retraites. Certaines personnes souhaitent également rester actives professionnellement parce que leur travail leur apporte des relations sociales et un sentiment d'utilité. L'âge de la retraite devrait donc peut-être tenir compte de la situation personnelle plutôt que d'être identique pour tout le monde."),

    ("Travail & Vie professionnelle", "Les horaires flexibles",
     "Les horaires flexibles permettent aux employés de mieux adapter leur journée à leurs besoins personnels. Une personne peut commencer plus tôt pour aller chercher ses enfants à l'école ou commencer plus tard après un rendez-vous important. Cette liberté peut réduire le stress et améliorer l'équilibre entre la vie professionnelle et la vie familiale. Les employés peuvent également choisir les heures où ils sont les plus efficaces. Pour de nombreuses entreprises, offrir davantage de flexibilité est donc une manière d'améliorer la satisfaction et la motivation des salariés.",
     "Les horaires flexibles peuvent cependant compliquer le travail en équipe. Si chacun commence et termine à une heure différente, il devient plus difficile de trouver un moment pour organiser une réunion ou résoudre rapidement un problème. Les clients peuvent également avoir du mal à savoir quand contacter certains employés. Dans certaines entreprises, des horaires communs sont donc nécessaires pour garantir une bonne organisation. La flexibilité devrait être adaptée au type de travail et ne devrait pas être considérée comme une solution universelle."),

    ("Travail & Vie professionnelle", "Les bureaux en entreprise",
     "Même avec le développement du télétravail, les bureaux restent importants pour de nombreuses entreprises. Ils permettent aux employés de se rencontrer directement, de discuter facilement et de développer des relations professionnelles. Les nouveaux employés peuvent également apprendre plus rapidement en observant leurs collègues. Un espace commun peut enfin renforcer le sentiment d'appartenance à l'entreprise. Pour cette raison, certaines entreprises souhaitent conserver des bureaux tout en permettant à leurs salariés de travailler à distance quelques jours par semaine.",
     "Pour certains métiers, les bureaux traditionnels ne sont plus indispensables. Grâce aux outils numériques, les employés peuvent communiquer, participer à des réunions et travailler sur des documents depuis presque n'importe où. Les entreprises peuvent ainsi réduire leurs dépenses liées aux locaux et investir cet argent dans d'autres projets. Les employés, de leur côté, gagnent du temps en évitant les trajets. Selon ce point de vue, il serait donc plus logique de conserver uniquement de petits espaces pour les réunions importantes."),

    ("Travail & Vie professionnelle", "Changer d'emploi pour être plus heureux",
     "Lorsqu'une personne n'est plus heureuse dans son emploi, changer d'entreprise peut être une bonne solution. Un nouvel environnement peut apporter davantage de motivation, de meilleures relations avec les collègues ou des horaires plus adaptés. Rester trop longtemps dans une situation qui provoque du stress peut avoir des conséquences négatives sur la santé et la vie personnelle. Pour certaines personnes, prendre le risque de commencer un nouveau travail est donc préférable à une situation professionnelle qui ne leur convient plus.",
     "Changer d'emploi n'est cependant pas toujours nécessaire. Une personne peut parfois améliorer sa situation en discutant avec son responsable ou en demandant de nouvelles responsabilités. Il est également possible de changer d'équipe ou de modifier certains horaires sans quitter complètement l'entreprise. Un nouvel emploi comporte aussi des risques, notamment pendant la période d'adaptation. Avant de démissionner, il serait donc préférable d'essayer de trouver des solutions dans son poste actuel."),

    ("Travail & Vie professionnelle", "Le bonheur au travail",
     "Les entreprises devraient davantage se préoccuper du bien-être de leurs employés. Une bonne ambiance, la reconnaissance du travail effectué et des possibilités d'évolution peuvent améliorer la motivation. Les salariés qui se sentent respectés sont souvent plus engagés et restent plus longtemps dans l'entreprise. Pour cette raison, investir dans le bien-être peut être bénéfique non seulement pour les employés mais également pour les résultats de l'entreprise.",
     "D'autres personnes pensent que le bonheur au travail relève principalement de la responsabilité individuelle. Une entreprise peut offrir de bonnes conditions, mais elle ne peut pas contrôler toutes les attentes et les difficultés personnelles d'un employé. Chaque salarié doit également apprendre à gérer son stress, communiquer avec ses collègues et trouver un équilibre entre son travail et sa vie privée. L'entreprise doit donc créer de bonnes conditions, mais chacun doit aussi prendre sa part de responsabilité."),

    # ==================================================================
    # THÈME 2 — ÉDUCATION & ENFANTS
    # ==================================================================
    ("Éducation & Enfants", "École publique ou école privée",
     "Pour certains parents, les écoles privées offrent de meilleures conditions d'apprentissage. Les classes sont parfois moins nombreuses et les établissements disposent de ressources supplémentaires pour proposer des activités variées. Les parents apprécient également le suivi personnalisé que leurs enfants peuvent recevoir. Ils considèrent donc que payer pour une école privée représente un investissement important dans l'avenir de leurs enfants, surtout lorsque ceux-ci ont besoin d'un accompagnement particulier.",
     "D'autres familles préfèrent l'école publique. Elle permet aux enfants de milieux sociaux différents de se rencontrer et d'apprendre ensemble. Les établissements publics proposent également de nombreux enseignants compétents et des activités intéressantes. Pour ces parents, la qualité de l'éducation ne dépend pas nécessairement du prix de l'établissement. Ils pensent plutôt que les gouvernements devraient améliorer les écoles publiques afin que tous les enfants puissent bénéficier des mêmes possibilités."),

    ("Éducation & Enfants", "Les téléphones à l'école",
     "Certains enseignants pensent que les élèves devraient pouvoir utiliser leur téléphone à l'école dans certaines situations. Un smartphone peut servir à chercher rapidement une information, utiliser une application éducative ou prendre une photo d'un document. Il peut également être utile pour contacter les parents en cas de problème. Selon cette opinion, le téléphone ne doit pas forcément être considéré comme un ennemi de l'éducation. Il faut plutôt apprendre aux jeunes à l'utiliser de manière responsable.",
     "D'autres enseignants souhaitent interdire complètement les téléphones pendant les cours. Selon eux, les smartphones empêchent les élèves de se concentrer et les encouragent à consulter les réseaux sociaux ou les messages. Même lorsque les téléphones sont utilisés pour travailler, il est difficile pour un professeur de contrôler leur utilisation. Une interdiction permettrait donc de créer un environnement plus calme et de réduire les distractions pendant les heures de classe."),

    ("Éducation & Enfants", "Les devoirs à la maison",
     "Les devoirs permettent aux élèves de revoir les notions étudiées pendant la journée. Ils peuvent ainsi mieux mémoriser les informations et identifier les matières qu'ils ne comprennent pas encore. Les devoirs apprennent également aux enfants à travailler seuls et à organiser leur temps. Pour certains parents et enseignants, quelques exercices réguliers sont donc indispensables pour consolider les connaissances et préparer les élèves aux examens.",
     "D'autres personnes pensent que les enfants ont déjà suffisamment de travail à l'école. Après plusieurs heures de cours, ils ont besoin de jouer, de faire du sport et de passer du temps avec leur famille. Trop de devoirs peuvent provoquer du stress et réduire la motivation. Certains parents souhaitent donc que les écoles donnent moins de travail à la maison et permettent aux enfants de mieux profiter de leur temps libre."),

    ("Éducation & Enfants", "Les cours en ligne",
     "Les cours en ligne rendent l'éducation accessible à un grand nombre de personnes. Un étudiant peut suivre une formation depuis chez lui, même s'il habite loin d'une école ou d'une université. Il peut également regarder certaines leçons plusieurs fois et organiser son travail selon son propre rythme. Cette solution est particulièrement intéressante pour les adultes qui travaillent ou pour les personnes qui ont des difficultés à se déplacer.",
     "Malgré ces avantages, les cours en présentiel restent importants. Les étudiants peuvent poser directement leurs questions au professeur et participer à des discussions avec leurs camarades. La présence physique aide également certaines personnes à rester concentrées et motivées. À la maison, les étudiants peuvent facilement être distraits par leur téléphone, leur famille ou les tâches quotidiennes. Pour cette raison, les cours traditionnels restent plus efficaces pour beaucoup d'élèves."),

    ("Éducation & Enfants", "Apprendre plusieurs langues",
     "Les enfants devraient apprendre plusieurs langues dès leur plus jeune âge. Ils sont généralement capables d'apprendre de nouveaux sons facilement et peuvent développer une bonne prononciation. Connaître plusieurs langues permet également de découvrir d'autres cultures et peut être un avantage professionnel plus tard. Pour les familles qui ont la possibilité d'offrir cet apprentissage, commencer tôt représente donc une excellente opportunité pour les enfants.",
     "D'autres personnes pensent qu'il ne faut pas surcharger les enfants avec trop de langues. Les premières années d'école sont déjà importantes pour apprendre à lire, écrire et maîtriser la langue principale. Ajouter plusieurs langues peut demander beaucoup d'efforts et réduire le temps consacré aux autres matières. Il serait donc préférable de commencer progressivement et de choisir une langue supplémentaire lorsque l'enfant est suffisamment à l'aise avec les apprentissages fondamentaux."),

    ("Éducation & Enfants", "Les activités extrascolaires",
     "Les activités extrascolaires permettent aux enfants de développer des compétences différentes de celles qu'ils apprennent en classe. Le sport peut améliorer la discipline et le travail en équipe, tandis que la musique ou le théâtre peuvent renforcer la confiance en soi. Ces activités donnent également aux enfants l'occasion de rencontrer de nouvelles personnes. Pour cette raison, les parents devraient encourager leurs enfants à pratiquer au moins une activité en dehors de l'école.",
     "Certains parents préfèrent cependant laisser leurs enfants avoir davantage de temps libre. Après une journée complète à l'école, les enfants ont besoin de se reposer et de jouer sans programme précis. Lorsque plusieurs activités sont organisées chaque semaine, ils peuvent devenir fatigués et stressés. Les enfants devraient donc pouvoir choisir eux-mêmes leurs activités et ne pas avoir un emploi du temps aussi chargé que celui des adultes."),

    ("Éducation & Enfants", "Les notes à l'école",
     "Les notes sont un moyen simple de mesurer les progrès des élèves. Elles permettent aux parents de savoir si leur enfant rencontre des difficultés et encouragent certains étudiants à travailler davantage. Les notes donnent également aux enseignants une idée du niveau de la classe. Pour cette raison, beaucoup de personnes considèrent les évaluations traditionnelles comme un outil nécessaire pour suivre les apprentissages.",
     "Les notes peuvent cependant avoir des effets négatifs sur les élèves. Certains deviennent très stressés avant les examens et pensent uniquement à obtenir une bonne note au lieu de comprendre réellement la matière. Un élève peut également avoir de bonnes connaissances mais être mauvais dans les situations d'examen. Il serait donc préférable d'utiliser différentes méthodes d'évaluation, comme les projets, les présentations et la participation en classe."),

    ("Éducation & Enfants", "L'école et les compétences pratiques",
     "L'école devrait enseigner davantage de compétences utiles dans la vie quotidienne. Les jeunes doivent savoir gérer un budget, comprendre un contrat, préparer un repas simple ou effectuer certaines démarches administratives. Ces connaissances sont importantes pour devenir autonome. Pour cette raison, les programmes scolaires devraient consacrer davantage de temps à la préparation des élèves à la vie adulte, en complément des matières traditionnelles.",
     "D'autres personnes pensent que l'école ne peut pas tout enseigner. Sa mission principale est de transmettre des connaissances générales et de développer la capacité de réfléchir. Les compétences pratiques peuvent être apprises progressivement grâce à la famille, aux expériences personnelles ou aux formations professionnelles. Ajouter trop de matières pratiques risquerait de réduire le temps consacré aux connaissances fondamentales."),

    ("Éducation & Enfants", "L'uniforme scolaire",
     "L'uniforme scolaire peut réduire les différences entre les élèves. Lorsque tout le monde porte les mêmes vêtements, les enfants sont moins jugés sur leurs vêtements ou sur la situation financière de leur famille. L'uniforme peut également faciliter la préparation le matin et donner une identité commune à l'établissement. Pour certains parents, cette solution permet donc de créer un environnement plus égalitaire et plus sérieux.",
     "Pour d'autres personnes, l'uniforme limite inutilement la liberté des élèves. Les vêtements sont une manière d'exprimer sa personnalité et ses goûts. Les jeunes doivent apprendre progressivement à faire leurs propres choix et à respecter ceux des autres. Au lieu d'imposer une tenue identique, l'école devrait plutôt apprendre aux élèves à s'habiller correctement et à respecter certaines règles générales."),

    ("Éducation & Enfants", "Les parents et les devoirs",
     "Les parents devraient accompagner leurs enfants lorsqu'ils font leurs devoirs. Ils peuvent expliquer une notion difficile, aider l'enfant à organiser son travail et montrer qu'ils s'intéressent à sa réussite. Pour les jeunes élèves, la présence des parents peut être particulièrement rassurante. Cependant, leur rôle devrait être de guider l'enfant plutôt que de faire le travail à sa place.",
     "D'autres personnes pensent que les enfants doivent apprendre à faire leurs devoirs seuls. S'ils demandent constamment l'aide de leurs parents, ils risquent de devenir dépendants et de manquer de confiance en leurs propres capacités. Les parents ont déjà beaucoup de responsabilités et ne connaissent pas toujours les méthodes utilisées à l'école. L'enseignant devrait donc rester la principale personne chargée d'aider l'élève dans ses apprentissages."),

    ("Éducation & Enfants", "L'université est-elle indispensable ?",
     "Pour beaucoup de jeunes, l'université reste la meilleure voie pour construire une carrière. Un diplôme supérieur permet d'accéder à certaines professions et offre des connaissances spécialisées. Les études universitaires permettent également de rencontrer d'autres étudiants et de développer un réseau professionnel. Pour les métiers qui demandent des qualifications précises, l'université reste donc indispensable.",
     "Cependant, réussir sa vie professionnelle ne dépend pas toujours d'un diplôme universitaire. Certaines personnes préfèrent suivre une formation professionnelle, créer une entreprise ou apprendre directement grâce à leur expérience. Dans plusieurs secteurs, les employeurs recherchent surtout des compétences pratiques et la capacité à résoudre des problèmes. Pour ces personnes, passer plusieurs années à l'université n'est donc pas forcément la meilleure solution."),

    ("Éducation & Enfants", "L'intelligence artificielle à l'école",
     "L'intelligence artificielle peut devenir un outil pédagogique très utile. Les élèves peuvent lui demander d'expliquer une notion difficile, de proposer des exercices supplémentaires ou de corriger certaines erreurs. Elle peut également adapter les explications au niveau de chaque étudiant. Selon certains enseignants, apprendre à utiliser correctement cette technologie préparera les jeunes à un monde professionnel dans lequel l'intelligence artificielle sera probablement très présente.",
     "D'autres enseignants sont beaucoup plus prudents. Ils craignent que les élèves utilisent l'intelligence artificielle pour faire leurs devoirs à leur place. Dans ce cas, ils peuvent obtenir de bonnes réponses sans réellement réfléchir ni apprendre. Il existe également des risques liés aux informations incorrectes fournies par certains outils. L'utilisation de l'IA à l'école devrait donc être très encadrée et ne jamais remplacer le travail personnel des élèves."),

    ("Éducation & Enfants", "La lecture chez les enfants",
     "La lecture reste une activité essentielle pour les enfants. Lire régulièrement permet d'enrichir le vocabulaire, d'améliorer la compréhension et de développer l'imagination. Les livres peuvent également aider les enfants à découvrir différentes cultures et à comprendre les émotions des autres. Pour ces raisons, les parents et les écoles devraient encourager les jeunes à lire quelques pages chaque jour, même lorsqu'ils utilisent également des outils numériques.",
     "Les habitudes des enfants ont changé et les livres ne sont plus leur seule source d'apprentissage. Les documentaires, les podcasts et les vidéos éducatives peuvent également développer leurs connaissances et leur curiosité. Certains enfants qui n'aiment pas lire peuvent apprendre beaucoup grâce à ces supports. Il serait donc préférable de proposer différentes formes de contenu plutôt que d'obliger tous les enfants à lire des livres traditionnels."),

    ("Éducation & Enfants", "La taille des classes",
     "Les classes moins nombreuses offrent de meilleures conditions d'apprentissage. Un enseignant peut consacrer davantage de temps à chaque élève et identifier plus facilement les difficultés. Les élèves ont également davantage d'occasions de poser des questions et de participer. Pour cette raison, réduire le nombre d'élèves par classe pourrait améliorer la qualité de l'enseignement et permettre aux enseignants de mieux accompagner chaque enfant.",
     "Réduire la taille des classes représente cependant un investissement très important. Il faudrait construire davantage de salles et recruter beaucoup plus d'enseignants. Dans certaines régions, ces dépenses seraient difficiles à financer. Il pourrait être plus efficace d'utiliser les ressources disponibles pour améliorer la formation des enseignants et fournir davantage de matériel pédagogique plutôt que de réduire systématiquement le nombre d'élèves."),

    ("Éducation & Enfants", "Les examens",
     "Les examens permettent de vérifier les connaissances des étudiants de manière relativement objective. Ils donnent également aux élèves un objectif clair et les encouragent à réviser régulièrement. Dans certaines professions, il est important de vérifier qu'une personne maîtrise réellement les connaissances nécessaires avant de lui confier certaines responsabilités. Les examens restent donc un outil utile pour mesurer les apprentissages.",
     "Les examens ne montrent cependant pas toujours les véritables capacités d'une personne. Certains étudiants connaissent parfaitement leur cours mais perdent leurs moyens à cause du stress. D'autres savent très bien travailler en équipe ou résoudre des problèmes pratiques, mais ces compétences ne sont pas évaluées par un examen classique. Les écoles devraient donc utiliser plusieurs méthodes pour évaluer les étudiants de manière plus complète."),

    # ==================================================================
    # THÈME 3 — TECHNOLOGIE & SOCIÉTÉ
    # ==================================================================
    ("Technologie & Société", "Les réseaux sociaux",
     "Les réseaux sociaux ont profondément changé notre manière de communiquer. Ils permettent de rester facilement en contact avec des amis ou des membres de la famille qui vivent loin. Ils donnent également accès à des informations, à des événements et à des communautés qui partagent les mêmes intérêts. Pour certaines personnes, ces plateformes sont devenues un moyen important de développer leur vie sociale et même de découvrir de nouvelles opportunités professionnelles.",
     "Les réseaux sociaux peuvent également avoir des effets négatifs sur la vie quotidienne. Certaines personnes passent plusieurs heures par jour à consulter leur téléphone et deviennent dépendantes des réactions des autres. Les plateformes peuvent aussi diffuser rapidement de fausses informations et créer une pression sociale importante. Les utilisateurs comparent parfois leur vie à des images idéalisées publiées par d'autres personnes. Il est donc nécessaire de limiter son utilisation et de rester critique face aux contenus."),

    ("Technologie & Société", "Les smartphones pour les enfants",
     "De nombreux parents offrent un smartphone à leur enfant lorsqu'il commence à se déplacer seul. Le téléphone permet de rester en contact en cas de problème et peut rassurer toute la famille. Les enfants peuvent également utiliser certaines applications éducatives ou apprendre à utiliser les outils numériques dont ils auront besoin plus tard. Pour ces raisons, certains parents pensent qu'un smartphone peut être utile dès le début de l'adolescence, à condition d'établir des règles.",
     "D'autres parents préfèrent attendre avant de donner un smartphone à leurs enfants. Ils craignent que les jeunes passent trop de temps sur les réseaux sociaux ou les jeux et deviennent dépendants des écrans. Les enfants peuvent également être exposés à des contenus inappropriés ou à des comportements dangereux en ligne. Selon cette opinion, les parents devraient d'abord apprendre aux enfants à utiliser Internet de manière responsable avant de leur donner un accès personnel et permanent."),

    ("Technologie & Société", "Acheter en ligne",
     "Les achats sur Internet sont devenus très pratiques. Les consommateurs peuvent comparer les prix de nombreux magasins sans se déplacer et commander à n'importe quelle heure. Les produits sont ensuite livrés directement à domicile, ce qui représente un avantage important pour les personnes qui travaillent beaucoup ou qui ont des difficultés à se déplacer. Les sites Internet proposent également un choix très large, parfois beaucoup plus important que celui des magasins traditionnels.",
     "Malgré ces avantages, les magasins physiques restent importants. Les clients peuvent voir et essayer les produits avant de les acheter et poser directement leurs questions à un vendeur. Acheter localement permet également de soutenir les petits commerces et de maintenir une activité économique dans les centres-villes. De plus, les achats en ligne entraînent souvent des emballages supplémentaires et des déplacements de livraison. Pour certains consommateurs, les magasins restent donc une meilleure solution."),

    ("Technologie & Société", "L'intelligence artificielle au travail",
     "L'intelligence artificielle peut améliorer considérablement les conditions de travail. Elle peut effectuer des tâches répétitives, analyser rapidement de grandes quantités d'informations et aider les employés à prendre certaines décisions. Les salariés peuvent ainsi consacrer davantage de temps aux tâches qui nécessitent de la créativité ou des relations humaines. Pour de nombreuses entreprises, l'IA représente donc une occasion d'augmenter la productivité tout en réduisant certaines tâches pénibles.",
     "L'utilisation de l'intelligence artificielle inquiète cependant certains travailleurs. Si une machine peut effectuer une tâche plus rapidement et à moindre coût, une entreprise peut décider de réduire le nombre d'employés. Les personnes qui ne possèdent pas les compétences nécessaires pour utiliser ces nouvelles technologies risquent également d'avoir des difficultés à trouver un emploi. Il faudrait donc accompagner le développement de l'IA par des formations afin d'éviter que certains travailleurs soient laissés de côté."),

    ("Technologie & Société", "Les écrans et les enfants",
     "Les écrans peuvent avoir une fonction éducative lorsqu'ils sont utilisés correctement. Les enfants peuvent regarder des documentaires, apprendre une langue grâce à des applications ou développer certaines compétences avec des jeux éducatifs. Les outils numériques rendent également l'apprentissage plus interactif et peuvent motiver les enfants qui ont des difficultés avec les méthodes traditionnelles. Selon certains parents, il ne faut donc pas interdire les écrans, mais apprendre aux enfants à les utiliser de manière raisonnable.",
     "D'autres spécialistes recommandent de limiter fortement le temps passé devant les écrans. Une utilisation excessive peut réduire l'activité physique et perturber le sommeil des enfants. Les jeunes risquent également de passer moins de temps à discuter avec leur famille ou à jouer avec d'autres enfants. Pour ces raisons, les parents devraient fixer des horaires précis et encourager les enfants à pratiquer davantage d'activités physiques, créatives et sociales."),

    ("Technologie & Société", "Les rencontres sur Internet",
     "Internet permet aujourd'hui de rencontrer des personnes que l'on n'aurait probablement jamais rencontrées dans la vie quotidienne. Les plateformes et les groupes en ligne réunissent des personnes qui partagent les mêmes passions ou les mêmes objectifs. Certaines amitiés commencées sur Internet deviennent ensuite de véritables relations dans la vie réelle. Pour les personnes qui sont timides ou qui viennent d'arriver dans une nouvelle ville, Internet peut donc faciliter les rencontres.",
     "Les relations commencées en ligne comportent néanmoins certains risques. Une personne peut facilement donner une fausse identité ou cacher certaines informations. Il est également difficile de connaître réellement quelqu'un uniquement à travers des messages. Les jeunes peuvent être particulièrement vulnérables face à des personnes mal intentionnées. Les rencontres en ligne peuvent être intéressantes, mais elles devraient être abordées avec beaucoup de prudence et ne jamais remplacer complètement les relations dans la vie réelle."),

    ("Technologie & Société", "Les informations sur Internet",
     "Internet a rendu l'information beaucoup plus accessible. En quelques secondes, une personne peut consulter des articles, regarder des vidéos ou trouver des explications sur presque tous les sujets. Les étudiants peuvent utiliser cette richesse d'informations pour approfondir leurs connaissances et les citoyens peuvent suivre l'actualité de leur pays et du monde. Pour beaucoup de personnes, Internet représente donc un outil essentiel pour apprendre et rester informé.",
     "Cette grande quantité d'informations représente également un problème. Tout ce qui est publié sur Internet n'est pas vrai et certaines personnes partagent volontairement de fausses informations. Les réseaux sociaux peuvent amplifier rapidement les rumeurs, car les utilisateurs partagent parfois un contenu sans vérifier sa source. Les citoyens doivent donc apprendre à comparer plusieurs sources et à vérifier l'origine des informations avant de les croire ou de les transmettre à d'autres personnes."),

    ("Technologie & Société", "Les réunions en visioconférence",
     "Les visioconférences sont devenues très courantes dans les entreprises. Elles permettent à des personnes qui travaillent dans différentes villes ou différents pays de se réunir sans prendre l'avion ou le train. Les entreprises peuvent ainsi réduire leurs dépenses de déplacement et gagner beaucoup de temps. Pour les employés, les réunions en ligne sont également pratiques lorsqu'elles évitent plusieurs heures de transport. Cette technologie facilite donc le travail des équipes internationales.",
     "Les réunions en ligne ne remplacent cependant pas toujours les rencontres en personne. Les participants communiquent parfois moins facilement et certaines discussions sont plus difficiles à avoir devant un écran. Les problèmes techniques peuvent également interrompre une réunion importante. De plus, les nouveaux employés peuvent avoir besoin de contacts directs pour mieux connaître leurs collègues et comprendre la culture de l'entreprise. Pour certaines situations, une rencontre physique reste donc préférable."),

    ("Technologie & Société", "Les jeux vidéo",
     "Les jeux vidéo peuvent avoir des effets positifs lorsqu'ils sont pratiqués avec modération. Certains jeux développent la logique, la créativité et la capacité à résoudre des problèmes. Les jeux en ligne permettent également de communiquer avec d'autres personnes et de travailler en équipe. Pour certains jeunes, ils représentent donc une activité de loisirs comparable à d'autres formes de divertissement, à condition que le temps consacré aux jeux reste raisonnable.",
     "Une utilisation excessive des jeux vidéo peut cependant devenir problématique. Certains joueurs passent plusieurs heures par jour devant leur écran et négligent leurs études, leur travail ou leur sommeil. Ils peuvent également pratiquer moins d'activité physique et avoir moins de contacts avec leur famille. Les parents devraient donc surveiller le temps passé à jouer et encourager les jeunes à maintenir un équilibre entre les jeux vidéo et les autres activités."),

    ("Technologie & Société", "Les robots dans la vie quotidienne",
     "Les robots peuvent rendre la vie quotidienne plus facile. Certains appareils peuvent nettoyer la maison, aider les personnes âgées ou effectuer des tâches difficiles. Dans les hôpitaux et les entreprises, les robots peuvent également réaliser des tâches dangereuses pour les humains. Pour leurs utilisateurs, ces technologies permettent de gagner du temps et d'améliorer l'autonomie des personnes qui ont besoin d'aide.",
     "Le développement des robots soulève cependant certaines inquiétudes. Si les machines deviennent capables d'effectuer de nombreuses tâches, certains emplois pourraient disparaître. Une société trop dépendante de la technologie pourrait également perdre certaines compétences humaines. Les personnes âgées pourraient par exemple avoir besoin de relations humaines plutôt que d'une machine pour les accompagner. Il est donc important de développer la technologie sans remplacer complètement les interactions humaines."),

    ("Technologie & Société", "Les réseaux sociaux au travail",
     "Les réseaux sociaux peuvent être utiles dans le monde professionnel. Une entreprise peut les utiliser pour communiquer avec ses clients, présenter ses produits et développer son image. Les employés peuvent également créer un réseau professionnel et découvrir des opportunités d'emploi. Pour certaines entreprises, les réseaux sociaux sont donc devenus un outil de communication aussi important que le courrier électronique ou le téléphone.",
     "Cependant, les réseaux sociaux peuvent aussi réduire la productivité des employés. Certains salariés consultent régulièrement leurs comptes personnels pendant leurs heures de travail et perdent du temps. Les informations publiées peuvent également créer des problèmes pour l'entreprise lorsque les employés ne respectent pas certaines règles. Les entreprises devraient donc définir clairement les usages autorisés et limiter l'utilisation personnelle pendant les heures de travail."),

    ("Technologie & Société", "Le téléphone à table",
     "Pour certaines personnes, utiliser son téléphone pendant un repas n'est pas nécessairement un problème. Un message important peut nécessiter une réponse rapide et certaines personnes utilisent leur téléphone pour rechercher une information ou prendre une photo. Dans une vie quotidienne très chargée, il peut être difficile de rester complètement déconnecté pendant plusieurs heures. Selon cette opinion, l'utilisation du téléphone est acceptable si elle reste limitée et respectueuse des autres personnes présentes.",
     "D'autres personnes considèrent que les téléphones devraient être évités pendant les repas. Un repas est un moment privilégié pour discuter avec sa famille ou ses amis et profiter de leur présence. Lorsqu'une personne regarde régulièrement son écran, elle participe moins à la conversation et peut donner l'impression que les autres ne sont pas importants. Pour préserver les relations sociales, certaines familles ont donc décidé de laisser tous les téléphones dans une autre pièce pendant les repas."),

    ("Technologie & Société", "La technologie et les personnes âgées",
     "Les nouvelles technologies peuvent améliorer l'autonomie des personnes âgées. Grâce aux smartphones et aux applications, elles peuvent communiquer facilement avec leur famille, prendre des rendez-vous ou effectuer certaines démarches sans se déplacer. Apprendre à utiliser Internet peut également leur permettre de rester informées et de maintenir des relations sociales. Pour cette raison, les personnes âgées devraient avoir davantage de possibilités de formation numérique.",
     "Il ne faut cependant pas obliger les personnes âgées à utiliser les nouvelles technologies. Certaines ont des difficultés à apprendre de nouveaux outils et peuvent se sentir exclues lorsque tous les services deviennent numériques. Les administrations et les entreprises devraient continuer à proposer des solutions par téléphone ou en personne. La technologie doit faciliter la vie des citoyens et non devenir une obligation pour ceux qui ne souhaitent pas ou ne peuvent pas l'utiliser."),

    ("Technologie & Société", "La vie privée en ligne",
     "Les services numériques demandent souvent certaines informations personnelles afin de fonctionner correctement. Les utilisateurs peuvent recevoir des recommandations adaptées à leurs goûts et profiter de services plus rapides. Pour beaucoup de personnes, partager quelques données représente un échange acceptable contre des services gratuits ou personnalisés. Elles considèrent donc qu'il est difficile de profiter pleinement d'Internet sans accepter une certaine utilisation de leurs données.",
     "D'autres personnes sont très préoccupées par la quantité d'informations personnelles collectées par les entreprises. Les utilisateurs ne savent pas toujours quelles données sont conservées ni comment elles sont utilisées. Ces informations peuvent servir à personnaliser la publicité ou être transmises à d'autres entreprises. Selon cette opinion, les citoyens devraient avoir davantage de contrôle sur leurs données et les entreprises devraient expliquer clairement leurs pratiques."),

    # The source paper titles this one "Les cours en ligne" as well; retitled to
    # what its documents actually argue, so the list has no duplicate entry.
    ("Technologie & Société", "Les formations en ligne",
     "Les formations en ligne permettent d'apprendre sans devoir se déplacer. Une personne qui travaille peut suivre un cours le soir, tandis qu'un étudiant peut organiser son apprentissage autour de ses autres activités. Les plateformes proposent également des formations dans de nombreux domaines, même lorsque ces cours ne sont pas disponibles dans la ville où vit l'étudiant. Cette flexibilité rend donc l'éducation accessible à un public beaucoup plus large.",
     "Les cours en ligne demandent cependant beaucoup d'autonomie. Certains étudiants ont du mal à rester motivés lorsqu'ils travaillent seuls et sans contact direct avec un professeur. Les échanges avec les autres étudiants sont également moins naturels. Pour les personnes qui ont besoin d'un cadre régulier, les cours en présentiel peuvent donc être beaucoup plus efficaces et permettre un meilleur suivi."),

    # ==================================================================
    # THÈME 4 — ENVIRONNEMENT & TRANSPORTS
    # ==================================================================
    ("Environnement & Transports", "Les voitures dans les centres-villes",
     "Certaines villes souhaitent limiter fortement la circulation automobile dans les centres-villes. Selon leurs responsables, cette mesure permettrait de réduire la pollution, le bruit et les embouteillages. Les rues pourraient être transformées en espaces plus agréables pour les piétons et les cyclistes. Les commerces pourraient également bénéficier d'un environnement plus calme. Pour les défenseurs de cette idée, les habitants disposent aujourd'hui de suffisamment d'autres moyens de transport pour réduire leur dépendance à la voiture.",
     "Les opposants à cette mesure estiment qu'interdire les voitures poserait des difficultés à de nombreux habitants. Les personnes âgées, les familles avec de jeunes enfants et certains travailleurs ont besoin de leur voiture pour se déplacer. Les transports publics ne sont pas toujours suffisamment développés dans toutes les villes. Les commerçants craignent également de perdre les clients qui viennent des quartiers éloignés. Avant d'interdire la voiture, il faudrait donc améliorer les transports collectifs et prévoir des solutions pour ceux qui ne peuvent pas s'en passer."),

    ("Environnement & Transports", "Les transports en commun gratuits",
     "Plusieurs villes proposent de rendre les transports en commun entièrement gratuits. Cette mesure encouragerait de nombreux habitants à laisser leur voiture à la maison et permettrait de réduire la pollution et les embouteillages. Elle aiderait également les personnes qui ont peu de moyens financiers à se déplacer pour travailler, étudier ou consulter un médecin. Selon les défenseurs de cette idée, la gratuité rendrait la ville plus accessible et les déplacements quotidiens beaucoup moins coûteux pour les familles.",
     "D'autres personnes pensent que la gratuité n'est pas la meilleure solution. Les transports publics coûtent très cher et cet argent doit venir des impôts payés par les habitants. Si les recettes disparaissent, les villes pourraient avoir des difficultés à entretenir les véhicules et à créer de nouvelles lignes. Un réseau gratuit mais lent et trop chargé n'attirerait pas les automobilistes. Il serait donc peut-être préférable d'utiliser cet argent pour augmenter la fréquence des bus et améliorer la qualité du service."),

    ("Environnement & Transports", "Le vélo en ville",
     "Le vélo présente de nombreux avantages dans les grandes villes. Il ne produit aucune pollution, ne fait pas de bruit et permet souvent de traverser le centre plus rapidement qu'une voiture. Il représente également une activité physique quotidienne qui améliore la santé et ne coûte presque rien. Pour ces raisons, de nombreuses municipalités construisent des pistes cyclables et proposent des vélos en libre-service afin d'encourager les habitants à changer leurs habitudes de déplacement.",
     "Le vélo ne convient cependant pas à toutes les situations. Les personnes qui habitent loin de leur travail, celles qui transportent des enfants ou du matériel lourd ne peuvent pas facilement s'en servir. Dans les régions où l'hiver est long, la neige et le froid rendent les trajets difficiles pendant plusieurs mois. La sécurité inquiète également beaucoup de cyclistes lorsque les pistes sont rares. Le vélo devrait donc être encouragé, mais il ne peut pas remplacer à lui seul les autres moyens de transport."),

    ("Environnement & Transports", "La voiture électrique",
     "La voiture électrique est présentée comme une solution efficace contre la pollution des villes. Elle ne rejette aucun gaz pendant son utilisation et fonctionne presque sans bruit, ce qui améliore la qualité de l'air et le calme dans les quartiers. Son entretien est également moins coûteux et l'électricité reste moins chère que le carburant. Selon ses défenseurs, remplacer progressivement les véhicules classiques permettrait de réduire fortement les émissions liées aux déplacements quotidiens.",
     "D'autres personnes se montrent plus prudentes face à cette technologie. Le prix d'achat reste élevé et de nombreuses familles ne peuvent pas s'offrir un véhicule neuf. La fabrication des batteries demande beaucoup de métaux et d'énergie, et leur recyclage n'est pas encore complètement résolu. Dans certaines régions, les bornes de recharge sont également trop rares pour les longs trajets. La voiture électrique constitue donc un progrès, mais elle ne suffira pas à régler seule les problèmes de transport."),

    ("Environnement & Transports", "Le tri des déchets",
     "Trier ses déchets est un geste simple que chaque habitant peut accomplir tous les jours. Le papier, le verre et le plastique peuvent être transformés en nouveaux produits, ce qui économise des matières premières et de l'énergie. Le tri réduit également la quantité de déchets envoyés dans les décharges. Pour de nombreuses municipalités, expliquer clairement les consignes et installer suffisamment de conteneurs représente donc l'un des moyens les plus efficaces de protéger l'environnement.",
     "Certains spécialistes estiment que le tri ne suffit pas à résoudre le problème. Une partie des déchets collectés n'est finalement pas recyclée parce qu'elle est mal triée ou trop coûteuse à traiter. En insistant uniquement sur le tri, on donne aussi l'impression qu'il est acceptable de continuer à consommer autant. Il serait donc plus utile de réduire les emballages dès la fabrication et d'encourager les habitants à acheter moins de produits jetables plutôt que de tout attendre du recyclage."),

    ("Environnement & Transports", "Les emballages plastiques",
     "De nombreux pays souhaitent interdire les emballages plastiques à usage unique. Ces produits sont utilisés pendant quelques minutes mais mettent des centaines d'années à disparaître et polluent gravement les rivières et les océans. Des solutions existent déjà : contenants réutilisables, papier, verre ou vente en vrac. Selon les défenseurs de cette interdiction, seule une règle claire obligera les entreprises à changer réellement leurs habitudes et à proposer des emballages plus respectueux de l'environnement.",
     "Les entreprises rappellent cependant que le plastique remplit des fonctions utiles. Il protège les aliments, prolonge leur conservation et limite ainsi le gaspillage alimentaire. Il est également léger, ce qui réduit le carburant nécessaire au transport des marchandises. Certains matériaux de remplacement coûtent plus cher et leur fabrication n'est pas toujours plus propre. Plutôt qu'une interdiction générale, il faudrait donc supprimer les emballages vraiment inutiles et améliorer la collecte de ceux qui restent nécessaires."),

    ("Environnement & Transports", "Prendre l'avion",
     "L'avion a rendu le monde beaucoup plus accessible. Il permet de rejoindre sa famille installée à l'étranger, de découvrir d'autres cultures et de développer des relations professionnelles entre les pays. Pour certaines destinations éloignées ou pour les îles, il n'existe tout simplement pas d'autre moyen de transport raisonnable. Le tourisme qu'il rend possible fait également vivre de nombreuses régions. Selon ce point de vue, limiter les vols reviendrait à réserver le voyage aux personnes les plus aisées.",
     "D'autres personnes rappellent que l'avion est l'un des moyens de transport les plus polluants par voyageur. Un seul vol long-courrier peut produire autant de gaz à effet de serre qu'une année entière de trajets quotidiens. Pour de nombreux déplacements en Europe ou à l'intérieur d'un pays, le train constitue une solution comparable en temps et beaucoup moins polluante. Les visioconférences permettent également d'éviter certains voyages d'affaires. Il faudrait donc réserver l'avion aux trajets pour lesquels aucune autre solution n'existe."),

    ("Environnement & Transports", "Les énergies renouvelables",
     "Les pays devraient investir massivement dans les énergies renouvelables. Le soleil et le vent sont des ressources gratuites et inépuisables qui ne produisent pas de gaz à effet de serre pendant leur utilisation. Le coût des panneaux solaires et des éoliennes a fortement baissé ces dernières années et ces installations créent de nombreux emplois locaux. Elles permettent également à un pays de moins dépendre des importations de pétrole et de mieux résister aux hausses de prix.",
     "Ces énergies présentent cependant des limites que l'on oublie souvent. Le vent ne souffle pas en permanence et les panneaux solaires produisent peu en hiver, alors que la consommation est justement la plus forte. Stocker cette électricité coûte encore très cher. Les grandes installations occupent aussi beaucoup d'espace et modifient les paysages. Pour garantir l'électricité à tout moment, il faudra donc combiner plusieurs sources d'énergie plutôt que de compter uniquement sur le soleil et le vent."),

    ("Environnement & Transports", "Acheter des produits locaux",
     "Acheter des produits cultivés près de chez soi présente plusieurs avantages. Les aliments parcourent moins de kilomètres, ce qui réduit la pollution liée au transport, et ils arrivent souvent plus frais chez le consommateur. Ces achats font vivre les agriculteurs de la région et maintiennent une activité économique dans les campagnes. Les clients peuvent également savoir plus facilement comment les produits ont été cultivés. Pour ces raisons, de nombreuses familles privilégient les marchés et les producteurs locaux.",
     "D'autres personnes rappellent que les produits locaux ne sont pas toujours la meilleure solution. Ils coûtent parfois plus cher et toutes les familles ne peuvent pas payer cette différence. Cultiver certains fruits et légumes dans une serre chauffée pendant l'hiver peut aussi consommer plus d'énergie que de les importer d'un pays où ils poussent naturellement. Le choix reste enfin limité selon les saisons et les régions. Il vaudrait donc mieux regarder la manière dont un produit est cultivé plutôt que seulement son origine."),

    ("Environnement & Transports", "La consommation d'eau",
     "Économiser l'eau est devenu une nécessité dans de nombreuses régions. Les sécheresses sont plus fréquentes et certaines villes doivent limiter l'arrosage ou le remplissage des piscines pendant l'été. Chaque habitant peut agir simplement : prendre des douches plus courtes, réparer rapidement une fuite ou installer des appareils économes. Ces gestes coûtent peu et réduisent également les factures. Pour les défenseurs de cette idée, sensibiliser les citoyens reste le moyen le plus rapide de préserver cette ressource.",
     "D'autres estiment que l'effort demandé aux particuliers reste très limité par rapport au problème réel. L'agriculture et l'industrie consomment la plus grande partie de l'eau disponible, et de nombreux réseaux perdent une quantité importante d'eau à cause de canalisations anciennes. Demander aux habitants de faire attention tout en négligeant ces pertes peut donc sembler injuste. Il faudrait avant tout moderniser les infrastructures et revoir les méthodes d'irrigation pour obtenir des résultats vraiment significatifs."),

    ("Environnement & Transports", "Acheter des objets d'occasion",
     "Acheter des vêtements, des meubles ou des appareils d'occasion est devenu une habitude pour de nombreuses personnes. Cette pratique permet d'économiser beaucoup d'argent et de donner une seconde vie à des objets encore en bon état. Elle évite aussi de fabriquer de nouveaux produits, ce qui consomme des matières premières et de l'énergie. Les plateformes en ligne et les magasins solidaires rendent aujourd'hui ces achats simples et accessibles à tout le monde.",
     "L'achat d'occasion comporte cependant certains inconvénients. Les produits ne sont pas garantis et il est parfois difficile de savoir s'ils fonctionneront longtemps. Un appareil électroménager ancien peut également consommer beaucoup plus d'électricité qu'un modèle récent. Certaines personnes n'ont enfin ni le temps ni la possibilité de chercher longuement l'objet dont elles ont besoin. L'occasion représente donc une bonne solution dans de nombreux cas, mais elle ne convient pas à tous les achats."),

    ("Environnement & Transports", "Les espaces verts en ville",
     "Les villes devraient créer davantage de parcs et planter beaucoup plus d'arbres. Les espaces verts rafraîchissent l'air pendant les fortes chaleurs, absorbent une partie de la pollution et permettent à l'eau de pluie de pénétrer dans le sol. Ils offrent également aux habitants un endroit gratuit pour marcher, faire du sport ou rencontrer leurs voisins. Plusieurs études montrent enfin que la présence de la nature réduit le stress et améliore la santé des citadins.",
     "D'autres responsables rappellent que l'espace disponible en ville est limité et très coûteux. Un terrain transformé en parc ne peut plus accueillir de logements, alors que de nombreuses familles cherchent à se loger à un prix raisonnable. L'entretien des parcs demande également un budget important et beaucoup d'eau pendant l'été. Il serait donc parfois plus efficace de végétaliser les rues, les cours d'école et les toits existants plutôt que de créer de grands parcs supplémentaires."),

    ("Environnement & Transports", "Taxer les produits polluants",
     "Certains gouvernements souhaitent augmenter les taxes sur les produits les plus polluants. Lorsqu'un article coûte plus cher, les consommateurs se tournent naturellement vers des solutions plus propres et les entreprises sont encouragées à modifier leur fabrication. L'argent récolté peut ensuite financer les transports publics ou aider les familles à isoler leur logement. Selon ce point de vue, le prix reste l'outil le plus rapide et le plus efficace pour changer les comportements à grande échelle.",
     "Ces taxes sont cependant souvent critiquées parce qu'elles pèsent surtout sur les ménages modestes. Une personne qui possède une voiture ancienne et habite loin de son travail n'a pas toujours les moyens d'acheter un véhicule plus propre. Elle paie donc la taxe sans pouvoir changer ses habitudes. Ces mesures peuvent alors provoquer un sentiment d'injustice et un rejet des politiques écologiques. Avant de taxer, il faudrait donc proposer des solutions de remplacement accessibles à tous."),

    ("Environnement & Transports", "Réparer plutôt que remplacer",
     "De plus en plus de personnes choisissent de faire réparer leurs appareils au lieu d'en acheter de nouveaux. Réparer coûte souvent moins cher, évite de jeter des objets encore utilisables et limite la production de déchets électroniques, très difficiles à traiter. Cette pratique fait également vivre des artisans et des ateliers de quartier. Pour ses défenseurs, les fabricants devraient être obligés de vendre des pièces détachées et de concevoir des produits plus faciles à ouvrir.",
     "La réparation n'est cependant pas toujours possible ni raisonnable. Le prix d'une intervention dépasse parfois celui d'un appareil neuf, et certaines pièces ne sont plus fabriquées après quelques années. Les ateliers de réparation sont également rares dans de nombreuses régions. Un modèle récent peut enfin consommer beaucoup moins d'électricité qu'un appareil ancien réparé plusieurs fois. Le choix dépend donc de chaque situation, même s'il faudrait clairement faciliter la réparation lorsqu'elle a du sens."),

    ("Environnement & Transports", "Le train ou la voiture pour les longs trajets",
     "Pour les longs trajets, le train présente de nombreux avantages sur la voiture. Il pollue beaucoup moins par voyageur, ne connaît pas les embouteillages et permet de lire, de travailler ou de se reposer pendant le voyage. Il est également plus sûr, puisque les accidents y sont beaucoup plus rares que sur la route. Pour les personnes qui voyagent seules ou à deux entre deux grandes villes, il constitue donc souvent la meilleure solution.",
     "La voiture conserve pourtant des atouts que le train ne peut pas offrir. Elle permet de partir à n'importe quelle heure, de s'arrêter où l'on veut et de transporter facilement des bagages volumineux. Pour une famille de quatre personnes, elle revient souvent moins cher que quatre billets. De nombreuses régions ne sont enfin pas desservies par le rail, ou seulement avec plusieurs correspondances. Le choix dépend donc du trajet, du nombre de voyageurs et des lignes réellement disponibles."),

    # ==================================================================
    # THÈME 5 — SANTÉ & MODE DE VIE
    # ==================================================================
    ("Santé & Mode de vie", "Faire du sport régulièrement",
     "Pratiquer une activité physique régulière est l'un des meilleurs moyens de rester en bonne santé. Le sport renforce le cœur, améliore le sommeil et aide à réduire le stress accumulé pendant la journée. Il n'est pas nécessaire de s'entraîner longtemps : trente minutes de marche rapide plusieurs fois par semaine produisent déjà des effets visibles. Les médecins recommandent donc d'intégrer le mouvement dans les habitudes quotidiennes plutôt que d'attendre d'avoir un problème de santé.",
     "Beaucoup de personnes savent tout cela mais n'arrivent pas à trouver le temps de faire du sport. Entre les horaires de travail, les trajets et les enfants, une séance régulière devient vite impossible à organiser. Les abonnements dans les salles coûtent également cher et certaines personnes se découragent après quelques semaines. Plutôt que de culpabiliser les gens, il faudrait donc rendre l'activité physique plus accessible : pistes cyclables, équipements gratuits et horaires adaptés près des lieux de travail."),

    ("Santé & Mode de vie", "La restauration rapide",
     "La restauration rapide correspond bien au rythme de vie actuel. Elle permet de manger en quelques minutes pendant une pause courte, à un prix que la plupart des budgets peuvent supporter. Ces restaurants sont ouverts tard, présents partout et pratiques pour les étudiants ou les personnes qui travaillent loin de chez elles. Beaucoup d'enseignes proposent aujourd'hui des salades, des plats moins gras et affichent clairement les informations nutritionnelles de leurs produits.",
     "Les spécialistes de la santé restent néanmoins inquiets. Ces repas contiennent souvent beaucoup de sel, de sucre et de matières grasses, et les portions ont fortement augmenté. Consommés plusieurs fois par semaine, ils favorisent la prise de poids et certaines maladies. La publicité s'adresse en outre directement aux enfants, qui prennent très tôt de mauvaises habitudes alimentaires. La restauration rapide devrait donc rester exceptionnelle et non devenir la base de l'alimentation quotidienne."),

    ("Santé & Mode de vie", "Cuisiner soi-même",
     "Préparer ses repas à la maison présente de nombreux avantages. On choisit soi-même les ingrédients, on limite le sel et le sucre et on sait exactement ce que l'on mange. Cuisiner revient également beaucoup moins cher que d'acheter des plats préparés ou de manger au restaurant. C'est enfin un moment agréable à partager en famille, et une occasion d'apprendre aux enfants à se nourrir correctement. Quelques recettes simples suffisent pour bien manger toute la semaine.",
     "Cuisiner tous les jours demande cependant du temps et de l'organisation. Après une longue journée de travail et un trajet fatigant, beaucoup de personnes n'ont ni l'énergie ni l'envie de préparer un repas complet. Il faut aussi savoir faire les courses, planifier les menus et posséder un minimum d'équipement. Les plats préparés de bonne qualité peuvent donc dépanner utilement, à condition de lire les étiquettes et de ne pas en faire une habitude quotidienne."),

    ("Santé & Mode de vie", "Le manque de sommeil",
     "Le sommeil est aussi important pour la santé que l'alimentation ou l'activité physique. Dormir suffisamment permet au corps de récupérer, renforce la mémoire et améliore la concentration pendant la journée. Les personnes qui manquent régulièrement de sommeil se montrent plus irritables, tombent malades plus souvent et commettent davantage d'erreurs au travail. Il faudrait donc protéger ses heures de repos, se coucher à des horaires réguliers et éviter les écrans en fin de soirée.",
     "Dans la réalité, il n'est pas toujours possible de dormir autant qu'on le souhaiterait. Certaines personnes travaillent de nuit ou avec des horaires changeants, d'autres se lèvent tôt à cause de longs trajets ou s'occupent de jeunes enfants. Le bruit et les soucis financiers empêchent également de bien dormir. Rappeler simplement qu'il faut dormir huit heures ne suffit donc pas : il faudrait aussi agir sur les conditions de travail et de logement qui rendent ce repos impossible."),

    ("Santé & Mode de vie", "La consultation médicale à distance",
     "La consultation médicale par vidéo s'est beaucoup développée et rend les soins plus accessibles. Un patient peut décrire ses symptômes, obtenir un avis et recevoir une ordonnance sans quitter son domicile. Cette solution est particulièrement utile dans les régions où les médecins sont rares, ainsi que pour les personnes âgées ou peu mobiles. Elle évite également de longues salles d'attente et permet de traiter rapidement les problèmes simples ou de renouveler un traitement habituel.",
     "La consultation à distance ne peut cependant pas remplacer un examen réel. Le médecin ne peut ni ausculter le patient ni remarquer certains signes qu'un écran ne montre pas, ce qui augmente le risque d'erreur. La relation de confiance se construit également moins bien à distance. Les personnes qui maîtrisent mal les outils numériques ou disposent d'une mauvaise connexion se trouvent enfin exclues. Cette pratique devrait donc compléter les consultations habituelles sans jamais les remplacer complètement."),

    ("Santé & Mode de vie", "Les applications de santé",
     "Les montres connectées et les applications de santé aident de nombreuses personnes à prendre soin d'elles. Elles comptent les pas, mesurent le rythme cardiaque, suivent la qualité du sommeil et rappellent de bouger après une longue période assise. Voir ses progrès chiffrés motive à continuer et permet de fixer des objectifs réalistes. Certaines applications signalent aussi des anomalies qui poussent l'utilisateur à consulter un médecin, parfois avant l'apparition de symptômes.",
     "Ces outils présentent néanmoins des inconvénients réels. Leurs mesures ne sont pas toujours fiables et peuvent inquiéter inutilement une personne en bonne santé, ou au contraire la rassurer à tort. Certains utilisateurs deviennent obsédés par leurs chiffres quotidiens et se sentent coupables dès qu'ils n'atteignent pas leur objectif. Ces applications collectent enfin des données médicales très personnelles dont l'utilisation reste peu claire. Elles doivent donc rester un simple repère et non un diagnostic."),

    ("Santé & Mode de vie", "Taxer les boissons sucrées",
     "Plusieurs pays ont décidé d'augmenter le prix des boissons très sucrées. Ces produits n'apportent presque aucun élément nutritif et favorisent le surpoids ainsi que les problèmes dentaires, en particulier chez les jeunes. Là où cette taxe a été appliquée, la consommation a diminué et plusieurs fabricants ont réduit la quantité de sucre de leurs recettes. L'argent récolté peut en outre financer des campagnes de prévention ou des repas équilibrés dans les écoles.",
     "D'autres personnes doutent de l'efficacité réelle de cette mesure. Une taxe touche surtout les ménages modestes, pour qui ces boissons représentent un plaisir peu coûteux. Certains consommateurs se tournent simplement vers d'autres produits tout aussi sucrés, sans changer leurs habitudes. Décider à la place des adultes ce qu'ils ont le droit de boire pose enfin une question de liberté. L'éducation alimentaire et un affichage clair seraient donc peut-être plus utiles qu'une augmentation des prix."),

    ("Santé & Mode de vie", "Le stress au quotidien",
     "Le stress est devenu un problème de santé majeur dans les sociétés modernes. Les horaires chargés, les messages permanents et l'incertitude économique maintiennent beaucoup de personnes dans un état de tension continu. Ce stress provoque des troubles du sommeil, des douleurs et parfois de véritables dépressions. Apprendre à s'organiser, à se déconnecter le soir et à pratiquer une activité relaxante peut réellement améliorer la situation. Les entreprises devraient également former leurs responsables à repérer ces difficultés.",
     "D'autres estiment qu'on parle du stress d'une manière trop individuelle. Proposer des séances de relaxation à des salariés qui manquent de personnel ou reçoivent des objectifs impossibles ne règle pas la cause du problème. Le stress vient souvent d'une charge de travail excessive, d'horaires imprévisibles ou d'un manque de reconnaissance. Il faudrait donc corriger l'organisation du travail elle-même plutôt que demander à chacun de mieux supporter une situation qui reste anormale."),

    ("Santé & Mode de vie", "Réduire la viande dans son alimentation",
     "De plus en plus de personnes choisissent de manger moins de viande. Les médecins rappellent qu'une consommation excessive, surtout de viande transformée, augmente le risque de plusieurs maladies. Les légumes secs, les œufs et les céréales complètes apportent des protéines à un prix bien plus faible. L'élevage occupe par ailleurs d'immenses surfaces et produit une part importante des gaz à effet de serre. Réduire sa consommation serait donc bénéfique pour la santé comme pour la planète.",
     "D'autres personnes rappellent que la viande reste un aliment complet et facile à intégrer dans les repas. Elle fournit du fer et de la vitamine B12, que certains régimes équilibrent difficilement, en particulier chez les enfants et les personnes âgées. Elle occupe également une place importante dans de nombreuses traditions familiales et culturelles. Plutôt que de supprimer la viande, il serait donc préférable d'en consommer des quantités raisonnables et de privilégier des élevages de meilleure qualité."),

    ("Santé & Mode de vie", "Chercher ses symptômes sur Internet",
     "Internet permet aujourd'hui à chacun de mieux comprendre sa santé. Avant un rendez-vous, un patient peut lire des explications sur sa maladie, préparer ses questions et mieux suivre ce que le médecin lui dit. Après la consultation, il peut relire des informations fiables sur son traitement. Ces recherches aident également à reconnaître des signes qui nécessitent une consultation rapide. Un patient informé participe donc davantage aux décisions qui concernent sa propre santé.",
     "Ces recherches provoquent cependant beaucoup d'angoisses inutiles. Des symptômes très courants conduisent souvent à des pages décrivant des maladies graves, ce qui inquiète fortement certaines personnes. D'autres, au contraire, se rassurent trop vite et retardent une consultation nécessaire. Les informations disponibles sont enfin de qualité très inégale et certains sites cherchent surtout à vendre des produits. Internet peut donc compléter l'avis d'un professionnel, mais il ne doit jamais servir à se diagnostiquer seul."),

    ("Santé & Mode de vie", "Le tabac dans les lieux publics",
     "L'interdiction de fumer dans les lieux publics a représenté un vrai progrès sanitaire. Elle protège les employés des bars et des restaurants, qui respiraient auparavant la fumée pendant toute leur journée de travail. Elle protège également les enfants et les personnes fragiles. Depuis ces mesures, le nombre de fumeurs a diminué dans plusieurs pays et de nombreuses personnes ont profité de ces règles pour arrêter. Il faudrait donc étendre l'interdiction aux parcs et aux terrasses.",
     "D'autres estiment que ces interdictions vont désormais trop loin. Le tabac reste un produit légal et les adultes doivent pouvoir décider pour eux-mêmes, surtout à l'extérieur, où la fumée se disperse rapidement. Multiplier les interdits risque de faire fumer les gens dans des lieux moins visibles plutôt que de les aider à arrêter. Il serait donc plus efficace de financer l'accompagnement au sevrage et la prévention auprès des jeunes que d'ajouter sans cesse de nouvelles règles."),

    ("Santé & Mode de vie", "Rester assis toute la journée",
     "Passer la journée entière assis devant un écran nuit sérieusement à la santé. Cette immobilité prolongée provoque des douleurs au dos et au cou, ralentit la circulation et favorise la prise de poids, même chez les personnes qui font du sport le soir. Des solutions simples existent : se lever quelques minutes chaque heure, organiser certaines réunions en marchant ou utiliser un bureau réglable en hauteur. Les entreprises devraient encourager activement ces habitudes.",
     "Ces conseils sont cependant difficiles à appliquer dans beaucoup de métiers. Un salarié qui répond aux clients ou doit tenir des délais serrés ne peut pas s'interrompre toutes les heures. Le matériel adapté coûte cher et n'est pas fourni partout, surtout aux personnes en télétravail. Certains postes exigent enfin une présence continue à un poste fixe. Améliorer réellement la situation demanderait donc de revoir l'organisation des tâches, et pas seulement de conseiller aux employés de se lever."),

    ("Santé & Mode de vie", "Les campagnes de prévention",
     "Les campagnes publiques de prévention jouent un rôle important. Elles rappellent l'utilité des dépistages, expliquent les gestes qui protègent la santé et touchent des personnes qui ne consultent jamais spontanément un médecin. Grâce à elles, de nombreuses maladies sont détectées plus tôt, ce qui améliore les chances de guérison et réduit fortement les coûts de traitement. Ces messages sont également gratuits et accessibles à toute la population, quel que soit son niveau de revenu.",
     "Certains spécialistes trouvent cependant ces campagnes peu efficaces. Les messages généraux atteignent surtout les personnes déjà attentives à leur santé, tandis que les publics les plus fragiles restent difficiles à convaincre. Répéter qu'il faut bien manger ou bouger davantage sert à peu de chose quand une famille manque de moyens ou de temps. Il serait donc préférable d'investir dans un accompagnement direct, des consultations gratuites et des actions menées au plus près des quartiers concernés."),

    ("Santé & Mode de vie", "Manger devant un écran",
     "Beaucoup de personnes déjeunent aujourd'hui devant leur ordinateur ou leur téléphone. Cette habitude permet de gagner du temps, de terminer un travail urgent ou simplement de se détendre en regardant une vidéo pendant la pause. Pour ceux qui travaillent seuls ou disposent de très peu de temps, il s'agit souvent de la seule solution possible. Manger rapidement à son poste n'empêche d'ailleurs pas de choisir un repas équilibré et préparé à la maison.",
     "Les nutritionnistes déconseillent pourtant fortement cette pratique. Lorsqu'une personne est concentrée sur un écran, elle mange plus vite et remarque moins le signal de satiété, ce qui la conduit à consommer davantage. Le repas perd également sa fonction de vraie pause, alors que le cerveau a besoin de ces quelques minutes de repos. Les échanges avec les collègues disparaissent enfin. Il vaudrait donc mieux quitter son poste, même brièvement, pour manger dans un autre endroit."),

    ("Santé & Mode de vie", "Les régimes amaigrissants",
     "Suivre un régime encadré peut réellement aider une personne en surpoids. Un programme précis fixe des objectifs clairs, apprend à composer des repas équilibrés et permet de mesurer ses progrès semaine après semaine. Accompagné par un professionnel, il réduit des risques de santé bien réels, comme le diabète ou les maladies du cœur. Beaucoup de personnes ont aussi besoin d'un cadre strict au départ pour rompre des habitudes installées depuis des années.",
     "La plupart des régimes donnent pourtant des résultats décevants sur la durée. Une grande partie des personnes reprennent le poids perdu dès qu'elles retrouvent leur alimentation habituelle, parfois davantage. Les programmes très restrictifs provoquent de la fatigue, des carences et un rapport difficile à la nourriture. Les régimes trouvés en ligne, sans aucun suivi, sont particulièrement risqués. Modifier durablement ses habitudes et bouger davantage reste donc plus efficace qu'un régime de quelques semaines."),

    # ==================================================================
    # THÈME 6 — VILLE, LOGEMENT & VIE QUOTIDIENNE
    # ==================================================================
    ("Ville, Logement & Vie quotidienne", "Vivre en ville ou à la campagne",
     "La ville offre des avantages que la campagne ne peut pas remplacer. On y trouve davantage d'emplois, des universités, des hôpitaux spécialisés et des transports qui fonctionnent tard le soir. Les habitants profitent également des cinémas, des musées, des restaurants et de nombreuses activités pour les enfants. Tout se trouve à proximité et il est plus facile de rencontrer des personnes qui partagent les mêmes intérêts. Pour beaucoup de jeunes, la ville reste donc le meilleur choix.",
     "La campagne attire pourtant de plus en plus de familles. Les logements y sont beaucoup plus grands pour un prix nettement inférieur, l'air est plus pur et le bruit presque absent. Les enfants peuvent jouer dehors en sécurité et les relations entre voisins restent plus chaleureuses. Avec le télétravail et une meilleure connexion Internet, il devient possible d'y exercer de nombreux métiers. Pour ceux qui recherchent le calme et l'espace, la campagne offre donc une qualité de vie supérieure."),

    ("Ville, Logement & Vie quotidienne", "Louer ou acheter son logement",
     "Acheter son logement reste un objectif important pour de nombreuses familles. Chaque mensualité constitue une véritable épargne, alors qu'un loyer est définitivement perdu. Devenir propriétaire protège aussi des augmentations de loyer et du risque de devoir déménager si le bailleur reprend son bien. On peut enfin transformer les lieux à son goût et transmettre ce patrimoine à ses enfants. À long terme, l'achat représente donc une sécurité que la location n'offre pas.",
     "La location présente cependant une souplesse précieuse. Un locataire peut changer de ville pour un nouvel emploi ou adapter la taille de son logement à sa famille sans procédure compliquée. Il n'a pas non plus à financer les grosses réparations ni les taxes qui pèsent sur les propriétaires. L'achat exige enfin un apport important et un crédit de longue durée, impossible pour beaucoup de ménages. Selon la situation de chacun, louer peut donc être un choix parfaitement raisonnable."),

    ("Ville, Logement & Vie quotidienne", "Construire des immeubles en hauteur",
     "Face au manque de logements, plusieurs villes choisissent de construire des immeubles plus hauts. Cette solution permet de loger beaucoup de personnes sur une petite surface et d'éviter que la ville s'étende sans fin sur les terres agricoles. Les habitants restent proches des transports, des commerces et de leur travail, ce qui réduit les trajets. Les bâtiments récents sont également mieux isolés et consomment moins d'énergie que les maisons individuelles anciennes.",
     "Les habitants s'opposent souvent à ces projets. Les tours modifient profondément le paysage d'un quartier, privent certains logements de lumière et augmentent la circulation dans des rues déjà saturées. La vie dans de très grands immeubles rend aussi les relations de voisinage plus difficiles, surtout pour les familles avec de jeunes enfants. Avant de construire en hauteur, il faudrait donc rénover les logements vides et vérifier que les écoles et les transports peuvent absorber ces nouveaux habitants."),

    ("Ville, Logement & Vie quotidienne", "La colocation",
     "La colocation est devenue une solution très répandue, et pas seulement chez les étudiants. Partager un appartement permet de diviser le loyer et les charges, donc d'habiter un logement plus grand dans un quartier mieux situé. Vivre avec d'autres personnes évite également la solitude, surtout lorsqu'on arrive dans une nouvelle ville. Les colocataires s'entraident au quotidien et créent souvent de véritables amitiés. Pour de nombreux jeunes actifs, c'est aujourd'hui le seul moyen de se loger correctement.",
     "La vie en colocation crée pourtant des tensions fréquentes. Les habitudes de ménage, les horaires, le bruit ou les invités provoquent régulièrement des disputes. Il devient difficile de se reposer ou de recevoir sa famille lorsqu'on partage toutes les pièces communes. Les questions d'argent posent également problème si un colocataire part brusquement ou ne paie pas sa part. Pour les personnes qui ont besoin de calme et d'intimité, un petit logement indépendant reste préférable."),

    ("Ville, Logement & Vie quotidienne", "Rester chez ses parents plus longtemps",
     "De nombreux jeunes adultes continuent d'habiter chez leurs parents après leurs études. Cette situation leur permet d'économiser pendant que les loyers augmentent, de terminer une formation sans s'endetter et de préparer plus sereinement leur installation. Ils peuvent également aider leurs parents au quotidien et rester proches de leur famille. Dans de nombreuses cultures, plusieurs générations vivent d'ailleurs ensemble depuis toujours, sans que cela pose le moindre problème.",
     "D'autres pensent qu'il est important de partir assez tôt du domicile familial. Vivre seul oblige à gérer un budget, un logement et des démarches administratives, ce qui rend réellement autonome. Rester trop longtemps chez ses parents peut retarder cet apprentissage et créer des tensions, les jeunes adultes supportant mal les règles de la maison. La situation pèse enfin sur des parents qui approchent de la retraite. Un départ progressif serait donc préférable lorsque les moyens le permettent."),

    ("Ville, Logement & Vie quotidienne", "Les commerces de quartier",
     "Les petits commerces jouent un rôle essentiel dans la vie d'un quartier. On y trouve des produits frais, des conseils personnalisés et un contact humain que les grandes surfaces n'offrent pas. Ces boutiques permettent aux personnes âgées de faire leurs courses à pied et animent les rues, ce qui les rend plus sûres. Elles font enfin vivre des familles et des producteurs de la région. Il faudrait donc soutenir ces commerces et limiter les grandes surfaces en périphérie.",
     "Les consommateurs rappellent cependant que les prix sont souvent plus élevés dans les petits commerces. Une famille nombreuse fait des économies importantes en achetant dans un supermarché, où le choix est également beaucoup plus large et les horaires plus étendus. Les commerces de quartier ferment tôt et n'ouvrent pas toujours le dimanche, ce qui ne convient pas aux personnes qui travaillent. Chacun devrait donc pouvoir choisir librement selon son budget et son emploi du temps."),

    ("Ville, Logement & Vie quotidienne", "Le bruit en ville",
     "Le bruit est devenu l'une des principales nuisances de la vie urbaine. La circulation, les travaux, les terrasses et les livraisons nocturnes empêchent de nombreux habitants de dormir correctement. Cette fatigue permanente augmente le stress et provoque de véritables problèmes de santé. Les villes devraient donc limiter la vitesse des véhicules, encadrer strictement les horaires de chantier et contrôler les établissements qui dépassent régulièrement les niveaux autorisés.",
     "D'autres estiment qu'une certaine animation fait partie de la vie urbaine. Les terrasses, les concerts et les marchés rendent une ville vivante et font travailler de nombreux commerçants. Interdire trop de choses risquerait de transformer les centres en quartiers vides le soir. Les travaux et les livraisons sont par ailleurs indispensables au fonctionnement de la ville. Il vaudrait donc mieux améliorer l'isolation des logements et organiser les activités bruyantes plutôt que de les supprimer."),

    ("Ville, Logement & Vie quotidienne", "Les caméras de surveillance",
     "De nombreuses municipalités installent des caméras dans les rues et les transports. Ces dispositifs aident la police à identifier les auteurs de vols et d'agressions, et permettent d'intervenir plus rapidement en cas d'incident. Leur simple présence décourage certains comportements et rassure les habitants, en particulier les personnes âgées qui hésitent à sortir le soir. Les images se révèlent enfin très utiles pour comprendre les accidents de la circulation.",
     "D'autres citoyens s'inquiètent de cette surveillance permanente. Être filmé en permanence dans l'espace public pose une question de liberté, et les images ne sont pas toujours conservées ni utilisées de manière transparente. Plusieurs études montrent en outre que la délinquance se déplace simplement vers les rues non équipées. Ces installations coûtent enfin très cher. Cet argent serait peut-être plus utile pour financer des agents présents sur le terrain et un meilleur éclairage des rues."),

    ("Ville, Logement & Vie quotidienne", "Changer souvent de ville",
     "Déménager régulièrement peut être très enrichissant. Changer de ville permet de saisir une meilleure occasion professionnelle, de découvrir une autre région et de rencontrer des personnes différentes. On apprend à s'adapter rapidement, à se débrouiller seul et à sortir de ses habitudes. Pour les jeunes actifs en particulier, accepter de bouger pendant quelques années ouvre des perspectives de carrière qu'il serait impossible d'obtenir en restant toujours au même endroit.",
     "Ces déménagements répétés ont pourtant un coût humain important. Il faut chaque fois reconstruire un cercle d'amis, trouver de nouveaux repères et parfois éloigner les enfants de leur école et de leurs camarades. Le conjoint doit également retrouver un emploi, ce qui n'est pas toujours simple. S'installer durablement quelque part permet au contraire de créer des liens solides, de participer à la vie locale et d'offrir à sa famille une stabilité précieuse."),

    ("Ville, Logement & Vie quotidienne", "Les relations entre voisins",
     "Connaître ses voisins améliore réellement la vie quotidienne. On peut s'échanger un service, récupérer un colis, surveiller un logement pendant les vacances ou simplement discuter quelques minutes. Ces liens réduisent l'isolement, en particulier chez les personnes âgées, et rendent l'immeuble plus agréable et plus sûr. Les fêtes de quartier et les jardins partagés sont donc des initiatives utiles, que les municipalités devraient encourager et soutenir davantage.",
     "D'autres personnes tiennent beaucoup à préserver leur tranquillité. Après une journée de travail, elles souhaitent rentrer chez elles sans être sollicitées et considèrent leur logement comme un espace strictement privé. Des relations trop proches avec les voisins peuvent aussi devenir pesantes et se transformer en conflits difficiles à éviter, puisqu'on se croise tous les jours. Se saluer poliment et respecter le calme de chacun suffit donc largement à une bonne vie collective."),

    ("Ville, Logement & Vie quotidienne", "Les locations de courte durée",
     "Les plateformes de location de courte durée ont transformé le tourisme. Elles permettent aux voyageurs de loger dans de vrais quartiers, souvent pour moins cher qu'à l'hôtel, et de disposer d'une cuisine, ce qui aide beaucoup les familles. Pour les propriétaires, louer quelques semaines par an apporte un complément de revenu appréciable. Les touristes ainsi accueillis font également vivre les commerces et les restaurants situés en dehors des zones habituelles.",
     "Dans plusieurs villes, ce système a pourtant aggravé la crise du logement. De nombreux appartements sont retirés de la location classique parce que la location touristique rapporte davantage, ce qui fait monter les loyers pour les habitants. Les immeubles concernés subissent aussi des allées et venues permanentes et du bruit la nuit. Certains quartiers perdent enfin leurs commerces de proximité au profit de boutiques pour touristes. Une réglementation stricte du nombre de nuitées paraît donc nécessaire."),

    ("Ville, Logement & Vie quotidienne", "Les animaux de compagnie en appartement",
     "Vivre avec un animal apporte beaucoup de bonheur, y compris dans un petit logement. Un chat ou un chien tient compagnie aux personnes seules, réduit le stress et oblige à sortir régulièrement, ce qui fait du bien à tout le monde. Les enfants apprennent également à s'occuper d'un autre être vivant et à devenir responsables. Avec des promenades suffisantes et un peu d'organisation, un animal s'adapte parfaitement à la vie en appartement.",
     "Il faut cependant réfléchir sérieusement avant d'adopter dans un espace réduit. Certains animaux ont besoin de courir et supportent mal de rester enfermés toute la journée pendant que leurs maîtres travaillent. Les aboiements peuvent gêner les voisins et provoquer de vrais conflits dans l'immeuble. Les frais de vétérinaire et la garde pendant les vacances représentent enfin un budget important. De nombreux animaux sont abandonnés chaque été faute d'avoir bien anticipé ces contraintes."),

    ("Ville, Logement & Vie quotidienne", "Se passer de voiture en ville",
     "Dans une grande ville bien desservie, posséder une voiture n'est plus vraiment nécessaire. L'achat, l'assurance, l'entretien et le stationnement représentent une dépense très lourde pour un véhicule qui reste garé la plus grande partie de la journée. Les transports publics, le vélo et les services d'autopartage couvrent la plupart des besoins, et il est possible de louer une voiture pour les rares longs trajets. Y renoncer libère donc du budget et de l'espace en ville.",
     "Cette idée fonctionne surtout dans les quartiers centraux les mieux équipés. En banlieue, les lignes sont rares le soir et le week-end, et certains emplois commencent avant le premier bus. Une famille qui transporte des enfants, des courses ou du matériel ne peut pas tout faire à vélo, surtout en hiver. Les services d'autopartage restent enfin concentrés dans les centres. Pour beaucoup de ménages, la voiture demeure donc indispensable, faute d'alternative réelle."),

    ("Ville, Logement & Vie quotidienne", "Rénover ou construire du neuf",
     "Rénover les bâtiments anciens devrait être la priorité des villes. La construction neuve consomme énormément de matériaux et d'énergie, alors que de nombreux logements et bureaux restent vides. Rénover permet de conserver le caractère d'un quartier, d'éviter d'étendre la ville sur les espaces naturels et d'améliorer rapidement l'isolation, donc les factures des habitants. Ces chantiers font également travailler des artisans locaux plutôt que de grandes entreprises venues d'ailleurs.",
     "La rénovation atteint pourtant vite ses limites. Certains bâtiments anciens sont si dégradés que les travaux coûtent plus cher qu'une construction neuve, pour un résultat moins performant. Il est également difficile d'y installer un ascenseur ou de les rendre accessibles aux personnes handicapées. Les chantiers durent longtemps et obligent parfois les habitants à partir. Face à une demande de logements très forte, construire du neuf reste donc souvent la solution la plus rapide et la plus adaptée."),

    ("Ville, Logement & Vie quotidienne", "Habiter un petit logement",
     "Vivre dans un logement de petite taille présente des avantages réels. Le loyer et les charges sont nettement plus faibles, ce qui permet de résider dans un quartier central, près de son travail et des transports. L'entretien demande peu de temps et l'espace limité oblige à ne garder que l'essentiel, donc à consommer moins. Pour une personne seule ou un jeune couple, un petit appartement bien conçu suffit largement au quotidien.",
     "Cette situation devient pourtant vite pénible lorsqu'elle dure. Le télétravail a montré qu'il est difficile de travailler, de recevoir ou simplement de s'isoler dans quelques mètres carrés. Une famille avec des enfants qui grandissent manque rapidement de place pour étudier et se reposer, ce qui crée des tensions permanentes. Ces logements sont enfin souvent proposés à un prix très élevé au mètre carré. Le petit logement doit donc rester une étape, pas une solution durable."),

    # ==================================================================
    # THÈME 7 — CULTURE, LOISIRS & VOYAGES
    # ==================================================================
    ("Culture, Loisirs & Voyages", "Voyager seul ou en groupe",
     "Voyager seul est une expérience particulièrement enrichissante. On organise son parcours comme on le souhaite, on modifie son programme à tout moment et on s'arrête aussi longtemps qu'on le désire dans un endroit qui plaît. Les voyageurs seuls parlent également beaucoup plus facilement aux habitants et aux autres visiteurs, car ils ne restent pas dans leur groupe. Cette liberté oblige enfin à se débrouiller et donne une réelle confiance en soi.",
     "Voyager accompagné présente pourtant de sérieux avantages. On partage les frais d'hébergement et de transport, ce qui rend le séjour nettement moins coûteux. On partage surtout les découvertes, et ces souvenirs communs restent longtemps. Le groupe apporte également une sécurité appréciable dans un pays inconnu, en cas de maladie ou de problème administratif. Pour les personnes qui parlent mal la langue locale, partir accompagné rend enfin le voyage beaucoup moins stressant."),

    ("Culture, Loisirs & Voyages", "Le tourisme de masse",
     "Le tourisme fait vivre des régions entières. Il crée des emplois dans les hôtels, les restaurants et les transports, et il finance l'entretien de monuments qui seraient autrement abandonnés. Dans certains pays, il représente une part essentielle de l'économie et permet à des zones rurales de conserver leurs habitants. Voyager favorise également la rencontre entre les cultures et aide les visiteurs à mieux comprendre des sociétés qu'ils connaissaient seulement par les médias.",
     "Dans plusieurs villes, l'afflux de visiteurs est pourtant devenu insupportable pour les habitants. Les logements se transforment en locations touristiques, les loyers augmentent et les commerces du quotidien disparaissent. Les sites les plus célèbres sont saturés, ce qui abîme les monuments et les milieux naturels fragiles. Le tourisme crée enfin des emplois souvent saisonniers et mal payés. Il faudrait donc limiter le nombre de visiteurs sur les sites les plus fréquentés et mieux répartir les flux."),

    ("Culture, Loisirs & Voyages", "La gratuité des musées",
     "Rendre les musées gratuits permettrait à tout le monde d'accéder à la culture. Le prix des billets décourage aujourd'hui de nombreuses familles, alors que ces institutions sont largement financées par l'argent public. La gratuité attire un public plus varié, notamment des jeunes et des personnes qui ne franchiraient jamais la porte d'un musée. Elle encourage aussi les visites courtes et répétées, bien plus agréables qu'une seule visite épuisante de plusieurs heures.",
     "D'autres estiment que la gratuité totale n'est pas la meilleure solution. Les musées ont besoin de ces recettes pour restaurer les œuvres, organiser des expositions et payer leur personnel. Là où la gratuité a été appliquée, elle a surtout profité à des visiteurs qui venaient déjà régulièrement. Les vraies barrières sont souvent l'éloignement et le sentiment de ne pas être à sa place. Des tarifs réduits accompagnés d'actions dans les écoles et les quartiers seraient donc plus efficaces."),

    ("Culture, Loisirs & Voyages", "Les livres papier ou numériques",
     "La liseuse et le téléphone ont rendu la lecture beaucoup plus pratique. Un seul appareil contient des centaines de titres, ce qui est idéal en voyage ou dans les transports. On peut agrandir les caractères, lire dans l'obscurité et acheter un livre en quelques secondes, souvent moins cher que l'édition papier. Ces formats permettent enfin d'accéder à des ouvrages introuvables en librairie et évitent d'imprimer et de transporter des millions de volumes.",
     "Beaucoup de lecteurs restent pourtant attachés au livre papier. Il ne dépend d'aucune batterie, ne fatigue pas les yeux et se prête, se revend ou s'offre facilement. Plusieurs études indiquent que l'on mémorise mieux un texte lu sur papier, sans les notifications qui interrompent la lecture sur un écran. Une bibliothèque personnelle a enfin une valeur affective qu'un fichier ne remplace pas. Les deux formats peuvent donc coexister selon les moments et les usages."),

    ("Culture, Loisirs & Voyages", "Les plateformes de streaming",
     "Les plateformes de streaming ont changé notre manière de regarder des films et des séries. Pour le prix d'une ou deux places de cinéma par mois, on accède à des milliers de titres, à l'heure qui convient et depuis n'importe quel appareil. Elles proposent également des productions venues du monde entier, y compris des films que les salles n'auraient jamais diffusés. Pour les familles et les personnes éloignées des grandes villes, c'est un accès à la culture inespéré.",
     "Les salles de cinéma conservent malgré tout un rôle irremplaçable. Le grand écran, le son et l'obscurité créent une expérience que le salon ne reproduit pas, et l'on regarde le film jusqu'au bout sans interruption ni téléphone. Aller au cinéma reste également une sortie partagée, un moment de vie sociale. Les salles font enfin vivre les centres-villes et soutiennent des productions plus exigeantes. Il serait dommage de les laisser disparaître au profit des seules plateformes."),

    ("Culture, Loisirs & Voyages", "Apprendre à jouer d'un instrument",
     "Apprendre la musique apporte beaucoup, à tout âge. Jouer d'un instrument développe la mémoire, la concentration et la patience, et procure une vraie satisfaction lorsqu'un morceau difficile est enfin maîtrisé. C'est également une manière agréable d'évacuer le stress après le travail et de rencontrer d'autres personnes au sein d'un groupe ou d'un orchestre. Il n'est pas nécessaire de viser un niveau professionnel pour en tirer un réel plaisir.",
     "Cet apprentissage demande cependant beaucoup de temps et de constance. Sans pratique quotidienne, les progrès restent très lents et beaucoup de débutants abandonnent après quelques mois, découragés. Les cours et l'instrument représentent également une dépense importante que toutes les familles ne peuvent pas assumer. Répéter chez soi peut enfin déranger les voisins. Pour ceux qui disposent de peu de temps libre, d'autres loisirs procurent un plaisir comparable pour un effort bien moindre."),

    ("Culture, Loisirs & Voyages", "Les salaires des sportifs professionnels",
     "Les salaires très élevés de certains sportifs choquent une grande partie du public. Il semble difficile de justifier qu'un joueur gagne en une semaine ce qu'une infirmière met des années à percevoir, alors que son métier n'a aucune utilité vitale. Ces sommes proviennent en partie de droits de diffusion payés indirectement par les spectateurs. Une meilleure répartition permettrait de financer le sport amateur et les équipements dans les quartiers.",
     "D'autres rappellent que ces carrières sont extrêmement courtes et fragiles. Un athlète de haut niveau s'entraîne depuis l'enfance, subit une pression constante et peut voir sa carrière s'arrêter brutalement à la suite d'une blessure. Les rares sportifs très bien payés génèrent par ailleurs des revenus considérables pour leur club, les diffuseurs et les commerces liés. Dans un marché où le public accepte de payer pour les voir, ces salaires suivent simplement la valeur créée."),

    ("Culture, Loisirs & Voyages", "Visiter son propre pays",
     "Beaucoup de personnes connaissent mieux les capitales étrangères que leur propre région. Voyager près de chez soi coûte pourtant nettement moins cher, ne demande ni billet d'avion ni formalités et pollue beaucoup moins. On y découvre des paysages, des monuments et des traditions souvent méconnus, tout en faisant vivre l'économie locale. Ces séjours courts sont enfin possibles plusieurs fois par an, alors qu'un grand voyage se prépare longtemps à l'avance.",
     "Partir à l'étranger apporte cependant quelque chose d'irremplaçable. Découvrir une autre langue, une autre cuisine et d'autres façons de vivre oblige à sortir de ses habitudes et modifie durablement le regard que l'on porte sur son propre pays. Ces voyages sont particulièrement formateurs pour les jeunes et facilitent l'apprentissage des langues. Rester toujours dans la même région, même en la connaissant bien, ne procure pas cette ouverture sur le monde."),

    ("Culture, Loisirs & Voyages", "Les voyages organisés",
     "Les voyages organisés rassurent de nombreux voyageurs. Tout est prévu à l'avance : transport, hébergement, visites et guide, ce qui évite des heures de préparation et les mauvaises surprises sur place. Cette formule convient particulièrement aux personnes âgées, aux familles et à ceux qui ne parlent pas la langue du pays. En cas de problème, un interlocuteur est disponible et les tarifs négociés en groupe restent souvent avantageux.",
     "D'autres voyageurs trouvent ces séjours trop rigides. Le programme impose des horaires stricts, on visite rapidement les sites les plus connus et l'on repart sans avoir vraiment rencontré les habitants. Le groupe reste entre soi et les échanges avec le pays visité demeurent superficiels. Organiser soi-même son voyage coûte souvent moins cher et permet de s'attarder là où l'on se sent bien. Pour découvrir réellement une culture, le voyage indépendant reste préférable."),

    ("Culture, Loisirs & Voyages", "Les films en version originale",
     "Regarder les films dans leur langue d'origine avec des sous-titres présente de vrais avantages. On entend la voix réelle des acteurs, ce qui préserve l'émotion et l'intention des scènes. Cette habitude améliore aussi nettement la compréhension orale d'une langue étrangère : dans les pays qui ne doublent pas les films, la population maîtrise souvent mieux l'anglais. Les sous-titres aident enfin les personnes malentendantes à suivre les dialogues.",
     "Le doublage garde pourtant son utilité. Lire des sous-titres oblige à quitter l'image des yeux et fait perdre une partie du travail visuel du réalisateur. Cette lecture reste difficile pour les jeunes enfants, les personnes âgées et celles qui lisent lentement. Le doublage rend ainsi les œuvres accessibles à un public bien plus large et fait vivre de véritables professionnels. L'idéal serait donc de proposer systématiquement les deux versions et de laisser chacun choisir."),

    ("Culture, Loisirs & Voyages", "Le bénévolat pendant son temps libre",
     "Consacrer quelques heures par semaine à une association apporte beaucoup, aux autres comme à soi-même. Le bénévolat permet d'aider concrètement des personnes en difficulté, de rencontrer des gens très différents et de sortir de son cercle habituel. Il donne aussi un sentiment d'utilité que le travail ne procure pas toujours et permet d'acquérir des compétences appréciées par les employeurs. De nombreuses associations ne fonctionneraient tout simplement pas sans ces bénévoles.",
     "D'autres personnes considèrent que le temps libre doit d'abord servir à se reposer. Après une semaine de travail et des responsabilités familiales, ajouter un engagement régulier peut devenir une charge de plus et conduire à l'épuisement. Certains s'inquiètent également de voir des bénévoles remplacer des emplois qui devraient être rémunérés, dans des services que les pouvoirs publics ont cessé de financer. S'engager doit donc rester un choix libre et adapté à la situation de chacun."),

    ("Culture, Loisirs & Voyages", "Les loisirs sans écran",
     "Les jeux de société, le bricolage ou la randonnée connaissent un vrai regain d'intérêt. Ces activités réunissent réellement les personnes autour d'une table ou sur un chemin, sans notifications ni écrans qui interrompent la conversation. Elles développent la patience, la stratégie et la coopération, et conviennent à tous les âges, ce qui les rend idéales en famille. Après des journées passées devant un ordinateur, elles offrent enfin un repos précieux pour les yeux et l'attention.",
     "Opposer systématiquement les écrans aux autres loisirs paraît cependant excessif. De nombreux jeux vidéo se jouent à plusieurs, exigent de la stratégie et permettent de garder le contact avec des amis éloignés. Les écrans donnent également accès à des documentaires, des cours et des créations impossibles à trouver autrement. Ce qui compte est l'équilibre et la qualité de ce que l'on fait, plutôt que le support utilisé pour se divertir."),

    ("Culture, Loisirs & Voyages", "Photographier ses voyages",
     "Photographier ce que l'on découvre en voyage est parfaitement légitime. Les images fixent des souvenirs qui s'effaceraient avec le temps et permettent de les partager avec sa famille et ses amis restés loin. Chercher un bon cadrage oblige aussi à observer attentivement un lieu, ses détails et sa lumière, donc à mieux le regarder. Ces photographies constituent enfin une mémoire précieuse que l'on prend plaisir à revoir des années plus tard.",
     "D'autres voyageurs trouvent que l'appareil s'interpose entre le visiteur et le lieu. Certaines personnes traversent un site célèbre en cherchant seulement la bonne photo, sans jamais s'arrêter pour observer ou écouter. Devant les monuments les plus connus, la foule qui se prend en photo gâche l'expérience de tous. Les images s'accumulent enfin sans être jamais regardées. Ranger son téléphone quelques heures permet souvent de garder un souvenir plus fort que n'importe quel cliché."),

    ("Culture, Loisirs & Voyages", "Assister aux matchs ou les regarder à la télévision",
     "Regarder le sport à la télévision présente de nombreux avantages. C'est beaucoup moins cher qu'un billet, on ne perd pas de temps en déplacement et l'on profite des ralentis, des commentaires et de plusieurs angles de caméra. Cette formule permet de suivre des compétitions organisées à l'autre bout du monde et de réunir des amis à la maison. Elle convient enfin parfaitement aux familles avec de jeunes enfants et aux personnes à mobilité réduite.",
     "L'ambiance d'un stade ne se retrouve pourtant nulle part ailleurs. Le bruit de la foule, les chants et l'émotion partagée par des milliers de personnes créent un souvenir que l'écran ne restitue pas. Sur place, on observe l'ensemble du terrain et le jeu qui se construit, alors que la caméra impose son cadrage. La présence du public fait enfin vivre les clubs, en particulier les plus modestes. Assister à un match reste donc une expérience irremplaçable."),

    ("Culture, Loisirs & Voyages", "Apprendre la langue du pays avant de partir",
     "Apprendre quelques bases de la langue avant un voyage change complètement l'expérience. Pouvoir saluer, commander un repas ou demander son chemin ouvre immédiatement les échanges avec les habitants, qui apprécient cet effort. Cela permet aussi de comprendre les panneaux, les horaires et les consignes de sécurité, donc de voyager plus sereinement. On accède enfin à des lieux et à des conversations que les visiteurs entièrement dépendants d'un traducteur ne connaîtront jamais.",
     "D'autres voyageurs jugent cet apprentissage peu réaliste. Il est impossible d'étudier sérieusement une langue pour un séjour d'une semaine, et beaucoup de personnes changent de destination chaque année. Les applications de traduction instantanée fonctionnent aujourd'hui très bien pour les situations courantes, et l'anglais suffit dans la plupart des lieux touristiques. Exiger de maîtriser la langue reviendrait à décourager des voyages qui restent enrichissants même sans elle."),

    # ==================================================================
    # THÈME 8 — SOCIÉTÉ, FAMILLE & CONSOMMATION
    # ==================================================================
    ("Société, Famille & Consommation", "Les grands-parents et la garde des enfants",
     "Confier ses enfants à leurs grands-parents présente de nombreux avantages. Les parents économisent des frais de garde très élevés et savent que leurs enfants sont entourés de personnes qui les aiment. Les grands-parents transmettent des histoires familiales, une langue et des traditions que la crèche ne transmet pas. Ces moments partagés créent enfin des liens très forts entre les générations et rompent la solitude de nombreuses personnes âgées.",
     "Cette organisation ne convient pourtant pas à toutes les familles. S'occuper de jeunes enfants plusieurs jours par semaine est fatigant, et certains grands-parents n'osent pas refuser par peur de décevoir. Les méthodes d'éducation diffèrent aussi d'une génération à l'autre, ce qui provoque des tensions sur les repas, les écrans ou les horaires. La crèche apporte enfin aux enfants une vie en collectivité et un éveil que le cadre familial ne remplace pas toujours."),

    ("Société, Famille & Consommation", "L'argent de poche",
     "Donner régulièrement une petite somme à un enfant est un excellent outil éducatif. Il apprend ainsi à comparer les prix, à attendre pour s'offrir quelque chose et à comprendre qu'un budget est limité. Ces expériences, faites avec de petites sommes, évitent bien des difficultés financières à l'âge adulte. Disposer de son propre argent donne également à l'enfant une autonomie et une confiance qu'il ne développe pas s'il doit demander pour chaque achat.",
     "D'autres parents préfèrent ne pas verser d'argent de poche fixe. Ils craignent que l'enfant considère cette somme comme un dû, sans lien avec le travail réel que représente le revenu familial. Certains estiment aussi qu'il vaut mieux discuter chaque achat, ce qui donne l'occasion d'expliquer le prix des choses. Toutes les familles n'ont enfin pas les moyens de verser cette somme régulièrement, et les comparaisons entre camarades peuvent devenir blessantes."),

    ("Société, Famille & Consommation", "Le mariage est-il encore nécessaire ?",
     "Le mariage garde une utilité réelle, au-delà de la cérémonie. Il offre une protection juridique importante en matière d'héritage, de logement et de pension, en particulier lorsqu'un des conjoints a réduit son activité pour élever les enfants. Il rassemble aussi les deux familles autour d'un engagement public et reste, dans de nombreuses cultures, un repère essentiel. Pour beaucoup de couples, cette démarche donne un cadre clair à une vie commune.",
     "D'autres considèrent que le mariage n'est plus indispensable. De nombreux couples vivent ensemble et élèvent leurs enfants sans acte officiel, et les législations reconnaissent de mieux en mieux ces situations. Un contrat n'a par ailleurs jamais garanti la solidité d'une relation, comme le montre le nombre de divorces. Les cérémonies représentent enfin une dépense considérable. Ce qui compte est l'engagement réel des deux personnes, pas le document qui l'accompagne."),

    ("Société, Famille & Consommation", "Rendre le vote obligatoire",
     "Rendre le vote obligatoire renforcerait la démocratie. Lorsque la participation est faible, les responsables élus ne représentent qu'une partie de la population, souvent la plus âgée et la plus aisée. Une participation générale obligerait les candidats à s'adresser à tous les citoyens, y compris à ceux qui s'abstiennent aujourd'hui. Dans les pays qui appliquent cette règle, la participation dépasse largement quatre-vingts pour cent et les résultats reflètent mieux l'ensemble de la société.",
     "D'autres estiment que contraindre les citoyens n'a guère de sens. Voter est un droit, et refuser de le faire constitue aussi une manière d'exprimer son désaccord avec l'offre politique proposée. Obliger des personnes peu informées à se prononcer risque de produire des votes choisis au hasard. L'abstention traduit surtout une perte de confiance : il vaudrait mieux s'attaquer à ses causes, améliorer l'éducation civique et faciliter concrètement l'accès au vote."),

    ("Société, Famille & Consommation", "Acheter à crédit",
     "Le crédit permet à de nombreux ménages d'accéder à des biens autrement inaccessibles. Sans emprunt, presque personne ne pourrait acheter un logement ou remplacer une voiture indispensable pour aller travailler. Étaler le paiement sur plusieurs mois évite aussi de vider une épargne nécessaire en cas d'imprévu. Utilisé avec prudence et pour des achats durables, le crédit constitue donc un outil financier utile et parfaitement raisonnable.",
     "Le crédit facile provoque cependant de graves difficultés. Les paiements en plusieurs fois proposés lors du moindre achat en ligne encouragent à dépenser au-delà de ses moyens, et l'accumulation de petites mensualités devient vite ingérable. Les taux appliqués aux crédits à la consommation sont souvent très élevés, si bien qu'un produit finit par coûter beaucoup plus cher. De nombreux ménages surendettés ont commencé par des achats qui semblaient anodins."),

    ("Société, Famille & Consommation", "Les maisons de retraite",
     "Les établissements spécialisés apportent aux personnes âgées dépendantes une prise en charge que la famille ne peut pas assurer. Du personnel formé est présent jour et nuit, les soins sont réguliers et les locaux sont adaptés aux difficultés de déplacement. Les résidents y trouvent aussi une vie sociale et des activités, alors qu'ils resteraient parfois seuls toute la journée chez eux. Cette solution évite enfin l'épuisement des proches aidants.",
     "Beaucoup de familles préfèrent malgré tout garder leurs parents à la maison le plus longtemps possible. Quitter son logement et ses habitudes est une épreuve douloureuse, et certains établissements manquent de personnel pour accompagner correctement chaque résident. Le coût mensuel dépasse par ailleurs les revenus de nombreuses familles. Avec des aides à domicile et quelques aménagements, il est souvent possible de rester chez soi dans de bonnes conditions."),

    ("Société, Famille & Consommation", "Les grandes journées de soldes",
     "Les grandes opérations commerciales rendent service à beaucoup de consommateurs. Elles permettent d'acheter à prix réduit un appareil ou des vêtements dont on a réellement besoin, et de nombreuses familles attendent ces périodes pour équiper la maison. Les commerçants écoulent leurs stocks et attirent des clients pendant des mois habituellement creux. Avec un peu de préparation et une liste précise, ces journées représentent donc une véritable économie.",
     "Ces opérations encouragent pourtant une consommation déraisonnable. La pression du compte à rebours et des promotions annoncées pousse à acheter des objets dont personne n'avait besoin la veille, et certaines réductions sont calculées sur des prix artificiellement augmentés. Ces achats massifs produisent d'énormes quantités d'emballages, de livraisons et de retours. Chaque année, une part importante des produits achetés lors de ces journées finit inutilisée au fond d'un placard."),

    ("Société, Famille & Consommation", "Le partage des tâches ménagères",
     "Le partage équitable des tâches domestiques devrait aller de soi dans un couple où les deux personnes travaillent. Les enquêtes montrent pourtant que les femmes assurent encore la plus grande part du ménage, des repas et de l'organisation familiale, ce qui limite leur temps de repos et leur progression professionnelle. Un partage réel améliore l'équilibre du couple et donne aux enfants un exemple précieux pour leur propre vie d'adulte.",
     "D'autres estiment que l'égalité stricte n'a pas toujours de sens. Dans certains foyers, une personne travaille bien plus d'heures ou rentre très tard, et il paraît logique que l'autre prenne davantage en charge la maison. Chacun a par ailleurs des compétences et des goûts différents, et une répartition selon les préférences fonctionne souvent mieux qu'un partage comptable. L'essentiel est que l'organisation soit choisie ensemble et acceptée par les deux personnes."),

    ("Société, Famille & Consommation", "Avoir des enfants tôt ou plus tard",
     "Devenir parent assez jeune présente plusieurs avantages. On dispose de davantage d'énergie pour s'occuper de jeunes enfants et l'écart d'âge favorise une relation complice. Les grands-parents sont encore actifs et peuvent aider concrètement. Les parents retrouvent également une plus grande liberté alors qu'ils sont encore jeunes, ce qui leur permet de reprendre des études ou de développer leur carrière une fois les enfants plus autonomes.",
     "Attendre quelques années offre pourtant d'autres avantages. Un couple plus âgé possède généralement une situation professionnelle stable, un logement adapté et une expérience de vie qui aide à affronter les difficultés. Les études et les débuts de carrière ne sont pas interrompus au moment le plus décisif. Ce choix dépend enfin de nombreux facteurs personnels et médicaux, et il serait injuste de juger des parents sur l'âge auquel ils ont fondé leur famille."),

    ("Société, Famille & Consommation", "Offrir de l'argent en cadeau",
     "Offrir de l'argent est souvent la solution la plus utile. La personne choisit exactement ce dont elle a besoin, ce qui évite les objets inutilisés et les échanges après les fêtes. Pour un mariage, un déménagement ou un projet d'études, cette aide est bien plus précieuse qu'un cadeau matériel. Dans de nombreuses cultures, remettre une somme lors des grandes occasions constitue d'ailleurs une tradition parfaitement respectée.",
     "D'autres trouvent ce geste trop impersonnel. Un cadeau choisi montre que l'on a réfléchi aux goûts de la personne, et c'est cette attention qui touche vraiment, bien plus que la valeur du présent. Remettre une somme peut également créer une gêne, chacun comparant ce qu'il a donné ou reçu. Un objet, même modeste, garde enfin un souvenir attaché, alors que l'argent se mêle aux dépenses courantes et s'oublie aussitôt."),

    ("Société, Famille & Consommation", "Le congé parental des pères",
     "Les pères devraient bénéficier d'un congé parental aussi long que les mères. Les premières semaines sont décisives pour créer le lien avec l'enfant et apprendre à s'en occuper réellement, pas seulement à aider. Un congé plus équilibré réduit également la fatigue de la mère et rééquilibre les tâches à long terme. Il limite enfin la discrimination à l'embauche, puisque les employeurs ne pourraient plus supposer que seules les femmes s'absenteront.",
     "Cette mesure soulève cependant des difficultés concrètes. Elle représente un coût élevé pour les finances publiques et pose de réels problèmes d'organisation aux petites entreprises, qui doivent remplacer deux salariés au lieu d'un. De nombreux pères hésitent en outre à prendre ce congé par crainte de nuire à leur carrière, si bien que le dispositif reste peu utilisé là où il existe. Un accompagnement des entreprises et un changement des mentalités sont donc indispensables."),

    ("Société, Famille & Consommation", "La publicité destinée aux enfants",
     "De nombreux pays souhaitent interdire la publicité qui vise directement les enfants. Avant un certain âge, un enfant ne comprend pas qu'un message cherche à lui vendre quelque chose et le reçoit comme une information. Ces publicités portent souvent sur des produits sucrés ou des jouets coûteux et créent des tensions dans les familles. Protéger les plus jeunes de cette pression commerciale relève donc d'une simple précaution.",
     "D'autres considèrent qu'une interdiction générale serait excessive et peu efficace. Les enfants voient de toute façon des publicités partout, y compris à travers les vidéos et les recommandations en ligne, difficiles à encadrer. Ces recettes financent par ailleurs des programmes et des contenus éducatifs de qualité. Apprendre très tôt aux enfants à reconnaître une publicité et à garder un regard critique les préparerait mieux qu'une interdiction qu'ils contourneront ailleurs."),

    ("Société, Famille & Consommation", "Épargner ou profiter de son argent",
     "Mettre régulièrement de l'argent de côté est une véritable sécurité. Une réserve permet de faire face à une panne, à une perte d'emploi ou à un problème de santé sans devoir emprunter à des conditions coûteuses. L'épargne rend également possibles les projets importants : études, logement, création d'entreprise. Commencer tôt, même avec de petites sommes, produit des effets considérables sur le long terme et permet d'aborder l'avenir plus sereinement.",
     "D'autres estiment qu'il ne faut pas tout sacrifier à l'avenir. Un voyage fait à trente ans, un instrument, une formation qui passionne n'ont pas la même valeur vingt ans plus tard, et la santé ou les circonstances ne sont jamais garanties. Épargner de manière excessive peut aussi devenir une source d'angoisse permanente. L'équilibre consiste donc à se constituer une réserve raisonnable tout en s'autorisant à profiter du présent."),

    ("Société, Famille & Consommation", "Aider financièrement ses proches",
     "Soutenir financièrement sa famille est un devoir naturel pour beaucoup de personnes. Aider un parent âgé, un frère au chômage ou financer les études d'un proche permet d'éviter des situations très difficiles, surtout là où les aides publiques sont limitées. De nombreuses personnes installées à l'étranger envoient ainsi régulièrement de l'argent à leur famille. Cette solidarité renforce les liens et chacun sait qu'il pourra compter sur les autres en cas de coup dur.",
     "Cette aide peut cependant devenir un poids très lourd. Certaines personnes s'imposent des sacrifices importants et renoncent à leurs propres projets, sans jamais oser refuser une demande. L'argent introduit également des tensions durables dans les familles, notamment lorsqu'un prêt n'est pas remboursé ou que l'effort n'est pas réparti équitablement. Aider suppose donc de fixer des limites claires et de ne pas mettre en danger son propre équilibre financier."),

    ("Société, Famille & Consommation", "Les vêtements de marque",
     "Acheter des vêtements de marque n'est pas seulement une question d'apparence. Ces produits sont souvent mieux coupés, fabriqués avec de meilleurs tissus et durent bien plus longtemps que des articles bon marché remplacés chaque saison. Payer davantage une seule fois revient donc parfois moins cher sur plusieurs années. Certaines marques garantissent en outre des conditions de fabrication correctes, ce que les vêtements les moins chers ne permettent presque jamais.",
     "D'autres estiment que le prix de ces articles ne correspond à rien de réel. Une grande partie de la somme paie la publicité et l'image, non la qualité, et de nombreux produits sortent des mêmes usines que des articles bien moins chers. Cette pression est particulièrement forte chez les adolescents, pour qui la marque devient un critère d'intégration et pèse lourdement sur le budget des familles. Savoir choisir un vêtement solide compte davantage que l'étiquette qu'il porte."),
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
    allowed = (not t.is_premium) or is_premium(user)
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
    # The reloader keeps a watcher process alive and restarts the server on any
    # file touch under /app. In production that spends memory a small VM needs
    # elsewhere and can drop a request mid-grade, so it stays a dev-only tool.
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=not IS_PROD)