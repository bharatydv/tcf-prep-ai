import { Link } from 'react-router-dom';
import {
  Sparkle, BookOpen, Question, ArrowRight, GraduationCap, Lightbulb, Compass,
} from '@phosphor-icons/react';

const RESOURCE_CARDS = [
  {
    to: '/blog',
    title: 'Blog',
    desc: 'Tips, strategies and study guides to help you reach CLB 7 and beyond on the TEF and TCF exams.',
    icon: BookOpen,
    cta: 'Read the blog',
    available: true,
  },
  {
    to: '/tef-tcf-writing-guide',
    title: 'Writing Guide',
    desc: 'A complete guide to the TEF/TCF writing exam: the three tâches, word counts, and how to reach CLB 7.',
    icon: GraduationCap,
    cta: 'Open the guide',
    available: true,
  },
  {
    to: '/faq',
    title: 'FAQ',
    desc: 'Answers to the most common questions about the exams, scoring, and how to use this platform.',
    icon: Question,
    cta: 'View FAQ',
    available: true,
  },
];

const TIPS = [
  'Practise to a timer so the exam time limit feels normal.',
  'Get feedback on every piece so you stop repeating the same mistakes.',
  'Learn a small set of higher-level connectors and reuse them deliberately.',
  'Read model answers at CLB 7+ to internalise structure and register.',
];

export default function Resources() {
  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-12 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Compass size={14} weight="fill" /> Resources
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            Everything to help you{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">prepare</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-700">
            Guides, articles and answers to help you study smarter for the TEF and TCF Canada exams.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        {/* RESOURCE CARDS */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCE_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.title}
                to={c.to}
                className="group flex flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                  <Icon size={24} weight="fill" />
                </span>
                <h3 className="mt-4 font-heading text-lg font-bold text-gray-900 group-hover:text-primary">{c.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{c.desc}</p>
                <span className="mt-4 flex items-center gap-1 text-sm font-semibold text-primary">
                  {c.cta} <ArrowRight size={15} weight="bold" className="transition group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>

        {/* QUICK TIPS */}
        <div className="mt-12 rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-8 shadow-soft">
          <h2 className="flex items-center gap-2 font-heading text-xl font-extrabold text-gray-900">
            <Lightbulb size={22} weight="fill" className="text-primary" /> Quick study tips
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {TIPS.map((t) => (
              <li key={t} className="flex items-start gap-2 rounded-2xl bg-white/70 p-4 text-sm leading-relaxed text-gray-700">
                <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
        </div>

        {/* PLACEHOLDER — more resources coming */}
        <div className="mt-8 rounded-3xl border border-dashed border-violet-200 bg-white p-8 text-center">
          <p className="font-heading text-base font-bold text-gray-900">More resources coming soon</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Vocabulary lists, downloadable templates, and video lessons are on the way. Check back soon.
          </p>
        </div>
      </div>
    </main>
  );
}
