"""What counts as a mistake somebody keeps making.

This is the rule that was wrong the first time it was written, and wrong in
the way that is hardest to notice: the section simply never appeared. It was
keyed on `times_repeated`, which only moves when the same normalised sentence
comes back — and nobody repeats a sentence. They repeat the kind of mistake,
in different words, which produces a second row rather than a second count.

tests/conftest.py imports server.py with no Postgres behind it, so the query
cannot run here. The rule is a pure function for exactly that reason.
"""
import server as m


def row(category, times=1, ref="sub_1", error="x", correction="y"):
    return {"category": category, "times": times, "ref": ref,
            "error": error, "correction": correction}


class TestGroupRecurring:
    def test_the_same_mistake_in_different_words_still_counts(self):
        """The bug this file exists for.

        Two agreement mistakes from two different answers, each seen once.
        Counting repeats per row gives nothing; counting the habit gives the
        thing the learner actually needs to know.
        """
        out = m.group_recurring([
            row("conjugation", times=1, ref="sub_1", error="les gens est"),
            row("conjugation", times=1, ref="sub_2", error="les voisins était"),
        ])
        assert len(out) == 1
        assert out[0]["category"] == "conjugation"
        assert out[0]["times"] == 2

    def test_one_mistake_made_once_is_not_a_habit(self):
        assert m.group_recurring([row("conjugation")]) == []

    def test_two_mistakes_in_a_single_answer_are_not_yet_a_habit(self):
        """Both from the same submission: that is one bad day, not a pattern,
        and the section is headed "across attempts"."""
        assert m.group_recurring([
            row("prepositions", ref="sub_1", error="participer de"),
            row("prepositions", ref="sub_1", error="besoin à"),
        ]) == []

    def test_the_same_sentence_twice_is_a_habit_on_its_own(self):
        out = m.group_recurring([row("prepositions", times=2, ref="sub_1")])
        assert len(out) == 1
        assert out[0]["times"] == 2

    def test_worst_category_first(self):
        out = m.group_recurring([
            row("prepositions", ref="sub_1"), row("prepositions", ref="sub_2"),
            row("conjugation", ref="sub_1"), row("conjugation", ref="sub_2"),
            row("conjugation", ref="sub_3"), row("conjugation", ref="sub_4"),
        ])
        assert [c["category"] for c in out] == ["conjugation", "prepositions"]

    def test_the_example_is_the_error_made_most_often(self):
        out = m.group_recurring([
            row("conjugation", times=1, ref="sub_1", error="once"),
            row("conjugation", times=5, ref="sub_2", error="over and over"),
        ])
        assert out[0]["example"]["error"] == "over and over"

    def test_at_most_four_cards(self):
        rows = []
        for cat in ("conjugation", "prepositions", "spelling",
                    "gender_number", "anglicism"):
            rows += [row(cat, ref="sub_1"), row(cat, ref="sub_2")]
        assert len(m.group_recurring(rows)) == 4

    def test_the_limit_is_honoured_when_asked_for_something_else(self):
        rows = []
        for cat in ("conjugation", "prepositions", "spelling"):
            rows += [row(cat, ref="sub_1"), row(cat, ref="sub_2")]
        assert len(m.group_recurring(rows, limit=2)) == 2

    def test_a_row_with_no_category_is_skipped_not_crashed_on(self):
        assert m.group_recurring([row(None, ref="sub_1"), row("", ref="sub_2")]) == []

    def test_a_missing_repeat_count_is_read_as_one(self):
        out = m.group_recurring([
            {"category": "spelling", "ref": "sub_1"},
            {"category": "spelling", "ref": "sub_2"},
        ])
        assert out[0]["times"] == 2

    def test_nothing_in_means_nothing_out(self):
        assert m.group_recurring([]) == []

    def test_every_card_carries_an_example_even_when_the_text_is_missing(self):
        out = m.group_recurring([
            {"category": "spelling", "ref": "sub_1"},
            {"category": "spelling", "ref": "sub_2"},
        ])
        assert out[0]["example"] == {"error": "", "correction": ""}
