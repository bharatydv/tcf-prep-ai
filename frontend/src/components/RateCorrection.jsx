/* "How was this correction?" under a result: five faces, one to five stars.
 *
 * A face is picked first because it is one tap and needs no reading. Only then
 * does the comment box open, and only a 4 or 5 is offered the choice to be
 * shown on the site — a low rating is feedback for us, never a public quote.
 * Nothing appears publicly until an admin approves it (see /admin, Reviews).
 */
import { useEffect, useState } from 'react';
import { Star } from '@phosphor-icons/react';
import { api, errMsg } from '../lib/api';
import { useT } from '../i18n';
import { useAuth } from '../context/AuthContext';

const FACES = ['😞', '🙁', '😐', '🙂', '😍'];

/* `compact`: for a narrow inline result card (the speaking practice page),
   where the full-width card with its own top margin does not fit. */
export default function RateCorrection({ submissionId, compact = false }) {
  const t = useT();
  const { user } = useAuth() || {};
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [allowPublic, setAllowPublic] = useState(false);
  const [name, setName] = useState(((user && user.name) || '').split(' ')[0]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Already rated: show the thanks, not the question again.
  useEffect(() => {
    if (!submissionId) return;
    api.get(`/api/reviews/mine/${submissionId}`)
      .then(({ data }) => {
        if (!data.review) return;
        setRating(data.review.rating);
        setComment(data.review.comment || '');
        setAllowPublic(Boolean(data.review.allow_public));
        setDone(true);
      })
      .catch(() => {});
  }, [submissionId]);

  if (!submissionId) return null;

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/reviews', {
        submission_id: submissionId, rating, comment,
        display_name: name, allow_public: rating >= 4 && allowPublic,
      });
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const box = compact
    ? 'rounded-2xl border border-violet-100 bg-white p-4'
    : 'card mt-8 p-6';

  if (done) {
    return (
      <section className={`${box} text-center`} data-testid="rate-done">
        <p className={compact ? 'text-2xl' : 'text-3xl'}>{FACES[rating - 1]}</p>
        <p className="mt-2 font-heading font-semibold text-gray-900">{t('rate.thanks')}</p>
        <button type="button" onClick={() => setDone(false)}
          className="mt-2 text-xs font-semibold text-primary hover:underline">
          {t('rate.change')}
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={send} className={box} data-testid="rate-correction">
      <p className={`text-center font-heading font-semibold text-gray-900 ${compact ? 'text-sm' : ''}`}>{t('rate.question')}</p>
      <div className={`mt-4 flex justify-center ${compact ? 'gap-1' : 'gap-2 sm:gap-4'}`}>
        {FACES.map((face, i) => {
          const value = i + 1;
          const on = rating === value;
          return (
            <button key={value} type="button" onClick={() => setRating(value)}
              aria-label={t(`rate.label${value}`)} aria-pressed={on}
              data-testid={`rate-${value}`}
              className={`flex flex-col items-center rounded-2xl border px-1 py-2 transition ${compact ? 'w-12' : 'w-14 sm:w-16'} ${on ? 'border-primary bg-violet-50' : 'border-transparent hover:bg-gray-50'}`}>
              <span className={`transition ${compact ? 'text-2xl' : 'text-3xl'} ${rating && !on ? 'opacity-40 grayscale' : ''}`}>{face}</span>
              <span className="mt-1 text-[11px] font-semibold text-gray-500">{t(`rate.label${value}`)}</span>
            </button>
          );
        })}
      </div>

      {rating > 0 && (
        <>
          <div className="mt-3 flex justify-center gap-0.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} size={18} weight="fill" className={n <= rating ? 'text-amber-400' : 'text-gray-200'} />
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3}
            placeholder={t(rating >= 4 ? 'rate.placeholderGood' : 'rate.placeholderBad')}
            data-testid="rate-comment"
            className="mt-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />

          {rating >= 4 && (
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-gray-700">
                <input type="checkbox" checked={allowPublic} onChange={(e) => setAllowPublic(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary" data-testid="rate-public" />
                <span>{t('rate.allowPublic')}</span>
              </label>
              {allowPublic && (
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                  placeholder={t('rate.namePlaceholder')} data-testid="rate-name"
                  className="w-full max-w-xs rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              )}
              {allowPublic && !comment.trim() && (
                <p className="text-xs text-amber-700">{t('rate.needComment')}</p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 text-center">
            <button className="btn-primary" disabled={busy} data-testid="rate-submit">{t('rate.send')}</button>
          </div>
        </>
      )}
    </form>
  );
}
