"""Which of the four papers a graded submission belongs to.

This is one line of code and it has a test file because it was six copies of
one line, spread across two Python functions and two React pages, and the day
Test Mode started writing `speaking_exam` not one of them was updated. Every
spoken answer given in a speaking paper was then filed as writing: oral marks
raised the written level, the written level decided the headline CLB band on
the dashboard, and a candidate whose speaking practice was all Test Mode was
told they had not practised speaking at all. The result page read the same
list and served those answers as essays, with no transcript and no recording.

The point of these tests is therefore not the branch — it is that there is one
list and everything reads it.
"""
import server as m


class TestSubmissionSkill:
    """Every source the product writes, and the paper it belongs to."""

    def test_loose_speaking_practice_is_speaking(self):
        assert m.submission_skill("speaking") == "speaking"

    def test_a_test_mode_tache_is_speaking(self):
        """The one that was wrong for as long as Test Mode existed."""
        assert m.submission_skill("speaking_exam") == "speaking"

    def test_free_conversation_is_speaking(self):
        """It answers no tâche, which is a different question from which
        paper it is. Somebody who only ever used free mode has practised
        speaking."""
        assert m.submission_skill("conversation") == "speaking"

    def test_written_practice_and_pasted_text_are_writing(self):
        assert m.submission_skill("practice") == "writing"
        assert m.submission_skill("paste") == "writing"

    def test_an_unknown_source_is_writing_rather_than_a_crash(self):
        """Three of the four papers are not graded from a submission at all,
        so the only other thing one can be is a text."""
        assert m.submission_skill("something_new") == "writing"
        assert m.submission_skill("") == "writing"
        assert m.submission_skill(None) == "writing"


class TestOneList:
    """The lists that used to disagree, and now cannot."""

    def test_every_spoken_source_is_in_the_full_list(self):
        for source in ("speaking", "speaking_exam", "conversation"):
            assert source in m.ALL_SPEAKING_SOURCES

    def test_no_written_source_is(self):
        for source in ("practice", "paste", "simulator"):
            assert source not in m.ALL_SPEAKING_SOURCES

    def test_the_comparison_list_is_a_subset_of_it(self):
        """SPEAKING_SOURCES answers "what should this attempt be compared
        with", which is narrower on purpose — free conversation is compared
        only against itself — but it must never name a source the full list
        has not heard of."""
        assert set(m.SPEAKING_SOURCES) <= set(m.ALL_SPEAKING_SOURCES)

    def test_the_admin_view_reads_the_same_list(self):
        """It had a copy of its own, two sources long."""
        assert m.SPOKEN_SOURCES == m.ALL_SPEAKING_SOURCES
