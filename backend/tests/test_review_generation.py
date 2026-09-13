"""What the two generated halves of a review card are allowed to be.

Both of these ask a model for French and then have to decide whether what came
back is usable. The old distractor check was `raw.lower() != correction.lower()`,
which let « il a mange » through as the third option next to « il a mangé » —
an option that is not a choice, printed on the card that decides mastery. No
provider is called here; the reply is the input.
"""
import pytest

import server as m


@pytest.fixture
def reply(monkeypatch):
    """Pin what the grading provider 'returns' for the next call."""
    def set_reply(text):
        async def fake(provider, system_prompt, user_text):
            return text
        monkeypatch.setattr(m, "_grade_with_provider", fake)
    return set_reply


class TestGenerateDistractor:
    async def test_an_accent_only_variant_of_the_answer_is_refused(self, reply):
        reply("il a mange")
        assert await m.generate_distractor(
            "il a manger", "il a mangé", "conjugation") == ""

    async def test_the_correction_echoed_back_is_refused(self, reply):
        reply('"je vais"')
        assert await m.generate_distractor("je va", "je vais", "conjugation") == ""

    async def test_the_learners_own_error_is_refused(self, reply):
        reply("Je Va")
        assert await m.generate_distractor("je va", "je vais", "conjugation") == ""

    async def test_an_empty_reply_leaves_the_card_with_two_options(self, reply):
        reply("")
        assert await m.generate_distractor("je va", "je vais", "conjugation") == ""

    async def test_another_tense_of_the_same_verb_is_kept(self, reply):
        reply("j'allais")
        assert await m.generate_distractor(
            "je va", "je vais", "conjugation") == "j'allais"

    async def test_a_provider_failure_is_not_fatal(self, monkeypatch):
        async def boom(provider, system_prompt, user_text):
            raise RuntimeError("provider down")
        monkeypatch.setattr(m, "_grade_with_provider", boom)
        assert await m.generate_distractor("je va", "je vais", "conjugation") == ""


class TestGenerateTransfer:
    ARGS = ("je va", "je vais", "aller is irregular", "conjugation")

    async def test_a_well_formed_drill_is_kept(self, reply):
        reply('{"stem": "Demain nous ____ au cinéma.", "answer": "allons", '
              '"hint": "aller, first person plural"}')
        drill = await m.generate_transfer(*self.ARGS)
        assert drill["stem"].count("____") == 1
        assert drill["answer"] == "allons"

    async def test_a_drill_with_no_blank_is_dropped(self, reply):
        reply('{"stem": "Demain nous allons au cinéma.", "answer": "allons"}')
        assert await m.generate_transfer(*self.ARGS) == {}

    async def test_a_drill_that_answers_itself_is_dropped(self, reply):
        reply('{"stem": "nous allons ____ demain", "answer": "allons"}')
        assert await m.generate_transfer(*self.ARGS) == {}

    async def test_a_drill_that_just_repeats_the_correction_is_dropped(self, reply):
        # The whole point is a sentence the learner has not memorised.
        reply('{"stem": "Hier ____ au marché.", "answer": "je vais"}')
        assert await m.generate_transfer(*self.ARGS) == {}

    async def test_a_reply_that_is_not_json_is_dropped(self, reply):
        reply("Sure! Here is a drill for you.")
        assert await m.generate_transfer(*self.ARGS) == {}
