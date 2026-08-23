"""Import server.py without a database, and with known billing settings.

server.py reads its configuration at import time, so the environment has to be
set before the module is touched. Nothing here connects to Postgres: the engine
is created lazily and these tests exercise pure functions only.

The values below are fixtures, not production settings — the fee rate and the
webhook secret are pinned so the arithmetic and signature tests assert against
a known answer rather than whatever happens to be in .env.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DATABASE_URL",
                      "postgresql://test:test@127.0.0.1:5432/test_never_used")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-at-least-32-chars-long")
os.environ.setdefault("ENV", "development")
os.environ.setdefault("CASHFREE_WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("INTERNATIONAL_CARD_FEE_PERCENT", "2.99")
os.environ.setdefault("TAX_PERCENT", "0")
os.environ.setdefault("BILLING_CURRENCY", "USD")

import server  # noqa: E402  (must follow the environment setup above)


def pytest_report_header(config):
    return (f"server.py imported from {BACKEND}  |  "
            f"fee {server.INTERNATIONAL_CARD_FEE_PERCENT}%  |  "
            f"tax {server.TAX_PERCENT}%")
