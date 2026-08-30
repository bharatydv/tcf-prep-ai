"""Compréhension orale question bank — 40 papers of 39 questions each.

The mirror of reading_bank, imported by scripts/build_content.py into
`backend/content/listening.json`. Same contract: `LISTENING_TESTS` and
`validate()`.

Each question is a dict:

    {
      "level": "A1",
      "band": "100 – 199 points",
      "audio": "listening/test01/q01.mp3",   # path under MEDIA_BASE_URL
      "image": "listening/images/<uuid>.webp",  # or "" — see below
      "transcript": "...",                   # withheld until the answer is in
      "transcript_en": "...",
      "question_fr": "",                     # see below
      "question_en": "",
      "options": [{"id": "a", "text": "...", "text_en": "...",
                   "explanation": "..."} x4],
      "correct_answer": "b",
      "key_line_fr": "...", "key_line_en": "...",
      "vocabulary": [{"term": "...", "gloss": "..."}],
      "breakdown": "...",
      "frequency": 1,
      "source_uuid": "...",
    }

Two things differ from reading, and both are the exam rather than missing data.

`question_fr` is empty. The compréhension orale paper prints no written stem:
the candidate hears a recording and picks one of four responses. There is
nothing to show above the options, so the player shows the audio instead.

Option `text` is empty on questions 1 to 10. In that first stretch the four
options are spoken too, not printed — the paper shows a photograph (questions 1
and 2) or nothing at all, and the candidate chooses A, B, C or D by ear. So
validate() does NOT require option text, unlike the reading bank; requiring it
would have meant inventing printed options the exam does not give, which is
exactly the crutch the section exists to remove. The English gloss and the
explanation are still there and appear in the correction afterwards.

Audio is keyed by the slot that uses it: the same recording is q07.mp3 in one
paper and q11.mp3 in another, so the JSON stores a {"paper:position": path} map
and _load() resolves it to the one path each expanded row needs.
"""
import json
import os

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
BANDS = {
    "A1": "100 – 199 points",
    "A2": "200 – 299 points",
    "B1": "300 – 399 points",
    "B2": "400 – 499 points",
    "C1": "500 – 599 points",
    "C2": "600 – 699 points",
}
QUESTIONS_PER_TEST = 39
TEST_COUNT = 40

_CONTENT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "content", "listening.json")


def _load():
    tests = {n: [] for n in range(1, TEST_COUNT + 1)}
    try:
        with open(_CONTENT, encoding="utf-8") as fh:
            bank = json.load(fh)
    except (OSError, ValueError):
        return tests

    questions = bank.get("questions", {})
    for number, uuids in bank.get("tests", {}).items():
        rows = []
        for position, uuid in enumerate(uuids, start=1):
            q = questions.get(uuid)
            if q is None:
                continue
            row = {**q, "source_uuid": uuid}
            # Collapse the per-slot audio map down to this slot's own file.
            row["audio"] = (q.get("audio") or {}).get(
                f"{int(number)}:{position}", "")
            rows.append(row)
        tests[int(number)] = rows
    return tests


LISTENING_TESTS = _load()


def validate() -> list:
    """Structural problems with the bank, as human-readable strings."""
    problems = []
    required = ("level", "audio", "transcript", "options", "correct_answer")

    for number in sorted(LISTENING_TESTS):
        questions = LISTENING_TESTS[number]
        if not questions:
            continue
        if len(questions) != QUESTIONS_PER_TEST:
            problems.append(
                f"test {number}: {len(questions)} questions, expected {QUESTIONS_PER_TEST}")

        for position, q in enumerate(questions, start=1):
            where = f"test {number} q{position}"
            for field in required:
                if not q.get(field):
                    problems.append(f"{where}: missing {field}")
            if q.get("level") not in LEVELS:
                problems.append(f"{where}: unknown level {q.get('level')!r}")

            options = q.get("options") or []
            ids = [o.get("id") for o in options]
            if ids != ["a", "b", "c", "d"]:
                problems.append(f"{where}: option ids are {ids}, expected a-d")
            if q.get("correct_answer") not in ids:
                problems.append(
                    f"{where}: correct_answer {q.get('correct_answer')!r} is not an option")
            # No option-text check: questions 1-10 print none by design.
            for o in options:
                if not (o.get("explanation") or "").strip():
                    problems.append(f"{where}: option {o.get('id')} has no explanation")

    return problems
