"""The money paths.

Every test here guards a case where a bug charges the wrong amount, grants
access nobody paid for, or takes access somebody did pay for.
"""
import base64
import hashlib
import hmac
import json
from datetime import timedelta

import pytest

import server as m


# --------------------------------------------------------------- the fee ---
class TestCheckoutBreakdown:
    """The fee is added to the customer's total, never taken from the plan."""

    @pytest.mark.parametrize("base, fee, total", [
        (80, 2.39, 82.39),      # the worked example from the brief
        (160, 4.78, 164.78),    # the other worked example
        (20, 0.60, 20.60),
        (15, 0.45, 15.45),
        (60, 1.79, 61.79),
        (220, 6.58, 226.58),
    ])
    def test_matches_the_published_arithmetic(self, base, fee, total):
        b = m.checkout_breakdown(base)
        assert b["base_amount"] == base
        assert b["fee_amount"] == fee
        assert b["total"] == total

    def test_total_is_always_base_plus_fee_plus_tax(self):
        for base in (0, 1, 7.77, 19.99, 999.95):
            b = m.checkout_breakdown(base)
            assert b["total"] == pytest.approx(
                b["base_amount"] + b["fee_amount"] + b["tax_amount"], abs=1e-9)

    def test_zero_is_free(self):
        assert m.checkout_breakdown(0)["total"] == 0.0

    def test_tax_is_off_unless_configured(self):
        """GST is not a payment fee and must not appear by default."""
        assert m.checkout_breakdown(80)["tax_amount"] == 0.0
        assert m.checkout_breakdown(80)["tax_percent"] == 0.0

    def test_fee_rate_is_configurable_per_method(self, monkeypatch):
        monkeypatch.setenv("PAYMENT_FEE_PERCENT_UPI", "0")
        assert m.checkout_breakdown(80, "upi")["fee_amount"] == 0.0
        monkeypatch.setenv("PAYMENT_FEE_PERCENT_UPI", "1.5")
        assert m.checkout_breakdown(80, "upi")["fee_amount"] == 1.20

    def test_rate_is_not_hardcoded_in_the_maths(self, monkeypatch):
        monkeypatch.setenv("PAYMENT_FEE_PERCENT_CARD", "10")
        assert m.checkout_breakdown(100, "card")["total"] == 110.0


class TestMoney:
    def test_rounds_half_up_to_the_cent(self):
        assert float(m.money("2.385")) == 2.39
        assert float(m.money("2.384")) == 2.38

    def test_survives_binary_float_noise(self):
        """Decimal(0.1 + 0.2) is 0.30000000000000004; the customer sees 0.30."""
        assert float(m.money(0.1 + 0.2)) == 0.30

    def test_none_is_zero(self):
        assert float(m.money(None)) == 0.0


# ------------------------------------------------------------- the plans ---
class TestPlanPricing:
    def test_first_time_price_is_lower_and_only_for_first_time(self):
        for plan in m.BILLING_PLANS.values():
            standing = m.plan_price(plan, first_time=False)
            intro = m.plan_price(plan, first_time=True)
            assert standing == plan["amount"]
            assert intro <= standing

    def test_cashfree_plan_id_encodes_the_price(self):
        """Cashfree plans are immutable, so a price change must be a new id.

        Without this a price rise silently keeps charging every new subscriber
        the old amount through a plan that still says the old number.
        """
        a = m.cf_plan_id("month", 80.00)
        b = m.cf_plan_id("month", 82.39)
        assert a != b
        assert "80_00" in a and "82_39" in b

    def test_plan_period_matches_what_is_sold(self):
        assert m.plan_period(m.BILLING_PLANS["week"]) == timedelta(weeks=1)
        assert m.plan_period(m.BILLING_PLANS["quarter"]) == timedelta(days=90)


# --------------------------------------------------------- webhook safety ---
def _sign(body: bytes, timestamp: str, secret: str) -> str:
    mac = hmac.new(secret.encode(), timestamp.encode() + body, hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


class TestWebhookSignature:
    BODY = json.dumps({"type": "SUBSCRIPTION_PAYMENT_SUCCESS"}).encode()
    TS = "1755950000"

    def test_accepts_a_correctly_signed_body(self):
        sig = _sign(self.BODY, self.TS, m.CASHFREE_WEBHOOK_SECRET)
        assert m.verify_cashfree_signature(self.BODY, sig, self.TS) is True

    def test_rejects_a_tampered_body(self):
        sig = _sign(self.BODY, self.TS, m.CASHFREE_WEBHOOK_SECRET)
        tampered = self.BODY.replace(b"SUCCESS", b"SUCCES_")
        assert m.verify_cashfree_signature(tampered, sig, self.TS) is False

    def test_rejects_a_replayed_timestamp(self):
        sig = _sign(self.BODY, self.TS, m.CASHFREE_WEBHOOK_SECRET)
        assert m.verify_cashfree_signature(self.BODY, sig, "1755959999") is False

    def test_rejects_a_signature_from_the_wrong_secret(self):
        sig = _sign(self.BODY, self.TS, "not-the-secret")
        assert m.verify_cashfree_signature(self.BODY, sig, self.TS) is False

    @pytest.mark.parametrize("sig, ts", [("", "1"), ("x", ""), ("", "")])
    def test_rejects_missing_parts(self, sig, ts):
        assert m.verify_cashfree_signature(self.BODY, sig, ts) is False


class TestWebhookClassification:
    """Success, cancellation and reversal must never overlap."""

    SUCCESS = ["SUBSCRIPTION_PAYMENT_SUCCESS", "PAYMENT_SUCCESS"]
    CANCEL = ["SUBSCRIPTION_CANCELLED", "SUBSCRIPTION_CANCELLATION"]
    REVERSE = ["SUBSCRIPTION_PAYMENT_REFUND", "PAYMENT_CHARGEBACK",
               "DISPUTE_CREATED", "PAYMENT_REVERSED"]

    @pytest.mark.parametrize("event", SUCCESS)
    def test_success_is_only_success(self, event):
        assert m._is_payment_success(event)
        assert not m._is_reversal(event, "")

    @pytest.mark.parametrize("event", CANCEL)
    def test_cancel_is_not_a_reversal(self, event):
        """Cancelling stops renewal; it must not take back paid-for access."""
        assert m._is_cancellation(event, "")
        assert not m._is_reversal(event, "")

    @pytest.mark.parametrize("event", REVERSE)
    def test_reversal_is_detected(self, event):
        assert m._is_reversal(event, "")
        assert not m._is_payment_success(event)

    def test_a_refund_carrying_a_cancelled_status_is_still_a_refund(self):
        """The real trap: Cashfree sends both words on one event."""
        assert m._is_reversal("SUBSCRIPTION_PAYMENT_REFUND", "CANCELLED")


class TestAmountVerification:
    def _row(self, **kw):
        row = m.Subscription(subscription_id="sub_x", user_id="u_x",
                             plan_id="month", amount=82.39, base_amount=80.0,
                             fee_amount=2.39)
        for k, v in kw.items():
            setattr(row, k, v)
        return row

    def test_reads_the_amount_cashfree_reports(self):
        assert m.verify_paid_amount({"payment_amount": "82.39"},
                                    self._row()) == 82.39

    def test_returns_none_when_no_amount_is_present(self):
        assert m.verify_paid_amount({"type": "X"}, self._row()) is None

    def test_a_mismatch_is_reported_not_swallowed(self, caplog):
        m.verify_paid_amount({"payment_amount": "1.00"}, self._row())
        assert "AMOUNT MISMATCH" in caplog.text


# ---------------------------------------------------------------- access ---
class TestPremiumAccess:
    def _user(self, status, until):
        return m.User(user_id="u", email="a@b.c", subscription_status=status,
                      premium_until=until)

    def test_free_is_not_premium(self):
        assert m.is_premium(self._user("free", None)) is False

    def test_expired_premium_is_not_premium(self):
        past = m.now_utc() - timedelta(days=1)
        assert m.is_premium(self._user("premium", past)) is False

    def test_unexpired_premium_is_premium(self):
        future = m.now_utc() + timedelta(days=1)
        assert m.is_premium(self._user("premium", future)) is True

    def test_null_expiry_is_an_unlimited_grant(self):
        assert m.is_premium(self._user("premium", None)) is True


# --------------------------------------------------------------- invoices ---
class TestInvoice:
    def _invoice(self, **kw):
        now = m.now_utc()
        fields = dict(
            invoice_id="inv_t", number="PF-2026-000001", user_id="u",
            subscription_id="sub_t", plan_id="quarter", plan_name="3 Months",
            currency="USD", base_amount=160.0, fee_percent=2.99,
            fee_amount=4.78, tax_percent=0.0, tax_amount=0.0, tax_label="Tax",
            total=164.78, payment_reference="cf_pay_1",
            period_start=now, period_end=now + timedelta(days=90),
            billed_to_name="Marie Dupont", billed_to_email="marie@example.com",
            issued_at=now)
        fields.update(kw)
        return m.Invoice(**fields)

    def test_renders_a_real_pdf(self):
        pdf = m.render_invoice_pdf(self._invoice())
        assert pdf[:5] == b"%PDF-"
        assert len(pdf) > 800

    def test_email_states_all_three_figures(self):
        """The customer must be able to check the arithmetic themselves."""
        body = m.invoice_email_body(self._invoice())
        assert "$160.00" in body and "$4.78" in body and "$164.78" in body

    def test_public_invoice_carries_no_internal_columns(self):
        pub = m.public_invoice(self._invoice())
        assert "id" not in pub and "emailed_at" not in pub
        assert pub["total"] == 164.78

    def test_money_formatting_falls_back_for_an_undrawable_symbol(self):
        assert m.fmt_money(1234.5, "USD") == "$1,234.50"
        assert m.fmt_money(1234.5, "INR") == "INR 1,234.50"


# ------------------------------------------------------------ rate limits ---
class TestRateLimitFallback:
    """The in-memory path, used only when the database is unreachable.

    It must still refuse a flood: an API that stops metering because the
    metering store is down is a worse outage than the one it prevents.
    """

    def test_allows_up_to_the_limit_then_refuses(self):
        key = "test-bucket:only-here"
        assert m._memory_rate_check(key, 2, 60) is None
        assert m._memory_rate_check(key, 2, 60) is None
        retry = m._memory_rate_check(key, 2, 60)
        assert retry is not None and retry > 0

    def test_buckets_do_not_leak_into_each_other(self):
        assert m._memory_rate_check("bucket-a:x", 1, 60) is None
        assert m._memory_rate_check("bucket-b:x", 1, 60) is None
