/* One subject in the writing or speaking theme picker.
 *
 * Shared for the same reason PaperCard is: the two pickers were copies of each
 * other, down to a progress bar both of them hardcoded to 0% because nothing
 * on a submission said which theme it came from. Submissions carry a theme_id
 * now, so the bar is real and a subject already worked on offers the two
 * things worth doing with it — read the last attempt back, or do it again.
 *
 * Both buttons exist here and not on the comprehension papers because a
 * written or spoken attempt HAS a result page (/feedback/:id) and a paper does
 * not. The choice on each surface is the one its data can honestly support.
 */
import { BookOpen, CaretRight, Lock, ArrowCounterClockwise } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { displayMark } from '../lib/tcf';

export function ThemeCard({ theme, ns, locked, attempt, onOpen }) {
  const t = useT();
  const count = theme.question_count ?? 0;
  // A locked theme shows no history: the buttons below would open a paywall,
  // which is not what "see what I wrote" should do.
  const done = locked ? null : attempt;
  const written = done?.attempts || 0;
  // Coverage, not completion. A learner who wrote three times on one topic has
  // not covered three topics, so the bar is capped and the figure beside it
  // counts pieces rather than claiming a fraction of the theme is finished.
  const filled = count ? Math.min(100, Math.round((written / count) * 100)) : 0;

  const shell = `flex flex-col rounded-3xl border bg-white text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50 ${
    locked ? 'border-amber-100' : 'border-violet-100'}`;

  const body = (
    <div className="flex flex-1 flex-col p-6">
      <div className="flex items-start justify-between">
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${
          locked ? 'bg-amber-50' : 'bg-violet-100'}`}>
          {locked ? <Lock size={20} weight="fill" className="text-amber-500" />
            : (theme.emoji || <BookOpen size={20} weight="duotone" className="text-primary" />)}
        </span>
        {theme.is_premium ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            {t(`${ns}.pro`)}
          </span>
        ) : <CaretRight size={18} className="text-gray-300" />}
      </div>

      <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{theme.name}</h3>
      {theme.description && (
        <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{theme.description}</p>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{t(`${ns}.attempted`)}</span>
          <span className="font-semibold text-gray-700" data-testid="theme-written">
            {locked ? '—' : t(`${ns}.nWritten`, { n: written })}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500"
            style={{ width: `${locked ? 0 : filled}%` }} />
        </div>
        <p className="mt-1 text-right text-[10px] text-gray-400">
          {locked ? t('themes.upgradeToUnlock')
            : done ? t(`${ns}.lastWas`, {
              level: done.tcf_level || '—',
              score: displayMark(done.score, done.tcf_level) ?? '—',
            })
              : t('themes.completed', { n: 0 })}
        </p>
      </div>
    </div>
  );

  // Nothing written here yet, so the whole card is the one thing it can do.
  if (!done) {
    return (
      <button onClick={() => onOpen(theme)} data-testid={`theme-${theme.theme_id}`}
        className={shell}>
        {body}
      </button>
    );
  }

  return (
    <div className={`${shell} cursor-default`} data-testid={`theme-${theme.theme_id}`}>
      {body}
      <div className="flex gap-2 border-t border-gray-100 p-4 pt-3">
        <button onClick={() => onOpen(theme)} data-testid="theme-again"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white transition hover:opacity-90">
          <ArrowCounterClockwise size={14} weight="bold" /> {t(`${ns}.again`)}
        </button>
        <Link to={`/feedback/${done.submission_id}`} data-testid="theme-see-last"
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:border-primary hover:text-primary">
          {t(`${ns}.seeLast`)}
        </Link>
      </div>
    </div>
  );
}
