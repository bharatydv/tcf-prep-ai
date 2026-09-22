/* The free vocabulary guide: the offer, and the questions people ask about it.
 *
 * This page used to print the guide itself — the ten theme headings, then
 * every table of pages 2 to 4, then a blurred teaser of the rest. That is
 * gone: the page is the file shown as pages on the left, the form on the
 * right, and the FAQ. What the guide says is in the guide, which the form
 * hands over.
 *
 * The gate is not in this file. The signed-out download URL is a signed
 * link the server issues after the form; the signed-in one refuses anybody
 * without an account. Nothing here decides who may have the file.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  DownloadSimple, ArrowRight, BookOpen, Sparkle, CheckCircle,
} from '@phosphor-icons/react';
import { useT } from '../i18n';
import { Seo, SITE_URL } from '../lib/seo';
import { useAuth } from '../context/AuthContext';
import LeadCaptureForm from '../components/LeadCaptureForm';
import PdfPreview from '../components/PdfPreview';
import { downloadPath } from '../lib/leads';
import GUIDE from '../content/vocabularyGuide.json';

export const VOCAB_PATH = '/tcf-canada-vocabulary';

/* Read out of the PDF by the generator rather than typed here, so a guide
   that gains a page does not leave the hero counting the old total. */
const TOTAL_PAGES = GUIDE.totalPages;

const FAQ = [1, 2, 3, 4, 5].map((n) => ({ q: `vocab.faq${n}q`, a: `vocab.faq${n}a` }));

export default function VocabularyGuide() {
  const t = useT();
  const location = useLocation();
  const { user } = useAuth();
  const signedIn = Boolean(user);

  /* What the form gave back: the signed URL for the file, once. Held so the
     card can turn into a download rather than reloading the page, and so the
     link survives a browser that blocked the automatic download. */
  const [done, setDone] = useState(null);

  /* Article, FAQ and a breadcrumb. Handed to <Seo> rather than appended by an
     effect, so `npm run build:prerender` bakes it into the static HTML and
     the crawlers that do not run JavaScript see it — the same reason the
     writing guide routes its markup this way. */
  const schema = useMemo(() => ([
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: t('vocab.docTitle'),
      description: t('vocab.docDesc'),
      inLanguage: 'en',
      about: GUIDE.themes.map((theme) => theme.title).join(', '),
      author: { '@type': 'Organization', name: 'prepfrancais' },
      publisher: {
        '@type': 'Organization',
        name: 'prepfrancais',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` },
      },
      datePublished: '2026-09-01',
      dateModified: '2026-09-21',
      mainEntityOfPage: SITE_URL + VOCAB_PATH,
      /* The file itself, declared as what it is. `isAccessibleForFree` is
         true because it is: an account costs nothing. */
      isAccessibleForFree: true,
      image: `${SITE_URL}/tcf-vocabulary/page-2.webp`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: 'en',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: t(f.q),
        acceptedAnswer: { '@type': 'Answer', text: t(f.a) },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('nav.resources'), item: `${SITE_URL}/resources` },
        { '@type': 'ListItem', position: 2, name: t('vocab.h1'), item: SITE_URL + VOCAB_PATH },
      ],
    },
  ]), [t]);

  const primary = 'btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600';
  const back = { from: location };

  /* Whether the card asks for the details or simply hands the file over.
     Signed in, it hands it over: that account already carries the name, the
     address and the number, and asking again for what we have is asking
     twice. Signed out, it asks — and it keeps asking on a later visit, even
     of somebody who answered before, because the exit dialog's "never
     again" rule is about not interrupting the same person twice, and
     nobody arrives on this page by accident. */
  const url = signedIn ? downloadPath() : (done && done.url);

  return (
    <main className="overflow-x-clip bg-white">
      <Seo title={t('vocab.docTitle')} description={t('vocab.docDesc')}
        path={VOCAB_PATH} type="article" jsonLd={schema}
        image="/tcf-vocabulary/page-2.webp" />

      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-6 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-violet-400/25 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-5xl px-4 pb-14 pt-8 sm:px-6">
          <nav aria-label="Breadcrumb" className="mb-6 text-xs font-semibold text-gray-500">
            <Link to="/resources" className="hover:text-primary">{t('nav.resources')}</Link>
            <span className="px-1.5 text-gray-400">/</span>
            <span className="text-gray-700">{t('vocab.h1')}</span>
          </nav>

          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
              <Sparkle size={14} weight="fill" /> {t('vocab.badge')}
            </span>
            <h1 className="mx-auto mt-4 max-w-3xl font-heading text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl">
              {t('vocab.h1lead')}{' '}
              <span className="whitespace-nowrap bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">
                {t('vocab.h1accent')}
              </span>
            </h1>
          </div>

          {/* The file on the left, the ask on the right.
              The same pages the exit dialog turns, because what is being
              offered is twenty-five pages of French with English beside it,
              and three real ones argue for it better than a sentence about
              them. Past page 4 the picture is blurred in the file itself,
              so what a signed-out visitor sees is what was sent. */}
          <div className="mt-10 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">

            {/* ---- what it is ------------------------------------------- */}
            <div className="mx-auto w-full max-w-sm">
              <PdfPreview downloadUrl={signedIn ? url : null} />
              <p className="mt-3 text-center text-[12px] leading-snug text-gray-600">
                {signedIn ? t('vocab.previewNoteIn') : t('vocab.previewNote')}
              </p>
              {/* What it is, in the three numbers somebody scans for. */}
              <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
                {[[TOTAL_PAGES, t('vocab.statPages')], [GUIDE.themes.length, t('vocab.statThemes')],
                  ['B2', t('vocab.statLevel')]].map(([value, label]) => (
                    <div key={label} className="rounded-2xl border border-violet-200 bg-white/80 px-3 py-3">
                      <dt className="font-heading text-xl font-extrabold text-primary">{value}</dt>
                      <dd className="mt-0.5 text-[11px] leading-tight text-gray-600">{label}</dd>
                    </div>
                  ))}
              </dl>
            </div>

            {/* ---- the ask ---------------------------------------------- */}
            <div className="mx-auto w-full max-w-md lg:max-w-none">
              <div className="rounded-3xl border border-violet-200 bg-white p-6 shadow-xl shadow-violet-200/40 sm:p-8"
                data-testid="vocab-offer">
                {url ? (
                  <div className="text-center">
                    {done && <CheckCircle size={34} weight="fill" className="mx-auto text-emerald-500" />}
                    <p className="font-heading text-2xl font-extrabold text-gray-900">
                      {done ? t('lead.doneTitle') : t('vocab.formTitleIn')}
                    </p>
                    <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
                      {done ? t('lead.doneBody') : t('vocab.formIntroIn')}
                    </p>
                    <a href={url} download data-testid="vocab-download"
                      className={`${primary} mt-5 w-full justify-center !py-3.5`}>
                      <DownloadSimple size={18} weight="bold" /> {t('vocab.download')}
                    </a>
                  </div>
                ) : (
                  <>
                    <p className="font-heading text-2xl font-extrabold text-gray-900">{t('vocab.formTitle')}</p>
                    <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t('vocab.formIntro')}</p>
                    <LeadCaptureForm className="mt-6" variant="page" onDone={setDone} ctaKey="vocab.formCta" />
                    <p className="mt-3 text-center text-[11px] leading-snug text-gray-400">
                      {t('vocab.formPrivacy')}{' '}
                      <Link to="/privacy" className="font-semibold text-gray-500 underline-offset-2 hover:text-primary hover:underline">
                        {t('consent.privacy')}
                      </Link>
                    </p>
                  </>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] font-semibold">
                {!signedIn && (
                  <Link to="/login" state={back} className="text-gray-500 hover:text-primary">
                    {t('vocab.lockedLogin')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* FAQ -------------------------------------------------------------- */}
        <h2 id="faq" className="scroll-mt-20 font-heading text-2xl font-extrabold text-gray-900">
          {t('vocab.faqTitle')}
        </h2>
        <div className="mt-4 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-violet-100 bg-violet-50/40 px-4 py-3">
              <summary className="cursor-pointer list-none font-heading text-[15px] font-bold text-gray-900 marker:hidden">
                {t(f.q)}
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{t(f.a)}</p>
            </details>
          ))}
        </div>

        {/* WHERE TO GO NEXT ------------------------------------------------- */}
        <div className="mt-12 rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-6 text-center">
          <h2 className="font-heading text-xl font-extrabold text-gray-900">{t('vocab.nextTitle')}</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-gray-700">{t('vocab.nextBody')}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link to="/speaking" className={primary}>
              {t('vocab.nextSpeaking')} <ArrowRight size={16} weight="bold" />
            </Link>
            <Link to="/tef-tcf-writing-guide" className="btn-outline">
              <BookOpen size={16} weight="fill" /> {t('vocab.nextGuide')}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
