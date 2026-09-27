"""The live roleplay's fast path, and the fallback that keeps it answering.

A turn is transcribed and answered by Groq when there is a Groq key. Anything
that goes wrong there must fall back to the grading setup — slower, but a
candidate is never left without a reply.
"""
from types import SimpleNamespace

import pytest

import server as m


@pytest.fixture
def groq_key(monkeypatch):
    monkeypatch.setattr(m, "GROQ_API_KEY", "gsk_live_example")


@pytest.fixture
def slow_path(monkeypatch):
    calls = []

    async def admin_transcription(audio, filename, db=None, mime=""):
        calls.append("transcribe")
        return "texte du fournisseur"

    async def grader_reply(provider, system, prompt):
        calls.append("grader")
        return "Agent : Réponse du correcteur."

    monkeypatch.setattr(m, "transcribe_audio", admin_transcription)
    monkeypatch.setattr(m, "_grade_with_provider", grader_reply)
    return calls


class TestTurnTranscription:
    async def test_uses_groq_when_there_is_a_key(self, groq_key, slow_path, monkeypatch):
        monkeypatch.setattr(m, "_transcribe_groq_turn", lambda audio, name: "bonjour")
        assert await m.transcribe_turn(b"x", "turn.webm") == "bonjour"
        assert slow_path == []

    async def test_falls_back_when_groq_fails(self, groq_key, slow_path, monkeypatch):
        def broken(audio, name):
            raise RuntimeError("503")
        monkeypatch.setattr(m, "_transcribe_groq_turn", broken)
        assert await m.transcribe_turn(b"x", "turn.webm") == "texte du fournisseur"
        assert slow_path == ["transcribe"]

    async def test_falls_back_when_groq_hears_nothing(self, groq_key, slow_path, monkeypatch):
        monkeypatch.setattr(m, "_transcribe_groq_turn", lambda audio, name: "")
        assert await m.transcribe_turn(b"x", "turn.webm") == "texte du fournisseur"

    async def test_without_a_groq_key_uses_the_admin_provider(self, slow_path, monkeypatch):
        monkeypatch.setattr(m, "GROQ_API_KEY", "")
        assert await m.transcribe_turn(b"x", "turn.webm") == "texte du fournisseur"


class TestExaminerReply:
    HISTORY = [{"role": "candidate", "text": "Bonjour, je voudrais louer un vélo."}]

    async def test_uses_groq_when_there_is_a_key(self, groq_key, slow_path, monkeypatch):
        monkeypatch.setattr(m, "_call_groq_converse",
                            lambda system, prompt: "Agent : Bien sûr, pour combien de jours ?")
        reply = await m.interaction_reply("Location de vélo.", self.HISTORY)
        assert reply == "Bien sûr, pour combien de jours ?"
        assert slow_path == []

    async def test_falls_back_to_the_grader_when_groq_fails(self, groq_key, slow_path, monkeypatch):
        def broken(system, prompt):
            raise RuntimeError("model not found")
        monkeypatch.setattr(m, "_call_groq_converse", broken)
        assert await m.interaction_reply("Location de vélo.", self.HISTORY) == "Réponse du correcteur."
        assert slow_path == ["grader"]

    async def test_falls_back_when_groq_returns_nothing(self, groq_key, slow_path, monkeypatch):
        monkeypatch.setattr(m, "_call_groq_converse", lambda system, prompt: "")
        assert await m.interaction_reply("Location de vélo.", self.HISTORY) == "Réponse du correcteur."


def test_the_fast_reply_asks_gpt_oss_to_think_briefly(groq_key, monkeypatch):
    sent = {}

    class Completions:
        def create(self, **kwargs):
            sent.update(kwargs)
            return SimpleNamespace(usage=None, choices=[SimpleNamespace(
                message=SimpleNamespace(content="Très bien."))])

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    monkeypatch.setattr(m, "_openai_client", lambda *a, **k: client)
    monkeypatch.setattr(m, "GROQ_CONVERSE_MODEL", "openai/gpt-oss-120b")
    assert m._call_groq_converse("system", "prompt") == "Très bien."
    assert sent["extra_body"] == {"reasoning_effort": "low"}
    assert sent["max_tokens"] == m.CONVERSE_MAX_TOKENS
