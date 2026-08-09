import { Link } from 'react-router-dom';
import {
  Sparkle, BookOpen, Question, ArrowRight, GraduationCap, Lightbulb, Compass,
} from '@phosphor-icons/react';
import { useT } from '../i18n';

/* Copy lives as translation keys and is resolved with t() at render time. */
const RESOURCE_CARDS = [
  { to: '/blog', title: 'res.blogTitle', desc: 'res.blogDesc', icon: BookOpen, cta: 'res.blogCta' },
  { to: '/tef-tcf-writing-guide', title: 'res.guideTitle', desc: 'res.guideDesc', icon: GraduationCap, cta: 'res.guideCta' },
  { to: '/faq', title: 'res.faqTitle', desc: 'res.faqDesc', icon: Question, cta: 'res.faqCta' },
];

const TIPS = ['res.tip1', 'res.tip2', 'res.tip3', 'res.tip4'];

export default function Resources() {
  const t = useT();

  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-12 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Compass size={14} weight="fill" /> {t('res.badge')}
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            {t('res.heroA')}{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">{t('res.heroB')}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-700">{t('res.heroSub')}</p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        {/* RESOURCE CARDS */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCE_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.to}
                to={c.to}
                className="group flex flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                  <Icon size={24} weight="fill" />
                </span>
                <h3 className="mt-4 font-heading text-lg font-bold text-gray-900 group-hover:text-primary">{t(c.title)}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{t(c.desc)}</p>
                <span className="mt-4 flex items-center gap-1 text-sm font-semibold text-primary">
                  {t(c.cta)} <ArrowRight size={15} weight="bold" className="shrink-0 transition group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>

        {/* QUICK TIPS */}
        <div className="mt-12 rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-8 shadow-soft">
          <h2 className="flex items-center gap-2 font-heading text-xl font-extrabold text-gray-900">
            <Lightbulb size={22} weight="fill" className="shrink-0 text-primary" /> {t('res.tipsTitle')}
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {TIPS.map((tip) => (
              <li key={tip} className="flex items-start gap-2 rounded-2xl bg-white/70 p-4 text-sm leading-relaxed text-gray-700">
                <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {t(tip)}
              </li>
            ))}
          </ul>
        </div>

        {/* PLACEHOLDER — more resources coming */}
        <div className="mt-8 rounded-3xl border border-dashed border-violet-200 bg-white p-8 text-center">
          <p className="font-heading text-base font-bold text-gray-900">{t('res.comingTitle')}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{t('res.comingBody')}</p>
        </div>
      </div>
    </main>
  );
}
