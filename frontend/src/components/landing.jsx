/* Primitives shared by every marketing page.
 *
 * These four lived inside Landing.jsx, which was fine while the landing page
 * was the only marketing surface. The /tcf-canada family adds fifteen more,
 * and a second copy of a scroll-reveal wrapper is the kind of thing that
 * drifts — one file gets the reduced-motion fix and the other does not.
 *
 * They pair with the .reveal / .faq-body / .ring-fg rules in index.css, which
 * already force an end state under prefers-reduced-motion.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';

/* Fires once, then disconnects: these drive entrance animations, not state
   that has to stay in sync with the viewport. */
export function useInView(threshold = 0.18) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

/* `as` exists because this wrapper was used inside a <ul>, where a <div>
   between the list and its items is invalid: the list stopped being announced
   as a list at all. Anything that wraps a semantic child needs to be able to
   become that child's legal parent. */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }) {
  const [ref, inView] = useInView();
  return (
    <Tag ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/* Animated progress ring. `max` is the scale the number is out of, so the same
   component draws a /20 tâche mark and a /699 section score. */
export function ScoreRing({ value = 82, max = 100, size = 92, label = '/100', caption, to = '#22C55E' }) {
  const [ref, inView] = useInView(0.6);
  const gradId = `ringGrad-${useId().replace(/:/g, '')}`;
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / max));
  return (
    <div ref={ref} className="inline-flex flex-col items-center">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDE9FE" strokeWidth="9" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gradId})`} strokeWidth="9"
            strokeLinecap="round" strokeDasharray={c} className="ring-fg"
            strokeDashoffset={inView ? c * (1 - pct) : c}
          />
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7C3AED" />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute text-center leading-none">
          <span className="font-heading text-2xl font-bold text-gray-900">{value}</span>
          <span className="block text-[10px] text-gray-400">{label}</span>
        </div>
      </div>
      {caption && (
        <span className="mt-1.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400">{caption}</span>
      )}
    </div>
  );
}

/* Disclosure, not a <details>: the grid-template-rows trick animates to the
   real content height, which <details> cannot do without a measured height. */
export function Faq({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-gray-800"
        onClick={() => setOpen(!open)} aria-expanded={open}>
        {q}
        <CaretDown size={18} className={`shrink-0 text-primary transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`faq-body ${open ? 'open' : ''}`}>
        <div><p className="px-5 pb-5 text-sm leading-relaxed text-gray-600">{a}</p></div>
      </div>
    </div>
  );
}
