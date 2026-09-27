/* One group of exam sets on the Test Mode chooser: a month of the official
 * series, or the general practice sets.
 *
 * Each group is a tinted panel. Closed, it is a single row that shows five
 * sets and slides — the arrows on the right move it a screen at a time, and
 * it also scrolls by touch and wheel. "View all" opens the panel into a grid
 * of every set; the arrows go away with it, because there is nothing left to
 * slide to.
 *
 * Five, not all: forty cards under one heading is a wall, and three walls in
 * a row (September, August, July) is a page nobody reads to the bottom. A
 * panel per month keeps every month on the first screen.
 */
import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Microphone } from '@phosphor-icons/react';
import { useT } from '../i18n';

const ARROW = 'flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm ring-1 ring-pink-100 transition '
  + 'hover:bg-pink-600 hover:text-white hover:ring-pink-600 '
  + 'disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-gray-700 disabled:hover:ring-pink-100';

/* One set. The whole card is the button: the accent bar and the filled arrow
   say so at rest, and on hover the arrow goes solid and the card lifts. */
export function ExamSetCard({ set, title, onOpen }) {
  const t = useT();
  return (
    <button onClick={() => onOpen(set.set_number)}
      data-testid={`speaking-set-${set.set_number}`}
      className="group relative flex h-full w-full items-center gap-3 overflow-hidden rounded-2xl border border-white bg-white py-3.5 pl-5 pr-4 text-left shadow-sm transition
        hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-lg hover:shadow-pink-200/40
        focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-400">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-pink-500 to-fuchsia-600" />
      <span className="min-w-0 flex-1">
        <h3 className="truncate font-heading text-[15px] font-extrabold text-gray-900">{title}</h3>
        {/* Nothing about the paper itself — not the subject, not the domain
            it is drawn from. A theme is most of the preparation for a
            question about it, and a candidate who can read the themes will
            sit the paper they already have opinions about. */}
        <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <Microphone size={12} weight="fill" className="text-pink-500" />
          <span className="truncate">{t('sexam.cardMeta')}</span>
        </span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-50 text-pink-600 transition group-hover:bg-pink-600 group-hover:text-white">
        <CaretRight size={14} weight="bold" />
      </span>
    </button>
  );
}

export default function ExamSetRow({ title, subtitle, sets, cardTitle, onOpen, testid }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const scroller = useRef(null);
  // Whether there is anything further to slide to, so an arrow at the end
  // of the row is visibly disabled instead of doing nothing when pressed.
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
  };

  useEffect(() => {
    if (open) return undefined;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, sets.length]);

  // A screen at a time: the row is sized so that is exactly the next five.
  const slide = (dir) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
  };

  const many = sets.length > 5;

  return (
    <section data-testid={testid}
      className="mt-4 rounded-3xl border border-pink-100/80 bg-gradient-to-br from-pink-50/80 via-white to-violet-50/60 p-4 first:mt-0 sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-heading text-lg font-extrabold text-gray-900">
            {title}
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-pink-700 ring-1 ring-pink-100">
              {t('sexam.countTests', { n: sets.length })}
            </span>
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>

        {many && (
          <div className="flex shrink-0 items-center justify-end gap-2">
            <button onClick={() => setOpen((v) => !v)}
              data-testid={`${testid}-toggle`}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-white px-4 text-xs font-bold text-pink-700 shadow-sm ring-1 ring-pink-100 transition hover:bg-pink-600 hover:text-white hover:ring-pink-600">
              {open ? t('sexam.showLess') : t('sexam.viewAll')}
            </button>
            {!open && (
              <>
                <button onClick={() => slide(-1)} disabled={edge.start}
                  aria-label={t('sexam.prev')} className={ARROW}>
                  <CaretLeft size={16} weight="bold" />
                </button>
                <button onClick={() => slide(1)} disabled={edge.end}
                  aria-label={t('sexam.next')} className={ARROW}>
                  <CaretRight size={16} weight="bold" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {open ? (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5" data-testid={`${testid}-grid`}>
          {sets.map((s) => (
            <ExamSetCard key={s.set_number} set={s} title={cardTitle(s)} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        /* Bleeds to the panel edge on phones so the next card peeks in,
           which is what says "this slides" without an arrow. From sm up the
           arrows say it, and the row sits inside the panel padding. */
        <div ref={scroller} onScroll={measure}
          data-testid={`${testid}-row`}
          className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 pt-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {sets.map((s) => (
            <div key={s.set_number}
              className="w-[70%] shrink-0 snap-start sm:w-[calc(50%-0.375rem)] md:w-[calc(33.333%-0.5rem)] lg:w-[calc(20%-0.6rem)]">
              <ExamSetCard set={s} title={cardTitle(s)} onOpen={onOpen} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
