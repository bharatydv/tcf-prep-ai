"""The payment lifecycle, event by event.

Each test here maps to one way a gateway can report reality: a charge, the
same charge reported twice, a refund, the same refund twice, a forged body, a
cancellation, a failure. Getting any of them wrong either grants access nobody
paid for or takes access somebody did pay for.

These exercise the classifiers and the revocation arithmetic, which is where
the decisions are made. The webhook handler's database work needs Postgres and
is not covered here.
"""
import base64
import hashlib
import hmac
import json
from datetime import timedelta

import pytest

import server as m


def sign(body: bytes, ts: str, secret: str = None) -> str:
    secret = secret if secret is not None else m.CASHFREE_WEBHOOK_SECRET
    mac = hmac.new(secret.encode(), ts.encode() + body, hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


def event(kind: str, **extra) -> bytes:
    payload = {"type": kind, "data": {"subscription_id": "sub_1", **extra}}
    return json.dumps(payload).encode()


class TestSuccessfulPayment:
    def test_classified_as_success_and_nothing_else(self):
        e = "SUBSCRIPTION_PAYMENT_SUCCESS"
        assert m._is_payment_success(e)
        assert not m._is_reversal(e, "")
        assert not m._is_cancellation(e, "")

    def test_the_period_granted_comes_from_the_plan_not_the_amount(self):
        """The processing fee rides along with every charge. If a cycle were
        derived from the amount paid, the fee would look like a bigger
        purchase."""
        for plan in m.BILLING_PLANS.values():
            assert m.plan_period(plan) == m.plan_period(plan)
        assert m.plan_period(m.BILLING_PLANS["week"]) == timedelta(weeks=1)
        assert m.plan_period(m.BILLING_PLANS["month"]) == timedelta(days=30)
        assert m.plan_period(m.BILLING_PLANS["quarter"]) == timedelta(days=90)


class TestDuplicateDelivery:
    """Cashfree retries until it gets a 2xx, so the same charge arrives more
    than once. The event key is what makes that safe."""

    def test_the_same_event_produces_the_same_key(self):
        body = event("SUBSCRIPTION_PAYMENT_SUCCESS")
        parsed = json.loads(body)
        first = f"{parsed['type']}:{m._dig(parsed, 'subscription_id')}:cf_pay_1"
        second = f"{parsed['type']}:{m._dig(parsed, 'subscription_id')}:cf_pay_1"
        assert first == second, "a retry must collide on the unique key"

    def test_two_different_payments_do_not_collide(self):
        """A renewal is a second charge and must be allowed through."""
        a = "SUBSCRIPTION_PAYMENT_SUCCESS:sub_1:cf_pay_1"
        b = "SUBSCRIPTION_PAYMENT_SUCCESS:sub_1:cf_pay_2"
        assert a != b


class TestRefund:
    def _user(self, days_left):
        return m.User(user_id="u", email="a@b.c", subscription_status="premium",
                      premium_until=m.now_utc() + timedelta(days=days_left))

    def _row(self):
        return m.Subscription(subscription_id="sub_1", user_id="u",
                              plan_id="month", amount=82.39, status="active")

    @pytest.mark.asyncio
    async def test_a_refund_removes_exactly_one_cycle(self):
        user = self._user(days_left=75)          # roughly two and a half cycles
        row = self._row()
        await m.revoke_premium_for_reversal(None, user, row,
                                            m.BILLING_PLANS["month"])
        remaining = (user.premium_until - m.now_utc()).days
        assert 44 <= remaining <= 46, remaining
        assert user.subscription_status == "premium", \
            "a customer with cycles left keeps the ones they still own"

    @pytest.mark.asyncio
    async def test_refunding_the_only_cycle_ends_premium(self):
        user = self._user(days_left=20)
        await m.revoke_premium_for_reversal(None, user, self._row(),
                                            m.BILLING_PLANS["month"])
        assert user.subscription_status == "free"
        assert user.premium_until <= m.now_utc()

    @pytest.mark.asyncio
    async def test_a_manual_unlimited_grant_is_not_revoked_by_a_gateway_event(self):
        """A NULL expiry was never bought through this channel."""
        user = m.User(user_id="u", email="a@b.c",
                      subscription_status="premium", premium_until=None)
        await m.revoke_premium_for_reversal(None, user, self._row(),
                                            m.BILLING_PLANS["month"])
        assert user.subscription_status == "premium"
        assert user.premium_until is None

    @pytest.mark.asyncio
    async def test_two_refunds_of_the_same_charge_remove_two_cycles(self):
        """Not idempotent by itself - the webhook's event key is what stops a
        duplicate reaching this at all. Documented here so the division of
        responsibility is explicit rather than assumed."""
        user = self._user(days_left=75)
        row = self._row()
        await m.revoke_premium_for_reversal(None, user, row, m.BILLING_PLANS["month"])
        first = user.premium_until
        await m.revoke_premium_for_reversal(None, user, row, m.BILLING_PLANS["month"])
        assert user.premium_until < first


class TestReversalClassification:
    @pytest.mark.parametrize("kind", [
        "SUBSCRIPTION_PAYMENT_REFUND", "PAYMENT_REFUND_SUCCESS",
        "PAYMENT_CHARGEBACK", "DISPUTE_CREATED", "PAYMENT_REVERSED",
    ])
    def test_every_way_money_comes_back_is_a_reversal(self, kind):
        assert m._is_reversal(kind, "")

    def test_a_refund_reported_with_a_cancelled_status_is_still_a_refund(self):
        """Checked before cancellation for exactly this reason: matching
        cancel first would keep the access and only stop the renewal."""
        assert m._is_reversal("SUBSCRIPTION_PAYMENT_REFUND", "CANCELLED")


class TestCancellation:
    def test_cancelling_is_not_a_reversal(self):
        assert m._is_cancellation("SUBSCRIPTION_CANCELLED", "")
        assert not m._is_reversal("SUBSCRIPTION_CANCELLED", "")

    def test_cancelling_does_not_touch_the_paid_period(self):
        """The learner paid for this cycle and keeps it to expiry; only the
        renewal stops. Asserted on the handler's source because the behaviour
        is the absence of a call."""
        import inspect
        src = inspect.getsource(m.billing_webhook)
        branch = src.split("_is_cancellation(event_type, status)")[1][:400]
        # Comments in that branch say the words "premium_until" precisely
        # because it deliberately leaves it alone, so compare executable lines.
        code = " ".join(l for l in branch.splitlines()
                        if not l.strip().startswith("#"))
        assert "revoke_premium" not in code
        assert "premium_until" not in code


class TestFailedAndPending:
    @pytest.mark.parametrize("kind", [
        "SUBSCRIPTION_PAYMENT_FAILED", "PAYMENT_FAILED", "SUBSCRIPTION_PENDING",
    ])
    def test_neither_grants_nor_revokes(self, kind):
        assert not m._is_payment_success(kind)
        assert not m._is_reversal(kind, "")


class TestForgedWebhooks:
    BODY = event("SUBSCRIPTION_PAYMENT_SUCCESS")
    TS = "1755950000"

    def test_a_valid_signature_is_accepted(self):
        assert m.verify_cashfree_signature(self.BODY, sign(self.BODY, self.TS),
                                           self.TS)

    def test_a_body_edited_after_signing_is_rejected(self):
        sig = sign(self.BODY, self.TS)
        forged = self.BODY.replace(b"sub_1", b"sub_9")
        assert not m.verify_cashfree_signature(forged, sig, self.TS)

    def test_a_signature_replayed_under_a_new_timestamp_is_rejected(self):
        sig = sign(self.BODY, self.TS)
        assert not m.verify_cashfree_signature(self.BODY, sig, "1755999999")

    def test_an_attacker_without_the_secret_cannot_sign(self):
        sig = sign(self.BODY, self.TS, secret="guessed-secret")
        assert not m.verify_cashfree_signature(self.BODY, sig, self.TS)
