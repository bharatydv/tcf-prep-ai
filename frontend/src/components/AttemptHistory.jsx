/* "You have sat this before" — the same block on every paper in the app.
 *
 * Every mode already recorded its attempts server-side; not one of them read
 * them back. A candidate who had finished a paper saw a page that behaved as
 * though they never had — no score, no answers, and in Expression orale's Test
 * Mode a sitting that reported "0 of 3 tâches completed" over three answers
 * that had really been graded. The record was never missing, only unread.
 *
 * One component rather than five, because the shape of the answer is the same
 * whatever the skill: when, how well, and a way back into the marked paper.
 * What differs is only where the rows come from and what opening one does, so
 * those are the props.
 *
 * It renders nothing at all on a paper never attempted. A heading over an
 * empty list would make a first sitting feel like a thing already failed.
 */
import { useEffect, useState } from 'react';
import { ArrowClockwise, CaretDown, ClockCounterClockwise, MagnifyingGlass } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDateTime, useT } from '../i18n';

/* A score is only worth colouring once it means something: the bands are the
   ones the papers themselves use, not an opinion invented here. */
function toneFor(pct) {
  if (pct >= 75) return 'bg-green-100 text-green-700';
  if (pct >= 50) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

/* Fetch the history for one paper, with the reload the pages need after a
   hand-in. Returns [] until it has loaded, and on failure: a history that
   cannot be read is a missing block, never an error over a working paper. */
export function useAttempts(url, { enabled = true } = {}) {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    if (!enabled || !url) { setAttempts([]); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.get(url)
      .then(({ data }) => {
        if (cancelled) return;
        setAttempts(Array.isArray(data) ? data : (data.attempts || []));
      })
      .catch(() => { if (!cancelled) setAttempts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, enabled, nonce]);

  return { attempts, loading, reload };
}

/* `attempts` rows: { id, label, created_at, score?, total?, note? }. The page
   maps its own records into that — a reading paper's 32/39, a tâche's B2 ·
   14/20 — because only the page knows how its marks are written. `score` and
   `total`, when given, choose the colour and nothing else. */
export default function AttemptHistory({
  attempts, onOpen, onRetake, opening = null, busy = false,
  className = '', testid = 'attempt-history',
  /* Only the newest few are worth the room; the rest are one click away.
     A candidate with thirty sittings wants the last one, not a ledger. */
  collapseAfter = 3,
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (!attempts?.length) return null;

  const shown = expanded ? attempts : attempts.slice(0, collapseAfter);
  const hidden = attempts.length - shown.length;

  return (
    <div className={`overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-soft ${className}`}
      data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2 border-b border-violet-50 px-5 py-3.5">
        <ClockCounterClockwise size={17} weight="fill" className="text-primary" />
        <p className="font-heading text-sm font-bold text-gray-900">
          {t('hist.title', { n: attempts.length })}
        </p>
        {onRetake && (
          <button type="button" onClick={onRetake} disabled={busy}
            data-testid={`${testid}-retake`}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline disabled:opacity-50">
            <ArrowClockwise size={13} weight="bold" />{t('hist.retake')}
          </button>
        )}
      </div>

      <ul className="divide-y divide-violet-50">
        {shown.map((a) => {
          const pct = a.total ? Math.round((a.score / a.total) * 100) : null;
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                pct == null ? 'bg-violet-100 text-primary' : toneFor(pct)}`}>
                {a.label}
              </span>
              <span className="text-xs text-gray-500">{formatDateTime(a.created_at)}</span>
              {a.note && <span className="text-xs text-gray-400">{a.note}</span>}
              <button type="button" onClick={() => onOpen(a)} disabled={busy}
                data-testid={`${testid}-open-${a.id}`}
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline disabled:opacity-50">
                <MagnifyingGlass size={12} weight="bold" />
                {opening === a.id ? t('hist.opening') : t('hist.review')}
              </button>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)}
          data-testid={`${testid}-more`}
          className="flex w-full items-center justify-center gap-1.5 border-t border-violet-50 py-2.5 text-xs font-semibold text-primary">
          <CaretDown size={12} weight="bold" />{t('hist.more', { n: hidden })}
        </button>
      )}
    </div>
  );
}
