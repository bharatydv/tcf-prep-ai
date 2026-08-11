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

# The level profile of one paper. The TCF compréhension écrite runs from A1 to
# C2 in ascending difficulty so that a candidate meets their ceiling instead of
# being stopped by the first hard item; every paper carries the same profile so
# a score on test 3 means what it means on test 7.
LEVEL_PROFILE = {"A1": 6, "A2": 7, "B1": 7, "B2": 7, "C1": 7, "C2": 6}

# The subject areas the TCF draws its reading documents from. Checked, not
# hoped for: without this list a hand-written paper drifts towards whatever the
# author finds easy to write, and a candidate who prepared on it would meet
# unfamiliar material on the day.
TOPICS = (
    "Vie quotidienne & logement",
    "Travail & emploi",
    "Études & formation",
    "Santé & bien-être",
    "Transports & voyages",
    "Loisirs, culture & médias",
    "Alimentation & consommation",
    "Environnement & nature",
    "Sciences & technologies",
    "Société, citoyenneté & administration",
)
# A 40-question paper cannot carry all ten domains evenly, but one that covers
# fewer than this is too narrow to be representative.
MIN_TOPICS_PER_TEST = 8

# A question has to be as hard as the level it claims. Nothing here measures
# CEFR difficulty properly — that is a judgement about abstraction, inference
# and idiom, which no word count captures. These bands catch the gross
# mismatches instead: a 90-word argumentative essay filed as A1, or a two-line
# sign filed as C1. Length and sentence length climb steeply to B1 and then
# level off, because past B1 the difficulty stops coming from how much there is
# to read and starts coming from what has to be inferred from it.
#
# Only an upper bound on sentence length. A lower bound sounds symmetrical but
# fails honest documents: a B1 job advert or a C1 notice is legitimately written
# in short clauses, and the minimum word count already stops a two-line sign
# being filed as C1.
#
# (min_words, max_words, max_words_per_sentence)
LEVEL_SHAPE = {
    "A1": (8,  35, 14),
    "A2": (18, 55, 18),
    "B1": (28, 75, 26),
    "B2": (30, 85, 30),
    "C1": (30, 90, 32),
    "C2": (30, 95, 32),
}


def _shape(text: str):
    """Word count and mean words per sentence for one document.

    Line breaks end a unit as surely as a full stop does: a sign or an advert
    is written one item per line and often carries no punctuation at all, so
    splitting on [.!?] alone reported a four-line notice as one 17-word
    sentence and failed it for complexity it did not have.
    """
    import re
    words = len(text.split())
    units = [s for s in re.split(r"[.!?…\n]+", text) if s.strip()]
    return words, words / max(1, len(units))

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
            missing = [f for f in ("level", "topic", "text", "question_fr",
                                   "options", "correct_answer")
                       if not q.get(f)]
            if missing:
                problems.append(f"{where}: missing {', '.join(missing)}")
                continue
            if q["level"] not in LEVELS:
                problems.append(f"{where}: unknown level {q['level']!r}")
            if q["topic"] not in TOPICS:
                problems.append(f"{where}: unknown topic {q['topic']!r}")
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

            # Does the document look like the level it claims?
            lo, hi, sl_hi = LEVEL_SHAPE[q["level"]]
            words, per_sentence = _shape(q["text"])
            if not lo <= words <= hi:
                problems.append(
                    f"{where}: {q['level']} document is {words} words, "
                    f"expected {lo}-{hi}")
            if per_sentence > sl_hi:
                problems.append(
                    f"{where}: {q['level']} averages {per_sentence:.0f} words "
                    f"per sentence, at most {sl_hi} expected")

        # A paper that drifts off the level profile stops being comparable to
        # the others, and one built from three subject areas stops being
        # representative of the exam.
        levels = {lvl: sum(1 for q in questions if q.get("level") == lvl)
                  for lvl in LEVELS}
        if levels != LEVEL_PROFILE:
            problems.append(f"test {number}: level profile is {levels}, "
                            f"expected {LEVEL_PROFILE}")
        covered = {q.get("topic") for q in questions} & set(TOPICS)
        if len(covered) < MIN_TOPICS_PER_TEST:
            problems.append(
                f"test {number}: covers {len(covered)} topic(s), "
                f"expected at least {MIN_TOPICS_PER_TEST} — missing "
                f"{sorted(set(TOPICS) - covered)}")

    # Across the whole bank every domain must appear, or the programme as a
    # whole leaves a hole a candidate could fall into on exam day.
    written = [q for qs in READING_TESTS.values() for q in qs]
    if written:
        never = sorted(set(TOPICS) - {q.get("topic") for q in written})
        if never:
            problems.append(f"bank: no question anywhere on {never}")
    return problems


def coverage() -> dict:
    """Topic × level counts across every written test, for a quick eyeball."""
    written = [q for qs in READING_TESTS.values() for q in qs]
    return {topic: {lvl: sum(1 for q in written
                             if q.get("topic") == topic and q.get("level") == lvl)
                    for lvl in LEVELS}
            for topic in TOPICS}
