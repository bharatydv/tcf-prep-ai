/* Real reviews from learners, on the homepage, pricing page and /reviews.
 *
 * Only rows a learner agreed to share and an admin approved come back from
 * /api/reviews. With none yet, this renders nothing — an empty "What students
 * say" box would be worse than no box. The /reviews page passes showEmpty so
 * the page itself still says something.
 *
 * Two layouts:
 *   marquee (homepage, pricing) — cards drifting right to left, paused on
 *     hover. Below three reviews there is not enough to loop without the same
 *     card showing twice side by side, so they sit still in the middle.
 *   list (/reviews) — the average and a bar per star on the left, every
 *     review on the right, the way people are used to reading reviews.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SealCheck, Star } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useT, formatDate } from '../i18n';

const MIN_FOR_MARQUEE = 3;

function Stars({ value, size = 16 }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} weight="fill" className={n <= Math.round(value) ? 'text-amber-400' : 'text-gray-200'} />
      ))}
    </span>
  );
}

function Heading({ t }) {
  return (
    <h2 className="text-center font-heading text-3xl font-extrabold text-gray-900">
      {t('reviews.titleA')} <span className="text-primary">{t('reviews.titleB')}</span>
    </h2>
  );
}

function countLabel(t, n) {
  return t(n === 1 ? 'reviews.countOne' : 'reviews.count', { n });
}

function ReviewCard({ r, t, copy }) {
  return (
    <li data-copy={copy ? '1' : undefined} aria-hidden={copy || undefined}
      className="flex w-[280px] shrink-0 flex-col rounded-3xl border border-violet-100 bg-white p-5 shadow-soft sm:w-[320px]">
      <Stars value={r.rating} />
      <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-700">“{r.comment}”</p>
      <p className="mt-4 text-xs font-bold text-gray-900">{r.name || t('reviews.anonymous')}</p>
    </li>
  );
}

function Marquee({ data, t, showAllLink }) {
  const { reviews } = data;
  const moving = reviews.length >= MIN_FOR_MARQUEE;
  // About 7 seconds per card keeps each one on screen long enough to read.
  const duration = `${Math.max(30, reviews.length * 7)}s`;

  return (
    <>
      <Heading t={t} />
      {data.average != null && (
        <p className="mt-2 flex items-center justify-center gap-2 text-sm text-gray-600">
          <Stars value={data.average} />
          <span><strong>{data.average}</strong> / 5 · {countLabel(t, data.count)}</span>
        </p>
      )}
      {moving ? (
        <div className="reviews-marquee-mask mt-8 overflow-hidden py-2">
          <ul className="reviews-marquee flex w-max gap-4" style={{ '--marquee-duration': duration }}>
            {reviews.map((r) => <ReviewCard key={r.id} r={r} t={t} />)}
            {reviews.map((r) => <ReviewCard key={`copy-${r.id}`} r={r} t={t} copy />)}
          </ul>
        </div>
      ) : (
        <ul className="mt-8 flex flex-wrap justify-center gap-4">
          {reviews.map((r) => <ReviewCard key={r.id} r={r} t={t} />)}
        </ul>
      )}
      {showAllLink && (
        <p className="mt-6 text-center">
          <Link to="/reviews" className="text-sm font-bold text-primary hover:underline">{t('reviews.seeAll')}</Link>
        </p>
      )}
    </>
  );
}

function List({ data, t }) {
  const breakdown = data.breakdown || {};
  return (
    <>
      <Heading t={t} />
      <div className="mt-10 grid items-start gap-8 md:grid-cols-[280px_1fr]">
        <aside className="rounded-3xl border border-violet-100 bg-violet-50/40 p-6 md:sticky md:top-24">
          <p className="font-heading text-5xl font-extrabold leading-none text-gray-900">
            {data.average}<span className="ml-1 text-lg font-semibold text-gray-400">/ 5</span>
          </p>
          <div className="mt-2"><Stars value={data.average} size={18} /></div>
          <p className="mt-1.5 text-sm text-gray-500">{t('reviews.basedOn', { n: data.count })}</p>
          <ul className="mt-5 space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = breakdown[star] || 0;
              const pct = data.count ? Math.round((n / data.count) * 100) : 0;
              return (
                <li key={star} className="grid grid-cols-[28px_1fr_28px] items-center gap-2 text-xs tabular-nums text-gray-500">
                  <span>{star} ★</span>
                  <span className="h-2 overflow-hidden rounded-full bg-violet-100">
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-right">{n}</span>
                </li>
              );
            })}
          </ul>
        </aside>

        <ul className="divide-y divide-violet-50">
          {data.reviews.map((r) => (
            <li key={r.id} className="py-5 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stars value={r.rating} />
                <span className="text-sm font-bold text-gray-900">{r.name || t('reviews.anonymous')}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <SealCheck size={12} weight="fill" /> {t('reviews.verified')}
                </span>
                <span className="text-xs text-gray-400">{formatDate(r.created_at)}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">“{r.comment}”</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export default function ReviewsSection({ variant = 'marquee', limit = 12, showEmpty = false, showAllLink = true, className = '' }) {
  const t = useT();
  const [data, setData] = useState(null);

  useEffect(() => {
    // Not in the prerendered HTML: reviews change without a deploy.
    if (/ReactSnap/i.test(window.navigator.userAgent)) return;
    api.get('/api/reviews', { params: { limit } })
      .then(({ data: d }) => setData(d))
      .catch(() => setData({ reviews: [], count: 0 }));
  }, [limit]);

  if (!data) return null;
  if (!data.reviews.length) {
    return showEmpty
      ? <p className="card mx-auto max-w-xl p-8 text-center text-sm text-gray-500">{t('reviews.empty')}</p>
      : null;
  }

  return (
    <section className={className} data-testid="reviews-section">
      {variant === 'list'
        ? <List data={data} t={t} />
        : <Marquee data={data} t={t} showAllLink={showAllLink} />}
    </section>
  );
}
