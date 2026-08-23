"""Drive the payment grant path without a gateway.

    python tools/webhook_replay.py --api http://127.0.0.1:15000

Cashfree's part of a payment is the checkout page. Everything that decides
what a customer actually gets happens afterwards, when the signed webhook
arrives: premium is granted, an invoice is issued, a duplicate is ignored, a
refund takes the access back. None of that needs Cashfree to be reachable -
only a correctly signed body - so it can be exercised here, in full, instead
of being discovered in production.

What it does
------------
1. Registers a throwaway learner through the real API.
2. Inserts a pending subscription for them (the row /billing/subscribe would
   have written after Cashfree accepted the mandate).
3. Sends a correctly signed SUBSCRIPTION_PAYMENT_SUCCESS webhook.
4. Checks: premium granted, expiry set from the PLAN, invoice issued.
5. Sends the same webhook again - nothing should change.
6. Sends a refund webhook - access should be taken back.

Requires the stack to be up and the database reachable, and it writes only to
rows it created.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import uuid

import requests

failures = 0


def check(label, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:46} {detail}")


def sign(body: bytes, ts: str, secret: str) -> str:
    return base64.b64encode(
        hmac.new(secret.encode(), ts.encode() + body, hashlib.sha256).digest()
    ).decode()


def psql(sql: str, container: str, user: str, db: str) -> str:
    """One statement, through the database container."""
    out = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", user, "-d", db,
         "-At", "-c", sql],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:200])
    return out.stdout.strip()


def post_event(api, secret, kind, sub_id, payment_id):
    body = json.dumps({
        "type": kind,
        "data": {"subscription_id": sub_id, "cf_payment_id": payment_id,
                 "payment_amount": "82.39"},
    }).encode()
    ts = str(int(time.time()))
    return requests.post(f"{api}/api/billing/webhook", data=body, headers={
        "Content-Type": "application/json",
        "x-webhook-signature": sign(body, ts, secret),
        "x-webhook-timestamp": ts}, timeout=30)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api", default="http://127.0.0.1:15000")
    ap.add_argument("--container", default="tcf_db")
    ap.add_argument("--db-user", default=os.environ.get("DB_USER", "audit"))
    ap.add_argument("--db-name", default=os.environ.get("DB_NAME", "audit_db"))
    ap.add_argument("--secret", default=os.environ.get(
        "CASHFREE_WEBHOOK_SECRET", "local-audit-webhook-secret"))
    a = ap.parse_args()

    q = lambda sql: psql(sql, a.container, a.db_user, a.db_name)  # noqa: E731

    print("1. a learner, through the real API")
    email = f"replay-{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{a.api}/api/auth/register", json={
        "email": email, "password": "ReplayPass!2026", "name": "Replay"}, timeout=30)
    check("registered", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code != 200:
        return 1
    user_id = q(f"SELECT user_id FROM users WHERE email = '{email}'")
    check("user row exists", bool(user_id), user_id)

    print("\n2. the subscription /billing/subscribe would have written")
    sub_id = f"replay_{uuid.uuid4().hex[:8]}"
    q(f"""INSERT INTO subscriptions
          (subscription_id, user_id, plan_id, status, currency, amount,
           base_amount, fee_percent, fee_amount, tax_amount,
           created_at, updated_at)
          VALUES ('{sub_id}', '{user_id}', 'month', 'pending', 'USD', 82.39,
                  80.0, 2.99, 2.39, 0.0, now(), now())""")
    check("pending subscription inserted", True, sub_id)
    before = q(f"SELECT COALESCE(subscription_status,'free') FROM users WHERE user_id='{user_id}'")
    check("learner starts without premium", before != "premium", f"status={before}")

    print("\n3. a signed payment-success webhook")
    r = post_event(a.api, a.secret, "SUBSCRIPTION_PAYMENT_SUCCESS", sub_id, "cf_replay_1")
    check("accepted", r.status_code == 200, f"HTTP {r.status_code} {r.text[:60]}")

    status = q(f"SELECT subscription_status FROM users WHERE user_id='{user_id}'")
    until = q(f"SELECT premium_until FROM users WHERE user_id='{user_id}'")
    check("premium granted", status == "premium", f"status={status}")
    check("expiry set from the plan", bool(until), f"premium_until={until[:19]}")
    days = q(f"SELECT ROUND(EXTRACT(EPOCH FROM (premium_until - now()))/86400) "
             f"FROM users WHERE user_id='{user_id}'")
    check("one month, not one amount", days in ("30", "29", "31"), f"{days} days")

    sub_status = q(f"SELECT status FROM subscriptions WHERE subscription_id='{sub_id}'")
    check("subscription marked active", sub_status == "active", sub_status)

    inv = q(f"SELECT number || ' ' || total FROM invoices WHERE user_id='{user_id}'")
    check("invoice issued", bool(inv), inv or "none")

    print("\n4. the same webhook again (Cashfree retries until it gets a 2xx)")
    r2 = post_event(a.api, a.secret, "SUBSCRIPTION_PAYMENT_SUCCESS", sub_id, "cf_replay_1")
    check("second delivery is a no-op", r2.json().get("duplicate") is True, r2.text[:60])
    days2 = q(f"SELECT ROUND(EXTRACT(EPOCH FROM (premium_until - now()))/86400) "
              f"FROM users WHERE user_id='{user_id}'")
    check("no second cycle granted", days2 == days, f"{days} -> {days2} days")
    n_inv = q(f"SELECT count(*) FROM invoices WHERE user_id='{user_id}'")
    check("no second invoice", n_inv == "1", f"{n_inv} invoice(s)")

    print("\n5. a refund")
    r3 = post_event(a.api, a.secret, "SUBSCRIPTION_PAYMENT_REFUND", sub_id, "cf_replay_2")
    check("accepted", r3.status_code == 200, f"HTTP {r3.status_code}")
    status3 = q(f"SELECT subscription_status FROM users WHERE user_id='{user_id}'")
    check("access taken back", status3 == "free", f"status={status3}")
    sub3 = q(f"SELECT status FROM subscriptions WHERE subscription_id='{sub_id}'")
    check("subscription marked refunded", sub3 == "refunded", sub3)

    print(f"\n{'-' * 60}")
    print(f"{'all checks passed' if not failures else str(failures) + ' FAILED'}")
    print(f"test data: user {email}, subscription {sub_id}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
