"""Turn the free vocabulary PDF into what the website can show of it.

    cd backend
    pip install pypdfium2 pillow pdfplumber
    python tools/lead_pdf_preview.py

The guide is read on the website as text — an article, not a stack of page
pictures — so the main output is the guide as text, in two files that differ
only in who may have them:

1. `frontend/src/content/vocabularyGuide.json` — pages 2 to 4, block by block:
   headings, paragraphs and tables, in the order the PDF puts them and in the
   PDF's own words. Public, bundled, indexed. Page 1 is not among them: it is
   the cover, and a cover proves nothing. Page 25 is a copyright notice set in
   the brand font, and is not content either.

2. `backend/content/downloads/vocab-guide-gated.json` — pages 5 to 24, the
   same way, served by the API to somebody signed in. Not under `frontend/`,
   because anything the bundle holds is public whatever the page says.

Nothing in either file is written here. Every heading, every sentence and
every cell is read out of the PDF, so the page cannot drift from the guide
and a correction to the guide arrives on the page by re-running this.

Two kinds of picture as well, for the popup and the locked teaser:

* `frontend/public/tcf-vocabulary/page-N.webp` — the free pages, sharp.
* `frontend/public/tcf-vocabulary/blur-N.webp` — the gated pages, blurred,
  with the blur baked into the file rather than applied with CSS. A CSS blur
  is a filter over a picture that was still sent, and one line in the
  inspector removes it. A page nobody has an account for should not be
  sitting in the browser's cache in the clear.

HOW THE TEXT IS READ
--------------------
Three things make this harder than "extract the text", and each has a rule:

* The diagonal watermark and the page footer are set in Poppins; the document
  itself is set in DejaVu. Everything here reads DejaVu and nothing else, so
  "prepfrancais.com" never lands in the middle of a sentence.

* Columns are found from the ruled lines, not from pdfplumber's cell
  rectangles, which sit up to two points to the right of the rule they stand
  for — enough to put the I of "Il faut que" in the cell before it.

* Cells are built from characters placed by their midpoint, not from
  pdfplumber's words. A word is grouped by horizontal proximity and knows
  nothing about columns, so "nous" ending one column and "If" beginning the
  next become the single word "nousIf". A character has one midpoint and the
  midpoint is in exactly one cell.

All of it is committed. The popup and the page have to paint the moment they
open, and neither a PDF renderer in the bundle nor a round trip to the server
would survive that. Re-run this when the PDF changes.
"""
import io
import json
import sys
from pathlib import Path

try:
    import pdfplumber
    import pypdfium2 as pdfium
    from PIL import ImageFilter
except ImportError:  # pragma: no cover - a build-time script, not the app
    sys.exit("pip install pypdfium2 pillow pdfplumber")

ROOT = Path(__file__).resolve().parent.parent.parent
PDF = ROOT / "backend" / "content" / "downloads" / "tcf-canada-vocabulaire-thematique.pdf"
PUBLIC = ROOT / "frontend" / "public" / "tcf-vocabulary"
CONTENT = ROOT / "frontend" / "src" / "content" / "vocabularyGuide.json"
GATED = ROOT / "backend" / "content" / "downloads" / "vocab-guide-gated.json"

TOTAL_PAGES = 25
# The pages anybody may read, 1-based as the PDF numbers itself in its footer.
FREE = (2, 3, 4)
# Everything from here on is behind an account, up to and including the last
# page that carries content. Page 25 is the copyright notice.
FIRST_GATED = 5
LAST_CONTENT = 24

# Wide enough to stay sharp on a retina screen at the ~560px the reader gives
# it, and no wider: this is a picture of a page, not the page.
WIDTH = 900
# A blurred page is never read, so it is rendered small, which costs two
# kilobytes instead of eighty and blurs further on the way up to full size.
BLUR_WIDTH = 380
BLUR_RADIUS = 7

# The document's own typeface. See the note above.
BODY_FONT = "DejaVu"
# Point sizes, as the guide sets them. A theme title is 11.5, a table or
# formation heading is 8.6, and the two lines at the top of page 2 are 15.6.
SIZE_TITLE = 14.0
SIZE_SECTION = 10.0

# ---------------------------------------------------------------------------
# Reading the page
# ---------------------------------------------------------------------------


def body_chars(page):
    return [c for c in page.chars if BODY_FONT in (c.get("fontname") or "")]


def cluster(values, tol=1.5):
    """Positions that are the same rule seen twice, averaged into one."""
    groups = []
    for value in sorted(values):
        if groups and value - groups[-1][-1] <= tol:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [sum(g) / len(g) for g in groups]


def lines_of(chars, tol=1.2):
    """[(top, text, chars)] — one entry per visual line, in reading order."""
    chars = sorted(chars, key=lambda c: (round(c["top"], 1), c["x0"]))
    out, cur, top = [], [], None
    for c in chars:
        if top is None:
            top = c["top"]
        elif abs(c["top"] - top) > tol:
            out.append(cur)
            cur, top = [], c["top"]
        cur.append(c)
    if cur:
        out.append(cur)
    result = []
    for group in out:
        text = "".join(c["text"] for c in sorted(group, key=lambda c: c["x0"]))
        text = " ".join(text.split())
        if text:
            result.append((group[0]["top"], text, group))
    return result


def is_header_row(chars):
    """The dark band at the top of every table: bold, and white on it."""
    return bool(chars) and all(
        "Bold" in (c.get("fontname") or "")
        and str(c.get("non_stroking_color")) == "(1.0, 1.0, 1.0)"
        for c in chars if c["text"].strip())


def read_table(page, chars, table):
    """{head, rows} — or {rows} alone where the table began on the page before."""
    columns = cluster([e["x0"] for e in page.vertical_edges
                       if e["top"] < table.bbox[3] - 1
                       and e["bottom"] > table.bbox[1] + 1
                       and table.bbox[0] - 2 <= e["x0"] <= table.bbox[2] + 2])
    if len(columns) < 2:
        return None
    out = []
    for row in table.rows:
        cells, cell_chars = [], []
        for i in range(len(columns) - 1):
            inside = [c for c in chars
                      if columns[i] <= (c["x0"] + c["x1"]) / 2 < columns[i + 1]
                      and row.bbox[1] <= (c["top"] + c["bottom"]) / 2 <= row.bbox[3]]
            cell_chars += inside
            # Lines joined with a space: a cell that wraps has no space
            # character at the break, and "agissions" + "rapidement." would
            # otherwise come out as one word.
            cells.append(" ".join(text for _, text, _ in lines_of(inside)))
        if any(cells):
            out.append((cells, is_header_row(cell_chars)))
    if not out:
        return None
    if out[0][1]:
        return {"head": out[0][0], "rows": [cells for cells, _ in out[1:]]}
    return {"rows": [cells for cells, _ in out]}


def read_page(page, number):
    """Everything on one page, as blocks, top to bottom.

    Every block carries the page it came from, and a table carries it per
    row, because a table that runs over a page break has rows on both sides
    of the line between what is free and what is not.
    """
    chars = body_chars(page)
    tables = page.find_tables()
    blocks = []

    for table in tables:
        found = read_table(page, chars, table)
        if found:
            found.update(type="table", _page=number,
                         _row_pages=[number] * len(found["rows"]))
            blocks.append((table.bbox[1], found))

    def in_a_table(c):
        return any(b[0] - 1 <= c["x0"] and c["x1"] <= b[2] + 1
                   and b[1] - 1 <= c["top"] and c["bottom"] <= b[3] + 1
                   for b in (t.bbox for t in tables))

    # The prose between the tables. Consecutive body lines are one paragraph
    # until the gap between them opens up, which is where the guide starts a
    # new one — it has no blank lines to go on.
    run = None
    for top, text, group in lines_of([c for c in chars if not in_a_table(c)]):
        first = group[0]
        size = first.get("size") or 0
        # Bold by majority, not by first letter: the closing tip on page 24
        # is a paragraph with bold words scattered through it, and a line of
        # it that happens to open on one is still a line of the paragraph.
        letters = [c for c in group if c["text"].strip()]
        bold = sum("Bold" in (c.get("fontname") or "") for c in letters) \
            >= 0.8 * len(letters)
        if bold and size >= SIZE_SECTION:
            run = None
            kind = "title" if size >= SIZE_TITLE else "section"
            blocks.append((top, {"type": kind, "text": text, "_page": number}))
        elif bold:
            run = None
            blocks.append((top, {"type": "heading", "text": text, "_page": number}))
        elif run is not None and top - run[0] <= 16:
            run[1]["text"] += " " + text
            run[0] = top
        else:
            run = [top, {"type": "paragraph", "text": text, "_page": number}]
            blocks.append((top, run[1]))

    blocks.sort(key=lambda b: b[0])
    return [b for _, b in blocks]


def merge(document, page_blocks):
    """Join what the page break split in half.

    A table that runs over the foot of a page starts the next one with no
    header band, and a sentence that runs over starts it mid-clause. Neither
    is a new block, and rendering them as two would put a heading-less table
    and a fragment on the page.
    """
    for block in page_blocks:
        last = document[-1] if document else None
        if (last and block["type"] == "table" and last["type"] == "table"
                and "head" not in block):
            rows, pages = block["rows"], block["_row_pages"]
            # A row cut by the page break comes back as a row with one cell
            # filled: the tail of a sentence, and nothing beside it. It is
            # the end of the row before, not a row.
            if rows and last["rows"] and sum(1 for c in rows[0] if c.strip()) == 1:
                for i, cell in enumerate(rows[0]):
                    if cell.strip():
                        last["rows"][-1][i] = f"{last['rows'][-1][i]} {cell}".strip()
                rows, pages = rows[1:], pages[1:]
            last["rows"] += rows
            last["_row_pages"] += pages
            continue
        if (last and block["type"] == "paragraph" == last["type"]
                and block is page_blocks[0]):
            last["text"] += " " + block["text"]
            continue
        document.append(dict(block))
    return document


def split(document, last_free):
    """One document into the part anybody may have and the part behind an account.

    Split by page, and inside a table by row, so that a table that starts on
    page 4 and ends on page 5 gives page 4's rows to the free file and page
    5's to the gated one — marked `continues`, so the page can put them back
    under the same heading for somebody who may see both.
    """
    free, gated = [], []

    def clean(block):
        return {k: v for k, v in block.items() if not k.startswith("_")}

    for block in document:
        if block["type"] != "table":
            (free if block["_page"] <= last_free else gated).append(clean(block))
            continue
        rows = list(zip(block["rows"], block["_row_pages"]))
        before = [r for r, p in rows if p <= last_free]
        after = [r for r, p in rows if p > last_free]
        if before:
            free.append(dict(clean(block), rows=before))
        if after:
            tail = dict(clean(block), rows=after)
            if before:
                tail["continues"] = True
            gated.append(tail)
    return free, gated


def themes(pdf):
    """The guide's own theme headings, with the page each one opens on.

    Read rather than listed, so "does it cover housing?" is answered by the
    file and not by whoever last edited this script.
    """
    out = []
    for number, page in enumerate(pdf.pages, start=1):
        for _, text, group in lines_of(body_chars(page)):
            first = group[0]
            if ("Bold" in (first.get("fontname") or "")
                    and SIZE_SECTION <= (first.get("size") or 0) < SIZE_TITLE
                    and text[:1].isdigit() and ". " in text[:4]):
                out.append({"page": number, "title": text})
    return out


# ---------------------------------------------------------------------------
# Rendering the pictures
# ---------------------------------------------------------------------------


def render(page, width):
    # pypdfium2 renders by scale factor, so the scale has to be worked back
    # out from the width we want.
    return page.render(scale=width / page.get_width()).to_pil()


def main():
    if not PDF.exists():
        sys.exit(f"missing {PDF}")
    PUBLIC.mkdir(parents=True, exist_ok=True)
    CONTENT.parent.mkdir(parents=True, exist_ok=True)

    doc = pdfium.PdfDocument(str(PDF))
    if len(doc) != TOTAL_PAGES:
        sys.exit(f"expected {TOTAL_PAGES} pages, found {len(doc)}")
    print(f"{PDF.name}: {len(doc)} pages")

    for number in FREE:
        img = render(doc[number - 1], WIDTH).convert("RGB")
        path = PUBLIC / f"page-{number}.webp"
        img.save(path, "WEBP", quality=82, method=6)
        print(f"  free  {number:>2} -> {path.name} ({path.stat().st_size // 1024} KB)")

    for number in range(FIRST_GATED, LAST_CONTENT + 1):
        blurred = render(doc[number - 1], BLUR_WIDTH).convert("RGB")
        blurred = blurred.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
        blurred.save(PUBLIC / f"blur-{number}.webp", "WEBP", quality=70, method=6)
    print(f"  gated {FIRST_GATED}-{LAST_CONTENT} -> blur-N.webp")

    with pdfplumber.open(str(PDF)) as pdf:
        document = []
        for number in range(FREE[0], LAST_CONTENT + 1):
            merge(document, read_page(pdf.pages[number - 1], number))
        found_themes = themes(pdf)
    free, gated = split(document, FREE[-1])

    def tally(blocks):
        return {"tables": sum(b["type"] == "table" for b in blocks),
                "rows": sum(len(b["rows"]) for b in blocks if b["type"] == "table")}

    comment = (f"Generated by backend/tools/lead_pdf_preview.py from {PDF.name}. "
               "Every word comes out of the PDF. Do not edit by hand.")
    io.open(CONTENT, "w", encoding="utf-8", newline="\n").write(json.dumps({
        "_comment": comment,
        "freePages": list(FREE),
        "contentPages": [FREE[0], LAST_CONTENT],
        "totalPages": TOTAL_PAGES,
        "themes": found_themes,
        "blocks": free,
        # What is behind the account, counted, so the locked teaser can say
        # how much without being handed any of it.
        "gated": tally(gated),
    }, ensure_ascii=False, indent=2) + "\n")
    io.open(GATED, "w", encoding="utf-8", newline="\n").write(json.dumps({
        "_comment": comment,
        "pages": [FIRST_GATED, LAST_CONTENT],
        "blocks": gated,
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"  text  -> {CONTENT.name}: {tally(free)}  |  "
          f"{GATED.name}: {tally(gated)}  |  {len(found_themes)} themes")


if __name__ == "__main__":
    main()
