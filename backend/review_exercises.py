"""Turning a due mistake into an exercise, and refusing the ones that don't work.

Every exercise here is built from three strings that already exist by the time
a mistake is due — the fragment the learner got wrong, the correction, and the
sentence they were writing when they got it wrong — so the whole module is
pure: no database, no model, and testable line by line.

Why it exists. The MCQ used to be assembled straight from the row: the stem was
the learner's own `error_text`, and the options were {correction, error_text,
distractor}. One option was therefore always character-for-character the string
printed above it, and that option was always the wrong one. "Never pick the
phrase shown in the stem" scored 50% on a card that had a distractor and 100%
on a card that did not — and cards without a distractor are the normal case,
because generate_distractor is allowed to return nothing. No French was
required to do this.

That is the hole the Fisher–Yates note in Review.jsx guards against, reached
from the other side: there a guessing strategy beat the grammar because of
where the answer sat, here because of what the stem gave away. Shuffling
harder does not help when the giveaway is the text itself.

So the stem is no longer an option. It is the learner's full sentence with the
error blanked out, which fixes the second half of the same problem: a fragment
like « aller au marché » cannot be conjugated by anybody, learner or examiner,
because nothing in it says who goes. Blanking the error inside the sentence
they actually wrote puts the subject back on screen and leaves the answer off
it.

The other forms exist for the same reason — every one of them shows a full
sentence, so none of them can ask a question that has no answer.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

PLACEHOLDER = "____"

# A stem needs some sentence left around the blank to be worth reading; one
# word either side is a fragment wearing a full stop.
MIN_CONTEXT_WORDS = 2

# Length-preserving accent fold. `unicodedata.normalize` would be the usual way
# to do this, but NFD changes the length of the string, and these folds are
# used to find a fragment's character span inside a sentence and then slice the
# ORIGINAL — accents and all. A 1:1 table keeps every index meaningful.
# œ and æ fold to a single letter for the same reason; both sides of every
# comparison are folded the same way, so nothing is lost by it.
_FOLD = str.maketrans(
    "àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ",
    "aaaaaaceeeeiiiinooooouuuuyyoa",
)

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WORD = re.compile(r"\w", re.UNICODE)
_SPACES = re.compile(r"\s+")
# Sentences end at punctuation, or at a paragraph break. A SINGLE newline is
# not a boundary: learners hard-wrap, and the grader quotes an error back as
# one phrase whether or not the learner's line ended in the middle of it — so
# splitting there would lose exactly the sentences most in need of context.
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+|\n[ \t]*\n\s*")

# Past this, a "sentence" is really an unpunctuated paragraph, and printing all
# of it around one blank buries the question. The window below keeps whole
# words either side of the error instead.
MAX_CONTEXT_CHARS = 240


def fold(text: str) -> str:
    """Lowercase and de-accent, preserving length so spans stay valid."""
    return (text or "").lower().translate(_FOLD)


def canon(text: str) -> str:
    """Comparison form: no case, no accents, no punctuation, single spaces.

    Two strings with the same canon are the same answer as far as a learner
    reading three options is concerned — « à côté » and « a cote » are not a
    choice, they are the same option printed twice.
    """
    return _SPACES.sub(" ", _PUNCT.sub(" ", fold(text))).strip()


def loose(text: str) -> str:
    """Comparison form for a TYPED answer: accents kept, punctuation not.

    Typing « vais » for « vais. » is the same answer. Typing « ou » for « où »
    is not — it is the mistake the exercise exists to catch — so this is the
    stricter of the two forms, and `canon` is used only to recognise that near
    miss and name it.
    """
    return _SPACES.sub(" ", _PUNCT.sub(" ", (text or "").lower())).strip()


def near_duplicate(a: str, b: str) -> bool:
    """True when two options differ only by accent, case, punctuation or space."""
    return canon(a) == canon(b)


# Words that can open a French subject. Kept as two sets rather than one
# because they license a subject differently: a pronoun IS the subject, a
# determiner only promises a noun is coming and so needs a word after it.
_SUBJECT_PRONOUNS = {
    "je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
    "ce", "c", "ca", "cela", "ceci", "celui", "celle", "ceux", "celles",
    "qui", "chacun", "chacune", "personne", "rien", "quelqu",
}
_DETERMINERS = {
    "le", "la", "les", "l", "un", "une", "des", "du", "mon", "ma", "mes",
    "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos",
    "leur", "leurs", "cet", "cette", "ces", "chaque", "plusieurs", "quelques",
    "tout", "tous", "toute", "toutes", "certains", "certaines", "aucun",
    "aucune", "beaucoup",
}


def has_subject(phrase: str) -> bool:
    """Whether a bare phrase says who is doing the thing.

    Deliberately conservative, and it is the fallback path that pays for that:
    a capital letter on the FIRST word is not evidence of a proper noun,
    because a fragment lifted out of a sentence is usually capitalised anyway.
    Misjudging « Marie prend » as subject-less costs one MCQ, and the learner
    still meets that mistake as a flashcard. Misjudging « prend le train » as
    subject-BEARING ships a question with no answer.
    """
    tokens = canon(phrase).split()
    if not tokens:
        return False
    if tokens[0] in _SUBJECT_PRONOUNS:
        return True
    if tokens[0] in _DETERMINERS and len(tokens) >= 2:
        return True
    return any(w[:1].isupper() for w in (phrase or "").split()[1:])


def split_sentences(text: str) -> List[str]:
    """Sentences with their internal whitespace collapsed.

    Collapsed rather than preserved because every span this module hands out is
    an index into the string it returns, and a hard-wrapped sentence would
    otherwise carry a newline into the middle of a blanked stem.
    """
    return [_SPACES.sub(" ", s).strip()
            for s in _SENTENCE_END.split(text or "") if s.strip()]


def _window(sentence: str, fragment: str) -> str:
    """`sentence` trimmed to whole words either side of `fragment`."""
    if len(sentence) <= MAX_CONTEXT_CHARS:
        return sentence
    span = locate(sentence, fragment)
    if not span:
        return sentence[:MAX_CONTEXT_CHARS].rsplit(" ", 1)[0] + " …"
    start, end = span
    room = (MAX_CONTEXT_CHARS - (end - start)) // 2
    left, right = max(0, start - room), min(len(sentence), end + room)
    head = sentence[left:start].split(" ", 1)[-1] if left else sentence[:start]
    tail = sentence[end:right].rsplit(" ", 1)[0] if right < len(sentence) else sentence[end:]
    return (("… " if left else "") + head + sentence[start:end] + tail
            + (" …" if right < len(sentence) else "")).strip()


def locate(haystack: str, needle: str) -> Optional[Tuple[int, int]]:
    """Character span of `needle` inside `haystack`, ignoring case and accents.

    Whole words only. A plain substring search finds « je va » inside « Je vais
    », and everything downstream then works on a span that cuts a word in half:
    the blank comes out as « ____is au marché », and spot-the-error offers the
    first two thirds of a correctly written verb as a segment to click.

    The needle's words are matched across any run of whitespace, because the
    grader quotes the learner's error back with its own spacing and a line
    break in the middle of it should not lose the sentence.
    """
    hay, nee = fold(haystack), fold(needle).strip()
    if not hay or not nee:
        return None
    words = [re.escape(w) for w in nee.split()]
    if not words:
        return None
    # Anchored only where there is a word character to anchor against: a
    # fragment that starts or ends on punctuation has no boundary there.
    left = r"(?<!\w)" if re.match(r"\w", nee) else ""
    right = r"(?!\w)" if re.search(r"\w$", nee) else ""
    m = re.search(left + r"\s+".join(words) + right, hay)
    return (m.start(), m.end()) if m else None


def sentence_containing(text: str, fragment: str) -> str:
    """The one sentence of `text` the learner made this mistake in, or ''."""
    for sentence in split_sentences(text):
        if locate(sentence, fragment):
            return _window(sentence, fragment)
    return ""


def blank_out(sentence: str, fragment: str) -> Optional[str]:
    """`sentence` with `fragment` replaced by a blank, or None if it won't work."""
    span = locate(sentence, fragment)
    if not span:
        return None
    start, end = span
    remaining = canon(sentence[:start] + " " + sentence[end:]).split()
    if len(remaining) < MIN_CONTEXT_WORDS:
        return None  # the error was most of the sentence; a blank says nothing
    return _SPACES.sub(" ", sentence[:start] + PLACEHOLDER + sentence[end:]).strip()


def apply_correction(sentence: str, fragment: str, replacement: str) -> str:
    """`sentence` as it should have been written, or '' if the span is gone.

    The replacement inherits the capital the learner's own word was wearing.
    The grader quotes errors back in lower case — « il a manger » for a
    sentence that opens « Il a manger » — so splicing it in verbatim produced
    a "corrected" sentence starting with a small letter. On the minimal-pair
    card that is both a wrong answer presented as the right one and a tell: the
    two sentences are supposed to differ by the mistake, not by a capital.
    """
    span = locate(sentence, fragment)
    if not span:
        return ""
    start, end = span
    if replacement[:1].islower() and sentence[start:start + 1].isupper():
        replacement = replacement[:1].upper() + replacement[1:]
    return _SPACES.sub(" ", sentence[:start] + replacement + sentence[end:]).strip()


def _halve(text: str) -> List[str]:
    words = text.split()
    cut = len(words) // 2
    return [" ".join(words[:cut]).strip(), " ".join(words[cut:]).strip()]


def split_segments(sentence: str,
                   fragment: str) -> Optional[Tuple[List[str], int]]:
    """Cut `sentence` into 3–4 pieces, one of which is exactly the error.

    Returns the pieces and the index of the guilty one. None when the error has
    nothing to hide among — a sentence that IS the error offers no choice.
    """
    span = locate(sentence, fragment)
    if not span:
        return None
    start, end = span
    before, middle, after = (sentence[:start].strip(),
                             sentence[start:end].strip(),
                             sentence[end:].strip())

    # Punctuation left over at either end joins the error rather than becoming
    # a segment of its own. An error at the end of a sentence otherwise left a
    # full stop sitting there as a fourth thing to click, which is not a piece
    # of the sentence and cannot be the piece with the mistake in it.
    if after and not _WORD.search(after):
        middle, after = middle + after, ""
    if before and not _WORD.search(before):
        middle, before = before + middle, ""
    if not middle or (not before and not after):
        return None

    if before and after:
        # Four pieces when one side can be halved without leaving a lone word,
        # three otherwise. More than four turns finding the error into finding
        # the boundary.
        longer_is_before = len(before.split()) >= len(after.split())
        longer = before if longer_is_before else after
        if len(longer.split()) >= 6:
            halves = _halve(longer)
            if longer_is_before:
                return [*halves, middle, after], 2
            return [before, middle, *halves], 1
        return [before, middle, after], 1

    side = before or after
    if len(side.split()) < 4:
        return None  # halving it would leave one-word decoys
    halves = _halve(side)
    return ([*halves, middle], 2) if before else ([middle, *halves], 0)


def visible_in(option: str, stem: str) -> bool:
    """Whether an option is legible inside the stem, so picking it is free.

    Short options are exempt: « de » turning up elsewhere in the sentence tells
    the learner nothing, and rejecting every card whose answer is a two-letter
    preposition would empty the preposition category.
    """
    o, s = canon(option), canon(stem)
    if len(o) < 4 or not s:
        return False
    return re.search(r"\b" + re.escape(o) + r"\b", s) is not None


def mcq_problem(stem: Optional[str], options: List[str],
                answer: str) -> Optional[str]:
    """Why this MCQ must not be served, or None if it may be.

    The three rules, in the order they were broken in production: an option
    that IS the stem, two options that are the same answer twice, and a
    question with nothing to choose between.
    """
    opts = [o for o in options if (o or "").strip()]
    if len(opts) < 2:
        return "too_few_options"
    if not any(near_duplicate(o, answer) for o in opts):
        return "answer_missing"
    for i, a in enumerate(opts):
        for b in opts[i + 1:]:
            if near_duplicate(a, b):
                return "duplicate_options"
    if stem:
        for o in opts:
            if near_duplicate(o, stem):
                return "option_is_the_stem"
            if visible_in(o, stem):
                return "option_visible_in_stem"
    return None


def valid_distractor(distractor: str, error_text: str, correction: str) -> bool:
    """Whether a generated distractor is a third option rather than a repeat.

    A distractor matching the correction gives the card two right answers; one
    matching the error duplicates an option already on screen; one differing
    from either by an accent alone is both of those at once and reads as a typo
    rather than as a choice. The old check was a lowercase `!=`, which caught
    the first two only when the model happened to match the casing as well.
    """
    d = (distractor or "").strip()
    if not d or len(canon(d)) < 2:
        return False
    return not (near_duplicate(d, correction) or near_duplicate(d, error_text))


# Which stored form each review mode needs. flashcards needs none: it shows the
# error and the correction, which every row has by definition.
MODE_FORM = {
    "flashcards": None,
    "mcq": "mcq",
    "sprint": "mcq",
    "cloze": "cloze",
    "spot": "spot",
    "typeit": "typeit",
    "pair": "pair",
    "transfer": "transfer",
}
MODES = tuple(MODE_FORM)
# The modes whose card needs a generated distractor, and the one whose card is
# itself generated. Nothing else here costs a model call.
DISTRACTOR_MODES = ("mcq", "sprint")
TRANSFER_MODES = ("transfer",)


def build_forms(mistake: dict) -> Dict[str, dict]:
    """Every exercise this mistake can honestly be asked as.

    A form that is absent could not be built — no sentence to put the error
    back into, no third option, nothing left over once the error was removed.
    The caller offers the learner the modes that have forms rather than serving
    a broken card and hoping.
    """
    error = (mistake.get("error_text") or "").strip()
    correction = (mistake.get("correction") or "").strip()
    distractor = (mistake.get("distractor") or "").strip()
    context = (mistake.get("context_sentence") or "").strip()
    forms: Dict[str, dict] = {}
    if not error or not correction or near_duplicate(error, correction):
        return forms

    # A sentence that does not contain the error is not the sentence the error
    # was made in — a mis-joined lookup, or a submission edited since.
    if context and not locate(context, error):
        context = ""

    stem = blank_out(context, error) if context else None
    corrected = apply_correction(context, error, correction) if context else ""

    # A sentence can print the answer somewhere other than the blank — a
    # parallel clause, a phrase the learner repeated, the same verb used
    # correctly ten words earlier. Filling that blank is copying, not
    # conjugating, so the two cards built around a blank are dropped. The MCQ
    # falls back to its stemless form below if the options carry the subject
    # themselves; spot-the-error and the minimal pair are unaffected, because
    # neither of them hides anything to begin with.
    if stem and visible_in(correction, stem):
        stem = None

    # ---- choose the correct form -------------------------------------------
    # With a stem, the learner's own wrong form is the best trap available, and
    # it is safe to offer because the stem no longer prints it. Without one,
    # the options are all the learner sees, so they have to carry the subject
    # themselves or the question cannot be reasoned about at all.
    if stem or (has_subject(correction) and has_subject(error)):
        options: List[str] = []
        for opt in (correction, error, distractor):
            opt = (opt or "").strip()
            if not opt or any(near_duplicate(opt, kept) for kept in options):
                continue
            if stem and visible_in(opt, stem):
                continue
            options.append(opt)
        if mcq_problem(stem, options, correction) is None:
            forms["mcq"] = {"stem": stem, "options": options,
                            "answer": correction}

    # ---- the forms that need the sentence back ------------------------------
    if stem:
        forms["cloze"] = {"stem": stem, "answer": correction}

    segments = split_segments(context, error) if context else None
    if segments:
        pieces, guilty = segments
        forms["spot"] = {"segments": pieces, "answer_index": guilty,
                         "answer": pieces[guilty]}

    # ---- the forms every row can do ----------------------------------------
    forms["typeit"] = {"context": context, "prompt": error,
                       "answer": correction}
    if corrected and not near_duplicate(context, corrected):
        forms["pair"] = {"wrong": context, "right": corrected}
    else:
        forms["pair"] = {"wrong": error, "right": correction}

    transfer = mistake.get("transfer") or {}
    t_stem = (transfer.get("stem") or "").strip()
    t_answer = (transfer.get("answer") or "").strip()
    if (PLACEHOLDER in t_stem and t_answer
            and not near_duplicate(t_answer, correction)
            and not visible_in(t_answer, t_stem)):
        forms["transfer"] = {"stem": t_stem, "answer": t_answer,
                             "hint": (transfer.get("hint") or "").strip()}
    return forms


def available_modes(forms: Dict[str, dict]) -> List[str]:
    return [mode for mode, form in MODE_FORM.items()
            if form is None or form in forms]


MATCH_EXACT, MATCH_ACCENT, MATCH_NO = "exact", "accent", "no"


def compare(given: str, expected: str) -> str:
    """How close a typed or picked answer is: exact, accent-only, or wrong."""
    if not (given or "").strip() or not (expected or "").strip():
        return MATCH_NO
    if loose(given) == loose(expected):
        return MATCH_EXACT
    if canon(given) == canon(expected):
        return MATCH_ACCENT
    return MATCH_NO


# Modes where the answer was typed from memory rather than clicked. An accent
# the learner did not type is an accent they would not have written, so these
# are marked wrong — but they are told which kind of wrong, because « ou/où »
# and « ou/mais » are not the same miss and a card that says only "incorrect"
# teaches neither.
TYPED_MODES = ("cloze", "typeit", "transfer")


def grade(mode: str, mistake: dict, answer: Optional[str] = None,
          self_rated: Optional[bool] = None) -> Tuple[bool, str]:
    """(correct, note) for one answered card. `note` is '' or 'accent'.

    No answer means a flashcard, whatever the session called itself: there is
    nothing to compare, so the learner's own "I got it" is the only signal.
    """
    if answer is None:
        return bool(self_rated), ""

    expected = mistake.get("correction") or ""
    if mode in ("spot", "pair", "transfer"):
        form = build_forms(mistake).get(MODE_FORM[mode])
        if not form:
            return False, ""
        expected = form["right"] if mode == "pair" else form["answer"]

    result = compare(answer, expected)
    if mode in TYPED_MODES:
        return result == MATCH_EXACT, ("accent" if result == MATCH_ACCENT else "")
    return result != MATCH_NO, ""
