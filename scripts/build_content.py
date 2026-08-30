#!/usr/bin/env python3
"""Turn the two raw exports into the JSON banks the server seeds from.

The exports are shaped for whoever scraped them, not for this app: keys are
`option_text_orig` / `qpassage_trans` / `breaking_down`, answers are upper-case
letters, vocabulary is one string of `[ term, gloss ]` pairs, and every question
is repeated in full inside each test it appears in. This script normalises all
of that once, at build time, so the server never has to know the export shape.

Two files come out, both read at import by the *_bank packages:

    backend/content/reading.json    {"questions": {uuid: {...}}, "tests": {"1": [uuid x39]}}
    backend/content/listening.json  same shape, plus audio/image paths

Questions are stored ONCE and referenced by uuid from each test that uses them
— 365 of the 890 reading questions and 256 of the 502 listening ones appear in
more than one paper, so the flat form would trible the file for nothing.

Media is not copied into the JSON. The listening audio (1,560 files, 1.8 GB) is
hard-linked into backend/media/ where the R2 upload script and the local static
mount both find it; hard links cost no disk, and fall back to a real copy when
the export and the repo are on different volumes.

Run:  python scripts/build_content.py
      python scripts/build_content.py --skip-media    (JSON only, no 1.8 GB pass)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTENING_EXPORT = ROOT / "fuck_tcf_export"
READING_EXPORT = ROOT / "fuck_tcf_reading_export"
CONTENT_DIR = ROOT / "backend" / "content"
MEDIA_DIR = ROOT / "backend" / "media"

TESTS = range(1, 41)
QUESTIONS_PER_TEST = 39
LETTERS = ["a", "b", "c", "d"]

# TCF Canada reports a score band per level; the old hand-written bank printed
# it beside the level chip and the frontend still renders it.
BANDS = {
    "A1": "100 – 199 points",
    "A2": "200 – 299 points",
    "B1": "300 – 399 points",
    "B2": "400 – 499 points",
    "C1": "500 – 599 points",
    "C2": "600 – 699 points",
}


# ---------------------------------------------------------------------------
# field-level conversion
# ---------------------------------------------------------------------------
def parse_vocabulary(words: str) -> list[dict]:
    """`[ asseyez-vous, sit down ], [ entrez, come in ]` -> [{term, gloss}].

    The gloss itself often contains commas ("come in / enter, arrive"), so the
    split is on the FIRST comma only and everything after it is the gloss.
    """
    out = []
    for chunk in re.findall(r"\[([^\]]*)\]", words or ""):
        term, sep, gloss = chunk.partition(",")
        term, gloss = term.strip(), gloss.strip()
        if sep and term and gloss:
            out.append({"term": term, "gloss": gloss})
    return out


def convert_options(raw: list[dict], fr_key: str) -> list[dict]:
    """Export options -> the app's `[{id, text, text_en, explanation}]`.

    `fr_key` differs between the banks: reading carries `option_text_orig`,
    listening carries `text` — and on listening questions 1 to 10 that field is
    deliberately empty, because in the real paper those options are only ever
    spoken. An empty `text` is preserved as empty rather than back-filled from
    the English, so the player can render bare letters exactly as the exam does.
    """
    options = []
    for opt in sorted(raw, key=lambda o: o["option_key"]):
        options.append({
            "id": opt["option_key"].lower(),
            "text": (opt.get(fr_key) or "").strip(),
            "text_en": (opt.get("option_text_trans") or "").strip(),
            "explanation": (opt.get("reason") or "").strip(),
        })
    return options


def convert_reading(q: dict) -> dict:
    return {
        "level": q["level"],
        "band": BANDS.get(q["level"], ""),
        "doc_type": "",
        "text": (q.get("passage") or "").strip(),
        "text_en": (q.get("qpassage_trans") or "").strip(),
        "question_fr": (q.get("question_text") or "").strip(),
        "question_en": (q.get("qtext_trans") or "").strip(),
        "options": convert_options(q["question_options"], "option_text_orig"),
        "correct_answer": q["answer"].lower(),
        "key_line_fr": (q.get("key_sentence_orig") or "").strip(),
        "key_line_en": (q.get("key_sentence_trans") or "").strip(),
        "vocabulary": parse_vocabulary(q.get("words", "")),
        "explanation": (q.get("simple_explanation") or "").strip(),
        "breakdown": (q.get("breaking_down") or "").strip(),
        "frequency": int(q.get("frequency") or 0),
    }


def convert_listening(q: dict, audio_by_test: dict) -> dict:
    return {
        "level": q["level"],
        "band": BANDS.get(q["level"], ""),
        "transcript": (q.get("transcript") or "").strip(),
        "transcript_en": (q.get("transcript_trans") or "").strip(),
        "question_fr": "",          # the CO paper prints no stem, only options
        "question_en": "",
        "options": convert_options(q["question_options"], "text"),
        "correct_answer": q["answer"].lower(),
        "key_line_fr": (q.get("key_sentence_orig") or "").strip(),
        "key_line_en": (q.get("key_sentence_trans") or "").strip(),
        "vocabulary": parse_vocabulary(q.get("words", "")),
        "explanation": "",
        "breakdown": (q.get("breaking_down") or "").strip(),
        "frequency": int(q.get("frequency") or 0),
        # Filled in per slot below: the same question can be q07.mp3 in test 3
        # and q11.mp3 in test 18, so audio is keyed by (test, position).
        "audio": audio_by_test,
        "image": "",
    }


# ---------------------------------------------------------------------------
# banks
# ---------------------------------------------------------------------------
def load_test(export: Path, n: int) -> list[dict]:
    path = export / f"test{n:02d}" / f"test{n:02d}.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build_reading() -> dict:
    questions, tests = {}, {}
    for n in TESTS:
        rows = load_test(READING_EXPORT, n)
        if len(rows) != QUESTIONS_PER_TEST:
            sys.exit(f"reading test {n}: expected {QUESTIONS_PER_TEST}, got {len(rows)}")
        slots = []
        for row in sorted(rows, key=lambda r: r["_index"]):
            uuid = row["question_uuid"]
            questions.setdefault(uuid, convert_reading(row))
            slots.append(uuid)
        tests[str(n)] = slots
    return {"questions": questions, "tests": tests}


def build_listening() -> tuple[dict, dict]:
    """Returns (bank, images) where images maps uuid -> remote url to fetch."""
    questions, tests, images = {}, {}, {}
    for n in TESTS:
        rows = load_test(LISTENING_EXPORT, n)
        if len(rows) != QUESTIONS_PER_TEST:
            sys.exit(f"listening test {n}: expected {QUESTIONS_PER_TEST}, got {len(rows)}")
        slots = []
        for row in sorted(rows, key=lambda r: r["_index"]):
            uuid = row["question_uuid"]
            if uuid not in questions:
                questions[uuid] = convert_listening(row, {})
                if row.get("image_url"):
                    images[uuid] = row["image_url"]
                    questions[uuid]["image"] = f"listening/images/{uuid}.webp"
            # One audio file per slot, named by the position it holds.
            questions[uuid]["audio"][f"{n}:{row['_index']}"] = (
                f"listening/test{n:02d}/q{row['_index']:02d}.mp3")
            slots.append(uuid)
        tests[str(n)] = slots
    return {"questions": questions, "tests": tests}, images


# ---------------------------------------------------------------------------
# media
# ---------------------------------------------------------------------------
def link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)          # same volume: costs no disk
    except OSError:
        shutil.copy2(src, dst)     # different volume, or a filesystem without links


def stage_audio() -> int:
    staged = 0
    for n in TESTS:
        for pos in range(1, QUESTIONS_PER_TEST + 1):
            src = LISTENING_EXPORT / f"test{n:02d}" / f"q{pos:02d}.mp3"
            if not src.exists():
                sys.exit(f"missing audio: {src}")
            link_or_copy(src, MEDIA_DIR / "listening" / f"test{n:02d}" / f"q{pos:02d}.mp3")
            staged += 1
    return staged


def fetch_images(images: dict) -> tuple[int, list[str]]:
    """Download the question images the exporter left behind as URLs.

    Listening questions 1 and 2 show a photograph and ask which of four spoken
    sentences describes it — without the image they cannot be answered at all,
    and the export shipped only a link to someone else's Firebase bucket. The
    reading half of that same bucket already returns 404 for every object, so
    these are pulled local now rather than hotlinked and lost later.

    Returns (fetched, uuids that could not be fetched). A failure is not fatal:
    the caller drops the image reference so the player never renders a broken
    one. Two objects are already gone from the bucket, and both belong to C1
    questions that print their four options, so the image was illustrating the
    audio rather than carrying the question — losing it costs nothing that the
    recording does not still say.
    """
    out = MEDIA_DIR / "listening" / "images"
    out.mkdir(parents=True, exist_ok=True)
    done, failed = 0, []
    for uuid, url in sorted(images.items()):
        dst = out / f"{uuid}.webp"
        if dst.exists() and dst.stat().st_size > 0:
            done += 1
            continue
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "tcf-prep-ai/1.0"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    dst.write_bytes(resp.read())
                done += 1
                break
            except (urllib.error.URLError, OSError) as exc:
                if attempt == 2:
                    failed.append(uuid)
                    print(f"  image unavailable {uuid}: {exc}", file=sys.stderr)
    return done, failed


# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-media", action="store_true",
                    help="write the JSON banks only; do not touch backend/media")
    args = ap.parse_args()

    for export in (LISTENING_EXPORT, READING_EXPORT):
        if not export.is_dir():
            sys.exit(f"export folder not found: {export}")

    CONTENT_DIR.mkdir(parents=True, exist_ok=True)

    reading = build_reading()
    listening, images = build_listening()

    # Media first, so a question whose image cannot be fetched has its image
    # reference cleared before the bank is written. Writing the JSON first
    # would leave a path in the database pointing at a file that is not there.
    if not args.skip_media:
        print(f"staging audio into {MEDIA_DIR.relative_to(ROOT)} …")
        print(f"  {stage_audio()} audio files")
        done, failed = fetch_images(images)
        print(f"  {done}/{len(images)} question images")
        for uuid in failed:
            listening["questions"][uuid]["image"] = ""
    else:
        print("media skipped — image references left as built")

    for name, bank in (("reading", reading), ("listening", listening)):
        path = CONTENT_DIR / f"{name}.json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(bank, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"{path.relative_to(ROOT)}: {len(bank['questions'])} unique questions, "
              f"{len(bank['tests'])} papers ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
