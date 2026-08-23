import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Microphone, PenNib, GraduationCap, CheckCircle,
  Fire, ChartLineUp, CaretDown, RocketLaunch, PaperPlaneTilt,
  ArrowRight, Play,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { Seo, SITE_URL } from '../lib/seo';
import { track } from '../lib/api';
import { useBillingPlans } from '../lib/plans';

/* ------------------------------------------------ scroll-reveal helpers ---- */
function useInView(threshold = 0.18) {
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
function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }) {
  const [ref, inView] = useInView();
  return (
    <Tag ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------ score ring ---- */
function ScoreRing({ value = 82, max = 100, size = 92, label = '/100', caption, to = '#22C55E' }) {
  const [ref, inView] = useInView(0.6);
  const gradId = `ringGrad-${useId().replace(/:/g, '')}`;
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / max));
  return (
    <div ref={ref} className="inline-flex flex-col items-center">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
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

/* ------------------------------------------------------------- FAQ item ---- */
function Faq({ q, a }) {
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

/* ===================================================================== page */
/* Verifiable description of the product, in place of invented testimonials. */
const HOW_IT_WORKS = [
  { title: 'land.how1t', body: 'land.how1b' },
  { title: 'land.how2t', body: 'land.how2b' },
  { title: 'land.how3t', body: 'land.how3b' },
  { title: 'land.how4t', body: 'land.how4b' },
];

const FAQ_NUMBERS = [1, 2, 3, 4];

export default function Landing() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [simTopic, setSimTopic] = useState('');
  const [simAnswer, setSimAnswer] = useState('');
  const trialTo = user ? '/dashboard' : '/register';

  // The top of the funnel. Everything else is measured against this number.
  useEffect(() => { track('landing_view'); }, []);

  const startSimulator = () => {
    if (!user) { toast.info(t('land.registerToast')); return navigate('/register'); }
    // Land on the writing task overview with the own-question panel already
    // filled in, rather than the separate check-writing page.
    navigate('/practice/tasks', {
      state: { ownQuestion: simTopic.trim(), text: simAnswer.trim() },
    });
  };

  /* The same catalogue the pricing page and the paywall render, straight from
     GET /api/billing/plans. This section used to carry its own Bronze/Silver/
     Gold cards at prices that existed nowhere else, so the first page a visitor
     saw quoted one figure and checkout charged another. */
  const { plans } = useBillingPlans();
  const planFeatures = ['pricing.feature1', 'pricing.feature2', 'pricing.feature3', 'pricing.feature4'];

  const nclc = [
    ['10+', '549 - 699', '16 - 20', '549 - 699', '16 - 20'],
    ['9', '524 - 548', '14 - 15', '524 - 548', '14 - 15'],
    ['8', '499 - 523', '12 - 13', '503 - 522', '12 - 13'],
    ['7', '453 - 498', '10 - 11', '458 - 502', '10 - 11'],
    ['6', '406 - 452', '7 - 9', '398 - 457', '7 - 9'],
    ['5', '375 - 405', '6 - 6', '369 - 397', '6 - 6'],
    ['4', '342 - 374', '4 - 5', '331 - 368', '4 - 5'],
  ];


  return (
    <main className="overflow-x-clip bg-white">
      <Seo
        titleKey="seo.home.title"
        descKey="seo.home.desc"
        path="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          inLanguage: lang === 'fr' ? 'fr-CA' : 'en',
          url: `${SITE_URL}/`,
          mainEntity: FAQ_NUMBERS.map((n) => ({
            '@type': 'Question',
            name: t(`land.faq${n}q`),
            acceptedAnswer: { '@type': 'Answer', text: t(`land.faq${n}a`) },
          })),
        }}
      />
      {/* ============================================================ HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="blob absolute -left-24 top-10 h-72 w-72 rounded-full bg-fuchsia-300/30 blur-3xl" />
        <div className="blob absolute right-0 top-1/3 h-80 w-80 rounded-full bg-violet-400/25 blur-3xl" style={{ animationDelay: '-5s' }} />
        <div className="blob absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-purple-300/30 blur-3xl" style={{ animationDelay: '-9s' }} />
        </div>
      
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pb-24 lg:pt-20">
          {/* left copy */}
          <div>
            {/* <span className="hero-rise inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm backdrop-blur mx-auto">
              <SealCheck size={15} weight="fill" /> Official TCF curriculum aligned
            </span> */}
            <h1 className="hero-rise mt-5 font-heading text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl" style={{ animationDelay: '0.1s' }}>
              {t('land.h1a')}<br />
              Score CLB 7{' '}
              <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">{t('land.h1b')}</span>
            </h1>
            <p className="hero-rise mt-5 max-w-md text-[15px] leading-relaxed text-gray-600" style={{ animationDelay: '0.2s' }}>
              {t('land.subheading')}
            </p>
            <div className="hero-rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: '0.3s' }}>
              <Link to={trialTo} data-testid="hero-trial-button"
                className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-6 !py-3 shadow-lg shadow-violet-300/60 hover:!brightness-110">
                {t('land.trial')}
              </Link>
              {/* <Link to="/pricing" className="btn-outline !border-gray-300 bg-white !px-6 !py-3" data-testid="hero-plans-button">
                {t('land.explorePlans')}
              </Link> */}
            </div>
            <div className="hero-rise mt-9 flex flex-wrap items-center gap-7" style={{ animationDelay: '0.4s' }}>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2.5">
                  {['SL', 'KB', 'PN'].map((ini, i) => (
                    <span key={ini} className="flex h-9 w-9 items-center rounded-full border-2 border-white text-[10px] font-bold text-white"
                      style={{ background: ['#7C3AED', '#C026D3', '#5B21B6'][i] }}>{ini}</span>
                  ))}
                </div>
                <div className="leading-tight">
                  <p className="font-heading text-sm font-bold text-gray-900">{t('land.freeMonthly')}</p>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('land.noCardShort')}</p>
                </div>
              </div>
              {/* <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-200/70 text-primary">
                  <ShieldCheck size={18} weight="fill" />
                </span>
                <p className="text-xs font-semibold leading-tight text-gray-700">{t('land.secure')}<br /><span className="text-gray-400">{t('land.adFree')}</span></p>
              </div> */}
            </div>
          </div>
          {/* right: youtube video — oozing-from-screen effect */}
          <div className="hero-rise" style={{ animationDelay: '0.25s' }}>
            <div className="relative mx-auto max-w-lg[1024px]">
              <div aria-hidden className="pointer-events-none absolute -inset-4 rounded-[2rem] bg-violet-400/20 blur-2xl" />
              <div aria-hidden className="pointer-events-none absolute -inset-8 rounded-[2.5rem] bg-fuchsia-300/15 blur-3xl" />
              <div className="relative rounded-[1.75rem] bg-gradient-to-br from-white/60 to-violet-200/40 p-[5px] shadow-2xl shadow-violet-400/50 backdrop-blur-sm ring-1 ring-white/60">
              <div className="overflow-hidden rounded-[1.4rem]">
                <div className="relative" style={{ paddingBottom: '56.25%' }}>
                  <iframe
                  className="absolute inset-0 h-full w-full"
                  src="https://www.youtube.com/embed/Sgxbx65IDeM?autoplay=1&mute=1&loop=1&playlist=Sgxbx65IDeM&controls=1&rel=0&modestbranding=1"
                  title={t('land.videoTitle')}
                  frameBorder="0"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  />
                </div>
              </div>
              </div>
              <div aria-hidden className="pointer-events-none absolute -bottom-6 left-1/2 h-6 w-3/4 -translate-x-1/2 rounded-full bg-violet-400/30 blur-xl" />
            </div>
          </div>
        </div>
      </section>

      {/* ============================================ AI WRITTEN SIMULATOR */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <Reveal>
          <div className="grid items-center gap-8 rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-6 sm:p-10 lg:grid-cols-[1fr_320px]">
            <div>
              {/* <span className="pill bg-primary text-white"><Sparkle size={13} weight="fill" /> {t('land.new')}</span> */}
              <h2 className="mt-4 font-heading text-2xl font-extrabold text-gray-900">{t('land.simTitle')}</h2>
              <p className="mt-2 max-w-md text-sm text-gray-600">
                {t('land.simSub')}
              </p>
              <div className="mt-5 rounded-2xl bg-white p-4 shadow-md shadow-violet-100">
                <input
                  className="input !rounded-xl text-sm" placeholder={t('land.topicPlaceholder')}
                  value={simTopic} maxLength={1000} onChange={(e) => setSimTopic(e.target.value)}
                  data-testid="sim-topic-input"
                />
                <p className="mt-2 text-xs italic text-gray-400">{t('land.topicExample')}</p>

                <textarea
                  className="input !rounded-xl text-sm mt-4 resize-none"
                  placeholder={t('land.answerPlaceholder')}
                  rows={5}
                  value={simAnswer}
                  maxLength={3000}
                  onChange={(e) => setSimAnswer(e.target.value)}
                  data-testid="sim-answer-input"
                />
                <p className="mt-1 text-right text-xs text-gray-400">{simAnswer.length} / 3000</p>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="rounded-lg bg-gray-50 px-3 py-1 text-xs text-gray-400">{simTopic.length} / 1000</span>
                  <button onClick={startSimulator} data-testid="start-simulator-button"
                    className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !py-2.5 text-sm">
                    {t('land.simStart')} <ArrowRight size={16} weight="bold" />
                  </button>
                </div>
              </div>
            </div>
            {/* simulation preview */}
            <Reveal delay={150}>
              <div className="tilt-card rounded-3xl bg-white p-5 shadow-xl shadow-violet-200/60">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="font-heading font-bold text-gray-800">{t('land.simPreview')}</span> 30 – 40 min
                </div>
                <div className="mt-3 flex gap-4 text-[11px] font-semibold">
                  <span className="flex items-center gap-1.5 text-primary"><span className="h-2 w-2 rounded-full bg-primary" /> {t('land.writtenTest')}</span>
                  <span className="flex items-center gap-1.5 text-green-600">▲ {t('land.aiEvaluation')}</span>
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-gray-600">
                  Je veux <s className="text-rose-400 decoration-rose-300">écris</s>{' '}
                  <span className="rounded bg-emerald-50 px-1 font-semibold text-emerald-600">écrire</span> pour exprimer mon
                  raisonnement. Hier, il <s className="text-rose-400 decoration-rose-300">a allé</s>{' '}
                  <span className="rounded bg-emerald-50 px-1 font-semibold text-emerald-600">est allé</span> à la réunion et il a
                  parlé <s className="text-rose-400 decoration-rose-300">de le</s>{' '}
                  <span className="rounded bg-emerald-50 px-1 font-semibold text-emerald-600">du</span> projet avec ses collègues.
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600">
                  <CheckCircle size={13} weight="fill" /> {t('land.errorsFixed', { count: 3 })}
                </p>
                <p className="mt-4 text-center text-[10px] uppercase tracking-wider text-gray-400">{t('land.estimatedScore')}</p>
                <div className="mt-2 flex items-start justify-center gap-6">
                  <ScoreRing value={9} max={20} size={78} label="/20" caption={t('land.simScoreLabel')} />
                  <ScoreRing value={6} max={10} size={78} label="CLB" caption={t('land.simClbLabel')} to="#D946EF" />
                </div>
              </div>
            </Reveal>
           
          </div>
        </Reveal>
      </section>

      

      {/* ================================== PRECISION / PERSONALIZATION */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Reveal>
          <div className="grid gap-10 rounded-3xl bg-gradient-to-br from-fuchsia-50 via-violet-50 to-white p-6 shadow-soft sm:p-10 lg:grid-cols-2">
            <div className="relative">
              <h2 className="font-heading text-3xl font-extrabold leading-tight text-gray-900">{t('land.precisionA')}<br />{t('land.precisionB')}</h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-600">
                {t('land.engine')}
              </p>
              <ul className="mt-6 space-y-3.5">
                {/* 'Used by 15,000+ learners worldwide' was removed: it is an
                    unverifiable claim, like the invented testimonials. The map
                    variable was also named `t`, shadowing the translator. */}
                {['land.trust1', 'land.trust2', 'land.trust3', 'land.trust4'].map((key, i) => (
                  <Reveal key={key} delay={i * 80} as="li"
                    className="flex items-center gap-3 text-sm font-medium text-gray-700">
                    <CheckCircle size={20} weight="fill" className="shrink-0 text-primary" /> {t(key)}
                  </Reveal>
                ))}
              </ul>
            </div>

            {/* personalised plan card */}
            <Reveal delay={120}>
              <div className="rounded-3xl bg-white p-6 shadow-xl shadow-violet-200/50">
                <p className="text-sm font-semibold text-gray-700">{t('land.weakness')}</p>
                <div className="mt-6 flex items-center justify-between px-2">
                  {[['B1', t('land.levelCurrent'), 'bg-cyan-100 text-cyan-700'], ['B2', t('land.levelInProgress'), 'bg-primary text-white shadow-lg shadow-violet-300'], ['C1', t('land.levelTarget'), 'bg-gray-200 text-gray-600']].map(([lv, lab, cls], i) => (
                    <div key={lv} className="relative flex flex-1 flex-col items-center">
                      {i > 0 && <span className="absolute -left-1/2 top-6 hidden h-0.5 w-full bg-gradient-to-r from-violet-200 to-primary sm:block" />}
                      <span className={`relative z-10 flex h-13 w-13 items-center justify-center rounded-full font-heading text-base font-bold ${cls}`} style={{ width: 52, height: 52 }}>{lv}</span>
                      <span className="mt-2 text-[11px] font-semibold text-gray-500">{lab}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
                    <span><span className="block text-[10px] font-normal uppercase tracking-wide text-gray-400">{t('land.nextMilestone')}</span>{t('land.milestoneText')}</span>
                    <span className="font-heading text-sm text-gray-800">72%</span>
                  </div>
                  <MilestoneBar value={72} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('land.studyStreak')}</p>
                    <p className="mt-1 flex items-center gap-1.5 font-heading text-xl font-bold text-gray-900"><Fire size={20} weight="fill" className="text-orange-500" /> {t('land.streakDays', { n: 12 })}</p>
                    <p className="text-[11px] text-gray-500">{t('land.doingGreat')}</p>
                  </div>
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('land.avgImprovement')}</p>
                    <p className="mt-1 flex items-center gap-1.5 font-heading text-xl font-bold text-gray-900"><ChartLineUp size={20} weight="bold" className="text-primary" /> {t('land.avgImprovementValue')}</p>
                    <p className="text-[11px] text-gray-500">{t('land.keepPushing')}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Reveal>
      </section>

      {/* ============================================= DARK APP SHOWCASE */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="rounded-[2rem] bg-ink px-5 py-12 sm:px-10 sm:py-16" style={{ background: 'radial-gradient(1100px 500px at 50% -10%, #2a1352 0%, #120822 55%)' }}>
          <Reveal>
            <h2 className="text-center font-heading text-3xl font-extrabold text-white sm:text-4xl">
              {t('land.practiceA')} <span className="bg-gradient-to-r from-fuchsia-400 to-violet-300 bg-clip-text text-transparent">{t('land.practiceB')}</span>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Speaking */}
            <DarkCard delay={0} icon={<Microphone size={16} weight="fill" />} title={t('land.cardSpeakTitle')}
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">{t('land.speakBlurb')}</p>
                <div className="mt-5 flex h-14 items-end justify-center gap-[3px]">
                  {[0.4, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.8, 0.5, 0.9, 0.65].map((h, i) => (
                    <span key={i} className="eq-bar w-1.5 rounded-full bg-gradient-to-t from-primary to-fuchsia-400"
                      style={{ height: `${h * 100}%`, animationDelay: `${i * 0.09}s` }} />
                  ))}
                  <span className="ml-3 flex h-10 w-10 items-center justify-center self-center rounded-full border-2 border-violet-400/40 font-heading text-[11px] font-bold text-white">70%</span>
                </div>
              </>}
              cta={t('land.cardSpeakCta')} to="/speaking" testid="dark-speaking" />
            {/* Writing */}
            <DarkCard delay={90} icon={<PenNib size={16} weight="fill" />} title={t('land.cardWriteTitle')}
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">{t('land.writeBlurb')}</p>
                <div className="mt-4 rounded-xl bg-white p-3 text-[11px] leading-relaxed text-gray-700">
                  Je veux <span className="rounded bg-red-100 px-1 line-through">écris</span>{' '}
                  <span className="rounded bg-green-100 px-1 font-semibold">écrire</span> pour exprimer mon raisonnement sur la
                  situation actuelle. <span className="rounded bg-red-100 px-1 line-through">Malgré que</span>{' '}
                  <span className="rounded bg-green-100 px-1 font-semibold">Bien que</span> le sujet soit difficile, j’ai{' '}
                  <span className="rounded bg-red-100 px-1 line-through">beaucoup des</span>{' '}
                  <span className="rounded bg-green-100 px-1 font-semibold">beaucoup d’</span>idées.
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {[['land.metricGrammar', '92%'], ['land.metricVocab', '85%'], ['land.metricCoherence', '90%']].map(([k, v]) => (
                    <span key={k} className="rounded-md border border-violet-400/30 px-2 py-1 text-violet-200">{t(k)} <span className="text-green-400">{v}</span></span>
                  ))}
                </div>
              </>}
              cta={t('land.cardWriteCta')} to="/check-writing" testid="dark-writing" />
            {/* Mock exams */}
            <DarkCard delay={180} icon={<GraduationCap size={16} weight="fill" />} title={t('land.cardMockTitle')}
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">{t('land.simBlurb')}</p>
                <div className="mt-4 space-y-2">
                  {/* the map variable used to be named `t`, which shadowed the translator */}
                  {[['TCF Canada', '1h 45m · 203 pts'], ['TCF FR', '1h 30m · 200 pts'], ['TCF Québec', '1h 45m · 200 pts']].map(([exam, m]) => (
                    <div key={exam} className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
                      <Play size={12} weight="fill" className="shrink-0 text-fuchsia-400" />
                      <div className="leading-tight"><p className="text-[11px] font-semibold text-white">{t('land.fullTest', { exam })}</p><p className="text-[9px] text-violet-300/60">{m}</p></div>
                    </div>
                  ))}
                </div>
              </>}
              cta={t('land.cardMockCta')} to="/exam/reading-comprehension" testid="dark-mock" />
            {/* Roadmap */}
            <DarkCard delay={270} icon={<ChartLineUp size={16} weight="bold" />} title={t('land.cardPlanTitle')}
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">{t('land.planBlurb')}</p>
                <div className="mt-5 flex items-center justify-between px-1">
                  {[['B1', t('land.stepCurrent'), 'border-violet-400/40 text-violet-200'], ['B2', t('land.stepInProgress'), 'border-fuchsia-400 bg-fuchsia-500/20 text-white'], ['C1', t('land.stepTarget'), 'border-white/20 text-violet-300/70']].map(([lv, lab, cls], i) => (
                    <div key={lv} className="flex flex-1 flex-col items-center">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 font-heading text-xs font-bold ${cls}`}>{lv}</span>
                      <span className="mt-1.5 text-[9px] uppercase tracking-wide text-violet-300/60">{lab}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-[10px] uppercase tracking-wide text-violet-300/50">{t('land.weeklyGoals')}</p>
                <p className="text-[11px] font-semibold text-white">{t('land.weeklyGoalText')}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10"><div className="h-1.5 w-2/3 rounded-full bg-gradient-to-r from-primary to-fuchsia-400" /></div>
              </>}
              cta={t('land.cardPlanCta')} to="/dashboard" testid="dark-roadmap" />
          </div>
        </div>
      </section>

      {/* ================================================= HOW IT WORKS ===
          This slot held four invented "graduates" with names, cities, NCLC
          scores and five-star ratings. Presenting fabricated reviews as real
          customers is misleading advertising, so it is replaced with what the
          product verifiably does. Add real quotes here once you have consent
          to publish them. */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Reveal>
          <h2 className="text-center font-heading text-3xl font-extrabold text-gray-900">
            {t('land.howA')} <span className="text-primary">{t('land.howB')}</span>
          </h2>
          <p className="mt-2 text-center text-sm text-gray-500">
            {t('land.howSub')}
          </p>
        </Reveal>
        <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((s, i) => (
            <Reveal key={s.title} delay={i * 90}>
              <div className="tilt-card flex h-full flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-600 font-heading text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t(s.title)}</h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-gray-600">{t(s.body)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* =========================================================== OFFERS */}
      <section className="bg-gradient-to-b from-white via-violet-50/60 to-fuchsia-50/60 px-4 py-16 sm:px-6">
        <Reveal>
          <h2 className="text-center font-heading text-3xl font-extrabold text-gray-900">{t('land.offers')}</h2>
          <p className="mt-2 text-center text-xs uppercase tracking-wider text-gray-400">{t('land.offersSub')}</p>
        </Reveal>
        <div className="mx-auto mt-10 grid max-w-5xl items-stretch gap-6 md:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.id} delay={i * 100} className={p.popular ? 'md:-my-4 z-10' : ''}>
              <div className={`tilt-card relative flex h-full flex-col overflow-hidden rounded-3xl bg-white text-center ${p.popular ? 'shadow-2xl shadow-violet-300/60 ring-2 ring-primary md:scale-[1.04]' : 'border border-violet-100 shadow-soft'}`}>
                {p.popular && (
                  <span className="absolute left-1/2 top-3 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-300 px-3 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-900 shadow">★ {t('pricing.mostPopular')}</span>
                )}
                <div className={`px-6 pb-5 pt-8 font-heading text-2xl font-bold ${p.popular ? 'bg-gradient-to-br from-primary to-fuchsia-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{p.name}</div>
                <div className="flex flex-1 flex-col px-7 py-7">
                  {/* The price arrives already formatted for its currency, so it
                      is printed whole rather than split on a decimal point that
                      is not a decimal point in every locale. */}
                  <p className="font-heading text-4xl font-extrabold text-gray-900">{p.price}</p>
                  {/* Only set when the introductory rate really applies, so no
                      card strikes through the price printed beside it. */}
                  {p.wasPrice && (
                    <p className="mt-1 text-sm font-semibold text-gray-400">
                      <span className="line-through">{p.wasPrice}</span>
                      <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">{t('pricing.firstTime')}</span>
                    </p>
                  )}
                  <p className="mt-1 text-xs font-semibold text-gray-400">/ {p.durationKey ? t(p.durationKey) : p.name}</p>
                  <ul className="mt-6 flex-1 space-y-3 text-left text-[13px] font-semibold text-gray-700">
                    <li className="flex items-center gap-2.5"><CheckCircle size={17} weight="fill" className="shrink-0 text-primary" /> {t('pricing.bonus', { n: p.bonus })}</li>
                    {planFeatures.map((f) => (
                      <li key={f} className="flex items-center gap-2.5"><CheckCircle size={17} weight="fill" className="shrink-0 text-primary" /> {t(f)}</li>
                    ))}
                  </ul>
                  {/* Still the trial CTA, not a checkout: the landing page sells
                      the offer, /pricing takes the money. */}
                  <Link to={trialTo} data-testid={`plan-${p.id}`}
                    className={`mt-7 ${p.popular ? 'btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 w-full justify-center' : 'btn-outline w-full justify-center'}`}>
                    {t('land.getStarted')}
                  </Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-sm font-semibold text-gray-500">
          {t('land.orPrefix')} <Link to="/register" className="text-primary underline-offset-2 hover:underline">{t('land.orFree')}</Link> {t('land.noCardSuffix')}
        </p>

        {/* NCLC table */}
        <Reveal className="mx-auto mt-16 max-w-4xl">
          <div className="overflow-hidden rounded-3xl shadow-2xl shadow-violet-300/40">
            <div className="bg-gradient-to-br from-primary via-purple-600 to-fuchsia-600 px-6 py-8 text-center">
              <h3 className="font-heading text-2xl font-extrabold text-white sm:text-3xl">{t('land.nclcTable')}</h3>
              <p className="mt-1.5 text-xs text-violet-100/80">{t('land.nclcSub')}</p>
            </div>
            <div className="overflow-x-auto bg-white" tabIndex={0} role="region"
              aria-label={t('land.nclcTable')}>
              <table className="w-full min-w-[560px] text-center text-sm">
                <thead>
                  <tr className="bg-violet-50/70 text-xs font-bold text-gray-700">
                    {['land.nclcColNclc', 'land.nclcColCompW', 'land.nclcColExpW', 'land.nclcColCompO', 'land.nclcColExpO'].map((h) => <th key={h} className="px-4 py-4">{t(h)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {nclc.map((row, i) => (
                    <tr key={row[0]} className={`text-gray-600 ${i % 2 ? 'bg-white' : 'bg-violet-50/40'}`}>
                      <td className="px-4 py-3"><span className="inline-block min-w-[44px] rounded-lg border border-primary/40 bg-violet-100 px-2 py-1 font-heading font-bold text-primary">{row[0]}</span></td>
                      {row.slice(1).map((c, k) => <td key={k} className="px-4 py-3">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      </section>

      {/* =============================================================== FAQ */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <Reveal><h2 className="font-heading text-3xl font-extrabold text-gray-900">{t('land.faq')}</h2></Reveal>
        <div className="mt-7 space-y-3.5">
          {FAQ_NUMBERS.map((n, i) => (
            <Reveal key={n} delay={i * 70}><Faq q={t(`land.faq${n}q`)} a={t(`land.faq${n}a`)} /></Reveal>
          ))}
        </div>
      </section>

      {/* ======================================================= CTA BANNER */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary via-purple-600 to-fuchsia-600 px-6 py-12 sm:px-12">
            <RocketLaunch size={90} weight="duotone" className="absolute -left-3 top-1/2 hidden -translate-y-1/2 rotate-12 text-white/25 sm:block" />
            <PaperPlaneTilt size={80} weight="duotone" className="absolute -bottom-3 right-4 hidden -rotate-12 text-white/25 sm:block" />
            <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6 text-center lg:flex-row lg:text-left">
              <div className="flex-1">
                <h2 className="font-heading text-2xl font-extrabold text-white sm:text-3xl">{t('land.ctaTitle')}</h2>
                <p className="mt-2 max-w-md text-sm text-violet-100/90">{t('land.ctaBody')}</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-wrap justify-center gap-3">
                  <Link to={trialTo} className="rounded-xl bg-white px-6 py-3 font-heading text-sm font-bold text-primary shadow-lg transition hover:scale-105" data-testid="cta-trial">
                    {t('land.ctaTrial')}
                  </Link>
                  <Link to="/pricing" className="rounded-xl border-2 border-white/70 px-6 py-3 font-heading text-sm font-bold text-white transition hover:bg-white/10" data-testid="cta-demo">
                    {t('land.ctaPacks')}
                  </Link>
                </div>
                <p className="text-[11px] text-violet-100/70">{t('land.noCard')}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

    </main>
  );
}

/* --------------------------------------------------------- sub-components */
function MilestoneBar({ value }) {
  const [ref, inView] = useInView(0.6);
  return (
    <div ref={ref} className="mt-2.5 h-2.5 rounded-full bg-violet-100">
      <div className="grow-bar h-2.5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: inView ? `${value}%` : '0%' }} />
    </div>
  );
}

function DarkCard({ icon, title, body, cta, to, delay, testid }) {
  return (
    <Reveal delay={delay}>
      <div className="tilt-card flex h-full flex-col rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
        <p className="flex items-center gap-2 font-heading text-sm font-bold text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-fuchsia-600 text-white">{icon}</span>
          {title}
        </p>
        <div className="mt-4 flex-1">{body}</div>
        <Link to={to} data-testid={testid}
          className="mt-5 block rounded-xl bg-gradient-to-r from-primary to-fuchsia-600 py-2.5 text-center font-heading text-xs font-bold text-white transition hover:brightness-110">
          {cta}
        </Link>
      </div>
    </Reveal>
  );
}