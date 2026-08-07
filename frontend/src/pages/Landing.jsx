import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Microphone, PenNib, GraduationCap, CheckCircle,
  Fire, ChartLineUp, CaretDown, Star, RocketLaunch, PaperPlaneTilt,
  ArrowRight, Play,
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
  const [simAnswer, setSimAnswer] = useState('');
  const [email, setEmail] = useState('');
  const trialTo = user ? '/dashboard' : '/register';

  const startSimulator = () => {
    if (!user) { toast.info('Create your free account to run the simulator — 5 free attempts included.'); return navigate('/register'); }
    // Land on the writing task overview with the own-question panel already
    // filled in, rather than the separate check-writing page.
    navigate('/practice/tasks', {
      state: { ownQuestion: simTopic.trim(), text: simAnswer.trim() },
    });
  };

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
              Write. Evaluate.<br />
              Score CLB 7{' '}
              <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">Results.</span>
            </h1>
            <p className="hero-rise mt-5 max-w-md text-[15px] leading-relaxed text-gray-600" style={{ animationDelay: '0.2s' }}>
              All-in-One TEF/TCF practice platform designed to record your persistent errors, provide correction, and help you achieve CLB 7.
            </p>
            <div className="hero-rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: '0.3s' }}>
              <Link to={trialTo} data-testid="hero-trial-button"
                className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-6 !py-3 shadow-lg shadow-violet-300/60 hover:!brightness-110">
                Start 5-Day Free Trial
              </Link>
              {/* <Link to="/pricing" className="btn-outline !border-gray-300 bg-white !px-6 !py-3" data-testid="hero-plans-button">
                Explore Study Plans
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
                  <p className="font-heading text-sm font-bold text-gray-900">15,000+</p>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">Active learners</p>
                </div>
              </div>
              {/* <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-200/70 text-primary">
                  <ShieldCheck size={18} weight="fill" />
                </span>
                <p className="text-xs font-semibold leading-tight text-gray-700">Secure &<br /><span className="text-gray-400">Ad-Free</span></p>
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
                  title="TCF Prep AI — See it in action"
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
              {/* <span className="pill bg-primary text-white"><Sparkle size={13} weight="fill" /> NEW</span> */}
              <h2 className="mt-4 font-heading text-2xl font-extrabold text-gray-900">Evaluate Your Writing in Under 10-Seconds</h2>
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

                <textarea
                  className="input !rounded-xl text-sm mt-4 resize-none"
                  placeholder="Write your answer here… (optional — leave blank to start fresh on the next page)"
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0.30 -75.90 544.20 100.15"
              className="h-9 w-auto" role="img" aria-label="monfrançais" preserveAspectRatio="xMinYMid meet">
              <path fill="#ae8bff" d="M15.400 0L4.500 0L4.500-24.600L4.300-51.900L14.100-51.900L13-28.200L13.900-28.200Q14.900-41.400 19.100-47.350Q23.300-53.300 30.900-53.300L30.900-53.300Q38.700-53.300 42-47.150Q45.300-41 44.700-28.200L44.700-28.200L45.600-28.200Q46.500-41.300 50.800-47.300Q55.100-53.300 63.100-53.300L63.100-53.300Q79.200-53.300 79.200-29L79.200-29L79.200 0L68.200 0L68.200-27.600Q68.200-35.700 66.200-39.550Q64.200-43.400 59.900-43.400L59.900-43.400Q53.900-43.400 50.500-36.450Q47.100-29.500 47.100-17L47.100-17L47.100 0L36.400 0L36.400-28.200Q36.400-43.400 28.100-43.400L28.100-43.400Q22.400-43.400 18.900-36.750Q15.400-30.100 15.400-17L15.400-17L15.400 0ZM109.100 1.300L109.100 1.300Q101.900 1.300 96.200-1.700Q90.500-4.700 87.250-10.750Q84-16.800 84-26L84-26Q84-35.200 87.300-41.250Q90.600-47.300 96.250-50.300Q101.900-53.300 109-53.300L109-53.300Q116.200-53.300 121.850-50.250Q127.500-47.200 130.750-41.050Q134-34.900 134-25.800L134-25.800Q134-16.500 130.700-10.500Q127.400-4.500 121.750-1.600Q116.100 1.300 109.100 1.300ZM109.300-7.300L109.300-7.300Q115.700-7.300 119.350-12Q123-16.700 123-25.300L123-25.300Q123-34.100 119.200-39.200Q115.400-44.300 108.800-44.300L108.800-44.300Q102.300-44.300 98.650-39.400Q95-34.500 95-26.100L95-26.100Q95-17.300 98.750-12.300Q102.500-7.300 109.300-7.300ZM150.300 0L139.400 0L139.400-25.900L139.300-51.900L149.100-51.900L148-28.200L148.900-28.200Q149.700-40.900 154.200-47.100Q158.700-53.300 167.400-53.300L167.400-53.300Q176.100-53.300 180.350-47.150Q184.600-41 184.600-28.400L184.600-28.400L184.600 0L173.700 0L173.700-27.600Q173.700-35.800 171.400-39.700Q169.100-43.600 164-43.600L164-43.600Q157.400-43.600 153.850-36.850Q150.300-30.100 150.300-15.500L150.300-15.500L150.300 0Z" />
              <path fill="#ffffff" d="M210.800 0L194.800 0L194.800-32.300L187.500-32.300L187.500-43.900L203.600-42.800L203.600-43.600Q197.500-44.300 194.400-46.500Q191.300-48.700 190.250-51.500Q189.200-54.300 189.200-56.600L189.200-56.600Q189.200-61.100 191.650-64.450Q194.100-67.800 198.450-69.600Q202.800-71.400 208.300-71.400L208.300-71.400Q212.800-71.400 216.350-70.200Q219.900-69 222.800-66.700L222.800-66.700L221.500-51.900Q216-55.700 211.200-55.700L211.200-55.700Q208.200-55.700 206.250-54.400Q204.300-53.100 204.300-50.300L204.300-50.300Q204.300-48 206.100-46.350Q207.900-44.700 212.400-44.700L212.400-44.700L222.400-44.700L222.400-32.300L210.800-32.300L210.800 0ZM241.700 0L225.600 0L225.600-52.800L239.600-52.800L239.600-31.800L240.400-31.800Q241-40.200 242.750-45.050Q244.500-49.900 247.150-51.950Q249.800-54 253.100-54L253.100-54Q257-54 260.700-51.900L260.700-51.900L259.900-33.900Q255.300-36.500 251.600-36.500L251.600-36.500Q246.800-36.500 244.250-32.450Q241.700-28.400 241.700-20.900L241.700-20.900L241.700 0ZM275.800 1.400L275.800 1.400Q271.800 1.400 268.200 0Q264.600-1.400 262.300-4.550Q260-7.700 260-13L260-13Q260-17.900 261.900-20.950Q263.800-24 267-25.850Q270.200-27.700 274-28.650Q277.800-29.600 281.500-30.300L281.500-30.300Q286.700-31.300 289.300-31.900Q291.900-32.500 292.850-33.300Q293.800-34.100 293.800-35.500L293.800-35.500Q293.800-38.400 291.650-39.900Q289.500-41.400 286-41.400L286-41.400Q283.800-41.400 281.600-40.600Q279.400-39.800 278-37.750Q276.600-35.700 276.700-31.900L276.700-31.900L262.300-32.900Q262.100-39.200 264.200-43.350Q266.300-47.500 269.950-49.850Q273.600-52.200 277.950-53.200Q282.300-54.200 286.600-54.200L286.600-54.200Q298.500-54.200 304.050-47.700Q309.600-41.200 309.600-29.300L309.600-29.300L309.600 0L295.600 0L295.600-15.100L295-15.100Q294.600-10.600 292.050-6.850Q289.500-3.100 285.350-0.850Q281.200 1.400 275.800 1.400ZM282.500-10.400L282.500-10.400Q284.800-10.400 287.450-11.600Q290.100-12.800 291.950-15.750Q293.800-18.700 293.800-23.900L293.800-23.900L293.800-24.500Q291.600-23.500 288.600-23Q285.600-22.500 282.800-21.800Q280-21.100 278.100-19.750Q276.200-18.400 276.200-15.700L276.200-15.700Q276.200-13.100 278.050-11.750Q279.900-10.400 282.500-10.400ZM330.400 0L314.200 0L314.200-52.800L327.900-52.800L327.900-31.300L328.700-31.300Q329.500-42.900 333.700-48.550Q337.900-54.200 346.400-54.200L346.400-54.200Q363.700-54.200 363.700-31.500L363.700-31.500L363.700 0L347.500 0L347.500-29.400Q347.500-40.200 340.600-40.200L340.600-40.200Q336.100-40.200 333.250-35.400Q330.400-30.600 330.400-18.700L330.400-18.700L330.400 0Z" />
              <path fill="#e8179b" d="M393.700 1.400L393.700 1.400Q384.200 1.400 378.300-2.350Q372.400-6.100 369.700-12.300Q367.000-18.500 367.000-25.800L367.000-25.800Q367.000-31.400 368.500-36.450Q370.000-41.500 373.150-45.550Q376.300-49.600 381.350-51.900Q386.400-54.200 393.500-54.200L393.500-54.200Q401.900-54.200 407.050-51.050Q412.200-47.900 414.250-42.900Q416.300-37.900 415.400-32.100L415.400-32.100L401.400-31Q401.700-36.300 399.500-38.950Q397.300-41.600 393.200-41.600L393.200-41.600Q388.300-41.600 385.800-37.950Q383.300-34.300 383.300-26.600L383.300-26.600Q383.300-19.100 385.900-14.850Q388.500-10.600 393.900-10.600L393.900-10.600Q397.600-10.600 399.500-12.400Q401.400-14.200 402.000-16.950Q402.600-19.700 402.200-22.400L402.200-22.400L417.100-21.700Q418.000-15.800 415.850-10.500Q413.700-5.200 408.250-1.900Q402.800 1.400 393.700 1.400ZM380.300 17.500L380.300 17.500L382.600 9Q384.000 9.900 386.550 10.600Q389.100 11.300 391.750 11.600Q394.400 11.900 396.250 11.350Q398.100 10.800 398.100 9.200L398.100 9.200Q398.100 8.500 397.350 7.750Q396.600 7 394.050 6.550Q391.500 6.100 386.000 6.400L386.000 6.400L387.000-0.800L397.000-0.800L396.400 3.300Q401.800 3.300 404.950 4.900Q408.100 6.500 408.100 10.500L408.100 10.500Q408.100 14.600 405.250 16.850Q402.400 19.100 397.950 19.850Q393.500 20.600 388.800 19.950Q384.100 19.300 380.300 17.500Z" />
              <path fill="#ffffff" d="M434.200 1.400L434.200 1.400Q430.200 1.400 426.600 0Q423.000-1.400 420.700-4.550Q418.400-7.700 418.400-13L418.400-13Q418.400-17.900 420.300-20.950Q422.200-24 425.400-25.850Q428.600-27.700 432.400-28.650Q436.200-29.600 439.900-30.300L439.900-30.300Q445.100-31.300 447.700-31.900Q450.300-32.500 451.250-33.300Q452.200-34.100 452.200-35.500L452.200-35.500Q452.200-38.400 450.050-39.900Q447.900-41.400 444.400-41.400L444.400-41.400Q442.200-41.400 440.000-40.600Q437.800-39.800 436.400-37.750Q435.000-35.700 435.100-31.900L435.100-31.900L420.700-32.900Q420.500-39.200 422.600-43.350Q424.700-47.500 428.350-49.850Q432.000-52.200 436.350-53.200Q440.700-54.200 445.000-54.200L445.000-54.200Q456.900-54.200 462.450-47.700Q468.000-41.200 468.000-29.300L468.000-29.300L468.000 0L454.000 0L454.000-15.100L453.400-15.100Q453.000-10.600 450.450-6.850Q447.900-3.100 443.750-0.850Q439.600 1.400 434.200 1.400ZM440.900-10.400L440.900-10.400Q443.200-10.400 445.850-11.600Q448.500-12.800 450.350-15.750Q452.200-18.700 452.200-23.900L452.200-23.900L452.200-24.500Q450.000-23.500 447.000-23Q444.000-22.500 441.200-21.800Q438.400-21.100 436.500-19.750Q434.600-18.400 434.600-15.700L434.600-15.700Q434.600-13.100 436.450-11.750Q438.300-10.400 440.900-10.400ZM488.800 0L472.600 0L472.600-52.800L488.800-52.800L488.800 0ZM480.600-56.600L480.600-56.600Q471.100-56.600 471.100-64.200L471.100-64.200Q471.100-71.900 480.600-71.900L480.600-71.900Q485.300-71.900 487.750-69.900Q490.200-67.900 490.200-64.200L490.200-64.200Q490.200-60.600 487.750-58.600Q485.300-56.600 480.600-56.600ZM517.100 1.400L517.100 1.400Q510.000 1.400 504.350-0.500Q498.700-2.400 495.600-6.750Q492.500-11.100 492.800-18.500L492.800-18.500L506.900-19.700Q507.500-10.100 517.600-10.100L517.600-10.100Q520.700-10.100 522.950-11.150Q525.200-12.200 525.200-14.700L525.200-14.700Q525.200-16.600 523.250-17.650Q521.300-18.700 515.200-20.200L515.200-20.200Q508.400-21.900 503.400-23.750Q498.400-25.600 495.750-28.650Q493.100-31.700 493.100-36.900L493.100-36.900Q493.100-42.400 496.050-46.250Q499.000-50.100 504.200-52.150Q509.400-54.200 516.200-54.200L516.200-54.200Q522.300-54.200 527.600-52.300Q532.900-50.400 535.950-46.100Q539.000-41.800 538.200-34.700L538.200-34.700L524.400-33.400Q524.800-37.800 522.250-40.150Q519.700-42.500 515.300-42.500L515.300-42.500Q511.900-42.500 510.050-41.250Q508.200-40 508.200-38.100L508.200-38.100Q508.200-35.800 510.850-34.600Q513.500-33.400 519.300-32.100L519.300-32.100Q522.700-31.400 526.400-30.300Q530.100-29.200 533.300-27.350Q536.500-25.500 538.500-22.500Q540.500-19.500 540.500-14.900L540.500-14.900Q540.500-7.500 534.500-3.050Q528.500 1.400 517.100 1.400Z" />
            </svg>
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