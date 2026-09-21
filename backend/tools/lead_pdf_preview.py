"""Turn the free vocabulary PDF into the pictures the popup shows.

    cd backend
    pip install pypdfium2 pillow
    python tools/lead_pdf_preview.py

Writes into frontend/public/lead-preview/, which is committed: the popup has
to paint the instant it opens, on a visitor who is already halfway out of the
tab, and neither a PDF renderer in the bundle nor a round trip to the server
would survive that. Re-run it when the PDF changes.

Why pictures, and why these pages
---------------------------------
Page 1 is the cover, which proves nothing — anybody can put a title on a page.
Pages 2, 3 and 4 are the tables, and a table of real French with real English
beside it is the whole argument for handing over a phone number. So the
preview starts at page 2.

The last picture is page 5 blurred, standing for everything from 5 to 25. The
blur is baked into the file rather than applied with CSS, because a CSS blur
is a filter over a picture that was still sent: remove one line in the
inspector and the page is readable. A page nobody has paid for with their
details should not be sitting in the browser's cache in the clear.
"""
import sys
from pathlib import Path

try:
    import pypdfium2 as pdfium
    from PIL import ImageFilter
except ImportError:  # pragma: no cover - a build-time script, not the app
    sys.exit("pip install pypdfium2 pillow")

ROOT = Path(__file__).resolve().parent.parent.parent
PDF = ROOT / "backend" / "content" / "downloads" / "tcf-canada-vocabulaire-thematique.pdf"
OUT = ROOT / "frontend" / "public" / "lead-preview"

# The readable pages, 1-based as the PDF numbers them in its own footer.
SHOWN = (2, 3, 4)
# The page that stands in for the rest of the file.
LOCKED = 5

# Wide enough to stay sharp on a retina screen at the ~330px the popup gives
# it, and no wider: this is a picture of a page, not the page.
WIDTH = 760
# The locked one is never read, so it is rendered small and blurred, which
# costs a few kilobytes instead of seventy.
LOCKED_WIDTH = 380
LOCKED_BLUR = 7


def render(page, width):
    # pypdfium2 renders by scale factor, so the scale has to be worked back
    # out from the width we want.
    scale = width / page.get_width()
    return page.render(scale=scale).to_pil()


def main():
    if not PDF.exists():
        sys.exit(f"missing {PDF}")
    OUT.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(PDF))
    print(f"{PDF.name}: {len(doc)} pages")

    for number in SHOWN:
        img = render(doc[number - 1], WIDTH).convert("RGB")
        path = OUT / f"page-{number}.webp"
        img.save(path, "WEBP", quality=82, method=6)
        print(f"  page {number} -> {path.name} ({path.stat().st_size // 1024} KB)")

    img = render(doc[LOCKED - 1], LOCKED_WIDTH).convert("RGB")
    img = img.filter(ImageFilter.GaussianBlur(LOCKED_BLUR))
    path = OUT / "locked.webp"
    img.save(path, "WEBP", quality=70, method=6)
    print(f"  page {LOCKED} blurred -> {path.name} "
          f"({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
