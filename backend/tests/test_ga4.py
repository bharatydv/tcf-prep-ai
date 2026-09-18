"""The purchase event GA4 is told about.

This runs on the money path, so the tests that matter are the ones about what
does NOT happen: nothing personal in the payload, nothing sent when the
property is not configured, and no exception that could escape into a webhook
which has already granted somebody their premium.

Deduplication itself is not tested here because it does not live here. One
purchase per charge is enforced by billing_webhook(), which reaches this call
only on the transition that actually granted a cycle - see
test_webhook_lifecycle.py for the guards that make that true.
"""
import json

import pytest

import server as m


class _Row:
    """The fields ga4_track_purchase() reads off a Subscription."""

    def __init__(self, **kw):
        self.subscription_id = kw.get("subscription_id", "sub_abc123")
        self.plan_id = kw.get("plan_id", "month")
        self.amount = kw.get("amount", 61.79)
        self.currency = kw.get("currency", "USD")
        self.ga_client_id = kw.get("ga_client_id", "1234567890.0987654321")
        self.ga_session_id = kw.get("ga_session_id", "1731000000")


@pytest.fixture
def sent(monkeypatch):
    """Capture the payload instead of posting it, with GA4 configured."""
    captured = []
    monkeypatch.setattr(m, "GA4_MEASUREMENT_ID", "G-TEST123456")
    monkeypatch.setattr(m, "GA4_API_SECRET", "secret")
    monkeypatch.setattr(m, "_ga4_post_sync", lambda payload: captured.append(payload))
    return captured


class TestClientId:
    def test_uses_the_browsers_id_when_checkout_captured_one(self):
        assert m._ga4_client_id("42.99", "sub_1") == "42.99"

    def test_derives_a_stable_stand_in_when_it_did_not(self):
        """A blocked tag must not cost us the sale, and a webhook retry must
        not invent a second user for the same order."""
        first = m._ga4_client_id(None, "sub_1")
        assert first == m._ga4_client_id(None, "sub_1")
        assert first != m._ga4_client_id(None, "sub_2")

    def test_the_stand_in_is_shaped_like_a_gtag_client_id(self):
        left, _, right = m._ga4_client_id(None, "sub_1").partition(".")
        assert left.isdigit() and right.isdigit()


class TestPurchasePayload:
    @pytest.mark.asyncio
    async def test_sends_the_commerce_fields_and_nothing_else(self, sent):
        await m.ga4_track_purchase(_Row(), first_cycle=True)

        assert len(sent) == 1
        event = sent[0]["events"][0]
        assert event["name"] == "purchase"
        params = event["params"]
        assert params["transaction_id"] == "sub_abc123"
        assert params["value"] == 61.79
        assert params["currency"] == "USD"
        assert params["plan"] == "month"
        assert params["first_cycle"] is True

    @pytest.mark.asyncio
    async def test_carries_no_personal_data_at_all(self, sent):
        """The one assertion this file exists for.

        Written as an exact allowlist of keys rather than a search for
        suspicious substrings: a blocklist passes happily on the day somebody
        adds a field nobody thought to forbid, which is precisely how personal
        data reaches an analytics property. Anything new here has to be added
        deliberately, in this list, by someone reading this comment.
        """
        await m.ga4_track_purchase(_Row(), first_cycle=False)

        assert set(sent[0]) == {"client_id", "non_personalized_ads",
                                "consent", "events"}
        assert set(sent[0]["events"][0]["params"]) == {
            "transaction_id", "value", "currency", "plan", "first_cycle",
            "engagement_time_msec", "items", "session_id"}
        assert set(sent[0]["events"][0]["params"]["items"][0]) == {
            "item_id", "item_name", "item_category", "price", "quantity"}

        # And nothing that looks like an address anywhere in the payload.
        assert "@" not in json.dumps(sent[0])

    @pytest.mark.asyncio
    async def test_joins_the_session_checkout_happened_in(self, sent):
        await m.ga4_track_purchase(_Row(), first_cycle=True)
        assert sent[0]["client_id"] == "1234567890.0987654321"
        assert sent[0]["events"][0]["params"]["session_id"] == "1731000000"

    @pytest.mark.asyncio
    async def test_omits_the_session_when_the_tag_was_blocked(self, sent):
        await m.ga4_track_purchase(
            _Row(ga_client_id=None, ga_session_id=None), first_cycle=True)
        assert "session_id" not in sent[0]["events"][0]["params"]
        # Still sent: revenue absent from GA4 is worse than revenue with no
        # campaign attached to it.
        assert sent[0]["events"][0]["params"]["value"] == 61.79

    @pytest.mark.asyncio
    async def test_says_the_same_about_ads_as_the_browser_does(self, sent):
        """gtag-init.js denies ad storage by default and the banner never
        grants it, so the server must not quietly claim otherwise."""
        await m.ga4_track_purchase(_Row(), first_cycle=True)
        assert sent[0]["non_personalized_ads"] is True
        assert sent[0]["consent"]["ad_user_data"] == "DENIED"
        assert sent[0]["consent"]["ad_personalization"] == "DENIED"

    @pytest.mark.asyncio
    async def test_reports_the_currency_the_row_was_charged_in(self, sent):
        await m.ga4_track_purchase(_Row(currency="INR", amount=5000),
                                   first_cycle=True)
        assert sent[0]["events"][0]["params"]["currency"] == "INR"
        assert sent[0]["events"][0]["params"]["value"] == 5000


class TestNeverBreaksTheWebhook:
    @pytest.mark.asyncio
    async def test_sends_nothing_without_an_api_secret(self, monkeypatch):
        calls = []
        monkeypatch.setattr(m, "GA4_API_SECRET", "")
        monkeypatch.setattr(m, "_ga4_post_sync", lambda p: calls.append(p))
        await m.ga4_track_purchase(_Row(), first_cycle=True)
        assert calls == []

    @pytest.mark.asyncio
    async def test_swallows_a_failed_post(self, monkeypatch):
        """The grant is already committed by the time this runs. A GA4 outage
        must not turn into a 500 that makes the gateway retry the payment."""
        def boom(_payload):
            raise RuntimeError("google is down")

        monkeypatch.setattr(m, "GA4_MEASUREMENT_ID", "G-TEST123456")
        monkeypatch.setattr(m, "GA4_API_SECRET", "secret")
        monkeypatch.setattr(m, "_ga4_post_sync", boom)
        await m.ga4_track_purchase(_Row(), first_cycle=True)  # must not raise

    @pytest.mark.asyncio
    async def test_survives_a_row_with_nothing_on_it(self, sent):
        await m.ga4_track_purchase(
            _Row(amount=None, currency=None, plan_id="month"), first_cycle=True)
        assert sent[0]["events"][0]["params"]["value"] == 0


class TestFunnelNames:
    def test_the_browser_may_report_practice_complete(self):
        """It is fired by lib/analytics.js; an unlisted name is dropped."""
        assert "practice_complete" in m.CLIENT_EVENTS
        assert "practice_start" in m.CLIENT_EVENTS
        assert "speaking_start" in m.CLIENT_EVENTS

    def test_purchase_and_signup_stay_server_side(self):
        # Renamed from "signup" to match GA4's own event and the taxonomy in
        # frontend/src/lib/eventTaxonomy.js. It had never been written to the
        # table under the old name, so there is no history to keep continuous.
        assert "payment_success" in m.SERVER_EVENTS
        assert "sign_up" in m.SERVER_EVENTS
        assert "payment_success" not in m.CLIENT_EVENTS
        assert "sign_up" not in m.CLIENT_EVENTS
