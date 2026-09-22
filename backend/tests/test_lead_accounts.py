"""The account the free-PDF form opens, and the door it must not open.

The form asks for a name, an address, a number and a level, and makes an
account out of them with no password. That buys a much shorter path back —
the first time somebody practises they are finishing an account rather than
starting one — and it costs two things that have to be held down by tests,
because getting either wrong is worse than never having had the feature.

The first is the login door. An account with no password must not be one that
any password opens.

The second is whose account it is. Nobody proved they own the address they
typed, so an unfinished account has to be worth nothing until somebody does.
"""
import pytest
from fastapi import HTTPException

import server


def a_user(**over):
    """A User the way the code under test reads one. Never saved anywhere."""
    fields = dict(user_id="user_test", email="a@example.com",
                  password_hash="hash", password_set=True, name="Ana",
                  level="B1", role="user", email_verified=True,
                  phone_verified=False, subscription_status="free")
    fields.update(over)
    return server.User(**fields)


class TestWhatCounts:
    """account_complete is the one definition; everything else reads it."""

    def test_a_password_and_a_confirmed_address_is_finished(self):
        assert server.account_complete(a_user()) is True

    def test_a_confirmed_number_counts_instead_of_the_address(self):
        # Many learners abroad read an SMS long before they find a mail from
        # an unfamiliar domain, and the account has said so since phone
        # confirmation was added. This stays true here.
        assert server.account_complete(
            a_user(email_verified=False, phone_verified=True)) is True

    def test_no_password_is_not_finished_however_confirmed(self):
        assert server.account_complete(
            a_user(password_set=False, email_verified=True)) is False

    def test_a_password_alone_is_not_finished(self):
        assert server.account_complete(
            a_user(email_verified=False, phone_verified=False)) is False


class TestTheLoginDoor:
    def test_no_password_means_no_password_opens_it(self):
        """The whole security argument for storing "" rather than a hash.

        verify_password swallows the bcrypt error and answers False, so an
        account the download form made cannot be signed into by guessing,
        by the empty string, or by anything else.
        """
        for attempt in ["", " ", "password", "hunter2", "null", "undefined"]:
            assert server.verify_password(attempt, "") is False

    def test_the_timing_equaliser_is_not_a_way_in_either(self):
        assert server.verify_password(
            "prepfrancais-timing-equaliser", "") is False


class TestTheDoorIsShutOnUnfinishedAccounts:
    async def test_an_unfinished_account_is_turned_away(self):
        with pytest.raises(HTTPException) as caught:
            await server.get_current_user(a_user(password_set=False))
        assert caught.value.status_code == 403
        # The code is what opens the finish form. A bare 401 would sign them
        # out and lose the details the form is meant to hand back.
        assert caught.value.detail["code"] == "account_incomplete"

    async def test_an_unconfirmed_address_is_turned_away_too(self):
        with pytest.raises(HTTPException) as caught:
            await server.get_current_user(
                a_user(email_verified=False, phone_verified=False))
        assert caught.value.status_code == 403

    async def test_a_finished_account_passes(self):
        user = a_user()
        assert await server.get_current_user(user) is user


class TestWhatTheBrowserIsTold:
    def test_the_interface_is_told_what_is_missing(self):
        out = server.public_user(a_user(password_set=False, level="A2"))
        assert out["complete"] is False
        assert out["password_set"] is False
        assert out["level"] == "A2"

    def test_a_finished_account_says_so(self):
        assert server.public_user(a_user())["complete"] is True


class TestTheFinishForm:
    def test_only_the_password_is_required(self):
        # Name, number and level come back prefilled from the account, so a
        # blank one means "unchanged" and must not be a validation error.
        body = server.FinishRegistrationIn(password="a-long-enough-one")
        assert (body.name, body.phone, body.level) == ("", "", "")

    def test_a_short_password_is_refused(self):
        with pytest.raises(Exception):
            server.FinishRegistrationIn(password="short")

    def test_the_code_is_digits(self):
        assert server.EmailCodeIn(code="012345").code == "012345"
        with pytest.raises(Exception):
            server.EmailCodeIn(code="abcdef")


class TestTheMigration:
    def test_existing_accounts_keep_their_password(self):
        """password_set defaults TRUE, or every account made before today
        would be read as unfinished and locked out of the whole site."""
        adds = [m for m in server.MIGRATIONS
                if "users ADD COLUMN IF NOT EXISTS password_set" in m]
        assert len(adds) == 1
        assert "DEFAULT TRUE" in adds[0]
        assert any("UPDATE users SET password_set = TRUE" in m
                   for m in server.MIGRATIONS)

    def test_the_level_column_is_added(self):
        assert any("users ADD COLUMN IF NOT EXISTS level" in m
                   for m in server.MIGRATIONS)
