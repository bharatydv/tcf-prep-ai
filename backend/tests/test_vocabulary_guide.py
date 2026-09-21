"""The guide page is made of generated files, and nothing else checks them.

/tcf-canada-vocabulary is two JSON files of the guide's own text — one bundled
and public, one served only to an account — plus a handful of pictures. None
of it is written by hand, all of it is committed rather than built on deploy.
A file missing or wrong in that set is not a failed build: it is an article
that stops mid-table for a visitor who has just created an account to read
the rest.

So these check the files, deliberately. They are what stands between "somebody
edited the generator" and finding out in production.
"""
import json
from pathlib import Path

import server

ROOT = Path(server.__file__).resolve().parent.parent
PUBLIC = ROOT / "frontend" / "public" / "tcf-vocabulary"
FREE_CONTENT = ROOT / "frontend" / "src" / "content" / "vocabularyGuide.json"

FREE = (2, 3, 4)
LAST_CONTENT = 24


def _free():
    return json.loads(FREE_CONTENT.read_text(encoding="utf-8"))


def _gated():
    return json.loads(server.VOCAB_GATED_CONTENT.read_text(encoding="utf-8"))


def _tables(blocks):
    return [b for b in blocks if b["type"] == "table"]


# ---------------------------------------------------------------- pictures --

def test_the_free_pages_are_public_files():
    for number in FREE:
        path = PUBLIC / f"page-{number}.webp"
        assert path.is_file(), f"missing {path}"
        assert path.stat().st_size > 10_000, f"{path.name} looks empty"


def test_every_gated_page_has_a_blurred_copy_and_nothing_sharper():
    """The teaser is the blurred pictures. Nothing sharp of these pages may
    sit in frontend/public, because that folder is served to anybody who asks
    and a sharp page-17.webp there would undo the account check without
    changing a line of it."""
    for number in range(server.VOCAB_FIRST_GATED, LAST_CONTENT + 1):
        blur = PUBLIC / f"blur-{number}.webp"
        assert blur.is_file(), f"missing {blur}"
        # Small because unreadable. A blurred page the size of a sharp one is
        # a page that has stopped being blurred.
        assert blur.stat().st_size < 6_000, f"{blur.name} is suspiciously large"
        assert not (PUBLIC / f"page-{number}.webp").exists(), (
            f"page {number} is behind an account, but a sharp copy of it is "
            f"in frontend/public")


def test_neither_the_cover_nor_the_copyright_page_is_shown():
    # Page 1 is branding and page 25 is the usage notice: neither is content,
    # and neither should be offered as a page of the guide, blurred or not.
    for number in (1, server.VOCAB_TOTAL_PAGES):
        assert not (PUBLIC / f"page-{number}.webp").exists()
        assert not (PUBLIC / f"blur-{number}.webp").exists()


# -------------------------------------------------------------------- text --

def test_the_two_files_agree_about_where_the_line_is():
    free = _free()
    gated = _gated()
    assert free["freePages"] == list(FREE)
    assert free["totalPages"] == server.VOCAB_TOTAL_PAGES
    assert free["contentPages"] == [FREE[0], LAST_CONTENT]
    assert max(free["freePages"]) + 1 == server.VOCAB_FIRST_GATED
    assert gated["pages"] == [server.VOCAB_FIRST_GATED, LAST_CONTENT]


def test_every_table_in_both_files_is_whole():
    """A column boundary that slid by two points does not crash: it moves the
    I of "Il faut que" into the cell before it, and the only way that is ever
    noticed is by checking. These are the shapes that go wrong when it does —
    an empty cell, a ragged row, a table with no rows at all."""
    for name, blocks in (("free", _free()["blocks"]), ("gated", _gated()["blocks"])):
        assert blocks, f"{name}: nothing was extracted"
        for block in blocks:
            if block["type"] != "table":
                assert block["text"].strip(), (name, block)
                continue
            assert block["rows"], (name, block.get("head"))
            width = len(block["head"]) if "head" in block else len(block["rows"][0])
            assert width >= 2, (name, block.get("head"))
            for row in block["rows"]:
                assert len(row) == width, (name, block.get("head"), row)
                assert all(cell.strip() for cell in row), (name, block.get("head"), row)


def test_the_free_file_holds_only_the_free_pages():
    """Page 5 opens theme 2. Any theme past the first inside the bundled file
    would mean the split had run past the account check and published a page
    nobody signed in for."""
    free = _free()
    text = json.dumps(free["blocks"], ensure_ascii=False)
    later = [t["title"] for t in free["themes"] if t["page"] > max(FREE)]
    assert later, "the guide should have themes past the free pages"
    for title in later:
        assert title not in text, f"{title} is behind the account check"
    # and the free file opens with the guide's own title, as the PDF does
    assert free["blocks"][0]["type"] == "title"


def test_the_gated_file_holds_the_rest_and_continues_the_last_table():
    free = _free()
    gated = _gated()
    text = json.dumps(gated["blocks"], ensure_ascii=False)
    for theme in free["themes"]:
        if theme["page"] > max(FREE):
            assert theme["title"] in text, f"{theme['title']} is missing from the gated file"
    # The table cut by the page-4/5 break: its first rows are free, the rest
    # are gated and say so, under the same header, so the page can put them
    # back together for somebody who may see both.
    first = gated["blocks"][0]
    last_free_table = _tables(free["blocks"])[-1]
    assert first["type"] == "table" and first.get("continues") is True
    assert first["head"] == last_free_table["head"]
    # The counts the teaser quotes are the counts of what it is teasing.
    assert free["gated"] == {
        "tables": len(_tables(gated["blocks"])),
        "rows": sum(len(b["rows"]) for b in _tables(gated["blocks"])),
    }


def test_the_contents_list_comes_out_of_the_guide():
    themes = _free()["themes"]
    assert len(themes) == 10
    assert themes[0]["page"] == 3
    # Numbered as the guide numbers them, ascending, with no gaps.
    for i, theme in enumerate(themes, start=1):
        assert theme["title"].startswith(f"{i}. "), theme
    pages = [t["page"] for t in themes]
    assert pages == sorted(pages)
    assert all(FREE[0] <= p <= LAST_CONTENT for p in pages)
