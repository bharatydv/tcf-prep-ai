"""Spread the answer key evenly across a test.

Writing forty questions by hand reliably produces a lopsided key — the first
draft of test 01 had 16 correct answers on b and exactly one on d. A candidate
who noticed that could score above their real level by guessing, which makes the
paper useless as a measure.

balance() fixes it mechanically: each question's options are ROTATED so that the
correct one lands on a letter that cycles a, b, c, d. A rotation is used rather
than a shuffle because it preserves the relative order of the options, so a set
written to read in a deliberate order (weakest distractor first, say) still
reads that way. Over forty questions the cycle gives exactly ten of each letter.

It is deterministic: the same source always produces the same paper, so a
question id keeps pointing at the same question across restarts and deploys.

Not applied to test 05, whose key comes from the source paper and is already
well spread — rotating it would silently disagree with the original document.
"""


def balance(questions: list) -> list:
    """Return the questions with their options rotated onto a cycling key."""
    letters = ["a", "b", "c", "d"]
    out = []
    for i, q in enumerate(questions):
        options = q["options"]
        if len(options) != 4:
            raise ValueError(
                f"balance() needs exactly 4 options, got {len(options)} "
                f"on {q.get('question_fr', '?')!r}")
        current = [o["id"] for o in options].index(q["correct_answer"])
        target = i % 4
        shift = (target - current) % 4

        rotated = [None] * 4
        for j, option in enumerate(options):
            rotated[(j + shift) % 4] = dict(option)
        for j, option in enumerate(rotated):
            option["id"] = letters[j]

        moved = dict(q)
        moved["options"] = rotated
        moved["correct_answer"] = letters[target]
        out.append(moved)
    return out
