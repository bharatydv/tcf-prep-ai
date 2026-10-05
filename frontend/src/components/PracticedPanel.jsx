/* A tâche already practised: the standing grade, and the way back into it.
 *
 * Its own file rather than a shape inside the practice page, because two
 * places need it — tâche 1, whose history IS the tâche, and every question
 * card of tâches 2 and 3 — and because a component that owns a fetch, a
 * cache and a selection is worth being able to mount in a test.
 */
import { useState, useEffect, useMemo } from 'react';
import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { displayMark, nclcFromMark } from '../lib/tcf';
import AttemptHistory from './AttemptHistory';
import { SpeakingResult } from './SpeakingResult';
import { useT } from '../i18n';

/* WHAT THIS IS FOR
 *
 * Test Mode had all of this and Practice mode had none of it. A question
 * answered yesterday looked untouched today: no mark, no corrections, no sign
 * that it had ever been opened — and the grade it earned could only be found
 * by hunting the dashboard's history list for a row with the right date.
 *
 * So a practised tâche says so, carries the mark and the CLB band the exam
 * would report for it, and opens its own corrections. The corrections are
 * SpeakingResult, which is the same component Test Mode reads a tâche back
 * with: a practice answer is graded by the same examiner against the same
 * grid, so showing it through a smaller hand-rolled panel only meant practice
 * taught less than a test did.
 *
 * `fresh` is a grade handed over the moment it lands, which is the one result
 * already in hand and never worth fetching again. Everything behind it is a
 * row in `attempts` and is fetched the first time it is opened — the earlier
 * attempts of a question are exactly the thing nobody wants loaded until they
 * ask for one.
 */
export default function PracticedPanel({
  attempts, fresh, tacheNum, tts, onAgain, idPrefix, testid, hint = null,
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  // submission_id -> the full result. The fresh grade seeds it.
  const [cache, setCache] = useState({});
  const [opening, setOpening] = useState(null);
  /* The grade that has just landed, as a history row. The server's list is
     reloaded behind it, but not instantly, and a candidate who has only ever
     practised this once must not be shown an empty picker over their own
     result in the gap. */
  const [freshRow, setFreshRow] = useState(null);

  useEffect(() => {
    const id = fresh?.submission_id;
    if (!id) { setFreshRow(null); return; }
    setCache((held) => ({ ...held, [id]: fresh }));
    setFreshRow({
      submission_id: id,
      tcf_level: fresh.tcf_level,
      overall_score: fresh.overall_score,
      created_at: new Date().toISOString(),
      error_count: (fresh.errors || []).length,
    });
    setSelected(id);
    // The answer was just given: this is the moment its corrections are wanted.
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  const rows = useMemo(() => {
    const list = attempts || [];
    if (!freshRow) return list;
    if (list.some((a) => a.submission_id === freshRow.submission_id)) return list;
    return [freshRow, ...list];
  }, [attempts, freshRow]);

  // Newest first, so the first row is where this tâche now stands.
  const latest = rows[0] || null;

  /* Fetched the first time it is opened, and kept. The history rows carry a
     level and a mark but no corrections — opening one as it stands would show
     an empty result page. */
  const pick = async (row) => {
    const id = row.id || row.submission_id;
    if (!id) return;
    if (cache[id]) { setSelected(id); return; }
    setOpening(id);
    try {
      const { data } = await api.get(`/api/submissions/${id}`);
      setCache((held) => ({ ...held, [id]: { ...(data.submission || {}), loaded: true } }));
      /* Selected only once it is in hand. Moving first and failing afterwards
         left the panel spinning over a result that was never going to
         arrive — and threw away the attempt that was already on screen. */
      setSelected(id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOpening(null);
    }
  };

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!selected && latest) pick(latest);
  };

  if (!latest) return null;

  const mark = displayMark(latest.overall_score, latest.tcf_level);
  const clb = nclcFromMark(mark);
  const shown = selected ? cache[selected] : null;

  return (
    <div className="mt-4 rounded-2xl border border-green-200 bg-green-50/40 p-4"
      data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-green-700 shadow-sm">
          <CheckCircle size={12} weight="fill" /> {t('st.practiced')}
        </span>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-primary shadow-sm">
          {latest.tcf_level} · {mark ?? '—'}/20
        </span>
        {/* The band the real paper reports, from the same conversion table
            Test Mode uses — see nclcFromMark in lib/tcf.js. */}
        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-700"
          data-testid={`${testid}-clb`}>
          {clb ? t('sexam.clb', { level: clb }) : t('sexam.clbBelow')}
        </span>
        <button type="button" onClick={toggle} data-testid={`${testid}-review`}
          className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 px-1 text-xs font-semibold text-primary underline">
          <MagnifyingGlass size={12} weight="bold" />
          {open ? t('st.hideMistakes') : t('st.reviewMistakes')}
        </button>
      </div>
      {(rows.length > 1 || hint) && (
        <p className="mt-1 text-xs text-gray-500">
          {rows.length > 1 ? t('st.nAttempts', { n: rows.length }) : hint}
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          {/* Which attempt's mistakes to read, and the way to earn another
              one. Both only appear once there is an attempt to choose. */}
          <AttemptHistory
            testid={`${testid}-attempts`}
            attempts={rows.map((a, i) => ({
              id: a.submission_id,
              label: `${t('hist.attemptN', { n: rows.length - i })} · ${a.tcf_level} · ${
                displayMark(a.overall_score, a.tcf_level) ?? '—'}/20`,
              note: a.error_count
                ? t('hist.errors', { n: a.error_count })
                : t('hist.noErrors'),
              created_at: a.created_at,
            }))}
            selectedId={selected}
            opening={opening}
            onOpen={pick}
            onRetake={onAgain}
            retakeLabel={t('st.practiceAgain')} />

          {rows.length > 1 && (
            <p className="px-1 text-xs text-gray-500">{t('st.pickAttempt')}</p>
          )}

          {shown ? (
            <SpeakingResult result={shown} tts={tts} idPrefix={idPrefix}
              taskType={tacheNum} />
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-violet-100 bg-white p-8 text-xs text-gray-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-primary" />
              {t('st.openingAttempt')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
