"""The live roleplay's fast path, and the fallback that keeps it answering.

A turn is transcribed and answered by Groq when there is a Groq key. Anything
that goes wrong there must fall back to the grading setup — slower, but a
candidate is never left without a reply.

The turn also travels in ONE request rather than two — see
/api/speaking/turn/reply, at the bottom of this file.
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


# ----------------------------------------------------------------------------
# One turn, one request
# ----------------------------------------------------------------------------
# The browser used to POST the audio to be transcribed, wait for the words,
# then POST the dialogue to be answered. The candidate sat through both round
# trips with the examiner silent, and the second one re-did the session lookup
# and the budget check to add nothing but the reply.


@pytest.fixture
def one_turn(monkeypatch):
    """Both provider calls replaced, and what they were asked recorded."""
    got = {"heard": "Bonjour, vous avez des chambres ?", "reply": "Oui, pour quelle date ?"}

    async def budget(db, user):
        got["budget"] = True

    async def upload(audio):
        return b"voice"

    async def transcribe(audio, filename, db=None, mime=""):
        got["transcribed"] = (audio, filename, mime)
        return got["heard"]

    async def reply(consigne, history, db=None, mode="tache2"):
        got["asked"] = {"consigne": consigne, "history": history, "mode": mode}
        return got["reply"]

    monkeypatch.setattr(m, "enforce_turn_budget", budget)
    monkeypatch.setattr(m, "read_audio_upload", upload)
    monkeypatch.setattr(m, "transcribe_turn", transcribe)
    monkeypatch.setattr(m, "interaction_reply", reply)
    return got


AUDIO = SimpleNamespace(filename="turn.webm", content_type="audio/webm")
USER = SimpleNamespace(user_id="user_1")


async def turn(payload):
    return await m.speaking_turn_reply(payload=payload, audio=AUDIO, mime_type=None,
                                       user=USER, db=None, _rl=None)


def payload(history, consigne="Vous téléphonez à un hôtel.", mode="tache2"):
    return m.ConverseIn(consigne=consigne, mode=mode,
                        history=history).model_dump_json()


class TestOneRequestPerTurn:
    async def test_transcribes_and_answers_in_the_same_call(self, one_turn):
        out = await turn(payload([{"role": "agent", "text": "Bonjour, je vous écoute."}]))
        assert out == {"text": "Bonjour, vous avez des chambres ?",
                       "reply": "Oui, pour quelle date ?"}
        assert one_turn["budget"] is True
        assert one_turn["transcribed"] == (b"voice", "turn.webm", "audio/webm")
        # The reply is written from a dialogue that already has the turn in it.
        assert one_turn["asked"]["history"][-1] == {
            "role": "candidate", "text": "Bonjour, vous avez des chambres ?"}
        assert one_turn["asked"]["mode"] == "tache2"

    async def test_cuts_the_examiner_echo_before_the_reply_is_written(self, one_turn):
        # The microphone caught the end of the examiner's line. Stripped here,
        # not in the browser: the model writes its answer from this text, so it
        # has to be the candidate's words by the time it reads them.
        one_turn["heard"] = "je vous écoute bonjour, vous avez des chambres ?"
        out = await turn(payload([{"role": "agent", "text": "Bonjour, je vous écoute."}]))
        assert out["text"] == "bonjour, vous avez des chambres ?"
        assert one_turn["asked"]["history"][-1]["text"] == "bonjour, vous avez des chambres ?"

    async def test_nothing_heard_asks_for_no_reply(self, one_turn):
        one_turn["heard"] = ""
        assert await turn(payload([])) == {"text": "", "reply": ""}
        assert "asked" not in one_turn

    async def test_a_failed_examiner_still_returns_the_words(self, one_turn):
        # 200 with an empty reply, not a 503: the candidate's turn has been
        # transcribed either way, and throwing it out costs them more than the
        # reply did. The browser keeps the words and offers "Try again".
        one_turn["reply"] = ""
        out = await turn(payload([]))
        assert out["text"] == "Bonjour, vous avez des chambres ?"
        assert out["reply"] == ""

    async def test_a_payload_that_is_not_a_conversation_is_refused(self, one_turn):
        with pytest.raises(m.HTTPException) as raised:
            await turn("{\"consigne\": \"\"}")
        assert raised.value.status_code == 422
