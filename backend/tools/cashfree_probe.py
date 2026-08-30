"""Exercise the Cashfree integration end to end, without charging anyone.

    cd backend
    CASHFREE_ENV=sandbox \
    CASHFREE_APP_ID=... CASHFREE_SECRET_KEY=... \
    python tools/cashfree_probe.py

Every step prints what Cashfree actually answered, so a failure names itself
instead of surfacing later as "payment doesn't work".

Refuses to touch production credentials unless --production is passed, and
even then it only reads: it never creates a subscription outside sandbox.

The question this exists to settle
----------------------------------
Whether a card issued in Canada or the US can be enrolled in a Cashfree
subscription mandate charged in USD. "International payments enabled" is a
different permission and does not answer it. Step 4 asks Cashfree directly, in
the only way that gets a real answer: by trying it.
"""
import argparse
import json
import os
import sys
import time
import uuid

import requests


def _load_local_env(path=".env.cashfree"):
    """Read credentials from a gitignored file beside the backend, if present.

    This exists so nobody is tempted to paste keys into this script. It is a
    tracked source file: a key typed here reaches GitHub on the next commit,
    and once it is in git history the only real remedy is rotating the key.

    `.env.cashfree` matches the `.env.*` rule already in .gitignore, so it
    cannot be committed by accident. Real environment variables still win, so
    a one-off run can override the file without editing it.
    """
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    full = os.path.join(here, path)
    if not os.path.exists(full):
        return
    for line in open(full, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_local_env()

APP_ID = os.environ.get("CASHFREE_APP_ID", "")
SECRET = os.environ.get("CASHFREE_SECRET_KEY", "")
ENV = os.environ.get("CASHFREE_ENV", "sandbox").lower()
API_VERSION = os.environ.get("CASHFREE_API_VERSION", "2025-01-01")
CURRENCY = os.environ.get("BILLING_CURRENCY", "USD")
BASE = os.environ.get(
    "CASHFREE_BASE_URL",
    "https://api.cashfree.com/pg" if ENV in {"production", "prod"}
    else "https://sandbox.cashfree.com/pg")

PASS, FAIL, INFO = "PASS", "FAIL", "    "
failures = 0


def say(status, label, detail=""):
    global failures
    if status == FAIL:
        failures += 1
    print(f"  {status:5} {label:44} {detail}")


def stop_if_auth_failed(code, body):
    """A rejected key answers nothing except "the key is wrong".

    This exists because an earlier version of this script reported a 401 on
    the plan-creation step as "plan in USD REFUSED - this is the answer to the
    currency question". It was not. Cashfree never looked at the currency; it
    refused the credentials and stopped. Reporting a capability verdict from
    an authentication error is worse than reporting nothing.
    """
    if code not in (401, 403):
        return False
    print()
    print(f"  Cashfree rejected the credentials (HTTP {code}).")
    print(f"  It said: {json.dumps(body)[:160]}")
    print()
    print("  Nothing about currencies, plans or mandates has been tested - the")
    print("  request never got past the door. Check, in order:")
    print()
    print("   1. These are SANDBOX keys, not production ones. A sandbox secret")
    print("      starts cfsk_ma_test_ ; production starts cfsk_ma_prod_.")
    print("   2. Sandbox keys exist at all. They are generated separately from")
    print("      production, under Developers -> API Keys with the environment")
    print("      toggle set to Sandbox - having production keys does not create")
    print("      them.")
    print("   3. The app id and secret are from the SAME pair. Mixing the app")
    print("      id of one environment with the secret of another fails exactly")
    print("      like this.")
    print("   4. No stray whitespace or a trailing newline in .env.cashfree.")
    return True


def call(method, path, payload=None):
    """One Cashfree request, with the reply returned whole."""
    url = f"{BASE}{path}"
    headers = {
        "x-client-id": APP_ID,
        "x-client-secret": SECRET,
        "x-api-version": API_VERSION,
        "Content-Type": "application/json",
    }
    try:
        r = requests.request(method, url, headers=headers, json=payload, timeout=30)
    except Exception as exc:  # noqa: BLE001
        return None, {"transport_error": str(exc)[:200]}
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {"raw": r.text[:300]}


def main():
    global failures
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--production", action="store_true",
                    help="allow read-only checks against live credentials")
    args = ap.parse_args()

    live = ENV in {"production", "prod"}
    print(f"environment : {ENV}  ({BASE})")
    print(f"api version : {API_VERSION}")
    print(f"currency    : {CURRENCY}")
    print(f"credentials : app_id {'set' if APP_ID else 'MISSING'}, "
          f"secret {'set' if SECRET else 'MISSING'}\n")

    if not (APP_ID and SECRET):
        print("Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY and run again.")
        return 2
    if live and not args.production:
        print("These are PRODUCTION credentials. Re-run with --production for the\n"
              "read-only checks, or set CASHFREE_ENV=sandbox to test properly.")
        return 2

    # --- 1. do the credentials work at all -------------------------------
    print("1. credentials")
    code, body = call("GET", "/subscriptions?limit=1")
    if code == 200:
        say(PASS, "credentials accepted", f"HTTP {code}")
    elif code in (401, 403):
        say(FAIL, "credentials rejected", f"HTTP {code} {json.dumps(body)[:120]}")
        return 1
    else:
        # A 404 here is fine - not every account exposes the list endpoint.
        # Step 2 establishes whether the credentials actually work.
        say(INFO, "list endpoint answered", f"HTTP {code} (proves nothing yet)")

    # --- 2. what can this account actually do ----------------------------
    print("\n2. account capability")
    code, body = call("GET", "/subscriptions/plans?limit=1")
    if stop_if_auth_failed(code, body):
        return 1
    say(PASS if code in (200, 404) else FAIL, "plans endpoint reachable",
        f"HTTP {code}")
    if code not in (200, 404):
        # Print what Cashfree said. A bare "HTTP 400" here sent someone off to
        # re-check keys that were never the problem: the credentials are fine
        # and the account is refusing to act, which is a different fix. The
        # message names which — "Profile is inactive" means the merchant
        # account is not activated and no key change will help.
        print(f"        Cashfree said: {json.dumps(body)[:300]}")

    if live:
        print("\nProduction credentials: stopping before anything is created.")
        print("Run with CASHFREE_ENV=sandbox to exercise the rest.")
        return 0 if failures == 0 else 1

    # --- 3. a plan in the currency we actually sell in --------------------
    print(f"\n3. create a plan priced in {CURRENCY}")
    plan_id = f"probe_{uuid.uuid4().hex[:10]}"
    code, body = call("POST", "/plans", {
        "plan_id": plan_id,
        "plan_name": "Probe plan (safe to delete)",
        "plan_type": "PERIODIC",
        "plan_currency": CURRENCY,
        "plan_recurring_amount": 1,
        "plan_max_amount": 1,
        "plan_max_cycles": 2,
        "plan_interval_type": "MONTH",
        "plan_intervals": 1,
    })
    if code in (200, 201):
        say(PASS, f"plan created in {CURRENCY}", plan_id)
    elif stop_if_auth_failed(code, body):
        return 1
    else:
        say(FAIL, f"plan in {CURRENCY} REFUSED", f"HTTP {code} {json.dumps(body)[:200]}")
        print(f"\n  ^ This is the answer to the currency question. If Cashfree will\n"
              f"    not hold a plan in {CURRENCY}, it cannot charge a card in it either.")
        return 1

    # --- 4. the question that actually matters ---------------------------
    print("\n4. enrol a card mandate (the international recurring question)")
    sub_id = f"probe_sub_{uuid.uuid4().hex[:8]}"
    code, body = call("POST", "/subscriptions", {
        "subscription_id": sub_id,
        "customer_details": {
            "customer_name": "Probe Customer",
            "customer_email": "probe@example.com",
            "customer_phone": "+15145550123",   # a Canadian number, on purpose
        },
        "plan_details": {"plan_id": plan_id},
        "authorization_details": {
            "authorization_amount": 1,
            "authorization_amount_refund": True,
            "payment_methods": ["card"],
        },
        "subscription_meta": {
            "return_url": "https://prepfrancais.com/billing/return?sub=" + sub_id,
        },
    })
    if code in (200, 201):
        link = (body.get("authorization_link") or body.get("authorisation_link")
                or body.get("subscription_link"))
        say(PASS, "subscription mandate created", sub_id)
        say(INFO, "authorisation link", (link or "(none returned)")[:70])
        print("\n  Open that link and pay with a Cashfree TEST CARD to finish the")
        print("  flow. The webhook is what grants premium - watch the backend log.")
        print("  If the link refuses a non-Indian card, that is the answer you")
        print("  have been waiting for, and it arrives here rather than from a")
        print("  customer whose payment failed.")
    else:
        say(FAIL, "mandate creation refused", f"HTTP {code}")
        print(f"\n  Cashfree said: {json.dumps(body)[:400]}")
        print("\n  This is the answer. A mandate that cannot be created cannot be")
        print("  charged. If the message mentions the currency, the phone number's")
        print("  country, or international payments, that names what to ask them to")
        print("  enable - or tells you the products need to become one-time orders.")

    print(f"\n{'-' * 62}")
    print("Nothing here charged anyone. The plan and subscription above are")
    print("sandbox objects and can be left or deleted.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
