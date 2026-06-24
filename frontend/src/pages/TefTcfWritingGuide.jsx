import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  PenNib, Clock, ListChecks, Target, ArrowRight, CheckCircle, Sparkle,
} from '@phosphor-icons/react';

/* ------------------------------------------------------------------ data --- */
const TACHES = [
  {
    n: 1, title: 'Tâche 1 — Écrire un message',
    words: '60–120 words', time: '~10 min',
    desc: 'A short, practical message: an invitation, a request, an apology or a note to a friend, colleague or service. Examiners look for the right register, a clear purpose and correct everyday vocabulary.',
  },
  {
    n: 2, title: 'Tâche 2 — Raconter / Rédiger un article',
    words: '120–150 words', time: '~20 min',
    desc: 'A narrative or descriptive text — often a blog post or article recounting an experience. You are expected to organise ideas, use connectors and vary your vocabulary and tenses.',
  },
  {
    n: 3, title: 'Tâche 3 — Comparer deux avis',
    words: '120–180 words', time: '~30 min',
    desc: 'An argumentative text comparing two opinions on a social topic, then defending your own. This is where higher scores are won or lost: clear structure, nuanced connectors and an explicit point of view.',
  },
];

const CLB_BANDS = [
  { clb: 'CLB 4', cefr: 'A2', note: 'Basic, simple sentences with frequent errors.' },
  { clb: 'CLB 5', cefr: 'B1 (lower)', note: 'Connected text, limited range, basic connectors.' },
  { clb: 'CLB 6', cefr: 'B1 (upper)', note: 'Clearer organisation, some complex sentences.' },
  { clb: 'CLB 7', cefr: 'B2', note: 'Clear arguments, varied connectors, few errors — the common PR target.', highlight: true },
  { clb: 'CLB 8', cefr: 'B2 (upper)', note: 'Fluent, well-structured, rich vocabulary.' },
  { clb: 'CLB 9+', cefr: 'C1–C2', note: 'Near-native, sophisticated, almost error-free.' },
];

const MISTAKES = [
  ['Gender & agreement', 'Wrong article or adjective agreement (le/la, accord). Learn nouns with their article and make adjectives agree.'],
  ['Verb conjugation', 'Tense and auxiliary errors, especially passé composé (être vs avoir) and the subjunctive.'],
  ['Prepositions', 'Wrong verb + preposition pairs (penser à, dépendre de) and place prepositions (à, en, au).'],
  ['Anglicisms', 'False friends like “actuellement” (currently) or calques from English structures.'],
  ['Weak connectors', 'Overusing “et / mais”. At CLB 7+ use “cependant, néanmoins, par conséquent, dans la mesure où”.'],
  ['Length & timing', 'Going under or over the word count, or running out of time on Tâche 3.'],
];

const FAQ = [
  {
    q: 'What is the difference between the TEF and TCF Canada writing exam?',
    a: 'Both the TEF Canada and TCF Canada assess French writing for Canadian immigration. Each has a written-expression section built around short, practical tasks. The TCF Canada writing section has three tasks (tâches) of increasing length and difficulty; the TEF Canada is similar in spirit. Both map results to the Canadian Language Benchmarks (CLB / NCLC).',
  },
  {
    q: 'What CLB level do I need for Canadian PR?',
    a: 'Many Express Entry candidates aim for CLB 7 in each skill, which corresponds roughly to CEFR B2. CLB 7 is a common threshold for maximising points, but exact requirements depend on your immigration program. Always check the current official requirement for your specific program.',
  },
  {
    q: 'How long is the TEF/TCF writing section?',
    a: 'The writing section typically lasts about 60 minutes across the tasks. A common split is roughly 10 minutes for the short message, 20 minutes for the narrative/article, and 30 minutes for the argumentative comparison — though you manage the total time yourself.',
  },
  {
    q: 'How many words should I write for each task?',
    a: 'A typical guide is 60–120 words for Tâche 1 (short message), 120–150 words for Tâche 2 (article/narrative), and 120–180 words for Tâche 3 (compare two opinions). Staying within the range matters: too short loses content marks, too long wastes time and risks errors.',
  },
  {
    q: 'How can I improve my French writing score quickly?',
    a: 'Focus on the errors that cap your level: gender/agreement, verb conjugation, prepositions and anglicisms. Learn a small set of higher-level connectors, practise to a timer, and get feedback on every piece you write so you stop repeating the same mistakes. Consistent, corrected practice moves scores faster than writing without feedback.',
  },
  {
    q: 'Is an AI writing checker accurate for TEF/TCF preparation?',
    a: 'An AI checker gives instant, consistent feedback on grammar, vocabulary, structure and an estimated level, which is useful for regular practice between formal mock exams. It is a preparation aid, not the official exam — estimated scores guide your study but your real result may differ.',
  },
];

/* ----------------------------------------------------------------- helpers - */
function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) { m = document.createElement('meta'); m.setAttribute('name', name); document.head.appendChild(m); }
  m.setAttribute('content', content);
  return m;
}

/* -------------------------------------------------------------------- page - */
export default function TefTcfWritingGuide() {
  useEffect(() => {
    const title = 'TEF / TCF Canada Writing Guide: How to Reach CLB 7 | MonFrancais';
    const desc = 'A complete guide to the TEF and TCF Canada writing exam: the three tâches, word counts, CLB 7 score equivalency, common mistakes, and how to prepare to reach CLB 7 (CEFR B2) and beyond.';
    document.title = title;
    setMeta('description', desc);

    // Article + FAQ JSON-LD (strong for SEO + AI citation)
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'guide-jsonld';
    ld.text = JSON.stringify([
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'TEF / TCF Canada Writing Guide: How to Reach CLB 7',
        description: desc,
        author: { '@type': 'Organization', name: 'MonFrancais' },
        publisher: { '@type': 'Organization', name: 'MonFrancais' },
        datePublished: '2026-06-01',
        dateModified: new Date().toISOString().slice(0, 10),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ]);
    document.getElementById('guide-jsonld')?.remove();
    document.head.appendChild(ld);
    return () => { document.getElementById('guide-jsonld')?.remove(); };
  }, []);

  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-6 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-violet-400/25 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl px-4 pb-12 pt-14 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Sparkle size={14} weight="fill" /> Free guide
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            TEF / TCF Canada Writing Guide:{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">How to Reach CLB 7</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-gray-700">
            Everything you need to understand the French writing exam for Canadian immigration — the three tâches, how many words to write, what CLB 7 really means, the mistakes that cap your score, and how to prepare efficiently.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/practice" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
              <PenNib size={18} weight="fill" /> Try the AI writing checker
            </Link>
            <a href="#faq" className="btn-outline">Jump to FAQ</a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* INTRO */}
        <p className="text-[15px] leading-relaxed text-gray-700">
          The <strong>TEF Canada</strong> and <strong>TCF Canada</strong> are the two French exams accepted for Canadian
          immigration. For most candidates, the goal in writing (<em>expression écrite</em>) is to reach <strong>CLB 7</strong>,
          which corresponds roughly to <strong>CEFR B2</strong> and is a common threshold for maximising Express Entry points.
          This guide explains exactly what the writing section asks of you and how to prepare for it.
        </p>

        {/* THE 3 TASKS */}
        <h2 className="mt-10 font-heading text-2xl font-extrabold text-gray-900">The three writing tasks (tâches)</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
          The writing section is built around three tasks of increasing length and difficulty. You manage your own time
          across them — roughly 60 minutes in total.
        </p>
        <div className="mt-6 space-y-4">
          {TACHES.map((t) => (
            <div key={t.n} className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 font-heading text-base font-bold text-primary">{t.n}</span>
                <h3 className="font-heading text-lg font-bold text-gray-900">{t.title}</h3>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="pill bg-violet-50 text-primary"><ListChecks size={14} className="mr-1 inline" /> {t.words}</span>
                <span className="pill bg-fuchsia-50 text-fuchsia-700"><Clock size={14} className="mr-1 inline" /> {t.time}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{t.desc}</p>
            </div>
          ))}
        </div>

        {/* CLB TABLE */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">CLB / NCLC score equivalency</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
          Your writing performance is mapped to the <strong>Canadian Language Benchmarks (CLB)</strong> — <em>NCLC</em> in
          French. Here is how the benchmarks line up with the CEFR levels used in most French courses:
        </p>
        <div className="mt-5 overflow-hidden rounded-3xl border border-violet-100 shadow-soft">
          <table className="w-full text-left text-sm">
            <thead className="bg-violet-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 font-heading font-bold">CLB / NCLC</th>
                <th className="px-4 py-3 font-heading font-bold">CEFR</th>
                <th className="px-4 py-3 font-heading font-bold">What it looks like</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-50">
              {CLB_BANDS.map((b) => (
                <tr key={b.clb} className={b.highlight ? 'bg-fuchsia-50/60' : 'bg-white'}>
                  <td className="px-4 py-3 font-semibold text-gray-900">{b.clb}{b.highlight && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-white">PR target</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{b.cefr}</td>
                  <td className="px-4 py-3 text-gray-600">{b.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Equivalencies are approximate and for guidance only. Always confirm the exact requirement for your immigration program with official sources.
        </p>

        {/* COMMON MISTAKES */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">The mistakes that cap your score</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
          At CLB 7, examiners expect clear structure and only occasional errors. These six categories are where most
          candidates lose marks — fixing them is the fastest way to move up a band:
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {MISTAKES.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-soft">
              <h3 className="flex items-center gap-2 font-heading text-base font-bold text-gray-900">
                <Target size={18} weight="duotone" className="text-primary" /> {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
            </div>
          ))}
        </div>

        {/* HOW TO PREPARE */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">How to prepare efficiently</h2>
        <ul className="mt-4 space-y-3">
          {[
            'Practise to a timer so the 60-minute limit feels normal, not stressful.',
            'Write on all three task types regularly — not just the one you find easiest.',
            'Get feedback on every piece, so you stop repeating the same mistakes.',
            'Build a personal list of higher-level connectors and reuse them deliberately.',
            'Read model answers at CLB 7+ to internalise structure and register.',
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-[15px] leading-relaxed text-gray-700">
              <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {tip}
            </li>
          ))}
        </ul>

        {/* INLINE CTA */}
        <div className="mt-10 rounded-3xl bg-gradient-to-r from-primary via-purple-600 to-fuchsia-600 p-8 text-center">
          <h2 className="font-heading text-2xl font-extrabold text-white">Get instant feedback on your French writing</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-violet-100/90">
            Write on a real task, and our AI returns your errors by category, corrections, and an estimated CLB level in seconds.
          </p>
          <Link to="/practice" className="btn-primary mt-5 !bg-white !text-primary hover:!brightness-100">
            Try the writing checker <ArrowRight size={16} weight="bold" />
          </Link>
        </div>

        {/* FAQ */}
        <h2 id="faq" className="mt-12 scroll-mt-20 font-heading text-2xl font-extrabold text-gray-900">Frequently asked questions</h2>
        <div className="mt-5 space-y-4">
          {FAQ.map((f) => (
            <div key={f.q} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-soft">
              <h3 className="font-heading text-base font-bold text-gray-900">{f.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.a}</p>
            </div>
          ))}
        </div>

        {/* CLOSING */}
        <p className="mt-10 text-xs leading-relaxed text-gray-400">
          This guide is for preparation purposes and is not affiliated with the official TEF or TCF exam bodies. Scores
          and levels mentioned are estimates to help guide your study; your official exam result may differ.
        </p>
      </div>
    </main>
  );
}
