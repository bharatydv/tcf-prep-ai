"""Turning a wrong answer on an answer-key paper into a correction.

Compréhension écrite and orale produce no grader output, so the dashboard told
candidates that "error analysis covers writing and speaking only" and showed
them nothing for half the exam. The material was always there: the attempt
stores the answer sheet and the bank holds the right answer, why each
distractor fails, and the line that decides it. These tests pin the shape that
material is read back in, because the corrections table reads a reading
mistake and a conjugation mistake through exactly the same five columns.
"""
import server as m


def option(oid, text, explanation=""):
    return {"id": oid, "text": text, "explanation": explanation}


OPTIONS = [
    option("A", "La description du personnage", "The text is about events."),
    option("B", "Le déroulement des événements"),
    option("C", "Le style de l'auteur", "Style is never discussed."),
]


def row(**kw):
    base = dict(skill="reading", position=30, level="B2", options=OPTIONS,
                correct_answer="B", picked="A",
                explanation="The passage narrates.", key_line_fr="Rien ne sert…",
                breakdown="A longer worked reasoning.")
    base.update(kw)
    return m._comprehension_row(**base)


class TestSeverity:
    """What a missed item cost, on the paper's own scale.

    Not a judgement call: the official TCF weights every item by where it
    sits, three points for the four easiest and thirty-three for the four
    hardest, so "how much did this cost" is arithmetic. See TCF_ITEM_POINTS.
    """

    def test_the_easiest_items_are_minor(self):
        assert m._comprehension_severity(1) == "minor"
        assert m._comprehension_severity(4) == "minor"

    def test_the_middle_of_the_paper_is_moderate(self):
        assert m._comprehension_severity(5) == "moderate"
        assert m._comprehension_severity(19) == "moderate"

    def test_the_items_that_decide_the_level_are_major(self):
        assert m._comprehension_severity(20) == "major"
        assert m._comprehension_severity(39) == "major"

    def test_it_agrees_with_the_weighting_it_claims_to_read(self):
        """If TCF_ITEM_POINTS ever changes, this moves with it rather than
        quietly reporting the old bands."""
        for position in range(1, 40):
            points = m.tcf_item_points(position)
            severity = m._comprehension_severity(position)
            assert severity == ("major" if points >= 21
                                else "moderate" if points >= 9 else "minor")


class TestRow:
    """The five columns the corrections table actually renders."""

    def test_said_and_should_have_been_are_the_two_options(self):
        r = row()
        assert r["error"] == "La description du personnage"
        assert r["correction"] == "Le déroulement des événements"

    def test_why_prefers_the_explanation_of_the_option_actually_picked(self):
        """The question's general explanation says what the text is about.
        The picked option's says why THAT answer is wrong, which is the only
        one of the two about the mistake the candidate made."""
        assert row()["explanation"] == "The text is about events."

    def test_why_falls_back_to_the_question_then_to_the_breakdown(self):
        assert row(picked="B", correct_answer="A")["explanation"] == "The passage narrates."
        assert row(explanation="", picked="B",
                   correct_answer="A")["explanation"] == "A longer worked reasoning."

    def test_remember_carries_the_line_that_decides_the_answer(self):
        assert row()["remember"] == "Rien ne sert…"

    def test_the_type_column_names_the_paper_not_a_grammar_category(self):
        """A missed inference is not a preposition error, and filing it as one
        would put it in a drill that cannot teach it."""
        assert row()["category"] == "reading"
        assert row(skill="listening")["category"] == "listening"

    def test_a_wrong_answer_is_always_an_error_never_a_style_upgrade(self):
        assert row()["kind"] == "error"

    def test_an_unanswered_item_says_nothing_rather_than_guessing(self):
        """Running out of time is not the same mistake as picking the wrong
        option, and the paper scoring both as nil does not make them one."""
        r = row(picked=None)
        assert r["error"] == ""
        assert r["correction"] == "Le déroulement des événements"

    def test_a_spoken_option_with_no_printed_text_falls_back_to_its_letter(self):
        """The oral paper speaks the options on its first ten questions
        instead of printing them, so an empty `text` there is the data being
        correct. "You answered B" is useful; an empty cell is not."""
        spoken = [option("A", ""), option("B", "")]
        r = row(skill="listening", options=spoken, correct_answer="B", picked="A")
        assert r["error"] == "A"
        assert r["correction"] == "B"

    def test_a_repeat_count_is_attached_only_when_there_is_one(self):
        assert "times_repeated" not in row()
        assert row(times_repeated=3)["times_repeated"] == 3

    def test_there_is_no_row_at_all_when_the_key_is_missing(self):
        """Without the right answer there is nothing to correct towards, and
        a row showing only what the candidate picked would teach nothing."""
        assert row(correct_answer="Z") is None

    def test_it_carries_the_paper_it_came_from(self):
        """The dashboard mixes all four papers under "All" and needs to know
        which is which without re-deriving it."""
        assert row()["skill"] == "reading"
        assert row(skill="listening")["skill"] == "listening"


class TestBothPapersAreCovered:
    def test_each_comprehension_paper_has_its_tables_named(self):
        for skill in ("reading", "listening"):
            attempts, questions, qid = m._COMPREHENSION[skill]
            assert attempts.endswith("_attempts")
            assert questions.endswith("_questions")
            assert qid.endswith("_question_id")

    def test_the_filter_covers_every_paper_the_dashboard_offers(self):
        assert set(m._SKILL_PAPERS) == {"writing", "speaking", "reading", "listening"}
