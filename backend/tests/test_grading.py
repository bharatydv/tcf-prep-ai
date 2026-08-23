"""The grading path, and the parts of it that decide what a learner is told.

A grader reply that cannot be read costs the learner a correction and the
credit that paid for it, so the parsing is tested against the shapes models
actually return rather than the shape the prompt asks for.
"""
import pytest

import server as m


GOOD = ('{"errors":[{"error":"je vous ecrit","correction":"je vous ecris",'
        '"explanation":"first person","category":"conjugation"}],'
        '"overall_score":62,"tcf_level":"B2","improvement_suggestions":["a"],'
        '"linking_words":["donc"],"vocabulary_suggestions":["neanmoins"]}')


class TestExtractJson:
    def test_plain_json(self):
        assert m._extract_json(GOOD)["overall_score"] == 62

    def test_fenced_json(self):
        assert m._extract_json("```json\n" + GOOD + "\n```")["tcf_level"] == "B2"

    def test_prose_wrapped_json(self):
        raw = "Here is the analysis:\n" + GOOD + "\nHope this helps!"
        assert m._extract_json(raw)["overall_score"] == 62

    def test_truncated_json_is_refused(self):
        with pytest.raises(ValueError, match="mid-JSON"):
            m._extract_json(GOOD[:80])

    def test_a_reply_with_no_json_is_refused(self):
        with pytest.raises(ValueError, match="no JSON object"):
            m._extract_json("I cannot grade this text.")


class TestValidateAnalysis:
    @pytest.mark.parametrize("level, expected", [
        ('"B2"', "B2"), ('"b2"', "B2"), ('"B2+"', "B2"),
        ('"Niveau B2"', "B2"), ('"B2 (autonome)"', "B2"),
    ])
    def test_accepts_the_levels_models_really_return(self, level, expected):
        raw = GOOD.replace('"B2"', level)
        assert m._validate_analysis(m._extract_json(raw))["tcf_level"] == expected

    @pytest.mark.parametrize("score, expected", [
        ("62", 62), ('"62"', 62), ('"62/100"', 62), ("61.5", 61), ('"62%"', 62),
    ])
    def test_accepts_the_scores_models_really_return(self, score, expected):
        raw = GOOD.replace("62", score, 1)
        got = m._validate_analysis(m._extract_json(raw))["overall_score"]
        assert got == expected

    def test_score_is_clamped_to_the_scale(self):
        raw = GOOD.replace('"overall_score":62', '"overall_score":140')
        assert m._validate_analysis(m._extract_json(raw))["overall_score"] == 100

    def test_a_missing_score_is_not_silently_an_A1(self):
        """Defaulting would tell a fluent writer they are a beginner."""
        with pytest.raises(ValueError, match="missing"):
            m._validate_analysis({"errors": [], "tcf_level": "B1"})

    def test_nonsense_level_is_refused_not_guessed(self):
        with pytest.raises(ValueError, match="unknown level"):
            m._validate_analysis({"errors": [], "overall_score": 60,
                                  "tcf_level": "expert"})

    def test_unknown_error_category_falls_back_rather_than_crashing(self):
        out = m._validate_analysis({
            "errors": [{"error": "x", "correction": "y", "explanation": "z",
                        "category": "invented"}],
            "overall_score": 50, "tcf_level": "B1"})
        assert out["errors"][0]["category"] in m.VALID_CATEGORIES


class TestLevelCaps:
    def _analysis(self, n_errors, level="C1", score=90):
        return {"errors": [{"error": "e", "correction": "c",
                            "explanation": "x", "category": "spelling"}] * n_errors,
                "overall_score": score, "tcf_level": level,
                "improvement_suggestions": [], "linking_words": [],
                "vocabulary_suggestions": []}

    def test_many_errors_cannot_be_awarded_c1(self):
        capped = m.apply_error_cap(self._analysis(8))
        assert capped["tcf_level"] in ("A1", "A2", "B1")

    def test_style_upgrades_do_not_count_as_errors(self):
        a = self._analysis(0)
        a["errors"] = [{"error": "e", "correction": "c", "explanation": "x",
                        "category": "improvement"}] * 8
        assert m.apply_error_cap(a)["tcf_level"] == "C1"

    def test_an_under_length_answer_is_penalised(self):
        """A real examiner marks a 20-word tache 2 down however good it is."""
        short = "Bonjour je m'appelle Marie et j'habite a Montreal depuis deux ans."
        capped = m.apply_writing_length_cap(self._analysis(0), short, 2)
        assert m.CEFR_LEVELS.index(capped["tcf_level"]) < m.CEFR_LEVELS.index("C1")


class TestAudioSafety:
    def test_declared_mime_is_used_when_it_is_on_the_allowlist(self):
        assert m.resolve_audio_mime("a.webm", "audio/webm") == "audio/webm"

    def test_a_bogus_declared_type_falls_back_to_the_extension(self):
        """Client metadata is a hint, never the decision."""
        assert m.resolve_audio_mime("a.mp4", "application/x-evil") == \
            m._AUDIO_MIME_BY_EXT["mp4"]

    def test_an_unknown_extension_gets_a_safe_default(self):
        assert m.resolve_audio_mime("a.exe", None) == "audio/webm"

    def test_the_size_ceiling_is_set(self):
        assert m.MAX_AUDIO_BYTES == 25 * 1024 * 1024


class TestLeakage:
    def test_grading_metadata_never_reaches_the_learner(self):
        """Which provider graded an answer is operational, not a result."""
        pub = m.public_analysis({"overall_score": 60, "tcf_level": "B1",
                                 "ai_provider": "deepseek",
                                 "ai_model": "deepseek-v4-flash",
                                 "ai_error": "bad_reply"})
        assert "ai_provider" not in pub
        assert "ai_model" not in pub
        assert "ai_error" not in pub
        assert pub["overall_score"] == 60

    def test_provider_errors_are_scrubbed_of_anything_key_shaped(self):
        scrubbed = m._scrub_secrets("failed with key sk-abcdef0123456789xyz")
        assert "sk-abcdef0123456789xyz" not in scrubbed
