/* The free vocabulary guide, as an article.
 *
 * It used to be a card on /resources with a link on it, which is the whole
 * resource reduced to its file name: nothing about it could be read without
 * first handing over a phone number, and nothing about it could be found,
 * because a PDF behind a form is a PDF no search engine has ever seen.
 *
 * So this page IS the guide — headings, paragraphs and tables, in the PDF's
 * order and the PDF's words, read out of the file by
 * backend/tools/lead_pdf_preview.py rather than retyped beside it. Nothing
 * here chooses what to say; the shapes are the shapes the generator found,
 * and this decides only what each one looks like. It reads the way a blog
 * post reads, because that is what a search engine, a screen reader and a
 * phone on a slow connection can all use — and a stack of page pictures is
 * what none of them can.
 *
 * WHAT IS BEHIND THE ACCOUNT, AND WHERE THE GATE IS
 * -------------------------------------------------
 * Pages 2 to 4 ship in the bundle, and are the part anybody may read. Pages
 * 5 to 24 are not in the bundle at all: they come from an API call that
 * answers 403 to somebody signed out, and this page never makes that call
 * for them. What a signed-out visitor sees past page 4 is a blurred picture
 * of the pages, blurred in the file rather than in CSS, and an invitation.
 *
 * That means the gate is not in this file. Nothing here decides what somebody
 * is allowed to see; it decides whether to ask, and the server decides the
 * rest. A signed-out visitor who edits this component still gets a 403.
 *
 * The cover, page 1, is not shown to anybody: it is branding, and a cover is
 * evidence of nothing. Page 25 is the copyright notice, and is not content.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  DownloadSimple, Lock, ArrowRight, BookOpen, Sparkle, CircleNotch,
} from '@phosphor-icons/react';
import { useT } from '../i18n';
import { Seo, SITE_URL } from '../lib/seo';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { downloadPath } from '../components/LeadMagnetModal';
import GUIDE from '../content/vocabularyGuide.json';

export const VOCAB_PATH = '/tcf-canada-vocabulary';

/* The file, as it is — read out of the PDF by the generator rather than typed
   here, so a guide that gains a page does not leave the contents list naming
   a page that moved. */
const TOTAL_PAGES = GUIDE.totalPages;
const FREE_PAGES = GUIDE.freePages;
const [, LAST_CONTENT] = GUIDE.contentPages;
const FIRST_GATED = Math.max(...FREE_PAGES) + 1;

/* How many blurred pages stand in for the locked part. Three is enough to
   say "there is a lot more of this"; twenty is a wall to scroll past. */
const TEASER_PAGES = [FIRST_GATED, FIRST_GATED + 1, FIRST_GATED + 2];

const FAQ = [1, 2, 3, 4, 5].map((n) => ({ q: `vocab.faq${n}q`, a: `vocab.faq${n}a` }));

/* The two halves put back together for somebody who may see both.
   A table that starts on page 4 and ends on page 5 was split by the
   generator along that line and its second half marked `continues`; here it
   goes back under the heading it belongs to, so the reader never sees a
   table start again with the same header six rows in. */
function joinContinuations(free, gated) {
  const all = free.map((block) => ({ ...block }));
  gated.forEach((block) => {
    const last = all[all.length - 1];
    if (block.continues && last && last.type === 'table') {
      last.rows = [...last.rows, ...block.rows];
    } else {
      all.push(block);
    }
  });
  return all;
}

/* What turns a wide table into a stack of labelled lines on a phone.
   Four columns of French at 390px is four columns of about sixty pixels, in
   which "rapidement." is broken across two lines — legible in the sense that
   the characters are all present. The column heading comes back as the label
   through `data-label`, so nothing loses its name when the header row goes. */
const STACK_TABLE = 'max-sm:block';
const STACK_ROW = 'max-sm:mb-[10px] max-sm:block max-sm:rounded-xl max-sm:border max-sm:border-violet-100 max-sm:last:mb-0';
const STACK_CELL = 'max-sm:block max-sm:w-full max-sm:px-3 max-sm:pb-0 max-sm:pt-2 max-sm:before:mb-0.5 max-sm:before:block max-sm:before:text-[9px] max-sm:before:font-bold max-sm:before:uppercase max-sm:before:tracking-wider max-sm:before:text-gray-500 max-sm:before:content-[attr(data-label)]';

/* One table of the guide, as a table.
   Not a grid of divs: these are rows of related values under a header, which
   is what a table is, and what lets a screen reader read "un métier — an
   occupation" as one thing rather than as two stray words. The first column
   is the French one in every table the guide has, so it is the one marked as
   French for a screen reader and for a translator. */
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

/* The guide, block by block, in its own order and its own words. */
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

/* Pages 5 to 24, for somebody signed in. Fetched rather than bundled — see
   the note at the top — and fetched once, when there is an account to fetch
   them for. */
function useGatedBlocks(signedIn) {
  const [state, setState] = useState({ blocks: null, error: false });
  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    api.get('/downloads/tcf-vocabulary/content')
      .then((r) => { if (alive) setState({ blocks: r.data.blocks || [], error: false }); })
      .catch(() => { if (alive) setState({ blocks: null, error: true }); });
    return () => { alive = false; };
  }, [signedIn]);
  return state;
}

export default function VocabularyGuide() {
  const t = useT();
  const location = useLocation();
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const gated = useGatedBlocks(signedIn);

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

  /* The same button for everybody. Signed in, it is the file. Signed out, it
     is the door to an account, with a word underneath saying so, and the
     page remembered so that somebody who makes the account lands back here
     rather than on the practice page wondering where the download went. */
  const primary = 'btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600';
  const back = { from: location };
  const download = signedIn ? (
    <a href={downloadPath()} download data-testid="vocab-download" className={primary}>
      <DownloadSimple size={18} weight="bold" /> {t('vocab.download')}
    </a>
  ) : (
    <span className="inline-flex flex-col items-center gap-1">
      <Link to="/register" state={back} data-testid="vocab-download-locked" className={primary}>
        <DownloadSimple size={18} weight="bold" /> {t('vocab.download')}
      </Link>
      <span className="text-[11px] font-semibold text-gray-500">{t('vocab.downloadNote')}</span>
    </span>
  );

  const blocks = signedIn && gated.blocks
    ? joinContinuations(GUIDE.blocks, gated.blocks)
    : GUIDE.blocks;

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
          <div className="mt-6 flex flex-wrap items-start justify-center gap-3">
            {download}
            <a href="#guide" className="btn-outline">{t('vocab.jump')}</a>
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
            question somebody asks before downloading anything. */}
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

        {/* THE GUIDE ------------------------------------------------------- */}
        <h2 id="guide" className="mt-12 scroll-mt-20 font-heading text-2xl font-extrabold text-gray-900">
          {t('vocab.guideTitle')}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
          {signedIn
            ? t('vocab.guideIntroIn')
            : t('vocab.guideIntroOut', { from: FREE_PAGES[0], to: FREE_PAGES[FREE_PAGES.length - 1] })}
        </p>
        {/* Every heading, sentence and cell below is the guide's, in its
            order and its wording. Nothing is summarised and nothing is added. */}
        <article data-testid="vocab-text">
          {blocks.map((block, i) => (
            <GuideBlock key={i} block={block} />
          ))}
        </article>

        {/* Signed in and still waiting, or signed in and the call failed. A
            page that silently stopped at page 4 for somebody with an account
            would look exactly like the page for somebody without one. */}
        {signedIn && !gated.blocks && (
          <p className="mt-6 flex items-center gap-2 text-[13px] font-semibold text-gray-500"
            data-testid="vocab-gated-state">
            {gated.error ? t('vocab.loadFail') : (
              <><CircleNotch size={16} className="animate-spin" /> {t('vocab.loading')}</>
            )}
          </p>
        )}

        {/* THE LOCKED PART, for everybody else ----------------------------- */}
        {!signedIn && (
          <div className="relative mt-8" data-testid="vocab-locked">
            {/* Three real pages, blurred in the file, laid one over the next so
                the depth of what follows is visible without twenty pictures.
                Never the text: the text past page 4 is not on this page for
                somebody signed out, and no CSS could make it so. */}
            <div className="relative h-[26rem] overflow-hidden rounded-2xl border border-gray-200">
              {TEASER_PAGES.map((n, i) => (
                <img key={n} src={`/tcf-vocabulary/blur-${n}.webp`}
                  alt={t('vocab.pageAlt', { n, total: TOTAL_PAGES })}
                  width="380" height="492" loading="lazy" decoding="async"
                  className="absolute left-1/2 w-[80%] -translate-x-1/2 rounded-lg border border-gray-200 bg-white shadow-md"
                  style={{ top: `${i * 2.5}rem`, zIndex: 3 - i, opacity: 1 - i * 0.18 }} />
              ))}
              <div className="absolute inset-0 z-10 grid place-items-center bg-gradient-to-b from-white/30 via-white/75 to-white px-6 text-center">
                <div>
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-white shadow-lg">
                    <Lock size={22} weight="fill" />
                  </span>
                  <p className="mt-3 font-heading text-lg font-extrabold text-gray-900">
                    {t('vocab.lockedTitle', { from: FIRST_GATED, to: LAST_CONTENT })}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] leading-snug text-gray-700">
                    {t('vocab.lockedBody', GUIDE.gated)}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Link to="/register" state={back} className={`${primary} !py-2.5 text-sm`}>
                      {t('vocab.lockedCta')} <ArrowRight size={15} weight="bold" />
                    </Link>
                    <Link to="/login" state={back} className="btn-outline !py-2.5 text-sm">
                      {t('vocab.lockedLogin')}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

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
