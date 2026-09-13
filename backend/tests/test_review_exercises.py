"""What a review card is allowed to ask, and what it must refuse to ask.

The cases that open each class are the ones that shipped: an option that was
also the stem, an option that differed from the answer by one accent, and a
question built from a fragment with nobody in it. They are regression tests,
not illustrations.
"""
import pytest

import review_exercises as rx


SENTENCE = "Hier je va au marché avec mes amis."


def mistake(**over):
    """A conjugation row as record_mistakes writes it, plus its sentence."""
    row = {
        "error_text": "je va",
        "correction": "je vais",
        "distractor": "j'allais",
        "context_sentence": SENTENCE,
        "category": "conjugation",
    }
    row.update(over)
    return row


class TestComparisonForms:
    def test_canon_ignores_accents_case_and_punctuation(self):
        assert rx.canon("À côté !") == rx.canon("a cote")

    def test_loose_keeps_accents_but_drops_punctuation(self):
        assert rx.loose("Vais.") == "vais"
        assert rx.loose("où") != rx.loose("ou")

    def test_accent_only_options_are_near_duplicates(self):
        assert rx.near_duplicate("il a mangé", "il a mange")

    def test_a_real_alternative_is_not_a_near_duplicate(self):
        assert not rx.near_duplicate("je vais", "je vont")


class TestHasSubject:
    @pytest.mark.parametrize("phrase", [
        "je va", "nous allons", "il faut que", "C'est bien",
        "notre tracteur", "les enfant joue",
    ])
    def test_subject_bearing_phrases(self, phrase):
        assert rx.has_subject(phrase)

    @pytest.mark.parametrize("phrase", [
        "aller au marché", "va au marché", "néparnassais", "",
        "prendre une décision",
    ])
    def test_phrases_with_nobody_in_them(self, phrase):
        assert not rx.has_subject(phrase)

    def test_a_capital_on_the_first_word_is_not_a_proper_noun(self):
        # A fragment lifted out of a sentence is capitalised either way.
        assert not rx.has_subject("Prendre le train")

    def test_a_capital_further_in_is(self):
        assert rx.has_subject("avec Marie hier")


class TestSentenceContaining:
    TEXT = ("Je m'appelle Paul. Hier je va au marché avec mes amis. "
            "C'était une belle journée.")

    def test_pulls_the_sentence_the_error_was_made_in(self):
        assert rx.sentence_containing(self.TEXT, "je va") == SENTENCE

    def test_matches_across_accents_and_case(self):
        assert rx.sentence_containing("Il a mangé la pomme.", "A MANGE")

    def test_matches_across_a_line_break_inside_the_fragment(self):
        assert rx.sentence_containing("je\nva au marché.", "je va")

    def test_returns_empty_when_the_error_is_not_in_the_text(self):
        assert rx.sentence_containing(self.TEXT, "nous mangeons") == ""

    def test_does_not_match_inside_a_longer_word(self):
        # « je va » is a prefix of « je vais »; matching there would blank out
        # two thirds of a verb the learner wrote correctly.
        assert rx.sentence_containing("Je vais au marché.", "je va") == ""
        both = "Je vais au marché et je va à la gare."
        start, end = rx.locate(both, "je va")
        assert both[start:end] == "je va"
        assert both[:start] == "Je vais au marché et "

    def test_a_paragraph_break_still_ends_a_sentence(self):
        text = "Bonjour\n\nHier je va au marché avec mes amis."
        assert rx.sentence_containing(text, "je va").startswith("Hier")

    def test_an_unpunctuated_paragraph_is_windowed_around_the_error(self):
        text = ("alors " * 60) + "je va " + ("ensuite " * 60)
        out = rx.sentence_containing(text, "je va")
        assert "je va" in out
        assert len(out) <= rx.MAX_CONTEXT_CHARS + 8
        assert out.startswith("… ") and out.endswith(" …")


class TestBlankOut:
    def test_replaces_the_error_and_keeps_the_subject_visible(self):
        assert rx.blank_out(SENTENCE, "va") == "Hier je ____ au marché avec mes amis."

    def test_refuses_when_the_error_was_the_whole_sentence(self):
        assert rx.blank_out("Je va.", "Je va") is None

    def test_refuses_when_the_fragment_is_not_there(self):
        assert rx.blank_out(SENTENCE, "nous allons") is None


class TestSplitSegments:
    def test_the_error_is_one_whole_segment(self):
        segments, guilty = rx.split_segments(SENTENCE, "je va")
        assert segments[guilty] == "je va"
        assert 3 <= len(segments) <= 4
        assert " ".join(segments).replace("  ", " ").startswith("Hier je va")

    def test_a_long_side_is_halved_to_make_a_fourth_segment(self):
        long_one = "Quand je suis arrivé à la gare hier soir je va directement."
        segments, guilty = rx.split_segments(long_one, "je va")
        assert len(segments) == 4
        assert segments[guilty] == "je va"

    def test_trailing_punctuation_joins_the_error_instead_of_being_a_segment(self):
        # A lone "." was being offered as a fourth thing to click.
        segments, guilty = rx.split_segments(
            "Hier je suis allé à la gare pour attendre ma soeur.", "ma soeur")
        assert "." not in segments
        assert segments[guilty] == "ma soeur."

    def test_refuses_a_sentence_that_is_only_the_error(self):
        assert rx.split_segments("Je va", "Je va") is None

    def test_refuses_when_there_is_too_little_to_hide_among(self):
        assert rx.split_segments("Je va vite", "Je va") is None


class TestMcqProblem:
    def test_an_option_that_is_the_stem_is_refused(self):
        # The shipped bug: stem was the error, and the error was an option.
        assert rx.mcq_problem("je va", ["je vais", "je va"],
                              "je vais") == "option_is_the_stem"

    def test_two_options_differing_only_by_an_accent_are_refused(self):
        assert rx.mcq_problem(None, ["il a mangé", "il a mange"],
                              "il a mangé") == "duplicate_options"

    def test_a_single_option_is_refused(self):
        assert rx.mcq_problem(None, ["je vais"], "je vais") == "too_few_options"

    def test_an_answer_that_is_not_on_screen_is_refused(self):
        assert rx.mcq_problem(None, ["je vont", "je allez"],
                              "je vais") == "answer_missing"

    def test_an_option_printed_inside_the_stem_is_refused(self):
        assert rx.mcq_problem("Hier je vais au marché ____.",
                              ["je vais", "je vont"],
                              "je vais") == "option_visible_in_stem"

    def test_a_short_option_inside_the_stem_is_tolerated(self):
        # Rejecting these would empty the preposition category.
        assert rx.mcq_problem("Je vais ____ la gare de Lyon.",
                              ["à", "en"], "à") is None

    def test_a_sound_question_passes(self):
        assert rx.mcq_problem("Hier je ____ au marché.",
                              ["je vais", "je va", "je vont"], "je vais") is None


class TestValidDistractor:
    def test_rejects_the_correction_back_again(self):
        assert not rx.valid_distractor("je vais", "je va", "je vais")

    def test_rejects_an_accent_stripped_correction(self):
        assert not rx.valid_distractor("il a mange", "il a manger", "il a mangé")

    def test_rejects_the_learners_own_error(self):
        assert not rx.valid_distractor("JE VA", "je va", "je vais")

    def test_accepts_another_tense_of_the_same_verb(self):
        # What _DISTRACTOR_RULE asks the model for: same subject, same verb,
        # a tense a learner really does reach for by mistake.
        assert rx.valid_distractor("j'allais", "je va", "je vais")


class TestBuildForms:
    def test_the_mcq_stem_is_the_sentence_with_the_error_blanked(self):
        forms = rx.build_forms(mistake())
        assert forms["mcq"]["stem"] == "Hier ____ au marché avec mes amis."
        assert forms["mcq"]["answer"] == "je vais"

    def test_the_learners_error_is_an_option_because_the_stem_hides_it(self):
        assert "je va" in rx.build_forms(mistake())["mcq"]["options"]

    def test_no_option_is_ever_the_stem(self):
        forms = rx.build_forms(mistake())
        stem = forms["mcq"]["stem"]
        assert all(not rx.near_duplicate(o, stem) for o in forms["mcq"]["options"])

    def test_an_accent_only_distractor_is_dropped_rather_than_shown(self):
        forms = rx.build_forms(mistake(correction="il a mangé",
                                       error_text="il a manger",
                                       distractor="il a mange",
                                       context_sentence="Hier il a manger une pomme."))
        assert forms["mcq"]["options"] == ["il a mangé", "il a manger"]

    def test_a_subjectless_fragment_with_no_sentence_gets_no_mcq(self):
        forms = rx.build_forms(mistake(error_text="aller au marché",
                                       correction="allé au marché",
                                       context_sentence=""))
        assert "mcq" not in forms

    def test_a_subject_bearing_fragment_with_no_sentence_still_gets_one(self):
        forms = rx.build_forms(mistake(context_sentence=""))
        assert forms["mcq"]["stem"] is None
        assert "je va" in forms["mcq"]["options"]

    def test_a_sentence_that_already_prints_the_answer_loses_its_blank(self):
        # « Je vais au marché et je va à la gare » — filling the gap is copying
        # the clause before it, so neither blank-based card is offered. The
        # options still carry the subject, so the stemless MCQ survives.
        forms = rx.build_forms(mistake(
            context_sentence="Je vais au marché et je va à la gare."))
        assert "cloze" not in forms
        assert forms["mcq"]["stem"] is None
        assert forms["spot"]["segments"][forms["spot"]["answer_index"]] == "je va"

    def test_a_sentence_that_does_not_contain_the_error_is_discarded(self):
        forms = rx.build_forms(mistake(context_sentence="Une phrase sans rapport."))
        assert forms["mcq"]["stem"] is None
        assert "cloze" not in forms and "spot" not in forms

    def test_cloze_and_spot_need_the_sentence(self):
        forms = rx.build_forms(mistake())
        assert forms["cloze"]["stem"] == forms["mcq"]["stem"]
        assert forms["spot"]["segments"][forms["spot"]["answer_index"]] == "je va"

    def test_the_pair_shows_two_full_sentences_that_differ(self):
        pair = rx.build_forms(mistake())["pair"]
        assert pair["wrong"] == SENTENCE
        assert pair["right"] == "Hier je vais au marché avec mes amis."

    def test_the_corrected_sentence_keeps_its_opening_capital(self):
        # The grader quotes errors back in lower case, so splicing « il a
        # mangé » into a sentence that opened « Il a manger » used to produce a
        # "correct" version starting with a small letter — on the one card
        # whose whole job is a difference the learner has to spot.
        pair = rx.build_forms(mistake(
            error_text="il a manger", correction="il a mangé",
            context_sentence="Il a manger une pomme avant de partir."))["pair"]
        assert pair["right"] == "Il a mangé une pomme avant de partir."

    def test_the_pair_falls_back_to_the_fragments_without_a_sentence(self):
        pair = rx.build_forms(mistake(context_sentence=""))["pair"]
        assert (pair["wrong"], pair["right"]) == ("je va", "je vais")

    def test_typeit_is_offered_for_every_row(self):
        assert "typeit" in rx.build_forms(mistake(context_sentence="",
                                                  distractor=""))

    def test_a_row_whose_correction_equals_its_error_yields_nothing(self):
        assert rx.build_forms(mistake(correction="je va")) == {}

    def test_a_transfer_drill_must_move_off_the_original_sentence(self):
        same = rx.build_forms(mistake(transfer={"stem": "Hier ____ au marché.",
                                                "answer": "je vais"}))
        assert "transfer" not in same

    def test_a_transfer_drill_with_a_new_subject_is_kept(self):
        forms = rx.build_forms(mistake(transfer={"stem": "Demain nous ____ au cinéma.",
                                                 "answer": "allons"}))
        assert forms["transfer"]["answer"] == "allons"

    def test_a_transfer_drill_printing_its_own_answer_is_refused(self):
        forms = rx.build_forms(mistake(transfer={"stem": "nous allons ____ demain",
                                                 "answer": "allons"}))
        assert "transfer" not in forms


class TestAvailableModes:
    def test_a_full_row_offers_everything_but_the_ungenerated_drill(self):
        modes = rx.available_modes(rx.build_forms(mistake()))
        assert set(modes) == {"flashcards", "mcq", "sprint", "cloze", "spot",
                              "typeit", "pair"}

    def test_a_bare_fragment_still_offers_the_two_that_need_nothing(self):
        modes = rx.available_modes(rx.build_forms(
            mistake(error_text="aller au marché", correction="allé au marché",
                    context_sentence="", distractor="")))
        assert set(modes) == {"flashcards", "typeit", "pair"}


class TestGrade:
    def test_a_picked_option_is_graded_against_the_correction(self):
        assert rx.grade("mcq", mistake(), answer="je vais") == (True, "")
        assert rx.grade("mcq", mistake(), answer="je va") == (False, "")

    def test_a_flashcard_is_the_learners_own_word(self):
        assert rx.grade("flashcards", mistake(), self_rated=True) == (True, "")

    def test_a_typed_answer_ignores_case_and_punctuation(self):
        assert rx.grade("cloze", mistake(), answer=" Je vais. ") == (True, "")

    def test_a_typed_answer_missing_an_accent_is_wrong_and_says_why(self):
        row = mistake(correction="il a mangé", error_text="il a manger",
                      context_sentence="Hier il a manger une pomme.")
        assert rx.grade("cloze", row, answer="il a mange") == (False, "accent")

    def test_a_clicked_answer_missing_an_accent_is_not_punished(self):
        # Nobody types on an MCQ; the option was rendered with its accents.
        row = mistake(correction="il a mangé", error_text="il a manger",
                      context_sentence="Hier il a manger une pomme.")
        assert rx.grade("mcq", row, answer="il a mange") == (True, "")

    def test_spot_is_graded_against_the_guilty_segment(self):
        assert rx.grade("spot", mistake(), answer="je va") == (True, "")
        assert rx.grade("spot", mistake(), answer="au marché") == (False, "")

    def test_the_pair_is_graded_against_the_corrected_sentence(self):
        assert rx.grade("pair", mistake(),
                        answer="Hier je vais au marché avec mes amis.") == (True, "")
        assert rx.grade("pair", mistake(), answer=SENTENCE) == (False, "")

    def test_transfer_is_graded_against_its_own_answer_not_the_correction(self):
        row = mistake(transfer={"stem": "Demain nous ____ au cinéma.",
                                "answer": "allons"})
        assert rx.grade("transfer", row, answer="allons") == (True, "")
        assert rx.grade("transfer", row, answer="je vais") == (False, "")

    def test_a_mode_whose_form_could_not_be_built_grades_as_wrong(self):
        assert rx.grade("transfer", mistake(), answer="allons") == (False, "")

    def test_an_empty_answer_is_never_correct(self):
        assert rx.grade("cloze", mistake(), answer="") == (False, "")
