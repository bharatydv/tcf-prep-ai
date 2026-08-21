import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  PenNib, Clock, ListChecks, Target, ArrowRight, CheckCircle, Sparkle,
} from '@phosphor-icons/react';
import { BackLink } from '../components/shared';
import { useI18n } from '../i18n';
import { Seo, SITE_URL } from '../lib/seo';

/* ------------------------------------------------------------------ data ---
   Copy is held as translation keys and resolved with t() at render time, so
   the guide reads in the language the visitor picked. */
const TACHES = [
  { n: 1, title: 'guide.t1title', words: 'guide.words1', time: '~10 min', desc: 'guide.t1desc' },
  { n: 2, title: 'guide.t2title', words: 'guide.words2', time: '~20 min', desc: 'guide.t2desc' },
  { n: 3, title: 'guide.t3title', words: 'guide.words3', time: '~30 min', desc: 'guide.t3desc' },
];

const CLB_BANDS = [
  { clb: 'CLB 4', cefr: 'A2', note: 'guide.clb4' },
  { clb: 'CLB 5', cefr: 'B1 (lower)', note: 'guide.clb5' },
  { clb: 'CLB 6', cefr: 'B1 (upper)', note: 'guide.clb6' },
  { clb: 'CLB 7', cefr: 'B2', note: 'guide.clb7', highlight: true },
  { clb: 'CLB 8', cefr: 'B2 (upper)', note: 'guide.clb8' },
  { clb: 'CLB 9+', cefr: 'C1–C2', note: 'guide.clb9' },
];

const MISTAKES = [1, 2, 3, 4, 5, 6].map((n) => [`guide.mistake${n}t`, `guide.mistake${n}`]);
const FAQ = [1, 2, 3, 4, 5, 6].map((n) => ({ q: `guide.faq${n}q`, a: `guide.faq${n}a` }));
const TIPS = [1, 2, 3, 4, 5].map((n) => `guide.tip${n}`);

/* -------------------------------------------------------------------- page - */
export default function TefTcfWritingGuide() {
  const { t, lang } = useI18n();

  // Article + FAQ markup. It was correct before but was appended by an effect,
  // so the crawlers it exists for — the ones that do not run JavaScript — never
  // saw it. Routed through <Seo>, it is emitted with the canonical URL and the
  // Open Graph pair, and `npm run build:prerender` bakes it into the HTML.
  const schema = useMemo(() => ([
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: `${t('guide.heroA')} ${t('guide.heroB')}`,
      description: t('guide.docDesc'),
      inLanguage: lang === 'fr' ? 'fr-CA' : 'en',
      author: { '@type': 'Organization', name: 'prepfrancais' },
      publisher: {
        '@type': 'Organization',
        name: 'prepfrancais',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` },
      },
      datePublished: '2026-06-01',
      dateModified: '2026-08-18',
      mainEntityOfPage: `${SITE_URL}/tef-tcf-writing-guide`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: lang === 'fr' ? 'fr-CA' : 'en',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: t(f.q),
        acceptedAnswer: { '@type': 'Answer', text: t(f.a) },
      })),
    },
  ]), [t, lang]);

  return (
    <main className="overflow-x-clip bg-white">
      <Seo
        title={t('guide.docTitle')}
        description={t('guide.docDesc')}
        path="/tef-tcf-writing-guide"
        type="article"
        jsonLd={schema}
      />
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-6 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-violet-400/25 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl px-4 pb-12 pt-10 text-center sm:px-6">
          <div className="text-left"><BackLink className="!mb-4" /></div>
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Sparkle size={14} weight="fill" /> {t('guide.badge')}
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            {t('guide.heroA')}{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">{t('guide.heroB')}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-gray-700">{t('guide.heroSub')}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/practice" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
              <PenNib size={18} weight="fill" /> {t('guide.tryChecker')}
            </Link>
            <a href="#faq" className="btn-outline">{t('guide.jumpFaq')}</a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* INTRO */}
        <p className="text-[15px] leading-relaxed text-gray-700">{t('guide.intro')}</p>

        {/* THE 3 TASKS */}
        <h2 className="mt-10 font-heading text-2xl font-extrabold text-gray-900">{t('guide.tachesTitle')}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{t('guide.tachesIntro')}</p>
        <div className="mt-6 space-y-4">
          {TACHES.map((tache) => (
            <div key={tache.n} className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 font-heading text-base font-bold text-primary">{tache.n}</span>
                <h3 className="font-heading text-lg font-bold text-gray-900">{t(tache.title)}</h3>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="pill bg-violet-50 text-primary"><ListChecks size={14} className="mr-1 inline" /> {t(tache.words)}</span>
                <span className="pill bg-fuchsia-50 text-fuchsia-700"><Clock size={14} className="mr-1 inline" /> {tache.time}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{t(tache.desc)}</p>
            </div>
          ))}
        </div>

        {/* CLB TABLE */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">{t('guide.bandsTitle')}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{t('guide.bandsIntro')}</p>
        <div className="mt-5 overflow-hidden rounded-3xl border border-violet-100 shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-violet-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3 font-heading font-bold">{t('guide.colClb')}</th>
                  <th className="px-4 py-3 font-heading font-bold">{t('guide.colCefr')}</th>
                  <th className="px-4 py-3 font-heading font-bold">{t('guide.colLooks')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-50">
                {CLB_BANDS.map((b) => (
                  <tr key={b.clb} className={b.highlight ? 'bg-fuchsia-50/60' : 'bg-white'}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-900">{b.clb}{b.highlight && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-white">{t('guide.prTarget')}</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{b.cefr}</td>
                    <td className="px-4 py-3 text-gray-600">{t(b.note)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">{t('guide.bandsNote')}</p>

        {/* COMMON MISTAKES */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">{t('guide.mistakesTitle')}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{t('guide.mistakesIntro')}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {MISTAKES.map(([titleKey, bodyKey]) => (
            <div key={titleKey} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-soft">
              <h3 className="flex items-center gap-2 font-heading text-base font-bold text-gray-900">
                <Target size={18} weight="duotone" className="shrink-0 text-primary" /> {t(titleKey)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{t(bodyKey)}</p>
            </div>
          ))}
        </div>

        {/* HOW TO PREPARE */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">{t('guide.prepTitle')}</h2>
        <ul className="mt-4 space-y-3">
          {TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-[15px] leading-relaxed text-gray-700">
              <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {t(tip)}
            </li>
          ))}
        </ul>

        {/* INLINE CTA */}
        <div className="mt-10 rounded-3xl bg-gradient-to-r from-primary via-purple-600 to-fuchsia-600 p-8 text-center">
          <h2 className="font-heading text-2xl font-extrabold text-white">{t('guide.ctaTitle')}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-violet-100/90">{t('guide.ctaBody')}</p>
          <Link to="/practice" className="btn-primary mt-5 !bg-white !text-primary hover:!brightness-100">
            {t('guide.ctaLink')} <ArrowRight size={16} weight="bold" />
          </Link>
        </div>

        {/* FAQ */}
        <h2 id="faq" className="mt-12 scroll-mt-20 font-heading text-2xl font-extrabold text-gray-900">{t('guide.faqTitle')}</h2>
        <div className="mt-5 space-y-4">
          {FAQ.map((f) => (
            <div key={f.q} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-soft">
              <h3 className="font-heading text-base font-bold text-gray-900">{t(f.q)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{t(f.a)}</p>
            </div>
          ))}
        </div>

        {/* CLOSING */}
        <p className="mt-10 text-xs leading-relaxed text-gray-400">{t('guide.closing')}</p>
      </div>
    </main>
  );
}
