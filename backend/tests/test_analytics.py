"""The journey analytics: everything that can be checked without a database.

tests/conftest.py imports server.py with no Postgres behind it, so the SQL in
this feature cannot be executed here. That constraint shaped the code: the
arithmetic, the validation, the redaction and the taxonomy all live in plain
functions precisely so they can be covered, and the endpoints are thin enough
that what is left is a query and a call into one of them.

The tests that matter most are the negative ones. A funnel that quietly
miscounts, a date filter that silently ignores what was typed, or a redactor
that lets an essay through are all failures nobody sees until the data has
already been collected or shown.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import server as m


UTC = timezone.utc
NOW = datetime(2026, 9, 18, 12, 0, 0, tzinfo=UTC)


# --------------------------------------------------------------- taxonomy ---
class TestTaxonomy:
    """The two halves of the event catalogue have to agree.

    frontend/src/lib/eventTaxonomy.js is the documentation; CLIENT_EVENTS and
    SERVER_EVENTS are the enforcement. A name fired by the browser but missing
    from the allowlist is accepted with a 204 and silently dropped, which is
    the worst possible failure: the dashboard is simply wrong and nothing
    anywhere says so.
    """

    def test_every_event_the_browser_fires_is_accepted(self):
        for name in ("landing_view", "page_view", "tcf_canada_view",
                     "signup_start", "login", "practice_start",
                     "practice_complete", "result_view", "pricing_view",
                     "checkout_start", "community_click", "mic_denied"):
            assert name in m.CLIENT_EVENTS, name

    def test_the_events_that_must_not_be_forgeable_are_server_only(self):
        for name in ("sign_up", "logout", "email_verified", "payment_success",
                     "payment_reversed", "ai_call", "ai_result"):
            assert name in m.SERVER_EVENTS, name
            assert name not in m.CLIENT_EVENTS, name

    def test_the_retired_speaking_name_is_still_accepted(self):
        """Rows written under it must keep counting."""
        assert "speaking_start" in m.CLIENT_EVENTS

    def test_no_event_name_is_in_both_halves(self):
        assert not (m.CLIENT_EVENTS & m.SERVER_EVENTS)

    def test_every_funnel_step_names_events_that_exist(self):
        known = m.CLIENT_EVENTS | m.SERVER_EVENTS
        for _key, _label, events in m.FUNNEL_STEPS:
            assert events, "a step with no events can never be reached"
            assert events <= known, events - known


# ------------------------------------------------------------- date ranges ---
class TestAnalyticsRange:
    def test_presets_cover_the_documented_filters(self):
        assert set(m.ANALYTICS_PRESETS) == {"today", "7d", "28d", "90d"}

    @pytest.mark.parametrize("preset, days", [("7d", 7), ("28d", 28), ("90d", 90)])
    def test_a_preset_looks_back_that_many_days(self, preset, days):
        since, until = m.analytics_range(preset, now=NOW)
        assert until == NOW
        assert (until - since).days == days

    def test_today_starts_at_midnight_not_twenty_four_hours_ago(self):
        since, until = m.analytics_range("today", now=NOW)
        assert since == NOW.replace(hour=0, minute=0, second=0, microsecond=0)
        assert until == NOW

    def test_a_custom_range_includes_the_whole_end_day(self):
        """Somebody asking for the 1st to the 7th means all of the 7th."""
        since, until = m.analytics_range("custom", "2026-09-01", "2026-09-07")
        assert since == datetime(2026, 9, 1, tzinfo=UTC)
        assert until == datetime(2026, 9, 8, tzinfo=UTC)

    def test_an_unknown_preset_is_refused_rather_than_defaulted(self):
        """A filter that ignores what was typed produces numbers somebody acts
        on believing they mean something else."""
        with pytest.raises(HTTPException) as e:
            m.analytics_range("last-tuesday")
        assert e.value.status_code == 400

    def test_a_custom_range_needs_both_ends(self):
        with pytest.raises(HTTPException) as e:
            m.analytics_range("custom", "2026-09-01", None)
        assert e.value.status_code == 400

    def test_a_backwards_range_is_refused(self):
        with pytest.raises(HTTPException) as e:
            m.analytics_range("custom", "2026-09-07", "2026-09-01")
        assert e.value.status_code == 400

    def test_an_unparseable_date_is_refused(self):
        with pytest.raises(HTTPException) as e:
            m.analytics_range("custom", "07/09/2026", "08/09/2026")
        assert e.value.status_code == 400

    def test_a_range_longer_than_the_cap_is_refused(self):
        """Not a retention policy - a guard against a hand-typed range asking
        for a scan of every row ever written."""
        with pytest.raises(HTTPException) as e:
            m.analytics_range("custom", "2020-01-01", "2026-01-01")
        assert e.value.status_code == 400
        assert str(m.ANALYTICS_MAX_DAYS) in e.value.detail


# ------------------------------------------------------------------ funnel ---
class TestBuildFunnel:
    def test_steps_come_back_in_journey_order(self):
        steps = m.build_funnel({}, {})
        assert [s["step"] for s in steps] == [
            "visitors", "signup", "practice", "completion", "checkout", "purchase"]

    def test_conversion_is_measured_against_the_previous_step(self):
        people = {"visitors": 1000, "signup": 100, "practice": 50,
                  "completion": 25, "checkout": 10, "purchase": 5}
        steps = {s["step"]: s for s in m.build_funnel(people, {})}
        assert steps["visitors"]["conversion_from_previous"] == 100.0
        assert steps["signup"]["conversion_from_previous"] == 10.0
        assert steps["practice"]["conversion_from_previous"] == 50.0
        assert steps["completion"]["conversion_from_previous"] == 50.0
        assert steps["checkout"]["conversion_from_previous"] == 40.0
        assert steps["purchase"]["conversion_from_previous"] == 50.0

    def test_an_empty_funnel_is_all_zeroes_and_does_not_divide_by_zero(self):
        steps = m.build_funnel({}, {})
        assert all(s["people"] == 0 for s in steps)
        assert all(s["conversion_from_previous"] == 0.0 for s in steps)

    def test_a_step_may_exceed_the_one_above_it(self):
        """Somebody can land straight on a practice page from a search result
        without ever seeing the home page. Clamping would hide a real
        acquisition path behind a tidier-looking number."""
        steps = {s["step"]: s for s in
                 m.build_funnel({"visitors": 10, "signup": 20}, {})}
        assert steps["signup"]["people"] == 20
        assert steps["signup"]["conversion_from_previous"] == 200.0

    def test_hits_are_reported_beside_people(self):
        steps = {s["step"]: s for s in
                 m.build_funnel({"visitors": 3}, {"visitors": 42})}
        assert steps["visitors"]["people"] == 3
        assert steps["visitors"]["hits"] == 42


# --------------------------------------------------------------- retention ---
class TestRetention:
    def test_percentages_are_of_the_cohort(self):
        row = m.retention_row(200, {1: 100, 7: 50, 28: 20})
        assert row["cohort"] == 200
        assert row["d1_pct"] == 50.0
        assert row["d7_pct"] == 25.0
        assert row["d28_pct"] == 10.0

    def test_an_empty_cohort_does_not_divide_by_zero(self):
        row = m.retention_row(0, {})
        assert row["cohort"] == 0
        assert row["d1_pct"] == 0.0


# -------------------------------------------------------------------- paths ---
class TestCollapsePath:
    def test_consecutive_repeats_collapse(self):
        """Six page_views in a row are one step of browsing, not six."""
        assert m.collapse_path(
            ["page_view", "page_view", "page_view", "pricing_view"]
        ) == ["page_view", "pricing_view"]

    def test_a_repeat_that_is_not_consecutive_is_kept(self):
        assert m.collapse_path(["pricing_view", "practice_start", "pricing_view"]) == [
            "pricing_view", "practice_start", "pricing_view"]

    def test_long_sessions_are_cut_so_paths_can_actually_repeat(self):
        steps = [f"e{i}" for i in range(50)]
        assert len(m.collapse_path(steps)) == 10

    def test_empty_entries_are_dropped(self):
        assert m.collapse_path([None, "", "login"]) == ["login"]


# ------------------------------------------------------------------ privacy ---
class TestSafeJourneyMeta:
    """The redactor. An allowlist, because the field that must not be shown is
    always the one nobody thought of."""

    def test_documented_product_context_survives(self):
        meta = {"skill": "reading", "exam": "tcf", "level": "B2",
                "plan": "month", "score": 18, "total": 39}
        assert m.safe_journey_meta(meta) == meta

    @pytest.mark.parametrize("field", [
        "text", "essay", "transcript", "audio", "recording", "answers",
        "email", "name", "phone", "password", "password_hash", "token",
        "access_token", "card", "card_number", "ip", "latitude", "message",
    ])
    def test_sensitive_fields_are_dropped_whatever_they_are_called(self, field):
        assert m.safe_journey_meta({field: "something private"}) == {}

    def test_a_nested_object_cannot_be_rendered(self):
        out = m.safe_journey_meta({"skill": "writing",
                                   "source": {"nested": "object"}})
        assert out["skill"] == "writing"
        assert isinstance(out["source"], str)

    def test_long_values_are_trimmed(self):
        assert len(m.safe_journey_meta({"level": "x" * 500})["level"]) == 120

    def test_a_non_dict_is_empty(self):
        assert m.safe_journey_meta(None) == {}
        assert m.safe_journey_meta("reading") == {}

    def test_the_allowlist_holds_no_field_that_reads_as_personal(self):
        for key in m.SAFE_META_KEYS:
            assert not any(bad in key for bad in
                           ("email", "password", "token", "card", "text",
                            "transcript", "audio", "ip", "phone", "name")), key


class TestSafeEventPath:
    @pytest.mark.parametrize("raw", [
        "/reset-password?token=abc123",
        "/account/verify?token=abc123",
        "/verify-email?token=abc123",
    ])
    def test_a_live_credential_never_reaches_the_table(self, raw):
        out = m.safe_event_path(raw)
        assert "token" not in out
        assert "abc123" not in out

    def test_the_exam_question_is_dropped(self):
        assert m.safe_event_path(
            "/speaking/record?tache=3&q=Presentez-vous") == "/speaking/record"

    def test_campaign_parameters_survive_so_attribution_works(self):
        assert m.safe_event_path("/pricing?utm_source=google") == \
            "/pricing?utm_source=google"

    def test_an_absolute_url_is_reduced_to_its_path(self):
        """A caller must not be able to record somebody else's host."""
        assert m.safe_event_path("https://evil.example/steal") == "/steal"

    def test_nothing_in_gives_nothing_out(self):
        assert m.safe_event_path(None) is None
        assert m.safe_event_path("") is None


# ----------------------------------------------------------------- filters ---
class TestValidateChoice:
    def test_a_known_value_passes_through_lowercased(self):
        assert m.validate_choice("READING", m.ANALYTICS_SKILLS, "skill") == "reading"

    def test_an_absent_filter_is_not_a_filter(self):
        assert m.validate_choice(None, m.ANALYTICS_SKILLS, "skill") is None
        assert m.validate_choice("", m.ANALYTICS_SKILLS, "skill") is None

    def test_an_unknown_value_is_refused_and_says_what_is_allowed(self):
        with pytest.raises(HTTPException) as e:
            m.validate_choice("telepathy", m.ANALYTICS_SKILLS, "skill")
        assert e.value.status_code == 400
        assert "reading" in e.value.detail

    @pytest.mark.parametrize("attack", [
        "reading'; DROP TABLE usage_events; --",
        "reading OR 1=1",
        "'; SELECT * FROM users; --",
        "reading UNION SELECT password_hash FROM users",
    ])
    def test_an_injection_attempt_is_refused_at_the_filter(self, attack):
        """Values are bound as parameters regardless, so this is defence in
        depth rather than the only guard - but a filter that reaches SQL at all
        should never carry a string like this."""
        with pytest.raises(HTTPException) as e:
            m.validate_choice(attack, m.ANALYTICS_SKILLS, "skill")
        assert e.value.status_code == 400

    def test_the_skill_set_is_the_four_the_exam_measures(self):
        assert m.ANALYTICS_SKILLS == {"reading", "listening", "writing", "speaking"}


class TestEventsInBinding:
    """The IN lists are built from generated names, never from values."""

    def test_names_are_generated_and_values_are_bound(self):
        placeholders, params = m._events_in("practice",
                                            {"practice_start", "speaking_start"})
        assert placeholders == ":practice_0, :practice_1"
        assert set(params.values()) == {"practice_start", "speaking_start"}

    def test_two_steps_cannot_collide_on_one_parameter_name(self):
        a_ph, a = m._events_in("visitors", {"page_view"})
        b_ph, b = m._events_in("practice", {"page_view"})
        assert not (set(a) & set(b))
        assert a_ph != b_ph


# ----------------------------------------------------------------- country ---
class TestCountryFromTimezone:
    @pytest.mark.parametrize("tz, code", [
        ("America/Toronto", "CA"),
        ("Europe/Paris", "FR"),
        ("Europe/Brussels", "BE"),
        ("Africa/Casablanca", "MA"),
        ("Africa/Algiers", "DZ"),
        ("Asia/Kolkata", "IN"),
    ])
    def test_the_zones_this_audience_actually_uses(self, tz, code):
        assert m.country_from_timezone(tz) == code

    def test_an_unmapped_zone_is_unknown_rather_than_a_guess(self):
        assert m.country_from_timezone("Antarctica/Troll") == "Unknown"
        assert m.country_from_timezone(None) == "Unknown"
        assert m.country_from_timezone("") == "Unknown"

    def test_nothing_finer_than_a_country_is_returned(self):
        for code in m.TIMEZONE_COUNTRY.values():
            assert len(code) == 2 and code.isupper()


# ----------------------------------------------------------- authorization ---
class TestAdminAuthorization:
    """Backend enforcement, not a hidden tab.

    Every analytics endpoint takes get_admin_user as a dependency. A frontend
    that hides the tab is a convenience; an endpoint left open would hand
    anyone who guessed the URL a readable history of what every learner did.
    """

    class _User:
        def __init__(self, role):
            self.role = role
            self.user_id = "user_1"

    @pytest.mark.asyncio
    async def test_an_admin_passes(self):
        admin = self._User("admin")
        assert await m.get_admin_user(admin) is admin

    @pytest.mark.asyncio
    async def test_an_ordinary_learner_is_refused(self):
        with pytest.raises(HTTPException) as e:
            await m.get_admin_user(self._User("user"))
        assert e.value.status_code == 403

    @pytest.mark.parametrize("role", ["", None, "administrator", "ADMIN", "staff"])
    @pytest.mark.asyncio
    async def test_nothing_that_merely_looks_like_admin_passes(self, role):
        with pytest.raises(HTTPException) as e:
            await m.get_admin_user(self._User(role))
        assert e.value.status_code == 403

    def test_every_analytics_route_depends_on_the_admin_check(self):
        import inspect

        routes = [r for r in m.app.routes
                  if getattr(r, "path", "").startswith("/api/admin/analytics")]
        assert routes, "the analytics endpoints are not registered"
        for route in routes:
            params = inspect.signature(route.endpoint).parameters
            depends = [p.default.dependency for p in params.values()
                       if hasattr(p.default, "dependency")]
            assert m.get_admin_user in depends, route.path

    def test_the_endpoints_the_dashboard_needs_all_exist(self):
        paths = {getattr(r, "path", "") for r in m.app.routes}
        for path in ("/api/admin/analytics/overview",
                     "/api/admin/analytics/funnel",
                     "/api/admin/analytics/journey",
                     "/api/admin/analytics/events",
                     "/api/admin/analytics/breakdown",
                     "/api/admin/analytics/retention",
                     "/api/admin/analytics/paths"):
            assert path in paths, path


# ------------------------------------------------------------------ schema ---
class TestSchema:
    def test_usage_events_carries_the_journey_columns(self):
        cols = m.UsageEvent.__table__.c
        for name in ("event_id", "session_id", "path", "anon_id", "user_id",
                     "event", "created_at", "meta"):
            assert name in cols, name

    def test_event_id_is_unique_so_a_retried_post_cannot_double_count(self):
        assert m.UsageEvent.__table__.c.event_id.unique is True

    def test_there_is_no_second_events_table(self):
        """One table. The identity map is not an event store - it has no event
        name, no timestamp of anything that happened, and four columns."""
        tables = set(m.Base.metadata.tables)
        assert "usage_events" in tables
        assert not [t for t in tables
                    if "event" in t and t not in {"usage_events", "billing_events"}]

    def test_the_identity_map_holds_pairs_and_nothing_sensitive(self):
        cols = set(m.AnalyticsIdentity.__table__.c.keys())
        assert cols == {"id", "anon_id", "user_id", "first_seen_at", "last_seen_at"}

    def test_a_browser_may_be_linked_to_more_than_one_account(self):
        """The unique constraint is on the PAIR. A table keyed on anon_id alone
        would have to pick a winner on a shared laptop, and would hand one
        person's study history to another."""
        uniques = [c for c in m.AnalyticsIdentity.__table__.constraints
                   if c.__class__.__name__ == "UniqueConstraint"]
        assert len(uniques) == 1
        assert {c.name for c in uniques[0].columns} == {"anon_id", "user_id"}

    def test_the_indexes_the_dashboards_read_on_exist(self):
        names = {i.name for i in m.UsageEvent.__table__.indexes}
        for expected in ("ix_usage_events_user_created",
                         "ix_usage_events_session_created",
                         "ix_usage_events_event_created",
                         "ix_usage_events_anon_created"):
            assert expected in names, expected

    def test_the_migration_is_additive_only(self):
        """Nothing in this feature's migration may drop or rewrite a column."""
        added = [s for s in m.MIGRATIONS
                 if "usage_events" in s or "analytics_identities" in s]
        assert added
        for stmt in added:
            upper = stmt.upper()
            assert "DROP" not in upper, stmt
            assert "DELETE" not in upper, stmt
            assert not upper.startswith("UPDATE"), stmt

    def test_anon_id_and_session_id_are_indexed(self):
        """anon_id was stored from the start and never indexed, so every
        question about an anonymous visitor was a sequential scan."""
        joined = " ".join(m.MIGRATIONS)
        assert "ix_usage_events_anon_id" in joined
        assert "ix_usage_events_session_id" in joined


# -------------------------------------------------------------- speaking AI ---
class TestSpeakingCost:
    def test_the_speaking_endpoint_records_what_it_cost(self):
        """Speaking is the most expensive thing the product does - a
        transcription, a grader and a second model listening to the audio - and
        it was the only feature whose cost never reached the events table."""
        import inspect

        src = inspect.getsource(m.speaking_analyze)
        assert 'record_event(db, "ai_call"' in src
        assert 'record_event(db, "ai_result"' in src
        assert 'feature="speaking"' in src

    def test_it_records_the_cost_and_not_the_recording(self):
        import inspect

        src = inspect.getsource(m.speaking_analyze)
        call = src[src.index('record_event(db, "ai_call"'):]
        call = call[:call.index(")\n")]
        # The transcript's LENGTH is what the grader was billed for. The
        # transcript itself, the audio and the question stay out of the table.
        assert "len(transcript" in call
        assert "transcript=" not in call
        assert "audio_bytes" not in call
        assert "question" not in call


# ------------------------------------------------------ anonymous visitors ---
class TestVisitorLabel:
    """A handle for somebody who has no name.

    It is a label for a row on a screen, not an identity: derived from the
    random id the browser already stores and from nothing about the person.
    """

    def test_it_reads_like_the_example(self):
        assert m.visitor_label("a8f3c1d2-0000") == "Anonymous Visitor #A8F3"

    def test_it_uses_only_the_random_id_the_browser_already_has(self):
        """Nothing about the device, the address or the network goes into it."""
        assert m.visitor_label("abcd") == "Anonymous Visitor #ABCD"

    def test_punctuation_in_a_uuid_does_not_leak_into_the_label(self):
        assert m.visitor_label("--ab--cd--") == "Anonymous Visitor #ABCD"

    def test_no_id_is_not_a_crash(self):
        assert m.visitor_label(None) == "Anonymous"
        assert m.visitor_label("") == "Anonymous"
        assert m.visitor_label("----") == "Anonymous"


class TestJourneyPhase:
    """The three bands. The hinge is drawn as well as the two halves."""

    def test_activity_with_no_account_is_before_signup(self):
        assert m.journey_phase("page_view", False) == "anonymous"

    def test_activity_with_an_account_is_after_signup(self):
        assert m.journey_phase("practice_start", True) == "identified"

    @pytest.mark.parametrize("event", ["sign_up", "login"])
    def test_the_identity_events_are_the_boundary(self, event):
        assert m.journey_phase(event, True) == "identity"

    def test_the_boundary_events_are_real_events(self):
        assert m.IDENTITY_EVENTS <= (m.CLIENT_EVENTS | m.SERVER_EVENTS)


class TestVisitorDirectorySql:
    """The directory query, which cannot be executed here but can be read.

    Only two things vary: which UNION branches are present and whether a search
    clause is included. Both come from validated inputs, never from a caller's
    string.
    """

    def test_all_shows_both_populations(self):
        sql = m.build_visitor_sql("all")
        assert "'registered' AS kind" in sql
        assert "'anonymous' AS kind" in sql
        assert "UNION ALL" in sql

    def test_anonymous_only_drops_the_account_branch(self):
        sql = m.build_visitor_sql("anonymous")
        assert "'anonymous' AS kind" in sql
        assert "'registered' AS kind" not in sql
        assert "UNION ALL" not in sql

    def test_registered_only_drops_the_browser_branch(self):
        sql = m.build_visitor_sql("registered")
        assert "'registered' AS kind" in sql
        assert "'anonymous' AS kind" not in sql

    @pytest.mark.parametrize("kind, clause", [
        ("paid", "<> 'free'"),
        ("free", "= 'free'"),
    ])
    def test_paid_and_free_filter_on_the_subscription(self, kind, clause):
        sql = m.build_visitor_sql(kind)
        assert f"COALESCE(u.subscription_status, 'free') {clause}" in sql
        # Neither is a population that can include a browser: nobody knows
        # whether an anonymous visitor has ever paid for anything.
        assert "'anonymous' AS kind" not in sql

    def test_an_account_with_no_events_is_still_a_row(self):
        """Otherwise this screen silently disagrees with the user table."""
        assert "LEFT JOIN by_user" in m.build_visitor_sql("all")

    def test_every_event_has_exactly_one_owner(self):
        """Resolved once, up front. Without this an event is counted against
        both an account and a browser, or against neither."""
        sql = m.build_visitor_sql("all")
        assert "COALESCE(e.user_id, l.user_id) AS owner_user_id" in sql
        assert "WHERE owner_user_id IS NOT NULL" in sql
        assert "WHERE owner_user_id IS NULL" in sql

    def test_a_browser_used_by_two_accounts_belongs_to_neither(self):
        sql = m.build_visitor_sql("all")
        assert "NOT EXISTS" in sql
        assert "other.user_id <> ai.user_id" in sql

    def test_the_search_term_is_bound_never_interpolated(self):
        sql = m.build_visitor_sql("all", searching=True)
        assert "ILIKE :q" in sql
        plain = m.build_visitor_sql("all", searching=False)
        assert "ILIKE" not in plain

    def test_the_window_is_bound_too(self):
        sql = m.build_visitor_sql("all")
        assert ":since" in sql and ":until" in sql
        assert ":limit" in sql and ":offset" in sql

    def test_accounts_with_no_activity_sort_last_rather_than_first(self):
        assert "ORDER BY last_seen DESC NULLS LAST" in m.build_visitor_sql("all")

    def test_the_cte_does_not_shadow_a_postgres_keyword(self):
        sql = m.build_visitor_sql("all")
        assert "visitor_rows AS (" in sql
        assert "), rows AS (" not in sql

    def test_nothing_a_caller_sends_can_reach_the_sql(self):
        """kind is validated against VISITOR_KINDS before it gets here, and
        searching is a boolean. There is no third input."""
        import inspect
        params = inspect.signature(m.build_visitor_sql).parameters
        assert set(params) == {"kind", "searching"}

    def test_the_directory_offers_exactly_the_documented_filters(self):
        assert m.VISITOR_KINDS == {"all", "registered", "anonymous",
                                   "paid", "free"}


class TestVisitorPrivacy:
    def test_the_directory_selects_nothing_that_locates_a_person(self):
        sql = m.build_visitor_sql("all").lower()
        for forbidden in ("ip", "user_agent", "latitude", "longitude",
                          "password", "token", "address"):
            assert f" {forbidden}" not in sql, forbidden

    def test_an_anonymous_row_carries_no_account_columns(self):
        """Name, email and subscription are NULL on that branch, so there is
        nothing to leak even if the screen asked for it."""
        sql = m.build_visitor_sql("anonymous")
        assert "NULL::varchar AS name" in sql
        assert "NULL::varchar AS email" in sql
        assert "NULL::varchar AS subscription_status" in sql


class TestJourneyAcceptsEitherIdentity:
    def test_it_takes_an_account_or_a_browser(self):
        import inspect
        params = inspect.signature(m.admin_analytics_journey).parameters
        assert "user_id" in params and "anon_id" in params
        # Both optional: the endpoint refuses neither-or-both itself, which is
        # a clearer error than a query that silently returns everything.
        assert params["user_id"].default.default is None
        assert params["anon_id"].default.default is None

    def test_it_refuses_an_ambiguous_request(self):
        import inspect
        src = inspect.getsource(m.admin_analytics_journey)
        assert "bool(user_id) == bool(anon_id)" in src
