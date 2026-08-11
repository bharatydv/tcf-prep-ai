"""Compréhension écrite question bank — 10 tests of 40 questions each.

Kept out of server.py deliberately: at four hundred questions carrying a
document, four glossed options, a per-option explanation, a key line and a
vocabulary list, the bank is far larger than the application code it feeds.

Each test module exposes QUESTIONS, a list of dicts shaped like:

    {
      "level": "A1",                     # A1 | A2 | B1 | B2 | C1 | C2
      "band": "100 – 199 points",        # official TCF score band for the level
      "doc_type": "Note personnelle / Personal note",
      "text": "...",                     # the French document the learner reads
      "question_fr": "...",
      "question_en": "...",              # gloss, shown under the French question
      "options": [
          {"id": "a", "text": "...", "text_en": "...", "explanation": "..."},
          ... exactly four, ids a-d ...
      ],
      "correct_answer": "d",
      "key_line_fr": "...",              # the sentence that decides the answer
      "key_line_en": "...",
      "vocabulary": [{"term": "...", "gloss": "..."}, ...],
    }

The explanation on every option is the point of the exercise: after submitting,
the learner is told why the right answer is right AND why each distractor is
wrong, which is what turns a score into a lesson.
"""
from . import (test_01, test_02, test_03, test_04, test_05,
               test_06, test_07, test_08, test_09, test_10)

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
BANDS = {
    "A1": "100 – 199 points",
    "A2": "200 – 299 points",
    "B1": "300 – 399 points",
    "B2": "400 – 499 points",
    "C1": "500 – 599 points",
    "C2": "600 – 699 points",
}
QUESTIONS_PER_TEST = 40

READING_TESTS = {
    1: test_01.QUESTIONS,
    2: test_02.QUESTIONS,
    3: test_03.QUESTIONS,
    4: test_04.QUESTIONS,
    5: test_05.QUESTIONS,
    6: test_06.QUESTIONS,
    7: test_07.QUESTIONS,
    8: test_08.QUESTIONS,
    9: test_09.QUESTIONS,
    10: test_10.QUESTIONS,
}


def validate() -> list:
    """Return a list of problems with the bank, empty when it is well formed.

    Run by the seeder before it writes anything: a question whose correct_answer
    names no option, or which lost an explanation, would reach a learner as a
    broken exercise, and that is far worse than a loud failure at startup.
    """
    problems = []
    for number, questions in READING_TESTS.items():
        if not questions:
            continue  # an unwritten test is incomplete, not malformed
        if len(questions) != QUESTIONS_PER_TEST:
            problems.append(
                f"test {number}: {len(questions)} questions, "
                f"expected {QUESTIONS_PER_TEST}")
        for i, q in enumerate(questions, start=1):
            where = f"test {number} q{i}"
            missing = [f for f in ("level", "text", "question_fr", "options",
                                   "correct_answer")
                       if not q.get(f)]
            if missing:
                problems.append(f"{where}: missing {', '.join(missing)}")
                continue
            if q["level"] not in LEVELS:
                problems.append(f"{where}: unknown level {q['level']!r}")
            ids = [o.get("id") for o in q["options"]]
            if ids != ["a", "b", "c", "d"]:
                problems.append(f"{where}: option ids are {ids}, expected a-d")
            if q["correct_answer"] not in ids:
                problems.append(
                    f"{where}: correct_answer {q['correct_answer']!r} "
                    f"matches no option")
            for o in q["options"]:
                if not o.get("explanation"):
                    problems.append(
                        f"{where}: option {o.get('id')} has no explanation")
    return problems
