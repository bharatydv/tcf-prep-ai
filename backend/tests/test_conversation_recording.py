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
