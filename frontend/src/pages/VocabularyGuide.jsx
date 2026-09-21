/* The free vocabulary guide, as a page rather than as a download button.
 *
 * It used to be a card on /resources with a link on it, which is the whole
 * resource reduced to its file name: nothing about it could be read without
 * first handing over a phone number, and nothing about it could be found,
 * because a PDF behind a form is a PDF no search engine has ever seen.
 *
 * So this page shows the guide three ways at once, and they are not the same
 * thing repeated:
 *
 * 1. As text. The two-column tables of the free pages are real HTML tables,
 *    extracted from the PDF by backend/tools/lead_pdf_preview.py rather than
 *    retyped beside it — so they cannot drift from the file, and so they are
 *    readable by a search engine, a screen reader and anybody on a slow
 *    connection. This is the part that makes the page worth indexing.
 *
 * 2. As pages. A reader of all 25 pages as pictures, which is what somebody
 *    deciding whether to download it actually wants to see. The cover is not
 *    among them: page 1 is branding, and a cover is evidence of nothing.
 *
 * 3. As the file. The download, for somebody with an account.
 *
 * WHAT IS BEHIND THE ACCOUNT, AND WHERE THE GATE IS
 * -------------------------------------------------
 * Pages 2, 3 and 4 are public files under frontend/public. Pages 5 to 25 are
 * public only as blurred copies, with the blur baked into the file rather
 * than applied in CSS — a CSS blur is a filter over a picture that was still
 * sent, and one line in the inspector takes it off. The sharp copies of those
 * pages are served by the API, which checks for an account.
 *
 * That means the gate is not in this file. Nothing here decides what somebody
 * is allowed to see; it decides which address to ask for, and the server
 * decides the rest. A signed-out visitor who edits this component still gets
 * a 403.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  FilePdf, DownloadSimple, Lock, ArrowRight, BookOpen, Sparkle,
} from '@phosphor-icons/react';
import { useT } from '../i18n';
import { Seo, SITE_URL } from '../lib/seo';
import { useAuth } from '../context/AuthContext';
import { downloadPath } from '../components/LeadMagnetModal';
import GUIDE from '../content/vocabularyGuide.json';

export const VOCAB_PATH = '/tcf-canada-vocabulary';

/* The file, as it is — read out of the PDF by the generator rather than typed
   here, so a guide that gains a page does not leave the reader ending on a
   404 and the contents list naming a page that moved. */
const TOTAL_PAGES = GUIDE.totalPages;
const FREE_PAGES = GUIDE.freePages;
const FIRST_GATED = Math.max(...FREE_PAGES) + 1;

const FAQ = [1, 2, 3, 4, 5].map((n) => ({ q: `vocab.faq${n}q`, a: `vocab.faq${n}a` }));

const PAGES = Array.from({ length: TOTAL_PAGES - 1 }, (_, i) => i + 2);

/* Which picture a page is, for this visitor.
   Free pages are the same file for everybody. The rest are the blurred copy,
   or — with an account — the API's sharp one. */
function pageSrc(number, signedIn) {
  if (FREE_PAGES.includes(number)) return `/tcf-vocabulary/page-${number}.webp`;
  return signedIn
    ? `/api/downloads/tcf-vocabulary/pages/${number}`
    : `/tcf-vocabulary/blur-${number}.webp`;
}

/* One table of the guide, as a table.
   Not a grid of divs: these are rows of related values under a header, which
   is what a table is, and what lets a screen reader read "un métier — an
   occupation" as one thing rather than as two stray words. The first column
   is the French one in every table the guide has, so it is the one marked as
   French for a screen reader and for a translator. */
/* What turns a wide table into a stack of labelled lines on a phone.
   Four columns of French at 390px is four columns of about sixty pixels, in
   which "rapidement." is broken across two lines — legible in the sense that
   the characters are all present. The column heading comes back as the label
   through `data-label`, so nothing loses its name when the header row goes. */
const STACK_TABLE = 'max-sm:block';
const STACK_ROW = 'max-sm:mb-[10px] max-sm:block max-sm:rounded-xl max-sm:border max-sm:border-violet-100 max-sm:last:mb-0';
const STACK_CELL = 'max-sm:block max-sm:w-full max-sm:px-3 max-sm:pb-0 max-sm:pt-2 max-sm:before:mb-0.5 max-sm:before:block max-sm:before:text-[9px] max-sm:before:font-bold max-sm:before:uppercase max-sm:before:tracking-wider max-sm:before:text-gray-500 max-sm:before:content-[attr(data-label)]';

function GuideTable({ head, rows }) {
  /* Two columns fit a phone; more do not. Read off the table rather than
     configured, because the guide sets its own tables at two, three and four
     columns and this is rendering whatever it finds. */
  const wide = (head ? head.length : rows[0].length) > 2;
  return (
    <div className="mt-3 rounded-2xl border border-violet-100 max-sm:border-0">
      <table className={`w-full table-fixed border-collapse text-left ${wide ? STACK_TABLE : ''}`}>
        {head && (
          <thead className={wide ? 'max-sm:hidden' : ''}>
            <tr className="border-b border-violet-100 bg-violet-50 text-[10px] uppercase tracking-wider text-gray-600">
              {head.map((cell) => (
                <th key={cell} className="px-3 py-2 font-bold">{cell}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className={wide ? STACK_TABLE : ''}>
          {rows.map((row) => (
            <tr key={row.join('|')}
              className={`border-b border-violet-50 last:border-b-0 odd:bg-violet-50/30 ${wide ? `${STACK_ROW} max-sm:pb-2` : ''}`}>
              {row.map((cell, i) => (
                <td key={i} lang={i === 0 ? 'fr' : undefined}
                  data-label={head ? head[i] : undefined}
                  className={`break-words px-3 py-2 text-[13px] leading-snug ${wide ? STACK_CELL : ''} ${i === 0 ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* The guide's free pages, block by block, in its own order and its own words.
   Nothing here chooses what to say — the shapes are the shapes the generator
   found in the PDF, and this only decides what each one looks like. */
function GuideBlock({ block }) {
  if (block.type === 'table') return <GuideTable head={block.head} rows={block.rows} />;
  if (block.type === 'paragraph') {
    return <p className="mt-3 text-[14px] leading-relaxed text-gray-700">{block.text}</p>;
  }
  if (block.type === 'heading') {
    return <h4 className="mt-7 font-heading text-[15px] font-bold text-gray-900">{block.text}</h4>;
  }
  /* `title` and `section`: the two sizes the guide sets its own headings in.
     Both are h3 here, under the h2 of the section they sit in — the level is
     the page's outline, not the PDF's point size. */
  return (
    <h3 className={`font-heading font-extrabold text-gray-900 ${block.type === 'title' ? 'mt-8 text-xl' : 'mt-10 text-lg'}`}>
      {block.text}
    </h3>
  );
}

export default function VocabularyGuide() {
  const t = useT();
  const { user } = useAuth();
  const signedIn = Boolean(user);

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
         true because it is: the form asks for a name, not for money. */
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

  const download = (
    <a href={downloadPath()} download data-testid="vocab-download"
      className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
      <DownloadSimple size={18} weight="bold" /> {t('vocab.download')}
    </a>
  );

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
        <div className="relative mx-auto max-w-3xl px-4 pb-12 pt-10 text-center sm:px-6">
          <nav aria-label="Breadcrumb" className="mb-4 text-left text-xs font-semibold text-gray-500">
            <Link to="/resources" className="hover:text-primary">{t('nav.resources')}</Link>
            <span className="px-1.5 text-gray-400">/</span>
            <span className="text-gray-700">{t('vocab.h1')}</span>
          </nav>
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Sparkle size={14} weight="fill" /> {t('vocab.badge')}
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            {t('vocab.h1')}{' '}
            <span lang="fr" className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">
              {t('vocab.h1fr')}
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-gray-700">
            {t('vocab.heroSub')}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {signedIn ? download : (
              <Link to="/register" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
                <FilePdf size={18} weight="fill" /> {t('vocab.getFree')}
              </Link>
            )}
            <a href="#pages" className="btn-outline">{t('vocab.jumpPages')}</a>
          </div>
          {/* What it is, in the three numbers somebody scans for. */}
          <dl className="mx-auto mt-7 grid max-w-lg grid-cols-3 gap-3 text-center">
            {[[TOTAL_PAGES, t('vocab.statPages')], [GUIDE.themes.length, t('vocab.statThemes')],
              ['B2', t('vocab.statLevel')]].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-violet-200 bg-white/80 px-3 py-3">
                  <dt className="font-heading text-xl font-extrabold text-primary">{value}</dt>
                  <dd className="mt-0.5 text-[11px] leading-tight text-gray-600">{label}</dd>
                </div>
              ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* THE CONTENTS --------------------------------------------------- */}
        <h2 className="font-heading text-2xl font-extrabold text-gray-900">
          {t('vocab.themesTitle')}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{t('vocab.themesNote')}</p>
        {/* The guide's own theme headings, spelled as it spells them, with
            the page each one opens on. "Does it cover housing?" is the
            question somebody asks before downloading anything, and a picture
            of a page cannot answer it. */}
        <ol className="mt-4 divide-y divide-violet-100 rounded-2xl border border-violet-100">
          {GUIDE.themes.map((theme) => (
            <li key={theme.title} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5">
              <span className="font-heading text-sm font-bold text-gray-900">{theme.title}</span>
              <span className="ml-auto whitespace-nowrap text-[11px] font-semibold text-primary">
                {t('vocab.fromPage', { n: theme.page })}
              </span>
            </li>
          ))}
        </ol>

        {/* THE FREE PAGES, AS TEXT ---------------------------------------- */}
        <h2 className="mt-12 font-heading text-2xl font-extrabold text-gray-900">
          {t('vocab.textTitle', { from: FREE_PAGES[0], to: FREE_PAGES[FREE_PAGES.length - 1] })}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{t('vocab.textIntro')}</p>
        {/* Every heading, sentence and cell below is the guide's, in its
            order and its wording — see backend/tools/lead_pdf_preview.py.
            Nothing is summarised and nothing is added. */}
        <div data-testid="vocab-text">
          {GUIDE.blocks.map((block, i) => (
            <GuideBlock key={i} block={block} />
          ))}
        </div>
        <p className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/50 px-4 py-3 text-[13px] leading-relaxed text-gray-700">
          {t('vocab.textEnds', { page: FREE_PAGES[FREE_PAGES.length - 1] })}
        </p>

        {/* THE READER ------------------------------------------------------ */}
        <h2 id="pages" className="mt-12 scroll-mt-20 font-heading text-2xl font-extrabold text-gray-900">
          {t('vocab.readTitle')}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
          {signedIn ? t('vocab.readIntroIn') : t('vocab.readIntroOut')}
        </p>
        {signedIn && <div className="mt-4">{download}</div>}

        <div className="mt-6 space-y-4" data-testid="vocab-reader">
          {PAGES.map((number) => {
            const locked = !signedIn && number >= FIRST_GATED;
            return (
              <figure key={number} className="relative overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
                <img
                  src={pageSrc(number, signedIn)}
                  /* The alt text names the page and what is on it rather than
                     repeating the title 24 times, which is what an image
                     carrying no information should say. */
                  alt={t('vocab.pageAlt', { n: number, total: TOTAL_PAGES })}
                  width="900" height="1165"
                  /* Only the first is worth fetching before it is scrolled
                     to; the rest are 24 more pictures on a page somebody may
                     never scroll. */
                  loading={number === 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  className="block w-full"
                />
                <figcaption className="border-t border-gray-100 bg-white px-4 py-2 text-[11px] font-semibold text-gray-500">
                  {t('vocab.pageCaption', { n: number, total: TOTAL_PAGES })}
                </figcaption>
                {/* The offer, over the first page nobody can read, and only
                    there: the same panel over all twenty-one would be a wall
                    rather than an invitation. */}
                {locked && number === FIRST_GATED && (
                  <div className="absolute inset-0 grid place-items-center bg-white/70 px-6 text-center backdrop-blur-[2px]">
                    <div>
                      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-white shadow-lg">
                        <Lock size={22} weight="fill" />
                      </span>
                      <p className="mt-3 font-heading text-lg font-extrabold text-gray-900">
                        {t('vocab.lockedTitle', { from: FIRST_GATED, to: TOTAL_PAGES })}
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-[13px] leading-snug text-gray-700">
                        {t('vocab.lockedBody')}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <Link to="/register" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !py-2.5 text-sm">
                          {t('vocab.lockedCta')} <ArrowRight size={15} weight="bold" />
                        </Link>
                        <Link to="/login" className="btn-outline !py-2.5 text-sm">{t('vocab.lockedLogin')}</Link>
                      </div>
                    </div>
                  </div>
                )}
              </figure>
            );
          })}
        </div>

        {/* FAQ -------------------------------------------------------------- */}
        <h2 id="faq" className="mt-12 scroll-mt-20 font-heading text-2xl font-extrabold text-gray-900">
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
            <Link to="/speaking" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
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
