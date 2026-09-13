/* The cards a due mistake can be drilled as.
 *
 * Five of the eight modes here exist to solve one problem: a mistake is logged
 * as a fragment — « je va », « notre tracteur » — and a fragment on its own is
 * not always a question. Nothing in « aller au marché » says who goes, so no
 * conjugation of it is right or wrong, and a card asking for one cannot be
 * answered by grammar, only guessed. Every card below puts the learner's own
 * sentence back on screen, which is where the subject was all along.
 *
 * The server decides which of these a given mistake can support and ships the
 * payload with the queue (see backend/review_exercises.py). A form that is
 * missing could not be built honestly, so the mode simply does not offer that
 * mistake rather than showing a broken card.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Keyboard } from '@phosphor-icons/react';
import { useT } from '../i18n';
import { AccentToolbar } from './AccentToolbar';
import { PLACEHOLDER, formFor, judge, markSpan, shuffle } from '../lib/review';

/* ------------------------------------------------------------- pieces ---- */

/* A stem with its blank drawn as a blank rather than as four underscores. */
function Stem({ text, className = '' }) {
  const parts = String(text || '').split(PLACEHOLDER);
  return (
    <p className={`text-lg leading-relaxed text-gray-800 ${className}`} data-testid="exercise-stem">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="mx-1 inline-block min-w-[4.5rem] border-b-2 border-dashed border-primary align-baseline" />
          )}
        </span>
      ))}
    </p>
  );
}

/* The learner's sentence with the wrong part marked, for the cards that show
   what they wrote rather than asking them to find it. */
function MarkedSentence({ sentence, fragment, className = '' }) {
  const span = markSpan(sentence, fragment);
  if (!span) {
    return <p className={`leading-relaxed ${className}`}>{sentence || fragment}</p>;
  }
  const [start, end] = span;
  return (
    <p className={`leading-relaxed ${className}`}>
      {sentence.slice(0, start)}
      <span className="rounded bg-red-50 px-1 font-semibold text-red-600 underline decoration-red-300 decoration-wavy">
        {sentence.slice(start, end)}
      </span>
      {sentence.slice(end)}
    </p>
  );
}

/* One line of French with the accents the keyboard does not have. */
function TypedField({ value, onChange, onSubmit, disabled, testid }) {
  const t = useT();
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="mt-5 space-y-2">
      <input ref={ref} type="text" value={value} disabled={disabled}
        data-testid={testid}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit(); }}
        placeholder={t('rev.typePlaceholder')}
        className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg outline-none transition focus:border-primary disabled:bg-gray-50 disabled:text-gray-500" />
      {!disabled && (
        <AccentToolbar textareaRef={ref}
          onInsert={(ch, next) => onChange(next === undefined ? value + ch : next)} />
      )}
    </div>
  );
}

/* Shown after every answer except in the sprint, which is two minutes against
   the clock and says so on the card that starts it. Everywhere else the card
   waits: the one sentence saying WHY the answer was wrong is the reason the
   review exists, and 900ms is less time than it takes to find it on the page. */
function Reveal({ mode, item, given, verdict, why, onNext, isLast }) {
  const t = useT();
  const form = formFor(mode, item);
  const expected = mode === 'pair' ? form?.right : (form?.answer || item.correction);
  return (
    <div className="mt-6 border-t border-gray-100 pt-5" data-testid="exercise-reveal">
      <p className={`text-sm font-bold ${verdict.correct ? 'text-green-700' : 'text-red-600'}`}>
        {verdict.correct ? t('rev.answerRight')
          : verdict.accentOnly ? t('rev.answerAccent') : t('rev.answerWrong')}
      </p>
      {!verdict.correct && (
        <p className="mt-1.5 text-sm text-gray-700">
          {t('rev.theAnswerIs')}{' '}
          <span className="font-semibold text-green-700">{expected}</span>
          {given ? (
            <>
              {' · '}{t('rev.youWrote')}{' '}
              <span className="text-red-600 line-through decoration-red-300">{given}</span>
            </>
          ) : null}
        </p>
      )}
      {mode === 'transfer' && (
        /* The drill is a different sentence on purpose, so it has to say which
           of the learner's own mistakes it came from or the point is lost. */
        <p className="mt-2 text-[13px] text-gray-500">
          {t('rev.transferFrom')}{' '}
          <span className="text-red-600 line-through decoration-red-300">{item.error_text}</span>
          {' → '}
          <span className="font-semibold text-green-700">{item.correction}</span>
        </p>
      )}
      {item.explanation && (
        <p className="mt-2.5 text-sm leading-relaxed text-gray-600">{item.explanation}</p>
      )}
      {why ? (
        <div className="mt-3 rounded-xl bg-gray-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
            {t('rev.yourReason')}
          </p>
          <p className="mt-1 text-sm text-gray-700">{why}</p>
        </div>
      ) : null}
      <button className="btn-primary mt-5 w-full justify-center" onClick={onNext}
        data-testid="review-next">
        {isLast ? t('rev.finish') : t('rev.next')}
      </button>
    </div>
  );
}

/* A wrong-looking option after the answer is in: green for the right one, red
   for the one the learner took, faded for the rest. */
function optionState(picked, option, expected, isCorrect) {
  if (picked == null) return '';
  if (isCorrect(option, expected)) return '!border-green-500 bg-green-50';
  if (option === picked) return '!border-red-400 bg-red-50';
  return 'opacity-50';
}

/* ---------------------------------------------------------- the cards ---- */

export function ExerciseCard({ mode, item, sprint = false, isLast = false, onAnswer }) {
  const t = useT();
  const form = formFor(mode, item);
  const [given, setGiven] = useState(null);
  const [typed, setTyped] = useState('');
  const [why, setWhy] = useState('');
  const [flipped, setFlipped] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setGiven(null); setTyped(''); setWhy(''); setFlipped(false);
    return () => clearTimeout(timer.current);
  }, [item.mistake_id, mode]);

  /* The options and the two sides of a minimal pair are shuffled per card.
     A pair that always put the corrected sentence second would be answerable
     by position, which is the same hole the Fisher–Yates note guards. */
  const options = useMemo(
    () => shuffle(form?.options || []), [form, item.mistake_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sides = useMemo(
    () => shuffle([form?.wrong, form?.right].filter(Boolean)),
    [form, item.mistake_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const verdict = given === null ? null : judge(mode, item, given);
  const commit = (value) => {
    setGiven(value);
    if (sprint) timer.current = setTimeout(() => onAnswer({ answer: value }), 700);
  };
  const next = () => onAnswer({ answer: given, note: why.trim() || undefined });

  /* ---- fix-it cards: nothing to compare, so the learner rates themselves -- */
  if (mode === 'flashcards') {
    return (
      <div className="card flip-in min-h-[260px] p-8" key={`${item.mistake_id}-${flipped}`}>
        {!flipped ? (
          <>
            <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.yourSentence')}</p>
            <MarkedSentence sentence={item.context_sentence} fragment={item.error_text}
              className="mt-3 text-lg text-red-700" />
            <p className="mt-6 text-sm text-gray-500">{t('rev.thinkThenFlip')}</p>
            <button className="btn-primary mt-4" onClick={() => setFlipped(true)}
              data-testid="flip-button">{t('rev.flip')}</button>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.correction')}</p>
            <p className="mt-3 text-lg font-medium leading-relaxed text-green-700">{item.correction}</p>
            {item.explanation && <p className="mt-4 text-sm text-gray-600">{item.explanation}</p>}
            <div className="mt-6 flex justify-center gap-3">
              <button className="btn-outline !border-amber-300 !text-amber-600"
                onClick={() => onAnswer({ selfRated: false })} data-testid="shaky-button">
                {t('rev.shaky')}
              </button>
              <button className="btn-primary !bg-green-600 hover:!bg-green-500"
                onClick={() => onAnswer({ selfRated: true })} data-testid="gotit-button">
                {t('rev.gotIt')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!form) return null;

  /* ---- choose the correct form, and its two-minute variant ---------------- */
  if (mode === 'mcq' || mode === 'sprint') {
    return (
      <div className="card p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.whichCorrect')}</p>
        {form.stem
          ? <Stem text={form.stem} className="mt-3" />
          /* No sentence survives for this mistake, so the options carry the
             subject themselves — the server only builds a stemless card when
             they do. */
          : <p className="mt-3 text-sm text-gray-500">{t('rev.noSentence')}</p>}
        <div className="mt-5 space-y-3">
          {options.map((opt) => (
            <button key={opt} disabled={given != null} data-testid="mcq-option"
              className={`block w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-left text-sm transition hover:border-primary ${
                optionState(given, opt, form.answer, (o, e) => o === e)}`}
              onClick={() => commit(opt)}>
              {opt}
            </button>
          ))}
        </div>
        {given != null && !sprint && (
          <Reveal mode={mode} item={item} given={given} verdict={verdict}
            onNext={next} isLast={isLast} />
        )}
      </div>
    );
  }

  /* ---- fill the blank in your own sentence -------------------------------- */
  if (mode === 'cloze') {
    return (
      <div className="card p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.clozePrompt')}</p>
        <Stem text={form.stem} className="mt-3" />
        <TypedField value={typed} onChange={setTyped} disabled={given != null}
          onSubmit={() => commit(typed)} testid="cloze-input" />
        {given == null && (
          <button className="btn-primary mt-4 w-full justify-center" disabled={!typed.trim()}
            onClick={() => commit(typed)} data-testid="check-button">
            <Check size={18} /> {t('rev.check')}
          </button>
        )}
        {given != null && (
          <Reveal mode={mode} item={item} given={given} verdict={verdict}
            onNext={next} isLast={isLast} />
        )}
      </div>
    );
  }

  /* ---- which part of this sentence is wrong ------------------------------- */
  if (mode === 'spot') {
    return (
      <div className="card p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.spotPrompt')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5" data-testid="spot-segments">
          {form.segments.map((seg, i) => (
            <button key={`${seg}-${i}`} disabled={given != null} data-testid="spot-segment"
              className={`rounded-lg border-2 border-dashed border-gray-200 px-2.5 py-1.5 text-lg leading-relaxed transition hover:border-primary hover:bg-violet-50 ${
                optionState(given, seg, form.answer, (o, e) => o === e)}`}
              onClick={() => commit(seg)}>
              {seg}
            </button>
          ))}
        </div>
        {given != null && (
          <Reveal mode={mode} item={item} given={given} verdict={verdict}
            onNext={next} isLast={isLast} />
        )}
      </div>
    );
  }

  /* ---- type the correction from memory ------------------------------------ */
  if (mode === 'typeit') {
    return (
      <div className="card p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.typePrompt')}</p>
        <MarkedSentence sentence={form.context || form.prompt} fragment={form.prompt}
          className="mt-3 text-lg text-gray-800" />
        <p className="mt-4 flex items-center gap-1.5 text-sm text-gray-500">
          <Keyboard size={16} /> {t('rev.typeAsk')}
        </p>
        <TypedField value={typed} onChange={setTyped} disabled={given != null}
          onSubmit={() => commit(typed)} testid="typeit-input" />
        {given == null && (
          <button className="btn-primary mt-4 w-full justify-center" disabled={!typed.trim()}
            onClick={() => commit(typed)} data-testid="check-button">
            <Check size={18} /> {t('rev.check')}
          </button>
        )}
        {given != null && (
          <Reveal mode={mode} item={item} given={given} verdict={verdict}
            onNext={next} isLast={isLast} />
        )}
      </div>
    );
  }

  /* ---- which of these two is correct, and why ----------------------------- */
  if (mode === 'pair') {
    return (
      <div className="card p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.pairPrompt')}</p>
        <div className="mt-4 space-y-3" data-testid="pair-sides">
          {sides.map((side, i) => (
            <button key={side} disabled={given != null} data-testid="pair-side"
              className={`flex w-full items-start gap-3 rounded-xl border-2 border-gray-200 px-4 py-3 text-left transition hover:border-primary ${
                optionState(given, side, form.right, (o, e) => o === e)}`}
              onClick={() => commit(side)}>
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[11px] font-bold text-gray-500">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="text-sm leading-relaxed">{side}</span>
            </button>
          ))}
        </div>
        {/* Asked before the reveal, not after: a reason written once the answer
            is on screen is a reason for the answer, not for the choice. */}
        <label className="mt-5 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('rev.whyLabel')}
          </span>
          <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)}
            disabled={given != null} data-testid="pair-why" maxLength={600}
            placeholder={t('rev.whyPlaceholder')}
            className="mt-1.5 w-full rounded-xl border-2 border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-primary disabled:bg-gray-50 disabled:text-gray-500" />
        </label>
        {given != null && (
          <Reveal mode={mode} item={item} given={given} verdict={verdict} why={why.trim()}
            onNext={next} isLast={isLast} />
        )}
      </div>
    );
  }

  /* ---- same rule, a sentence you have never seen -------------------------- */
  if (mode === 'transfer') {
    return (
      <div className="card p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.transferPrompt')}</p>
        {form.hint && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-[13px] font-semibold text-primary">
            <ArrowRight size={14} /> {form.hint}
          </p>
        )}
        <Stem text={form.stem} className="mt-3" />
        <TypedField value={typed} onChange={setTyped} disabled={given != null}
          onSubmit={() => commit(typed)} testid="transfer-input" />
        {given == null && (
          <button className="btn-primary mt-4 w-full justify-center" disabled={!typed.trim()}
            onClick={() => commit(typed)} data-testid="check-button">
            <Check size={18} /> {t('rev.check')}
          </button>
        )}
        {given != null && (
          <Reveal mode={mode} item={item} given={given} verdict={verdict}
            onNext={next} isLast={isLast} />
        )}
      </div>
    );
  }

  return null;
}
