"""The number that decides whether somebody is already in the group.

One person types "+1 (555) 010-1234" into the popup today and "001 555 010
1234" next month. If those two are not the same string by the time they reach
the database, that person gets a second invitation to a group they are already
in — which is the one thing the form is not allowed to do.
"""
import server


def test_one_number_typed_four_ways_is_one_key():
    typed = [
        "+1 555 010 1234",
        "+1 (555) 010-1234",
        "001-555-010-1234",
        "+15550101234",
    ]
    keys = {server.whatsapp_key(value) for value in typed}
    assert keys == {"+15550101234"}


def test_the_country_code_is_part_of_the_identity():
    # The same nine digits in France and in India are two different people,
    # and nothing here is allowed to guess which country a bare number is in.
    assert server.whatsapp_key("+33 6 12 34 56 78") != server.whatsapp_key("+91 612 345 678")


def test_a_number_that_cannot_be_read_never_raises():
    # normalize_phone refuses; this one must not. A lead is lost the moment
    # the endpoint answers with an error, and the shape of a phone number is
    # not worth losing one over.
    assert server.whatsapp_key("") == ""
    assert server.whatsapp_key("   ") == ""
    assert server.whatsapp_key("call me") == ""
    assert server.whatsapp_key(None) == ""


def test_the_key_matches_the_backfill_sql():
    """The migration backfills phone_key in Postgres, not in Python.

    Both have to agree, or a number given before the column existed stops
    matching the same number given after it — and the person is invited twice.
    This pins the rule the SQL implements: strip to digits, drop a leading 00,
    prefix a +.
    """
    backfill = [stmt for stmt in server.MIGRATIONS
                if "UPDATE leads SET phone_key" in stmt]
    assert len(backfill) == 1
    sql = backfill[0]
    assert "regexp_replace(phone, '\\D', '', 'g')" in sql
    assert "'^00', ''" in sql
    assert "'+' ||" in sql


def test_the_guide_page_form_needs_no_number():
    """Two forms, one schema.

    The exit dialog sends a number; the guide page sends a level and no
    number. Both must pass, or one of the two forms silently 422s and the
    lead it was collecting never arrives.
    """
    dialog = server.LeadIn(name="Ana", email="ana@example.com",
                           phone="+1 555 010 1234")
    assert dialog.level == ""
    page = server.LeadIn(name="Ana", email="ana@example.com", level="B1")
    assert page.phone == ""
    assert page.level == "B1"


def test_a_number_that_is_given_is_still_checked():
    # Optional is not the same as unchecked: "call me" was refused before and
    # is refused now, because it cannot be dialled.
    import pytest
    with pytest.raises(Exception):
        server.LeadIn(name="Ana", email="ana@example.com", phone="call me")
