"""Compréhension écrite question bank — 40 papers of 39 questions each.

The bank used to be ten hand-written Python modules. It is now the real exam
material, imported from an export by scripts/build_content.py into
`backend/content/reading.json` and read from there at import time. The public
contract is unchanged — `READING_TESTS` and `validate()` — so the seeder in
server.py did not have to learn where the questions come from.

Each question is a dict:

    {
      "level": "A1",                     # A1 | A2 | B1 | B2 | C1 | C2
      "band": "100 – 199 points",        # official TCF score band for the level
      "doc_type": "",                    # not carried by the export
      "text": "...",                     # the French document the learner reads
      "text_en": "...",                  # gloss, withheld until the answer is in
      "question_fr": "...",
      "question_en": "...",
      "options": [
          {"id": "a", "text": "...", "text_en": "...", "explanation": "..."},
          ... exactly four, ids a-d ...
      ],
      "correct_answer": "d",
      "key_line_fr": "...",              # the sentence that decides the answer
      "key_line_en": "...",
      "vocabulary": [{"term": "...", "gloss": "..."}, ...],
      "explanation": "...",              # one-line why, for the correction card
      "breakdown": "...",                # the worked reasoning, step by step
      "frequency": 2,                    # how many papers this question sits in
      "source_uuid": "...",              # stable id from the export
    }

A question that appears in several papers is stored once in the JSON and
referenced by uuid from each paper that uses it — 365 of the 890 do. They are
expanded into per-paper lists here, sharing nothing mutable, because the seeder
writes one row per (paper, position) and `reading_question_id` has to stay
`rq_NN_PP` for old attempts to keep pointing at real questions.

The old validate() also enforced a level profile, a topic spread and word-count
bands per level. Those rules policed hand-authoring — they caught a paper
drifting towards whatever its author found easy to write. They are gone, and
deliberately: this is the material as it is actually set, and a rule saying a
C2 document may not exceed 95 words would now reject the exam rather than the
bank. What remains is structural, which is what the seeder needs to be true.

_balance.py is gone for the same reason, and must not come back. It rotated
each option set so the key cycled a, b, c, d — worth doing when the questions
were written by hand, because a first draft put sixteen answers on b and one on
d. These keys are the real ones: across the eighty papers they already fall
25/28/24/22, and rotating an imported question would move its options away from
the order the source sets them in. In the listening bank the same rotation
would be actively wrong, because the recording names the options aloud ("A.
Allez-y, entrez. B. Asseyez-vous…") and the printed letters have to match what
the candidate hears. Individual papers do lean — paper 38 puts 19 of 39 on b —
but that is the paper as it is sat.
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
                        "content", "reading.json")


def _load():
    """Expand {questions, tests} into {paper number: [question dicts]}.

    Returns an empty paper for every number the content file does not cover, so
    /api/reading/tests still lists all forty and the frontend shows the missing
    ones as "coming soon" rather than hiding them — the same behaviour the
    hand-written bank had for papers that were not written yet.
    """
    tests = {n: [] for n in range(1, TEST_COUNT + 1)}
    try:
        with open(_CONTENT, encoding="utf-8") as fh:
            bank = json.load(fh)
    except (OSError, ValueError):
        # No content file (a checkout that has not run the build script yet):
        # every paper is simply empty. The seeder logs it and moves on rather
        # than refusing to boot the whole API over missing practice material.
        return tests

    questions = bank.get("questions", {})
    for number, uuids in bank.get("tests", {}).items():
        rows = []
        for uuid in uuids:
            q = questions.get(uuid)
            if q is None:
                continue
            rows.append({**q, "source_uuid": uuid})
        tests[int(number)] = rows
    return tests


READING_TESTS = _load()


def validate() -> list:
    """Structural problems with the bank, as a list of human-readable strings.

    The seeder refuses to write anything if this is non-empty, so it checks the
    things that would otherwise reach the database as a broken paper: a missing
    field the API would serve as null, an option set the player cannot render,
    or an answer key pointing at an option that is not there.
    """
    problems = []
    required = ("level", "text", "question_fr", "options", "correct_answer")

    for number in sorted(READING_TESTS):
        questions = READING_TESTS[number]
        if not questions:
            continue                      # not imported yet; served as not-ready
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
            for o in options:
                if not (o.get("text") or "").strip():
                    problems.append(f"{where}: option {o.get('id')} has no text")
                if not (o.get("explanation") or "").strip():
                    problems.append(f"{where}: option {o.get('id')} has no explanation")

    return problems
