"""Turn the free vocabulary PDF into what the website can show of it.

    cd backend
    pip install pypdfium2 pillow
    python tools/lead_pdf_preview.py

Three kinds of output, because the guide is shown three ways:

1. `frontend/public/tcf-vocabulary/page-N.webp` — the free pages, sharp, as
   public files. Page 1 is not among them: it is the cover, and a cover proves
   nothing. The sample starts at page 2, where the tables start.

2. `frontend/public/tcf-vocabulary/blur-N.webp` — every page behind the
   sign-in, blurred. The blur is baked into the file rather than applied with
   CSS: a CSS blur is a filter over a picture that was still sent, and one
   line in the inspector removes it. A page nobody has an account for should
   not be sitting in the browser's cache in the clear.

3. `backend/content/downloads/vocab-pages/page-N.webp` — the same pages
   sharp, served by the API to somebody signed in. Not in `public/`, because
   anything under `public/` is public whatever the page says.

And `frontend/src/content/vocabularyTables.json`: the two-column tables of the
free pages, as text. The reader above is pictures, and a picture of a table is
worth nothing to a search engine or to a screen reader — this is the same
content in HTML, taken out of the PDF rather than retyped beside it.

All of it is committed. The popup and the page have to paint the moment they
open, and neither a PDF renderer in the bundle nor a round trip to the server
would survive that. Re-run this when the PDF changes.
"""
import io
import json
import sys
from pathlib import Path

try:
    import pypdfium2 as pdfium
    from PIL import ImageFilter
except ImportError:  # pragma: no cover - a build-time script, not the app
    sys.exit("pip install pypdfium2 pillow")

ROOT = Path(__file__).resolve().parent.parent.parent
PDF = ROOT / "backend" / "content" / "downloads" / "tcf-canada-vocabulaire-thematique.pdf"
PUBLIC = ROOT / "frontend" / "public" / "tcf-vocabulary"
GATED = ROOT / "backend" / "content" / "downloads" / "vocab-pages"
TABLES = ROOT / "frontend" / "src" / "content" / "vocabularyTables.json"

TOTAL_PAGES = 25
# The pages anybody may read, 1-based as the PDF numbers itself in its footer.
FREE = (2, 3, 4)
# Everything from here on is behind an account.
FIRST_GATED = 5

# Wide enough to stay sharp on a retina screen at the ~560px the reader gives
# it, and no wider: this is a picture of a page, not the page.
WIDTH = 900
# A blurred page is never read, so it is rendered small, which costs two
# kilobytes instead of eighty and blurs further on the way up to full size.
BLUR_WIDTH = 380
BLUR_RADIUS = 7

# ---------------------------------------------------------------------------
# The tables, in the order they appear.
#
# Only the two-column ones, and only from the free pages. The four-column
# tables put two of their columns to the right of the split below, which would
# interleave them with the table being read; they stay pictures, which is what
# the reader is for.
#
# Each entry is (page, heading, rows). The row count is how the extraction
# knows where a table stops without having to understand the page.
# ---------------------------------------------------------------------------
WANTED = [
    (2, "Cause → Consequence Connectors", 12),
    (3, "Opinion Expressions", 10),
    (3, "Important Nouns", 13),
    (4, "Collocations", 7),
    (4, "Advanced Expressions", 5),
]

# Where the French column ends and the English one begins, in PDF points.
# The same for every two-column table in the file, which is what makes reading
# the two sides separately and pairing them up safe.
SPLIT_X = 300


def render(page, width):
    # pypdfium2 renders by scale factor, so the scale has to be worked back
    # out from the width we want.
    return page.render(scale=width / page.get_width()).to_pil()


def column(page, left, right):
    """The text of one vertical slice of a page, line by line.

    Read a side at a time rather than a row at a time: a row's two cells are
    two runs of characters that a text extractor is free to hand back in
    either order, while a column is unambiguous and comes out top to bottom.
    """
    tp = page.get_textpage()
    text = tp.get_text_bounded(left=left, bottom=0, right=right,
                               top=page.get_height())
    return [line.strip() for line in text.splitlines() if line.strip()]


def tables(doc):
    """The wanted tables, as {heading, rows: [[french, english], ...]}."""
    out = []
    for number in sorted({page for page, _, _ in WANTED}):
        page = doc[number - 1]
        left = column(page, 0, SPLIT_X)
        right = column(page, SPLIT_X, page.get_width())
        li = ri = 0
        for want_page, heading, count in WANTED:
            if want_page != number:
                continue
            # The heading, then the "French" header cell, then the rows.
            while li < len(left) and left[li] != heading:
                li += 1
            # The right-hand side has no headings, so its "English" header is
            # what marks the same table. Both sides only ever move forwards,
            # which is what keeps the two in step.
            while ri < len(right) and right[ri] != "English":
                ri += 1
            if li >= len(left) or ri >= len(right):
                sys.exit(f"table not found on page {number}: {heading}")
            li += 2
            ri += 1
            rows = [[left[li + i], right[ri + i]] for i in range(count)]
            out.append({"page": number, "heading": heading, "rows": rows})
            li += count
            ri += count
    return out


def main():
    if not PDF.exists():
        sys.exit(f"missing {PDF}")
    PUBLIC.mkdir(parents=True, exist_ok=True)
    GATED.mkdir(parents=True, exist_ok=True)
    TABLES.parent.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(PDF))
    if len(doc) != TOTAL_PAGES:
        sys.exit(f"expected {TOTAL_PAGES} pages, found {len(doc)}")
    print(f"{PDF.name}: {len(doc)} pages")

    for number in FREE:
        img = render(doc[number - 1], WIDTH).convert("RGB")
        path = PUBLIC / f"page-{number}.webp"
        img.save(path, "WEBP", quality=82, method=6)
        print(f"  free  {number:>2} -> {path.name} ({path.stat().st_size // 1024} KB)")

    for number in range(FIRST_GATED, TOTAL_PAGES + 1):
        page = doc[number - 1]
        blurred = render(page, BLUR_WIDTH).convert("RGB")
        blurred = blurred.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
        path = PUBLIC / f"blur-{number}.webp"
        blurred.save(path, "WEBP", quality=70, method=6)

        sharp = render(page, WIDTH).convert("RGB")
        gated = GATED / f"page-{number}.webp"
        sharp.save(gated, "WEBP", quality=82, method=6)
        print(f"  gated {number:>2} -> {path.name} ({path.stat().st_size // 1024} KB)"
              f" + {gated.name} ({gated.stat().st_size // 1024} KB)")

    found = tables(doc)
    payload = {
        "_comment": ("Generated by backend/tools/lead_pdf_preview.py from "
                     f"{PDF.name}. Do not edit by hand."),
        "tables": found,
    }
    io.open(TABLES, "w", encoding="utf-8", newline="\n").write(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"  tables -> {TABLES.name} "
          f"({len(found)} tables, {sum(len(x['rows']) for x in found)} rows)")


if __name__ == "__main__":
    main()
