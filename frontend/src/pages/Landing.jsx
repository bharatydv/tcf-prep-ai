import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Microphone, PenNib, GraduationCap, FolderOpen, ShieldCheck, CheckCircle,
  Sparkle, Fire, ChartLineUp, CaretDown, Star, RocketLaunch, PaperPlaneTilt,
  ArrowRight, Lightning, SealCheck, Play,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

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

function Reveal({ children, delay = 0, className = '' }) {
  const [ref, inView] = useInView();
  return (
    <div ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ score ring ---- */
function ScoreRing({ value = 82, size = 92, label = '/100' }) {
  const [ref, inView] = useInView(0.6);
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div ref={ref} className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDE9FE" strokeWidth="9" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth="9"
          strokeLinecap="round" strokeDasharray={c} className="ring-fg"
          strokeDashoffset={inView ? c * (1 - value / 100) : c}
        />
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#22C55E" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center leading-none">
        <span className="font-heading text-2xl font-bold text-gray-900">{value}</span>
        <span className="block text-[10px] text-gray-400">{label}</span>
      </div>
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
export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [simTopic, setSimTopic] = useState('');
  const [email, setEmail] = useState('');
  const trialTo = user ? '/dashboard' : '/register';

  const startSimulator = () => {
    if (!user) { toast.info('Create your free account to run the simulator — 5 free attempts included.'); return navigate('/register'); }
    navigate('/check-writing', { state: { label: simTopic.trim() || null } });
  };

  const features = [
    { icon: Microphone, title: 'AI Speaking Lab', desc: 'Real-time pronunciation & fluency feedback.', to: '/speaking' },
    { icon: PenNib, title: 'Writing Assistant', desc: 'Advanced grammar, coherence & structure check.', to: '/practice' },
    { icon: GraduationCap, title: 'Mock Exams', desc: 'Full-length TCF tests with AI evaluation.', to: '/exam/reading-comprehension' },
    { icon: FolderOpen, title: 'Resources', desc: 'Real recent topics with model answers for your level.', to: '/recent-topics' },
  ];

  const plans = [
    { name: 'Bronze', price: '14.99', period: '/ 5 Days', popular: false },
    { name: 'Silver', price: '29.99', period: '/ 1 Month', popular: true },
    { name: 'Gold', price: '49.99', period: '/ 2 Months', popular: false },
  ];

  const nclc = [
    ['10+', '549 - 699', '16 - 20', '549 - 699', '16 - 20'],
    ['9', '524 - 548', '14 - 15', '524 - 548', '14 - 15'],
    ['8', '499 - 523', '12 - 13', '503 - 522', '12 - 13'],
    ['7', '453 - 498', '10 - 11', '458 - 502', '10 - 11'],
    ['6', '406 - 452', '7 - 9', '398 - 457', '7 - 9'],
    ['5', '375 - 405', '6 - 6', '369 - 397', '6 - 6'],
    ['4', '342 - 374', '4 - 5', '331 - 368', '4 - 5'],
  ];

  const stories = [
    { name: 'Sandrine L.', score: 'NCLC 9 · Montréal', quote: 'The mistake tracker is brutal in the best way — it kept showing me my own preposition errors until they were gone. Jumped from B1 to C1 in four months.' },
    { name: 'Karim B.', score: 'NCLC 8 · Toronto', quote: 'The exam simulator feels exactly like the real thing: same 60-minute pressure, same three tasks. On exam day nothing surprised me.' },
    { name: 'Priya N.', score: 'NCLC 10 · Vancouver', quote: 'I pasted my old essays into Check My Writing and finally understood why my accord en genre kept failing. The flashcard reviews fixed it for good.' },
    { name: 'Diego M.', score: 'NCLC 8 · Calgary', quote: 'Five free corrections were enough to convince me. The C1 improvement suggestions alone are worth the Silver pack.' },
  ];

  return (
    <div className="overflow-x-clip bg-white">
      {/* ============================================================ HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        {/* floating blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="blob absolute -left-24 top-10 h-72 w-72 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="blob absolute right-0 top-1/3 h-80 w-80 rounded-full bg-violet-400/25 blur-3xl" style={{ animationDelay: '-5s' }} />
          <div className="blob absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-purple-300/30 blur-3xl" style={{ animationDelay: '-9s' }} />
        </div>

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pb-24 lg:pt-20">
          {/* left copy */}
          <div>
            <span className="hero-rise inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm backdrop-blur">
              <SealCheck size={15} weight="fill" /> Official TCF curriculum aligned
            </span>
            <h1 className="hero-rise mt-5 font-heading text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl" style={{ animationDelay: '0.1s' }}>
              Smart AI Practice.<br />
              Real Exam{' '}
              <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">Results.</span>
            </h1>
            <p className="hero-rise mt-5 max-w-md text-[15px] leading-relaxed text-gray-600" style={{ animationDelay: '0.2s' }}>
              Accelerate your French certification journey with the only AI platform engineered
              for TCF precision. Get real-time feedback on speaking and writing.
            </p>
            <div className="hero-rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: '0.3s' }}>
              <Link to={trialTo} data-testid="hero-trial-button"
                className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-6 !py-3 shadow-lg shadow-violet-300/60 hover:!brightness-110">
                Start 5-Day Free Trial
              </Link>
              <Link to="/pricing" className="btn-outline !border-gray-300 bg-white !px-6 !py-3" data-testid="hero-plans-button">
                Explore Study Plans
              </Link>
            </div>
            <div className="hero-rise mt-9 flex flex-wrap items-center gap-7" style={{ animationDelay: '0.4s' }}>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2.5">
                  {['SL', 'KB', 'PN'].map((ini, i) => (
                    <span key={ini} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
                      style={{ background: ['#7C3AED', '#C026D3', '#5B21B6'][i] }}>{ini}</span>
                  ))}
                </div>
                <div className="leading-tight">
                  <p className="font-heading text-sm font-bold text-gray-900">15,000+</p>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">Active learners</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-200/70 text-primary">
                  <ShieldCheck size={18} weight="fill" />
                </span>
                <p className="text-xs font-semibold leading-tight text-gray-700">Secure &<br /><span className="text-gray-400">Ad-Free</span></p>
              </div>
            </div>
          </div>

          {/* right: live correction preview card */}
          <div className="hero-rise" style={{ animationDelay: '0.25s' }}>
            <div className="tilt-card relative mx-auto max-w-md rounded-3xl border border-white/70 bg-white/90 p-6 shadow-2xl shadow-violet-300/40 backdrop-blur">
              <div className="flex items-center justify-between">
                <p className="font-heading text-sm font-bold text-gray-800">Live AI Correction</p>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="ping-soft absolute inline-flex h-full w-full rounded-full bg-green-400" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
              </div>
              <p className="mt-4 rounded-2xl bg-violet-50/80 p-4 text-sm leading-7 text-gray-700">
                Hier, je suis{' '}
                <span className="rounded px-1 font-medium" style={{ background: '#FED7AA' }}>aller</span>{' '}
                au marché avec{' '}
                <span className="rounded px-1 font-medium" style={{ background: '#BFDBFE' }}>ma</span>{' '}
                ami pour acheter des légumes{' '}
                <span className="rounded px-1 font-medium" style={{ background: '#FEF08A' }}>frais</span>.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
                <span className="pill bg-orange-100 text-orange-700">Conjugaison · allé</span>
                <span className="pill bg-violet-100 text-primary">Accord · mon amie</span>
              </div>
              <div className="mt-5 flex items-center justify-between rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50 p-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400">Estimated level</p>
                  <p className="font-heading text-3xl font-extrabold text-gray-900">B2 <ArrowRight size={18} className="inline text-green-500" /> <span className="text-primary">C1</span></p>
                </div>
                <ScoreRing value={82} />
              </div>
            </div>
          </div>
        </div>

        {/* feature strip */}
        <div className="relative mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <Reveal>
            <div className="grid divide-y divide-gray-100 rounded-3xl bg-white shadow-xl shadow-violet-200/50 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
              {features.map((f, i) => (
                <Link key={f.title} to={f.to} data-testid={`feature-${i}`}
                  className="group flex items-start gap-4 p-6 transition hover:bg-violet-50/60">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-primary transition group-hover:scale-110 group-hover:bg-primary group-hover:text-white">
                    <f.icon size={22} weight="duotone" />
                  </span>
                  <span>
                    <span className="block font-heading text-sm font-bold text-gray-900">{f.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-gray-500">{f.desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================================ AI WRITTEN SIMULATOR */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <Reveal>
          <div className="grid items-center gap-8 rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-6 sm:p-10 lg:grid-cols-[1fr_320px]">
            <div>
              <span className="pill bg-primary text-white"><Sparkle size={13} weight="fill" /> NEW</span>
              <h2 className="mt-4 font-heading text-2xl font-extrabold text-gray-900">AI Written Simulator ✍️</h2>
              <p className="mt-2 max-w-md text-sm text-gray-600">
                Paste any topic or question and experience a real AI written test simulation instantly.
              </p>
              <div className="mt-5 rounded-2xl bg-white p-4 shadow-md shadow-violet-100">
                <input
                  className="input !rounded-xl text-sm" placeholder="Paste your topic or question here…"
                  value={simTopic} maxLength={1000} onChange={(e) => setSimTopic(e.target.value)}
                  data-testid="sim-topic-input"
                />
                <p className="mt-2 text-xs italic text-gray-400">e.g. Impact of technology on modern education</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="rounded-lg bg-gray-50 px-3 py-1 text-xs text-gray-400">{simTopic.length} / 1000</span>
                  <button onClick={startSimulator} data-testid="start-simulator-button"
                    className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !py-2.5 text-sm">
                    Start Simulator <ArrowRight size={16} weight="bold" />
                  </button>
                </div>
              </div>
            </div>
            {/* simulation preview */}
            <Reveal delay={150}>
              <div className="tilt-card rounded-3xl bg-white p-5 shadow-xl shadow-violet-200/60">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="font-heading font-bold text-gray-800">Simulation Preview</span> 30 – 40 min
                </div>
                <div className="mt-3 flex gap-4 text-[11px] font-semibold">
                  <span className="flex items-center gap-1.5 text-primary"><span className="h-2 w-2 rounded-full bg-primary" /> Written Test</span>
                  <span className="flex items-center gap-1.5 text-green-600">▲ AI Evaluation</span>
                </div>
                <div className="mt-4 space-y-2.5">
                  {[100, 84, 92, 68].map((w, i) => (
                    <div key={i} className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-violet-200" style={{ width: `${w}%` }} /></div>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-center"><ScoreRing value={82} size={84} /></div>
                <p className="mt-1 text-center text-[10px] uppercase tracking-wider text-gray-400">Estimated score</p>
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
              <h2 className="font-heading text-3xl font-extrabold leading-tight text-gray-900">Precision. Personalization.<br />Progress.</h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-gray-600">
                Our AI engine is trained on official TCF criteria to give you accurate feedback and help you improve faster.
              </p>
              <ul className="mt-6 space-y-3.5">
                {['Built on official TCF evaluation criteria', 'AI-trained by language experts', 'Real-time feedback & score prediction',
                  'Used by 15,000+ learners worldwide', 'Secure, private & ad-free platform'].map((t, i) => (
                  <Reveal key={t} delay={i * 80}>
                    <li className="flex items-center gap-3 text-sm font-medium text-gray-700">
                      <CheckCircle size={20} weight="fill" className="shrink-0 text-primary" /> {t}
                    </li>
                  </Reveal>
                ))}
              </ul>
              <span aria-hidden className="pointer-events-none absolute -bottom-4 right-0 select-none text-[120px] leading-none text-fuchsia-200/70 sm:text-[150px]">🗼</span>
            </div>

            {/* personalised plan card */}
            <Reveal delay={120}>
              <div className="rounded-3xl bg-white p-6 shadow-xl shadow-violet-200/50">
                <p className="text-sm font-semibold text-gray-700">We analyze your weaknesses and create a plan just for you.</p>
                <div className="mt-6 flex items-center justify-between px-2">
                  {[['B1', 'Current Level', 'bg-cyan-100 text-cyan-700'], ['B2', 'In Progress', 'bg-primary text-white shadow-lg shadow-violet-300'], ['C1', 'Target Level', 'bg-gray-200 text-gray-600']].map(([lv, lab, cls], i) => (
                    <div key={lv} className="relative flex flex-1 flex-col items-center">
                      {i > 0 && <span className="absolute -left-1/2 top-6 hidden h-0.5 w-full bg-gradient-to-r from-violet-200 to-primary sm:block" />}
                      <span className={`relative z-10 flex h-13 w-13 items-center justify-center rounded-full font-heading text-base font-bold ${cls}`} style={{ width: 52, height: 52 }}>{lv}</span>
                      <span className="mt-2 text-[11px] font-semibold text-gray-500">{lab}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
                    <span><span className="block text-[10px] font-normal uppercase tracking-wide text-gray-400">Next milestone</span>Writing: Improve coherence</span>
                    <span className="font-heading text-sm text-gray-800">72%</span>
                  </div>
                  <MilestoneBar value={72} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Study streak</p>
                    <p className="mt-1 flex items-center gap-1.5 font-heading text-xl font-bold text-gray-900"><Fire size={20} weight="fill" className="text-orange-500" /> 12 Days</p>
                    <p className="text-[11px] text-gray-500">You're doing great!</p>
                  </div>
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Average improvement</p>
                    <p className="mt-1 flex items-center gap-1.5 font-heading text-xl font-bold text-gray-900"><ChartLineUp size={20} weight="bold" className="text-primary" /> +120 Pts</p>
                    <p className="text-[11px] text-gray-500">Keep pushing!</p>
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
              Practice. Get Feedback. <span className="bg-gradient-to-r from-fuchsia-400 to-violet-300 bg-clip-text text-transparent">Improve.</span>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Speaking */}
            <DarkCard delay={0} icon={<Microphone size={16} weight="fill" />} title="AI Speaking Lab"
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">Practice with AI that listens, analyzes and improves your pronunciation and fluency.</p>
                <div className="mt-5 flex h-14 items-end justify-center gap-[3px]">
                  {[0.4, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.8, 0.5, 0.9, 0.65].map((h, i) => (
                    <span key={i} className="eq-bar w-1.5 rounded-full bg-gradient-to-t from-primary to-fuchsia-400"
                      style={{ height: `${h * 100}%`, animationDelay: `${i * 0.09}s` }} />
                  ))}
                  <span className="ml-3 flex h-10 w-10 items-center justify-center self-center rounded-full border-2 border-violet-400/40 font-heading text-[11px] font-bold text-white">70%</span>
                </div>
              </>}
              cta="Start Speaking" to="/speaking" testid="dark-speaking" />
            {/* Writing */}
            <DarkCard delay={90} icon={<PenNib size={16} weight="fill" />} title="Writing Assistant"
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">Get detailed feedback on grammar, coherence, vocabulary and structure.</p>
                <div className="mt-4 rounded-xl bg-white p-3 text-[11px] leading-relaxed text-gray-700">
                  Je veux <span className="rounded bg-red-100 px-1 line-through">écris</span> <span className="rounded bg-green-100 px-1 font-semibold">écrire</span> pour exprimer mon raisonnement à la situation actuelle.
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {[['Grammar', '92%'], ['Vocabulary', '85%'], ['Coherence', '90%']].map(([k, v]) => (
                    <span key={k} className="rounded-md border border-violet-400/30 px-2 py-1 text-violet-200">{k} <span className="text-green-400">{v}</span></span>
                  ))}
                </div>
              </>}
              cta="Check My Writing" to="/check-writing" testid="dark-writing" />
            {/* Mock exams */}
            <DarkCard delay={180} icon={<GraduationCap size={16} weight="fill" />} title="Mock Exams"
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">Full-length TCF simulations with real exam conditions.</p>
                <div className="mt-4 space-y-2">
                  {[['TCF Canada – Full Test', '1h 45m · 203 pts'], ['TCF FR – Full Test', '1h 30m · 200 pts'], ['TCF Québec – Full Test', '1h 45m · 200 pts']].map(([t, m]) => (
                    <div key={t} className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
                      <Play size={12} weight="fill" className="shrink-0 text-fuchsia-400" />
                      <div className="leading-tight"><p className="text-[11px] font-semibold text-white">{t}</p><p className="text-[9px] text-violet-300/60">{m}</p></div>
                    </div>
                  ))}
                </div>
              </>}
              cta="Start Mock Exam" to="/exam/reading-comprehension" testid="dark-mock" />
            {/* Roadmap */}
            <DarkCard delay={270} icon={<ChartLineUp size={16} weight="bold" />} title="Study Roadmap"
              body={<>
                <p className="text-xs leading-relaxed text-violet-200/80">Personalized study plan to reach your target level.</p>
                <div className="mt-5 flex items-center justify-between px-1">
                  {[['B1', 'Current', 'border-violet-400/40 text-violet-200'], ['B2', 'In progress', 'border-fuchsia-400 bg-fuchsia-500/20 text-white'], ['C1', 'Target', 'border-white/20 text-violet-300/70']].map(([lv, lab, cls], i) => (
                    <div key={lv} className="flex flex-1 flex-col items-center">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 font-heading text-xs font-bold ${cls}`}>{lv}</span>
                      <span className="mt-1.5 text-[9px] uppercase tracking-wide text-violet-300/60">{lab}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-[10px] uppercase tracking-wide text-violet-300/50">Weekly goals</p>
                <p className="text-[11px] font-semibold text-white">Improve written coherence</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10"><div className="h-1.5 w-2/3 rounded-full bg-gradient-to-r from-primary to-fuchsia-400" /></div>
              </>}
              cta="View Roadmap" to="/dashboard" testid="dark-roadmap" />
          </div>
        </div>
      </section>

      {/* ===================================================== TESTIMONIALS */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Reveal>
          <h2 className="text-center font-heading text-3xl font-extrabold text-gray-900">Success Stories from Our <span className="text-primary">Graduates</span></h2>
          <p className="mt-2 text-center text-sm text-gray-500">Hear directly from students who achieved their dreams.</p>
        </Reveal>
        <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stories.map((s, i) => (
            <Reveal key={s.name} delay={i * 90}>
              <div className="tilt-card flex h-full flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 font-heading text-sm font-bold text-white">
                    {s.name.split(' ').map((w) => w[0]).join('')}
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-bold text-gray-900">{s.name}</p>
                    <p className="text-[11px] text-gray-400">{s.score}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-0.5 text-amber-400">
                  {Array.from({ length: 5 }).map((_, k) => <Star key={k} size={15} weight="fill" />)}
                </div>
                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-gray-600">“{s.quote}”</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* =========================================================== OFFERS */}
      <section className="bg-gradient-to-b from-white via-violet-50/60 to-fuchsia-50/60 px-4 py-16 sm:px-6">
        <Reveal>
          <h2 className="text-center font-heading text-3xl font-extrabold text-gray-900">Our Offers</h2>
          <p className="mt-2 text-center text-xs uppercase tracking-wider text-gray-400">Simple plans. Powerful preparation.</p>
        </Reveal>
        <div className="mx-auto mt-10 grid max-w-5xl items-stretch gap-6 md:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.name} delay={i * 100} className={p.popular ? 'md:-my-4 z-10' : ''}>
              <div className={`tilt-card relative flex h-full flex-col overflow-hidden rounded-3xl bg-white text-center ${p.popular ? 'shadow-2xl shadow-violet-300/60 ring-2 ring-primary md:scale-[1.04]' : 'border border-violet-100 shadow-soft'}`}>
                {p.popular && (
                  <span className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-amber-300 px-3 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-900 shadow">★ Most popular</span>
                )}
                <div className={`px-6 pb-5 pt-8 font-heading text-2xl font-bold ${p.popular ? 'bg-gradient-to-br from-primary to-fuchsia-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{p.name}</div>
                <div className="flex flex-1 flex-col px-7 py-7">
                  <p className="font-heading text-4xl font-extrabold text-gray-900">${p.price.split('.')[0]}<span className="text-xl">.{p.price.split('.')[1]}</span></p>
                  <p className="mt-1 text-xs font-semibold text-gray-400">{p.period}</p>
                  <ul className="mt-6 flex-1 space-y-3 text-left text-[13px] font-semibold text-gray-700">
                    {['40 Reading Tests', '40 Listening Tests', 'Writing + AI Feedback', 'Oral & written exam topics'].map((f) => (
                      <li key={f} className="flex items-center gap-2.5"><CheckCircle size={17} weight="fill" className="shrink-0 text-primary" /> {f}</li>
                    ))}
                  </ul>
                  <Link to={trialTo} data-testid={`plan-${p.name.toLowerCase()}`}
                    className={`mt-7 ${p.popular ? 'btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 w-full justify-center' : 'btn-outline w-full justify-center'}`}>
                    Get Started
                  </Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-sm font-semibold text-gray-500">
          Or <Link to="/register" className="text-primary underline-offset-2 hover:underline">start with 5 free attempts</Link> — no credit card required.
        </p>

        {/* NCLC table */}
        <Reveal className="mx-auto mt-16 max-w-4xl">
          <div className="overflow-hidden rounded-3xl shadow-2xl shadow-violet-300/40">
            <div className="bg-gradient-to-br from-primary via-purple-600 to-fuchsia-600 px-6 py-8 text-center">
              <h3 className="font-heading text-2xl font-extrabold text-white sm:text-3xl">Official NCLC Equivalency Table</h3>
              <p className="mt-1.5 text-xs text-violet-100/80">Reference for converting TCF Canada scores to NCLC levels</p>
            </div>
            <div className="overflow-x-auto bg-white">
              <table className="w-full min-w-[560px] text-center text-sm">
                <thead>
                  <tr className="bg-violet-50/70 text-xs font-bold text-gray-700">
                    {['NCLC', 'Comp. Written', 'Exp. Written', 'Comp. Oral', 'Exp. Oral'].map((h) => <th key={h} className="px-4 py-4">{h}</th>)}
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
        <Reveal><h2 className="font-heading text-3xl font-extrabold text-gray-900">Frequently Asked Questions</h2></Reveal>
        <div className="mt-7 space-y-3.5">
          {[
            ['What is the TCF exam and who is it for?', 'The Test de Connaissance du Français is the official French proficiency exam used for Canadian immigration (TCF Canada), French nationality, and university admission. It measures listening, reading, speaking and writing, mapped to CEFR levels A1–C2 and NCLC levels for Canada.'],
            ['How does the AI provide feedback on my writing?', 'Every text runs through an examiner-grade AI pipeline that scores against official CEFR criteria, highlights all six error categories (prepositions, spelling, conjugation, gender/number agreement, anglicisms, C1 improvements), and explains each correction. Mistakes are saved to your personal history for spaced-repetition review.'],
            ['Is the exam simulator identical to the official one?', 'The Exam Simulator reproduces the official written test conditions: the 3 tâches, a strict shared 60-minute timer, auto-submit at zero, no spellcheck, and paste disabled — so the real exam holds no surprises.'],
            ['Can I cancel my free trial at any time?', 'Yes. Your 5 free AI corrections per month require no credit card at all, and paid packs are one-time purchases for a fixed duration — there is no recurring subscription to cancel.'],
          ].map(([q, a], i) => (
            <Reveal key={q} delay={i * 70}><Faq q={q} a={a} /></Reveal>
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
                <h2 className="font-heading text-2xl font-extrabold text-white sm:text-3xl">Ready to Get Your Certification?</h2>
                <p className="mt-2 max-w-md text-sm text-violet-100/90">Join thousands of professionals and students who used TCF Prep AI to reach their target French level.</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-wrap justify-center gap-3">
                  <Link to={trialTo} className="rounded-xl bg-white px-6 py-3 font-heading text-sm font-bold text-primary shadow-lg transition hover:scale-105" data-testid="cta-trial">
                    Start Free Trial
                  </Link>
                  <Link to="/pricing" className="rounded-xl border-2 border-white/70 px-6 py-3 font-heading text-sm font-bold text-white transition hover:bg-white/10" data-testid="cta-demo">
                    See Study Packs
                  </Link>
                </div>
                <p className="text-[11px] text-violet-100/70">No credit card required · Cancel anytime</p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============================================================ FOOTER */}
      <footer className="bg-ink text-violet-200/70" style={{ background: '#120822' }}>
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <p className="font-heading text-2xl font-extrabold text-white">TCF Prep AI</p>
            <p className="mt-3 text-sm font-semibold text-violet-100">Prepare smarter. Achieve TCF success.</p>
            <p className="mt-3 max-w-xs text-xs leading-relaxed">
              Practice speaking, writing, listening and reading with AI-powered feedback, realistic
              mock exams, and personalized study plans designed for TCF Canada aspirants.
            </p>
          </div>
          <div>
            <p className="font-heading text-sm font-bold text-white">Product</p>
            <ul className="mt-4 space-y-2.5 text-xs">
              <li><Link to="/practice" className="transition hover:text-white">Writing Assistant</Link></li>
              <li><Link to="/exam-simulator" className="transition hover:text-white">Exam Simulator</Link></li>
              <li><Link to="/exam/reading-comprehension" className="transition hover:text-white">Mock Exams</Link></li>
              <li><Link to="/speaking" className="transition hover:text-white">Speaking Lab</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-heading text-sm font-bold text-white">Resources</p>
            <ul className="mt-4 space-y-2.5 text-xs">
              <li><Link to="/recent-topics" className="transition hover:text-white">Recent Exam Topics</Link></li>
              <li><Link to="/review" className="transition hover:text-white">Mistake Review</Link></li>
              <li><Link to="/pricing" className="transition hover:text-white">Study Packs</Link></li>
              <li><Link to="/dashboard" className="transition hover:text-white">My Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-heading text-sm font-bold text-white">Newsletter</p>
            <p className="mt-4 text-xs">Get the latest French learning tips delivered to your inbox.</p>
            <form className="mt-3 flex overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/15"
              onSubmit={(e) => { e.preventDefault(); if (!email.trim()) return; toast.success('Merci ! You are on the list.'); setEmail(''); }}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Your email"
                className="w-full bg-transparent px-3.5 py-2.5 text-xs text-white placeholder-violet-300/50 outline-none" data-testid="newsletter-input" />
              <button className="bg-gradient-to-r from-primary to-fuchsia-600 px-4 text-white transition hover:brightness-110" aria-label="Subscribe" data-testid="newsletter-button">
                <PaperPlaneTilt size={15} weight="fill" />
              </button>
            </form>
            <div className="mt-5 flex gap-2.5">
              {['f', '𝕏', 'in', '◎'].map((s) => (
                <span key={s} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white transition hover:bg-primary">{s}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-[11px] text-violet-300/50">
          © {new Date().getFullYear()} TCF Prep AI. All rights reserved.
        </div>
      </footer>
    </div>
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
