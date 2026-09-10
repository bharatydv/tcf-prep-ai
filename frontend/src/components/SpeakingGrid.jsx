/* The examiner's grid for one spoken answer.
 *
 * The official Expression orale result is not a single number. A candidate
 * told "B1" learns which shelf they are on and nothing about which part of B1
 * to work on, whereas the real grid marks four separate things and a weak
 * paper is usually weak in one of them. This renders what the grader returned
 * of that grid, in the order an examiner reads it.
 *
 * Only criteria the grader actually returned are drawn. A transcript grader
 * cannot hear the candidate and is instructed not to invent a phonological
 * score, so that row is simply absent rather than shown as a zero — telling
 * someone they scored 0 on something nobody assessed is worse than saying
 * nothing. The slot exists in SPEAKING_CRITERIA on the server, so an
 * audio-capable grader fills it here with no change to this file.
 */
import { Star, Target } from '@phosphor-icons/react';
import { markOutOf20, nclcFromMark, nextMarkBand, LEVEL_COLUMNS, levelColumn } from '../lib/tcf';
import { useT } from '../i18n';

// The examiner's own order: how it sounded, how the French held up, whether it
// answered the task, and whether it was structured.
const CRITERIA = ['phonology', 'linguistic', 'adequacy', 'discourse'];

/* Mirrors DELIVERY_SCALES in backend/server.py — the server only ever sends a
   value from these lists, and the position in the list is the colour: first is
   good, last is not. Change one, change both. */
const DELIVERY_SCALES = {
  pronunciation: ['clear', 'understandable', 'needs_work'],
  fluency: ['fluent', 'uneven', 'hesitant'],
  intonation: ['natural', 'flat', 'monotone'],
  liaisons: ['accurate', 'some_errors', 'many_errors'],
};

const RATING_TONE = [
  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'bg-amber-50 text-amber-700 ring-amber-200',
  'bg-rose-50 text-rose-700 ring-rose-200',
];

// The chart is a ladder, not data: each column is taller than the last because
// each level is higher than the last, and the filled one says where you stand.
const COLUMN_HEIGHT = ['34%', '50%', '66%', '82%', '100%'];

/* A bar's colour from its score, on the same CEFR bands the rubric uses. A
   single accent colour for every score would make a 25 and a 75 look alike at
   a glance, which is the one thing a bar chart is for. */
function barTone(score) {
  if (score < 20) return 'bg-red-500';
  if (score < 40) return 'bg-orange-500';
  if (score < 55) return 'bg-amber-500';
  if (score < 70) return 'bg-lime-500';
  if (score < 85) return 'bg-emerald-500';
  return 'bg-emerald-600';
}

export function SpeakingGrid({ result }) {
  const t = useT();
  if (!result) return null;

  const level = result.tcf_level;
  const mark = markOutOf20(result.overall_score, level);
  const nclc = nclcFromMark(mark);
  const next = nextMarkBand(mark);
  const here = levelColumn(level);

  const criteria = result.criteria && typeof result.criteria === 'object' ? result.criteria : {};
  const rows = CRITERIA
    .filter((name) => criteria[name] && Number.isFinite(criteria[name].score))
    .map((name) => [name, criteria[name]]);

  // How it was delivered, as chips. Only what the audio examiner actually
  // rated: an absent badge means nobody listened for it, which is the normal
  // case whenever the phonology criterion itself is absent.
  const delivery = result.delivery && typeof result.delivery === 'object' ? result.delivery : {};
  const badges = Object.entries(DELIVERY_SCALES)
    .map(([name, scale]) => [name, delivery[name], scale.indexOf(delivery[name])])
    .filter(([, , i]) => i >= 0);

  const strengths = Array.isArray(result.strengths) ? result.strengths : [];
  const focus = Array.isArray(result.focus_areas) ? result.focus_areas : [];

  // Nothing of the grid came back — an older graded attempt, or a grader that
  // dropped the fields. The headline level is shown by the caller either way,
  // so render nothing rather than an empty frame.
  if (!rows.length && !strengths.length && !focus.length && !badges.length && mark === null) return null;

  return (
    <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft"
      data-testid="speaking-grid">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">

        {/* THE MARK, AND HOW FAR THE NEXT BAND IS */}
        <div>
          {mark !== null && (
            <>
              {/* The bars are direct children of a fixed-height row: a
                  percentage height only resolves against a definite one, and
                  wrapping each in a column that shrank to its own label made
                  every bar collapse to nothing. Labels sit in their own row. */}
              <div className="flex h-16 items-end gap-1.5" aria-hidden="true">
                {LEVEL_COLUMNS.map((label, i) => (
                  <div key={label} style={{ height: COLUMN_HEIGHT[i] }}
                    className={`flex-1 rounded-t-md ${i === here ? 'bg-primary' : 'bg-violet-100'}`} />
                ))}
              </div>
              <div className="mt-1 flex gap-1.5" aria-hidden="true">
                {LEVEL_COLUMNS.map((label, i) => (
                  <span key={label}
                    className={`flex-1 text-center text-[9px] font-bold ${
                      i === here ? 'text-primary' : 'text-gray-400'}`}>
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-3 font-heading text-3xl font-extrabold text-primary"
                data-testid="grid-mark">
                {mark}<span className="text-lg text-gray-400">/20</span>
              </p>
              <p className="text-xs text-gray-500">
                {nclc ? t('grid.clb', { level: nclc }) : t('grid.clbBelow')}
              </p>

              {next && (
                <div className="mt-3 rounded-2xl bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 py-2">
                  <p className="text-xs font-bold text-primary" data-testid="grid-next">
                    {t('grid.toNext', { level: next.level, points: next.points })}
                  </p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500"
                      style={{ width: `${Math.round((mark / (mark + next.points)) * 100)}%` }} />
                  </div>
                </div>
              )}
            </>
          )}

          {strengths.length > 0 && (
            <div className="mt-4 rounded-2xl border-l-4 border-emerald-400 bg-emerald-50/50 p-3">
              <p className="flex items-center gap-1.5 font-heading text-xs font-bold text-emerald-900">
                <Star size={14} weight="fill" className="text-emerald-500" /> {t('grid.strengths')}
              </p>
              <ul className="mt-1.5 space-y-1">
                {strengths.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-gray-700">• {s}</li>
                ))}
              </ul>
            </div>
          )}

          {focus.length > 0 && (
            <div className="mt-3 rounded-2xl border-l-4 border-rose-400 bg-rose-50/50 p-3">
              <p className="flex items-center gap-1.5 font-heading text-xs font-bold text-rose-900">
                <Target size={14} weight="fill" className="text-rose-500" /> {t('grid.focus')}
              </p>
              <ul className="mt-1.5 space-y-1">
                {focus.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-gray-700">• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* CRITERION BY CRITERION */}
        <div className="space-y-4">
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="grid-delivery">
              {badges.map(([name, value, i]) => (
                <span key={name}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${RATING_TONE[i]}`}>
                  {t(`grid.delivery.${name}`)}: {t(`grid.rating.${value}`)}
                </span>
              ))}
            </div>
          )}
          {rows.map(([name, c]) => (
            <div key={name} data-testid={`grid-${name}`}>
              <p className="font-heading text-sm font-bold text-gray-900">{t(`grid.${name}`)}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className={`h-full rounded-full ${barTone(c.score)}`}
                  style={{ width: `${Math.max(2, c.score)}%` }} />
              </div>
              {c.comment && (
                <p className="mt-2 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
                  {c.comment}
                </p>
              )}
            </div>
          ))}
          {!rows.length && (
            <p className="text-xs leading-relaxed text-gray-400">{t('grid.none')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default SpeakingGrid;
