"""The Razorpay money paths.

Same standard as test_billing.py: every test here guards a case where a bug
charges the wrong amount, grants access nobody paid for, or takes access
somebody did pay for. The three that matter most are the ones asserting that
one payment cannot be granted twice, that paise are not mistaken for rupees,
and that an unsigned body is refused.
"""
import hashlib
import hmac
import json

import pytest

import server as m


def _sign(body: bytes, secret: str) -> str:
    """Razorpay's scheme: hex HMAC-SHA256 of the raw body. No timestamp."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# ------------------------------------------------------------ signatures ---
class TestSignature:
    BODY = json.dumps({"event": "payment.captured"}).encode()

    def test_accepts_a_correctly_signed_body(self):
        sig = _sign(self.BODY, m.RAZORPAY_WEBHOOK_SECRET)
        assert m.verify_razorpay_signature(self.BODY, sig) is True

    def test_rejects_a_tampered_body(self):
        sig = _sign(self.BODY, m.RAZORPAY_WEBHOOK_SECRET)
        assert m.verify_razorpay_signature(
            self.BODY.replace(b"captured", b"capture_"), sig) is False

    def test_rejects_a_signature_from_the_wrong_secret(self):
        assert m.verify_razorpay_signature(
            self.BODY, _sign(self.BODY, "not-the-secret")) is False

    def test_rejects_an_empty_signature(self):
        assert m.verify_razorpay_signature(self.BODY, "") is False

    def test_rejects_everything_when_no_secret_is_configured(self, monkeypatch):
        """An unset secret must close the endpoint, not open it.

        Razorpay's webhook secret is typed into the dashboard and is a
        different string from the API key secret. If a missing one fell back to
        "accept", this endpoint would grant premium to anyone who can POST
        JSON at it.
        """
        monkeypatch.setattr(m, "RAZORPAY_WEBHOOK_SECRET", "")
        assert m.verify_razorpay_signature(self.BODY, _sign(self.BODY, "")) is False

    def test_a_cashfree_signature_does_not_pass_as_a_razorpay_one(self):
        """The two schemes differ in digest encoding and in signed material."""
        import base64
        cf = base64.b64encode(hmac.new(
            m.RAZORPAY_WEBHOOK_SECRET.encode(),
            b"1755950000" + self.BODY, hashlib.sha256).digest()).decode()
        assert m.verify_razorpay_signature(self.BODY, cf) is False


# ----------------------------------------------------------- minor units ---
class TestMinorUnits:
    """Razorpay counts in paise. A factor-of-100 slip is a 100x mischarge."""

    @pytest.mark.parametrize("amount, minor", [
        (82.39, 8239),      # the worked example: 80 + 2.99%
        (164.78, 16478),
        (20.60, 2060),
        (15.45, 1545),
        (0, 0),
        (1, 100),
    ])
    def test_converts_to_the_integer_razorpay_wants(self, amount, minor):
        assert m.to_minor_units(amount, "INR") == minor
        assert isinstance(m.to_minor_units(amount, "INR"), int)

    @pytest.mark.parametrize("amount, minor", [
        (1.15, 115),      # int(1.15 * 100) is 114
        (2.01, 201),
        (0.29, 29),
        (0.57, 57),
    ])
    def test_survives_the_floats_that_truncation_gets_wrong(self, amount, minor):
        """int(1.15 * 100) is 114 in binary floating point.

        A cent short is not a rounding curiosity: it is a mismatch logged
        against the payment, and a customer charged less than their receipt
        says. money() rounds before the multiply, which is what avoids it.
        """
        assert int(amount * 100) == minor - 1           # the trap
        assert m.to_minor_units(amount, "INR") == minor  # not fallen into

    def test_no_catalogue_total_is_ever_a_cent_short(self):
        """The property, across every price this site can actually charge."""
        for plan in m.BILLING_PLANS.values():
            for base in (plan["amount"], plan["first_amount"]):
                total = m.checkout_breakdown(base)["total"]
                assert m.to_minor_units(total, "INR") == round(total * 100)

    def test_round_trips(self):
        for amount in (0, 0.01, 15.45, 82.39, 226.58, 999.99):
            assert float(m.from_minor_units(
                m.to_minor_units(amount, "USD"), "USD")) == amount

    def test_zero_decimal_currencies_are_not_multiplied(self):
        """JPY has no minor unit: 500 yen is 500, not 50000."""
        assert m.to_minor_units(500, "JPY") == 500
        assert float(m.from_minor_units(500, "JPY")) == 500.0

    def test_an_unknown_currency_is_treated_as_two_decimal(self):
        """All but a handful of ISO 4217 codes are, so that is the safe guess."""
        assert m.to_minor_units(10, "ZZZ") == 1000


# ---------------------------------------------------------- event parsing ---
def _captured(payment_id="pay_ABC", order_id="order_XYZ", sub_id="sub_abc123",
              amount=8239, event="payment.captured"):
    return {
        "entity": "event",
        "event": event,
        "contains": ["payment"],
        "payload": {"payment": {"entity": {
            "id": payment_id,
            "entity": "payment",
            "amount": amount,
            "currency": "INR",
            "status": "captured",
            "order_id": order_id,
            "notes": {"subscription_id": sub_id, "plan_id": "month"},
        }}},
    }


class TestEventParsing:
    HEADERS = {"x-razorpay-event-id": "evt_1"}

    def test_reads_our_own_id_out_of_the_notes(self):
        """Our subscription id is the only field that matches a row exactly."""
        p = m._parse_razorpay_event(_captured(), self.HEADERS)
        assert p["our_id"] == "sub_abc123"
        assert p["gateway_order_id"] == "order_XYZ"

    def test_falls_back_to_the_receipt_when_notes_are_missing(self):
        event = {"event": "order.paid", "payload": {"order": {"entity": {
            "id": "order_XYZ", "receipt": "sub_abc123", "amount": 8239,
            "currency": "INR"}}}}
        assert m._parse_razorpay_event(event, self.HEADERS)["our_id"] == "sub_abc123"

    def test_converts_the_amount_out_of_paise(self):
        assert m._parse_razorpay_event(_captured(), self.HEADERS)["amount"] == 82.39

    def test_names_the_payment_as_the_reference(self):
        """The marker becomes the invoice's payment_reference."""
        assert m._parse_razorpay_event(_captured(), self.HEADERS)["marker"] == "pay_ABC"

    def test_falls_back_to_the_event_id_when_no_payment_is_named(self):
        event = {"event": "subscription.pending", "payload": {}}
        p = m._parse_razorpay_event(event, self.HEADERS)
        assert p["marker"] == "evt_1"
        assert p["event_key"] == "rzp:subscription.pending:evt_1"

    def test_a_body_with_nothing_in_it_does_not_explode(self):
        """A malformed body must be ignorable, not a 500 that triggers retries."""
        p = m._parse_razorpay_event({}, {})
        assert p["our_id"] == "" and p["amount"] is None
        assert p["event_type"] == "UNKNOWN"

    def test_notes_that_are_not_a_dict_are_ignored(self):
        event = _captured()
        event["payload"]["payment"]["entity"]["notes"] = []
        assert m._parse_razorpay_event(event, self.HEADERS)["our_id"] == ""


class TestOnePaymentGrantsOnce:
    """The double-grant guard, which is the expensive bug in this file."""

    def test_captured_and_order_paid_share_one_idempotency_key(self):
        """Both events describe the same money.

        Razorpay sends both when both are subscribed in the dashboard. They
        carry different `event` strings, so a key built from the event type
        would let each one through and grant two cycles for one charge.
        """
        a = m._parse_razorpay_event(_captured(event="payment.captured"), {})
        b = m._parse_razorpay_event(_captured(event="order.paid"), {})
        assert a["event_key"] == b["event_key"] == "rzp:paid:pay_ABC"

    def test_two_different_payments_do_not_collide(self):
        a = m._parse_razorpay_event(_captured(payment_id="pay_1"), {})
        b = m._parse_razorpay_event(_captured(payment_id="pay_2"), {})
        assert a["event_key"] != b["event_key"]

    @pytest.mark.parametrize("event", ["payment.captured", "order.paid"])
    def test_both_are_treated_as_a_successful_payment(self, event):
        assert m._is_payment_success(event) is True

    def test_an_authorised_payment_is_not_a_paid_one(self):
        """An authorisation is a hold. The money has not moved yet."""
        assert m._is_payment_success("payment.authorized") is False
        p = m._parse_razorpay_event(_captured(event="payment.authorized"), {})
        # And it must not take the paid key, or it would block the capture
        # that follows it from ever being applied.
        assert p["event_key"] == "rzp:payment.authorized:pay_ABC"

    @pytest.mark.parametrize("event", ["payment.failed", "order.notified"])
    def test_other_events_grant_nothing(self, event):
        assert m._is_payment_success(event) is False

    def test_cashfree_events_still_classify(self):
        """The switch must not cost the old gateway its own vocabulary."""
        assert m._is_payment_success("SUBSCRIPTION_PAYMENT_SUCCESS") is True
        assert m._is_payment_success("PAYMENT_SUCCESS") is True
        assert m._is_payment_success("SUBSCRIPTION_CANCELLED") is False


class TestReversals:
    def test_a_refund_is_a_reversal(self):
        assert m._is_reversal("refund.created", "processed") is True
        assert m._is_reversal("payment.dispute.created", "") is True

    @staticmethod
    def _refund(refund_id="rfnd_1", amount=2000):
        """A refund event as Razorpay sends one: refund AND original payment."""
        event = _captured()
        event["event"] = "refund.created"
        event["contains"] = ["refund", "payment"]
        event["payload"]["refund"] = {"entity": {
            "id": refund_id, "payment_id": "pay_ABC", "amount": amount,
            "currency": "INR", "status": "processed"}}
        return event

    def test_a_refund_reads_the_refunded_amount_not_the_original(self):
        """Both entities carry an `amount`, side by side, and they differ.

        A partial refund of 20.00 against an 82.39 payment must be recorded as
        20.00. Searching the body by field name would return whichever came
        first in dict order.
        """
        assert m._parse_razorpay_event(self._refund(), {})["amount"] == 20.00

    def test_a_refund_still_finds_the_row_it_belongs_to(self):
        """Our id rides in the payment's notes, which a refund event carries."""
        p = m._parse_razorpay_event(self._refund(), {})
        assert p["our_id"] == "sub_abc123"
        assert p["gateway_order_id"] == "order_XYZ"

    def test_two_partial_refunds_are_two_events(self):
        """Keyed on the refund, not the payment.

        Both refunds name the same payment. Keying on that would make the
        second a duplicate and drop it — access the customer was refunded for
        and kept.
        """
        a = m._parse_razorpay_event(self._refund("rfnd_1", 2000), {})
        b = m._parse_razorpay_event(self._refund("rfnd_2", 1000), {})
        assert a["event_key"] != b["event_key"]
        assert a["marker"] == "rfnd_1" and b["marker"] == "rfnd_2"

    def test_a_refund_never_collides_with_the_payment_it_reverses(self):
        paid = m._parse_razorpay_event(_captured(), {})
        assert self._refund()["payload"]["payment"]["entity"]["id"] == "pay_ABC"
        assert m._parse_razorpay_event(self._refund(), {})["event_key"]             != paid["event_key"]


class TestAmountVerification:
    """A correct charge must not be logged as a mismatch."""

    class _Row:
        subscription_id = "sub_abc123"
        amount = 82.39
        base_amount = 80.0
        fee_amount = 2.39

    def test_the_normalised_amount_matches_the_row(self, caplog):
        seen = m.verify_paid_amount(_captured(), self._Row(), amount=82.39)
        assert seen == 82.39
        assert "AMOUNT MISMATCH" not in caplog.text

    def test_raw_paise_would_have_been_a_mismatch(self, caplog):
        """Proves the conversion is what keeps the log clean, not luck."""
        m.verify_paid_amount(_captured(), self._Row(), amount=8239.0)
        assert "AMOUNT MISMATCH" in caplog.text

    def test_an_absent_amount_is_not_an_error(self):
        assert m.verify_paid_amount({}, self._Row()) is None


# ------------------------------------------------------- provider switch ---
class TestProviderSwitch:
    """billing_configured() answers for the selected gateway, not either one.

    Answering yes because the other provider still has credentials in the
    environment would light up a buy button that leads nowhere.
    """

    def test_razorpay_needs_razorpay_keys(self, monkeypatch):
        monkeypatch.setattr(m, "PAYMENT_PROVIDER", "razorpay")
        monkeypatch.setattr(m, "CASHFREE_APP_ID", "cf-id")
        monkeypatch.setattr(m, "CASHFREE_SECRET_KEY", "cf-secret")
        monkeypatch.setattr(m, "RAZORPAY_KEY_ID", "")
        monkeypatch.setattr(m, "RAZORPAY_KEY_SECRET", "")
        assert m.billing_configured() is False
        monkeypatch.setattr(m, "RAZORPAY_KEY_ID", "rzp_test_x")
        monkeypatch.setattr(m, "RAZORPAY_KEY_SECRET", "shh")
        assert m.billing_configured() is True

    def test_cashfree_needs_cashfree_keys(self, monkeypatch):
        monkeypatch.setattr(m, "PAYMENT_PROVIDER", "cashfree")
        monkeypatch.setattr(m, "RAZORPAY_KEY_ID", "rzp_test_x")
        monkeypatch.setattr(m, "RAZORPAY_KEY_SECRET", "shh")
        monkeypatch.setattr(m, "CASHFREE_APP_ID", "")
        monkeypatch.setattr(m, "CASHFREE_SECRET_KEY", "")
        assert m.billing_configured() is False

    def test_a_receipt_names_the_gateway_that_took_the_money(self):
        assert m.gateway_display_name("razorpay") == "Razorpay"
        assert m.gateway_display_name("cashfree") == "Cashfree"

    def test_an_unknown_provider_still_prints_something(self):
        assert m.gateway_display_name("stripe") == "Stripe"
        assert m.gateway_display_name("") == m.gateway_display_name(None)
