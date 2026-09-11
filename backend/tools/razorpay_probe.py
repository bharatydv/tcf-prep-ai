"""Exercise the Razorpay integration end to end, without charging anyone.

    cd backend
    RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... \
    python tools/razorpay_probe.py

Every step prints what Razorpay actually answered, so a failure names itself
instead of surfacing later as "payment doesn't work".

Creating an order costs nothing and charges nobody - an order is an intent to
collect, and an unpaid one simply expires. So the probe creates one on test
keys, which is the only way to get a real answer about currency support. With
live keys it refuses to create anything unless --production is passed, and
even then the order it makes is never paid.

The questions this exists to settle
-----------------------------------
1. Do these keys authenticate at all, and is the pair from the same mode?
2. Can this account open an order in BILLING_CURRENCY? "International payments
   enabled" is a separate permission and does not answer it. Step 3 asks
   Razorpay directly, in the only way that gets a real answer: by trying it.
3. Is RAZORPAY_WEBHOOK_SECRET the one the dashboard is signing with? Nothing
   here can reach the dashboard, so step 5 verifies the shape locally and
   tells you how to confirm the value itself.
"""
import argparse
import json
import os
import sys
import uuid

import requests


def _load_local_env(path=".env.razorpay"):
    """Read credentials from a gitignored file beside the backend, if present.

    This exists so nobody is tempted to paste keys into this script. It is a
    tracked source file: a key typed here reaches GitHub on the next commit,
    and once it is in git history the only real remedy is rotating the key.

    `.env.razorpay` matches the `.env.*` rule already in .gitignore, so it
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

KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
CURRENCY = os.environ.get("BILLING_CURRENCY", "USD").upper()
BASE = os.environ.get("RAZORPAY_BASE_URL", "https://api.razorpay.com/v1")

PASS, FAIL, WARN, INFO = "PASS", "FAIL", "WARN", "    "
failures = 0


def say(status, label, detail=""):
    global failures
    if status == FAIL:
        failures += 1
    print(f"  {status:5} {label:44} {detail}")


def call(method, path, payload=None):
    """One Razorpay request, with the reply returned whole."""
    try:
        r = requests.request(method, f"{BASE}{path}",
                             auth=(KEY_ID, KEY_SECRET),
                             headers={"Content-Type": "application/json"},
                             json=payload, timeout=30)
    except Exception as exc:  # noqa: BLE001
        return None, {"transport_error": str(exc)[:200]}
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {"raw": r.text[:300]}


def described(body):
    """Razorpay's human-readable half of an error, if there is one."""
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        return err.get("description") or json.dumps(err)[:160]
    return json.dumps(body)[:160]


def stop_if_auth_failed(code, body):
    """A rejected key answers nothing except "the key is wrong".

    Reporting a currency verdict from an authentication error would be worse
    than reporting nothing: Razorpay never looked at the currency, it refused
    the credentials and stopped.
    """
    if code not in (401, 403):
        return False
    print()
    print(f"  Razorpay rejected the credentials (HTTP {code}).")
    print(f"  It said: {described(body)}")
    print()
    print("  Nothing about currencies or orders has been tested - the request")
    print("  never got past the door. Check, in order:")
    print()
    print("   1. The key id and secret are from the SAME pair. Regenerating a")
    print("      key replaces both halves, and mixing an old secret with a new")
    print("      id fails exactly like this.")
    print("   2. They are from the same MODE. A key id beginning rzp_test_ is")
    print("      a Test Mode key and its secret only works in Test Mode;")
    print("      rzp_live_ is Live. The dashboard toggle decides which set the")
    print("      Settings -> API Keys page shows you.")
    print("   3. No stray whitespace or trailing newline in .env.razorpay.")
    print("   4. The account is activated. A Razorpay account that has not")
    print("      completed KYC has Live keys that do not yet authenticate.")
    return True


def main():
    global failures
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--production", action="store_true",
                    help="allow an (unpaid) order to be created with live keys")
    args = ap.parse_args()

    live = KEY_ID.startswith("rzp_live_")
    mode = "LIVE" if live else ("test" if KEY_ID.startswith("rzp_test_")
                                else "unrecognised")
    print(f"base url    : {BASE}")
    print(f"key mode    : {mode}  ({KEY_ID[:12] + '...' if KEY_ID else 'MISSING'})")
    print(f"currency    : {CURRENCY}")
    print(f"credentials : key_id {'set' if KEY_ID else 'MISSING'}, "
          f"secret {'set' if KEY_SECRET else 'MISSING'}\n")

    if not (KEY_ID and KEY_SECRET):
        print("  Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET first.")
        return 2

    # --- 1. the keys authenticate -------------------------------------------
    # Listing orders is the cheapest authenticated read there is: it creates
    # nothing, and an account with no orders answers 200 with an empty list
    # rather than a 404 that would be ambiguous.
    code, body = call("GET", "/orders?count=1")
    if stop_if_auth_failed(code, body):
        return 2
    if code == 200:
        say(PASS, "credentials authenticate",
            f"{body.get('count', 0)} existing order(s) visible")
    else:
        say(FAIL, "credentials authenticate", f"HTTP {code}: {described(body)}")
        return 2

    if mode == "unrecognised":
        say(WARN, "key id has a recognised prefix",
            "expected rzp_test_ or rzp_live_")

    # --- 2. the currency the site is configured to charge in ----------------
    if live and not args.production:
        say(INFO, f"order in {CURRENCY}",
            "skipped - live keys, pass --production to test")
    else:
        probe_id = f"probe_{uuid.uuid4().hex[:10]}"
        code, body = call("POST", "/orders", {
            # One rupee/dollar, in the smallest unit. Never paid.
            "amount": 100,
            "currency": CURRENCY,
            "receipt": probe_id,
            "payment_capture": 1,
            "notes": {"probe": "razorpay_probe.py"},
        })
        if code in (200, 201) and body.get("id"):
            say(PASS, f"order in {CURRENCY}", f"created {body['id']} (unpaid)")
            # The field the webhook handler matches a row on. If this ever
            # stops coming back, checkout still works and every payment
            # afterwards fails to find its subscription.
            if body.get("receipt") == probe_id:
                say(PASS, "receipt echoed back", probe_id)
            else:
                say(FAIL, "receipt echoed back",
                    f"sent {probe_id}, got {body.get('receipt')!r}")
            if (body.get("notes") or {}).get("probe"):
                say(PASS, "notes ride along with the order", "")
            else:
                say(FAIL, "notes ride along with the order",
                    "the webhook finds its row through notes.subscription_id")
        else:
            say(FAIL, f"order in {CURRENCY}", f"HTTP {code}: {described(body)}")
            print()
            print(f"  This account could not open an order in {CURRENCY}.")
            print("  Razorpay accounts are INR by default; charging any other")
            print("  currency needs International Payments enabled AND that")
            print("  specific currency on the account. Either enable it, or")
            print("  set BILLING_CURRENCY to one this account can take -")
            print("  leaving it as it is means every checkout 502s.")

    # --- 3. the webhook secret ----------------------------------------------
    if not WEBHOOK_SECRET:
        say(FAIL, "RAZORPAY_WEBHOOK_SECRET is set",
            "unset - every webhook will be refused with 401")
        print()
        print("  Without it no payment ever grants premium: the money is taken")
        print("  and the account stays on the free trial. It is NOT the API key")
        print("  secret - it is the string you type into Settings -> Webhooks")
        print("  when you create the webhook, and it exists only there and here.")
    elif WEBHOOK_SECRET == KEY_SECRET:
        say(WARN, "RAZORPAY_WEBHOOK_SECRET differs from the key secret",
            "they match - is that really what the dashboard has?")
    else:
        say(PASS, "RAZORPAY_WEBHOOK_SECRET is set", f"{len(WEBHOOK_SECRET)} chars")
    say(INFO, "", "verify it for real by sending a test event from the")
    say(INFO, "", "dashboard and checking the server logs for a 401.")

    # --- 4. what the dashboard must be subscribed to ------------------------
    print()
    print("  Events this server acts on. Subscribe these in the dashboard:")
    print("    payment.captured   grants premium (required)")
    print("    refund.created     takes back exactly the cycle refunded")
    print("    payment.failed     records the failure against the order")
    print("  order.paid may also be subscribed; it is treated as the same")
    print("  payment as payment.captured and cannot double-grant.")
    print("  payment.authorized is ignored on purpose - a hold is not money.")

    print()
    print("  " + ("all checks passed" if not failures
                  else f"{failures} check(s) failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
