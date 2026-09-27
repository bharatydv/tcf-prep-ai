"""A roleplay graded together with the candidate's recording.

Every outside call is replaced: the transcriber, the grader, the database and
the disk. What is left is the decision this endpoint makes — which words the
grader marks, and what is kept so a correction can play the candidate's own
voice.
"""
from types import SimpleNamespace

import pytest

import server as m

WORDS = [{"text": "Je", "start": 0, "end": 200},
         {"text": "suis", "start": 200, "end": 450},
         {"text": "originaire", "start": 450, "end": 900},
         {"text": "de", "start": 900, "end": 1000},
         {"text": "Inde.", "start": 1000, "end": 1400}]


@pytest.fixture
def seen(monkeypatch):
    got = {}

    async def reserve(db, user, *a, **k):
        return user

    async def transcribe(audio, filename, db=None, mime=""):
        got["transcribed"] = (audio, filename, mime)
        return {"text": got.get("recorded", "Je suis originaire de Inde."),
                "words": WORDS}

    async def grade(consigne, history, db=None, task_type=None):
        got["history"] = history
        return {"errors": [], "overall_score": 50, "tcf_level": "B1",
                "improvement_suggestions": [], "linking_words": [],
                "vocabulary_suggestions": []}

    async def persist(db, user, text, prompt_id, analysis, **k):
        got["analysis"] = dict(analysis)
        return {"submission_id": "sub_x", "streak": 1}

    async def keep(db, sid, uid, data, mime):
        got["kept"] = (sid, data, mime)
        return f"speaking/{uid}/{sid}.webm"

    async def history(*a, **k):
        return {}

    monkeypatch.setattr(m, "reserve_credit", reserve)
    monkeypatch.setattr(m, "transcribe_audio_detailed", transcribe)
    monkeypatch.setattr(m, "grade_interaction", grade)
    monkeypatch.setattr(m, "persist_submission", persist)
    monkeypatch.setattr(m, "store_recording", keep)
    monkeypatch.setattr(m, "learning_history", history)
    return got


USER = SimpleNamespace(user_id="user_1")


def body(mode, candidate):
    return m.ConverseGradeIn(consigne="Présentez-vous.", mode=mode, exam_set=23, history=[
        {"role": "agent", "text": "Présentez-vous."},
        *({"role": "candidate", "text": t} for t in candidate)])


def candidate_lines(history):
    return [t["text"] for t in history if t["role"] == "candidate"]


async def test_tache1_is_graded_on_the_recording(seen):
    out = await m.grade_conversation(body("tache1", ["Je suis originaire", "de Inde"]),
                                     USER, None, audio_bytes=b"voice",
                                     filename="session.webm", mime="audio/webm")
    assert candidate_lines(seen["history"]) == ["Je suis originaire de Inde."]
    assert seen["kept"] == ("sub_x", b"voice", "audio/webm")
    assert out["has_audio"] is True
    # Timed like a tâche 3 answer, so a correction finds its own words.
    assert out["speech_words"][0] == {"t": "Je", "s": 0, "e": 200}
    assert out["transcript"].endswith("Candidat : Je suis originaire de Inde.")
    assert seen["analysis"]["speech_words"] == out["speech_words"]


async def test_a_recording_cut_short_does_not_replace_a_fuller_answer(seen):
    seen["recorded"] = "Je"
    browser = ["Je suis originaire de Inde et j'habite à Toronto depuis deux ans"]
    await m.grade_conversation(body("tache1", browser), USER, None,
                               audio_bytes=b"voice", filename="s.webm", mime="audio/webm")
    assert candidate_lines(seen["history"]) == browser


async def test_tache2_keeps_its_turns_and_still_keeps_the_voice(seen):
    turns = ["Bonjour, je voudrais louer un vélo.", "Quel est le prix ?"]
    out = await m.grade_conversation(body("tache2", turns), USER, None,
                                     audio_bytes=b"voice", filename="s.webm", mime="audio/webm")
    assert candidate_lines(seen["history"]) == turns
    assert out["has_audio"] is True
    assert out["speech_words"]


async def test_without_a_recording_nothing_is_transcribed_or_kept(seen):
    out = await m.grade_conversation(body("tache1", ["Bonjour."]), USER, None)
    assert "transcribed" not in seen and "kept" not in seen
    assert candidate_lines(seen["history"]) == ["Bonjour."]
    assert out["speech_words"] == []
    assert "has_audio" not in out


async def test_a_failed_transcription_still_grades_what_the_browser_heard(seen, monkeypatch):
    async def broken(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(m, "transcribe_audio_detailed", broken)
    out = await m.grade_conversation(body("tache1", ["Bonjour, je m'appelle Anna."]), USER, None,
                                     audio_bytes=b"voice", filename="s.webm", mime="audio/webm")
    assert candidate_lines(seen["history"]) == ["Bonjour, je m'appelle Anna."]
    assert out["has_audio"] is True    # the voice is still kept for replay
    assert out["speech_words"] == []


AGENT = "Très bien. Nous avons des vélos de ville, des vélos électriques et des VTT."
OPENING = "Bonjour. Présentez-vous, s’il vous plaît."


class TestStripEcho:
    """Same cases as frontend/src/lib/echo.test.js: the two must agree."""

    def test_cuts_the_end_of_the_examiners_line(self):
        assert m.strip_echo("des vélos électriques et des VTT d'accord et combien ça coûte",
                            AGENT) == "d'accord et combien ça coûte"

    def test_cuts_the_tail_of_the_tache1_instruction(self):
        assert m.strip_echo("s'il vous plaît bonjour je m'appelle Dana", OPENING) \
            == "bonjour je m'appelle Dana"

    def test_a_turn_that_was_only_echo_is_empty(self):
        assert m.strip_echo("des vélos électriques et des VTT.", AGENT) == ""

    def test_a_long_run_is_cut_even_mid_line(self):
        assert m.strip_echo("nous avons des vélos de ville je voudrais un vélo", AGENT) \
            == "je voudrais un vélo"

    def test_a_candidate_reusing_a_few_words_keeps_them(self):
        assert m.strip_echo("des vélos de ville, s’il vous plaît", AGENT) \
            == "des vélos de ville, s’il vous plaît"
        assert m.strip_echo("nous avons besoin de deux vélos", AGENT) \
            == "nous avons besoin de deux vélos"

    def test_hello_back_is_kept(self):
        assert m.strip_echo("Bonjour, je m'appelle Anna.", OPENING) == "Bonjour, je m'appelle Anna."

    def test_only_the_start_is_examined(self):
        assert m.strip_echo("je voudrais des vélos électriques et des VTT", AGENT) \
            == "je voudrais des vélos électriques et des VTT"


async def test_the_examiners_echo_is_not_graded_as_the_candidate(seen):
    history = m.ConverseGradeIn(consigne="Location de vélo.", mode="tache2", history=[
        {"role": "agent", "text": AGENT},
        {"role": "candidate", "text": "des vélos électriques et des VTT et combien ça coûte ?"},
        {"role": "agent", "text": "Vingt-cinq dollars par jour."},
        # Three of the examiner's last words and nothing else: pure echo.
        {"role": "candidate", "text": "dollars par jour."},
        # Two words the candidate repeats to check them: an answer, kept.
        {"role": "agent", "text": "Le casque est inclus par jour."},
        {"role": "candidate", "text": "par jour ? D'accord, merci."},
    ])
    await m.grade_conversation(history, USER, None)
    assert candidate_lines(seen["history"]) == ["et combien ça coûte ?",
                                                 "par jour ? D'accord, merci."]


async def test_the_tache1_recording_loses_the_instructions_echo(seen):
    seen["recorded"] = "s'il vous plaît. Je m'appelle Anna et j'habite à Toronto."
    turns = [{"role": "agent", "text": OPENING},
             {"role": "candidate", "text": "je m'appelle Anna et j'habite à Toronto"}]
    await m.grade_conversation(m.ConverseGradeIn(consigne="Présentez-vous.", mode="tache1",
                                                 history=turns),
                               USER, None, audio_bytes=b"voice", filename="s.webm",
                               mime="audio/webm")
    assert candidate_lines(seen["history"]) == ["Je m'appelle Anna et j'habite à Toronto."]
