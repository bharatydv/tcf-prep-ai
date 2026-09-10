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


class TestSpeakingGrid:
    """The criterion-by-criterion grid the result page reads.

    The interesting cases are all absences: a grader that omits a criterion is
    saying it could not judge it, and a candidate must never be shown a zero
    for something nobody assessed.
    """
    def _reply(self, **extra):
        return {"errors": [], "overall_score": 60, "tcf_level": "B2",
                "answers_question": True, "relevance_comment": "ok",
                "suggestions": [], "vocabulary_suggestions": [], **extra}

    def test_the_three_transcript_criteria_are_kept(self):
        out = m._validate_speaking(self._reply(criteria={
            "linguistic": {"score": 61, "comment": "varied tenses"},
            "adequacy": {"score": 70, "comment": "answers the task"},
            "discourse": {"score": 55, "comment": "few connectors"}}))
        assert set(out["criteria"]) == {"linguistic", "adequacy", "discourse"}
        assert out["criteria"]["linguistic"]["score"] == 61

    def test_a_criterion_the_grader_omitted_is_absent_not_zero(self):
        out = m._validate_speaking(self._reply(criteria={
            "linguistic": {"score": 61, "comment": "x"}}))
        assert "phonology" not in out["criteria"]

    def test_a_phonology_score_invented_from_a_transcript_is_still_carried(self):
        """The prompt forbids it; the validator does not silently drop it.

        Dropping it here would hide a grader that ignores the instruction, and
        the slot exists precisely so an audio grader can fill it."""
        out = m._validate_speaking(self._reply(criteria={
            "phonology": {"score": 40, "comment": "hesitant"}}))
        assert out["criteria"]["phonology"]["score"] == 40

    def test_scores_written_as_strings_or_fractions_are_read(self):
        out = m._validate_speaking(self._reply(criteria={
            "linguistic": {"score": "61/100", "comment": "x"},
            "adequacy": {"score": "70%", "comment": "y"}}))
        assert out["criteria"]["linguistic"]["score"] == 61
        assert out["criteria"]["adequacy"]["score"] == 70

    def test_an_unreadable_criterion_score_drops_only_that_criterion(self):
        out = m._validate_speaking(self._reply(criteria={
            "linguistic": {"score": "good", "comment": "x"},
            "adequacy": {"score": 70, "comment": "y"}}))
        assert "linguistic" not in out["criteria"]
        assert out["criteria"]["adequacy"]["score"] == 70

    def test_no_criteria_at_all_is_an_empty_grid_not_a_failure(self):
        out = m._validate_speaking(self._reply())
        assert out["criteria"] == {}
        assert out["overall_score"] == 60

    def test_strengths_and_focus_areas_are_capped_and_cleaned(self):
        out = m._validate_speaking(self._reply(
            strengths=["clear plan", "  ", "good range", "d", "e", "f"],
            focus_areas=["nasal vowels"]))
        assert out["strengths"] == ["clear plan", "good range", "d", "e"]
        assert out["focus_areas"] == ["nasal vowels"]

    def test_a_capped_level_pulls_the_grid_down_with_it(self):
        """A 20-word answer cannot demonstrate B2 range however good it is, so
        a criterion still reading 75 beside a capped A2 headline would be the
        page contradicting itself."""
        graded = {"errors": [], "overall_score": 75, "tcf_level": "B2",
                  "answers_question": True,
                  "criteria": {"linguistic": {"score": 75, "comment": "x"}}}
        out = m.apply_speaking_caps(graded, "Bonjour je m'appelle Marie.", 3)
        assert out["caps_applied"]
        ceiling = m.LEVEL_MAX_SCORE[out["tcf_level"]]
        assert out["criteria"]["linguistic"]["score"] <= ceiling

    def test_an_uncapped_grid_is_left_exactly_as_graded(self):
        graded = {"errors": [], "overall_score": 60, "tcf_level": "B2",
                  "answers_question": True,
                  "criteria": {"adequacy": {"score": 68, "comment": "x"}}}
        out = m.apply_speaking_caps(graded, "mot " * 200, 3)
        assert out["criteria"]["adequacy"]["score"] == 68


class TestSeverity:
    """How much an error costs, as three named weights.

    Absent rather than defaulted: only the speaking graders are asked for it,
    and a writing correction that carries none must not be labelled "moderate"
    by a default nobody chose.
    """
    def _reply(self, **error_extra):
        return {"errors": [{"error": "je vous ecrit", "correction": "je vous ecris",
                            "explanation": "first person", "category": "conjugation",
                            **error_extra}],
                "overall_score": 60, "tcf_level": "B2"}

    def test_a_named_weight_is_kept(self):
        out = m._validate_analysis(self._reply(severity="major"))
        assert out["errors"][0]["severity"] == "major"

    def test_it_is_absent_when_the_grader_did_not_give_one(self):
        assert "severity" not in m._validate_analysis(self._reply())["errors"][0]

    def test_a_weight_outside_the_three_is_absent_not_invented(self):
        out = m._validate_analysis(self._reply(severity="catastrophic"))
        assert "severity" not in out["errors"][0]

    def test_case_and_spacing_do_not_lose_it(self):
        out = m._validate_analysis(self._reply(severity="  Moderate "))
        assert out["errors"][0]["severity"] == "moderate"


class TestCorrectedVersion:
    """The candidate's own answer with the mistakes taken out.

    Kept separate from enhanced_version on purpose: every difference between
    the transcript and this one is a mistake they made, and every difference
    between this one and enhanced_version is a way they could have said it
    better. One field cannot carry both readings.
    """
    def _reply(self, **extra):
        return {"errors": [], "overall_score": 60, "tcf_level": "B2",
                "answers_question": True, **extra}

    def test_it_is_carried_alongside_the_enhanced_one(self):
        out = m._validate_speaking(self._reply(
            corrected_version="Je vous ecris pour reserver une place.",
            enhanced_version="Je me permets de vous ecrire afin de reserver une place."))
        assert out["corrected_version"].startswith("Je vous ecris")
        assert out["enhanced_version"].startswith("Je me permets")

    def test_a_grader_that_omits_it_yields_an_empty_string(self):
        assert m._validate_speaking(self._reply())["corrected_version"] == ""

    def test_a_runaway_rewrite_cannot_fill_the_page(self):
        out = m._validate_speaking(self._reply(corrected_version="mot " * 2000))
        assert len(out["corrected_version"]) <= 2000


class TestLanguageMix:
    """Words produced in another language, which the paper cannot mark at all."""
    def _reply(self, mix):
        return {"errors": [], "overall_score": 60, "tcf_level": "B2",
                "answers_question": True, "language_mix": mix}

    def test_detected_carries_the_languages_and_a_sample(self):
        out = m._validate_speaking(self._reply(
            {"detected": True, "languages": ["English"],
             "sample": "hello, sapko awaz aa rahi thi"}))
        assert out["language_mix"]["languages"] == ["English"]
        assert "hello" in out["language_mix"]["sample"]

    def test_not_detected_is_empty_so_no_banner_is_rendered(self):
        assert m._validate_speaking(self._reply(
            {"detected": False, "languages": [], "sample": ""}))["language_mix"] == {}

    def test_a_missing_or_malformed_field_is_empty(self):
        assert m._validate_speaking(self._reply(None))["language_mix"] == {}
        assert m._validate_speaking(self._reply("yes"))["language_mix"] == {}

    def test_blank_language_names_are_dropped(self):
        out = m._validate_speaking(self._reply(
            {"detected": True, "languages": ["English", "  ", "Hindi"]}))
        assert out["language_mix"]["languages"] == ["English", "Hindi"]


class TestSpeechAudio:
    """The examiner that listens instead of reading.

    It is the one part of a speaking result allowed to come back empty: the
    learner has paid for a grade and has one, so a second provider being down
    must cost them a criterion and never the correction.
    """
    def test_a_clean_reply_fills_the_criterion(self):
        out = m._validate_speech_audio({
            "phonology": {"score": 45, "comment": "the nasal in etranger"},
            "delivery": {"pronunciation": "needs_work", "fluency": "hesitant",
                         "intonation": "flat", "liaisons": "many_errors"},
            "pronunciation_errors": [
                {"word": "positive", "issue": "vowel", "explanation": "open o"}]})
        assert out["phonology"]["score"] == 45
        assert out["delivery"]["fluency"] == "hesitant"
        assert out["pronunciation_errors"][0]["word"] == "positive"

    def test_a_rating_outside_its_scale_is_dropped_not_rendered_blank(self):
        out = m._validate_speech_audio({
            "delivery": {"fluency": "quite good", "intonation": "natural"}})
        assert "fluency" not in out["delivery"]
        assert out["delivery"]["intonation"] == "natural"

    def test_an_unknown_issue_type_falls_back_rather_than_dropping_the_error(self):
        out = m._validate_speech_audio({"pronunciation_errors": [
            {"word": "chien", "issue": "palatal", "explanation": "x"}]})
        assert out["pronunciation_errors"][0]["issue"] == "vowel"

    def test_a_nameless_pronunciation_error_is_dropped(self):
        """"Some sounds were unclear" is not something to go and practise."""
        out = m._validate_speech_audio({"pronunciation_errors": [
            {"word": "  ", "issue": "vowel", "explanation": "x"}]})
        assert out["pronunciation_errors"] == []

    def test_an_unjudgeable_recording_yields_no_score(self):
        out = m._validate_speech_audio({
            "phonology": None, "delivery": {}, "pronunciation_errors": []})
        assert "phonology" not in out

    def test_garbled_badges_do_not_cost_the_criterion(self):
        out = m._validate_speech_audio({
            "phonology": {"score": 62, "comment": "clear"}, "delivery": "good"})
        assert out["phonology"]["score"] == 62
        assert out["delivery"] == {}


class TestMergeSpeechAudio:
    def _graded(self, **extra):
        return {"errors": [], "overall_score": 60, "tcf_level": "B2",
                "answers_question": True,
                "criteria": {"linguistic": {"score": 60, "comment": "x"}},
                **extra}

    def test_phonology_joins_the_grid(self):
        out = m.merge_speech_audio(self._graded(), {
            "phonology": {"score": 45, "comment": "nasal vowels"},
            "delivery": {"fluency": "hesitant"}, "pronunciation_errors": []})
        assert out["criteria"]["phonology"]["score"] == 45
        assert out["criteria"]["linguistic"]["score"] == 60
        assert out["delivery"]["fluency"] == "hesitant"

    def test_pronunciation_errors_never_reach_the_error_cap(self):
        """A mispronounced nasal vowel is not a grammar mistake. Appending it
        to `errors` would drive apply_error_cap and lower the level twice over
        for one fault."""
        out = m.merge_speech_audio(self._graded(), {
            "pronunciation_errors": [{"word": "etranger", "issue": "nasal",
                                      "explanation": "x"}] * 6})
        assert out["errors"] == []
        assert len(out["pronunciation_errors"]) == 6
        assert m.apply_error_cap(out)["tcf_level"] == "B2"

    def test_a_capped_grade_pulls_a_late_phonology_mark_down_too(self):
        capped = self._graded(caps_applied=[{"code": "speakVeryShort"}],
                              tcf_level="A2", overall_score=39)
        out = m.merge_speech_audio(capped, {
            "phonology": {"score": 80, "comment": "very clear"}})
        assert out["criteria"]["phonology"]["score"] <= m.LEVEL_MAX_SCORE["A2"]

    def test_nothing_from_the_audio_examiner_leaves_the_grade_untouched(self):
        graded = self._graded()
        assert m.merge_speech_audio(graded, {}) is graded
        assert "phonology" not in graded["criteria"]

    @pytest.mark.asyncio
    async def test_it_is_off_rather_than_failing_when_there_is_no_key(self, monkeypatch):
        monkeypatch.setattr(m, "GEMINI_API_KEY", "")
        monkeypatch.setattr(m, "SPEECH_AUDIO_PROVIDER", "gemini")
        assert await m.analyze_speech_audio(b"x", "audio/webm", "q", "t") == {}


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


class TestStreamingSessionLifetime:
    """The SSE grading endpoint must not touch the request-scoped session.

    FastAPI tears a `Depends(...yield)` dependency down when the endpoint
    function RETURNS. For a StreamingResponse that is before the body has
    produced a single byte, so a generator using `db` runs against a session
    get_db has already closed — and SQLAlchemy does not raise, it silently
    re-opens and checks out a pool connection nothing will ever check back in.
    One leak per streamed grade, on the busiest AI path in the product.

    Which way round it behaves depends on the installed FastAPI: 0.115 (what
    requirements.txt pins) tears down first, later versions tear down last.
    That is exactly why this is asserted rather than trusted.
    """

    def _generator_source(self):
        import inspect
        import re
        src = inspect.getsource(m.analyze_stream)
        body = src[src.index("async def gen():"):]
        # Comments explain the hazard by name, so compare executable lines only.
        return "\n".join(l for l in body.splitlines()
                         if not l.strip().startswith("#"))

    def test_the_generator_opens_its_own_session(self):
        assert "async with SessionLocal() as sdb:" in self._generator_source()

    def test_the_generator_never_uses_the_request_session(self):
        import re
        code = self._generator_source()
        # `db` PASSED or dereferenced — `f(db,`, `f(db)`, `db.execute`. The
        # keyword name in `db=sdb` is not a use of it, and `sdb` is the
        # generator's own session, so neither matches.
        leaks = [ln.strip() for ln in code.splitlines()
                 if re.search(r"(?<![A-Za-z_])db\s*[,).]", ln)]
        assert not leaks, (
            "analyze_stream's generator still references the request-scoped "
            f"session, which is closed before the stream runs: {leaks}")
