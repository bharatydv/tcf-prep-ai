"""The guide page is made of generated files, and nothing else checks them.

/tcf-canada-vocabulary is 24 pictures, half of them served by the API, plus a
JSON file of extracted tables — none of it written by hand, all of it committed
rather than built on deploy. A file missing from that set is not a failed
build: it is a page that renders with a broken image where page 17 should be,
on a visitor who has just created an account to see it.

So these are file-existence tests, deliberately. They are what stands between
"somebody edited the generator" and finding out in production.
"""
import json
from pathlib import Path

import server

ROOT = Path(server.__file__).resolve().parent.parent
PUBLIC = ROOT / "frontend" / "public" / "tcf-vocabulary"
CONTENT = ROOT / "frontend" / "src" / "content" / "vocabularyGuide.json"

FREE = (2, 3, 4)


def test_the_free_pages_are_public_files():
    # These three are not behind the endpoint at all: they are the sample, and
    # a sample that needs an account is not a sample.
    for number in FREE:
        path = PUBLIC / f"page-{number}.webp"
        assert path.is_file(), f"missing {path}"
        assert path.stat().st_size > 10_000, f"{path.name} looks empty"


def test_every_gated_page_has_both_a_blur_and_a_sharp_copy():
    for number in range(server.VOCAB_FIRST_GATED, server.VOCAB_TOTAL_PAGES + 1):
        blur = PUBLIC / f"blur-{number}.webp"
        sharp = server.VOCAB_PAGES_DIR / f"page-{number}.webp"
        assert blur.is_file(), f"missing {blur}"
        assert sharp.is_file(), f"missing {sharp}"
        # The blurred one is the small, unreadable copy. If it ever comes out
        # the size of the sharp one, something has stopped blurring — which
        # would put the paid-for pages in the clear in frontend/public.
        assert blur.stat().st_size * 4 < sharp.stat().st_size, (
            f"blur-{number}.webp is suspiciously large: "
            f"{blur.stat().st_size} vs {sharp.stat().st_size}")


def test_no_sharp_page_of_the_gated_half_is_in_the_public_folder():
    """The gate is the endpoint, and the endpoint is bypassed by a file.

    Anything under frontend/public is served to anybody who asks for it, so a
    sharp page-17.webp appearing there would quietly undo the account check in
    vocabulary_page() without changing a line of it.
    """
    for number in range(server.VOCAB_FIRST_GATED, server.VOCAB_TOTAL_PAGES + 1):
        assert not (PUBLIC / f"page-{number}.webp").exists(), (
            f"page {number} is behind an account, but a sharp copy of it is "
            f"in frontend/public")


def test_the_cover_is_not_shown_anywhere():
    # Page 1 is the branding page. It is not evidence of anything, and the
    # reader starts at page 2 on purpose.
    assert not (PUBLIC / "page-1.webp").exists()
    assert not (PUBLIC / "blur-1.webp").exists()
    assert not (server.VOCAB_PAGES_DIR / "page-1.webp").exists()


def _content():
    return json.loads(CONTENT.read_text(encoding="utf-8"))


def test_the_page_says_which_pages_it_transcribes():
    data = _content()
    assert data["freePages"] == list(FREE)
    assert data["totalPages"] == server.VOCAB_TOTAL_PAGES
    assert max(data["freePages"]) + 1 == server.VOCAB_FIRST_GATED


def test_the_transcription_keeps_the_guides_own_order():
    """The blocks are the guide's, in its order, and every table has cells.

    A column boundary that slid by two points does not crash: it moves the I
    of "Il faut que" into the cell before it, and the only way that is ever
    noticed is by checking. These are the shapes that go wrong when it does —
    an empty cell, a ragged row, a table with no rows at all.
    """
    blocks = _content()["blocks"]
    kinds = [b["type"] for b in blocks]
    assert kinds[0] == "title", "the transcription should open with the guide's title"
    assert "table" in kinds and "paragraph" in kinds and "heading" in kinds

    for block in blocks:
        if block["type"] != "table":
            assert block["text"].strip(), block
            continue
        assert block["rows"], block.get("head")
        width = len(block["head"]) if "head" in block else len(block["rows"][0])
        assert width >= 2
        for row in block["rows"]:
            assert len(row) == width, (block.get("head"), row)
            assert all(cell.strip() for cell in row), (block.get("head"), row)


def test_the_transcription_is_the_free_pages_and_only_those():
    """It ends where page 4 ends.

    Page 5 opens theme 2, so the presence of any theme after the first would
    mean the transcription had run past the account check and published a page
    nobody signed in for.
    """
    data = _content()
    text = json.dumps(data["blocks"], ensure_ascii=False)
    later = [t["title"] for t in data["themes"] if t["page"] > max(FREE)]
    assert later, "the guide should have themes past the free pages"
    for title in later:
        assert title not in text, f"{title} is behind the account check"


def test_the_contents_list_comes_out_of_the_guide():
    themes = _content()["themes"]
    assert len(themes) == 10
    assert themes[0]["page"] == 3
    # Numbered as the guide numbers them, ascending, with no gaps.
    for i, theme in enumerate(themes, start=1):
        assert theme["title"].startswith(f"{i}. "), theme
    pages = [t["page"] for t in themes]
    assert pages == sorted(pages)
