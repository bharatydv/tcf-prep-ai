/* The pages of the real file, as pictures, turned with arrows.
 *
 * See backend/tools/lead_pdf_preview.py for where the pictures come from. It
 * starts at page 2 because page 1 is the cover, and a cover proves nothing:
 * anybody can put a title on a page. Pages 2 to 4 are the tables of French
 * with English beside it, which is the entire argument for handing over an
 * address.
 *
 * The last slide is page 5 with the blur baked into the file rather than
 * applied in CSS, so "the rest is locked" is true of what was sent and not
 * just of what is displayed. There is no sharp copy of any page past 4 on
 * the site at all (a test guards that), which is why somebody signed in is
 * not shown one here either: for them the slide says the rest is in the
 * file, and the file is one click away.
 *
 * One component for the exit dialog and the guide page, because the two
 * used to disagree about how the file was shown, and the guide page is the
 * one somebody looks at longest.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeft, CaretRight, BookOpen, Lock } from '@phosphor-icons/react';
import { useT } from '../i18n';

export const TOTAL_PAGES = 25;
export const FIRST_LOCKED = 5;
const SLIDES = [
  { page: 2, src: '/tcf-vocabulary/page-2.webp' },
  { page: 3, src: '/tcf-vocabulary/page-3.webp' },
  { page: 4, src: '/tcf-vocabulary/page-4.webp' },
  { locked: true, src: '/tcf-vocabulary/blur-5.webp' },
];

/* `readPath` is where the rest of the guide is, for somebody entitled to
   it: given, the last slide offers the way through instead of the padlock,
   because a lock over pages you already own is a lie. `keys` wires the arrow
   keys, which a dialog wants (it owns the keyboard while open) and a page
   does not (a reader pressing → to scroll a table must not turn a page
   they are not looking at). `compact` is the dialog's height budget. */
export default function PdfPreview({ readPath = null, keys = false, compact = false, className = '' }) {
  const t = useT();
  const [slide, setSlide] = useState(0);

  const step = useCallback((by) => {
    setSlide((i) => (i + by + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (!keys) return undefined;
    /* The arrow keys move the preview, because a carousel that can only be
       driven with the mouse is one most people never turn past the first
       page — and the first page is the least convincing one. */
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, step]);

  const current = SLIDES[slide];
  const caption = useMemo(() => (
    current.locked
      ? t('lead.locked', { from: FIRST_LOCKED, to: TOTAL_PAGES })
      : t('lead.page', { n: current.page, total: TOTAL_PAGES })
  ), [current, t]);

  const arrow = 'absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-violet-100 bg-white/95 text-primary shadow-md transition hover:bg-white disabled:opacity-40';

  return (
    <div className={className} data-testid="pdf-preview">
      <div className="relative">
        <button type="button" onClick={() => step(-1)} aria-label={t('lead.prev')}
          data-testid="lead-prev" className={`${arrow} left-2`}>
          <CaretLeft size={15} weight="bold" />
        </button>

        {/* Every page is in the DOM at once so an arrow press is instant
            rather than a spinner over a blank rectangle. They are four small
            pictures, not the 3 MB file. The first one stays in normal flow
            and the others sit over it, so the box is as tall as a page in
            any browser, including the ones that do not know aspect-ratio. */}
        <div className={`relative aspect-[857/1109] w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm ${compact ? 'max-h-[27vh] sm:max-h-none' : ''}`}>
          {SLIDES.map((s, i) => (
            <img key={s.src} src={s.src} alt=""
              aria-hidden={i !== slide}
              className={`${i === 0 ? 'relative' : 'absolute inset-0'} h-full w-full object-cover object-top transition-opacity duration-200 ${i === slide ? 'opacity-100' : 'opacity-0'}`} />
          ))}
          {current.locked && (
            <div className="absolute inset-0 grid place-items-center bg-white/45 px-4 text-center">
              {readPath ? (
                <Link to={readPath} data-testid="preview-read"
                  className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !py-2.5 text-sm">
                  <BookOpen size={16} weight="fill" /> {t('vocab.readCta')}
                </Link>
              ) : (
                <div>
                  <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-primary text-white shadow-lg">
                    <Lock size={17} weight="fill" />
                  </span>
                  <p className="mt-2 font-heading text-[13px] font-black leading-snug text-gray-900">
                    {t('lead.lockedBody')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <button type="button" onClick={() => step(1)} aria-label={t('lead.next')}
          data-testid="lead-next" className={`${arrow} right-2`}>
          <CaretRight size={15} weight="bold" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="text-[11px] font-semibold text-gray-500" data-testid="lead-caption">
          {caption}
        </span>
        <span className="flex gap-1">
          {SLIDES.map((s, i) => (
            <i key={s.src}
              className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-3.5 bg-primary' : 'w-1.5 bg-violet-200'}`} />
          ))}
        </span>
      </div>
    </div>
  );
}
