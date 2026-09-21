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
TABLES = ROOT / "frontend" / "src" / "content" / "vocabularyTables.json"

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


def test_the_extracted_tables_are_real_pairs():
    """The page's indexable text. Generated from the PDF, never retyped."""
    data = json.loads(TABLES.read_text(encoding="utf-8"))
    tables = data["tables"]
    assert tables, "no tables were extracted"
    for table in tables:
        assert table["heading"].strip()
        # Only the free pages: this text is readable with no account, so it
        # must not come from a page that needs one.
        assert table["page"] in FREE, (
            f"{table['heading']} came from page {table['page']}, which is "
            f"behind the account check")
        assert table["rows"], f"{table['heading']} has no rows"
        for french, english in table["rows"]:
            # A column that slid would show up as an empty cell or as one
            # side holding both languages, not as a crash.
            assert french.strip() and english.strip(), table["heading"]
            assert french != english, table["heading"]
