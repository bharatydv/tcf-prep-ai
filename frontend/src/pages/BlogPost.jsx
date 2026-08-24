import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarBlank, User } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { BackLink } from '../components/shared';
import { formatDate, useI18n } from '../i18n';
import { Seo, SITE_URL } from '../lib/seo';

/* Very small, safe markdown -> HTML for headings, bold, links, lists, paragraphs.
   If you write posts in HTML already, it passes through fine. */
/* An allowlist, applied to the HTML branch below.
 *
 * That branch used to return the stored markup verbatim into
 * dangerouslySetInnerHTML. Posts are admin-authored and the CSP is strict
 * enough that an injected <script>, an onerror= handler and a javascript: URL
 * are all blocked — but the CSP was then the ONLY thing standing between an
 * admin account and stored XSS on every public article, and one future
 * 'unsafe-inline' added for an unrelated reason would have removed it silently.
 *
 * Parsing happens in an inert document, so nothing runs and no image is
 * fetched while we inspect it. */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE', 'A', 'IMG', 'FIGURE', 'FIGCAPTION',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'DIV',
]);
const ALLOWED_ATTRS = { A: ['href', 'title'], IMG: ['src', 'alt', 'title'] };
// Removed WITH their contents. Everything else that is not allowed is
// unwrapped instead, so stripping a <section> does not take the paragraph
// inside it — but the text inside a <script> is not text anyone wants to read.
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED',
  'APPLET', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT',
  'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE',
]);
const SAFE_URL = /^(https?:|mailto:|\/|#)/i;

function sanitizeHtml(html) {
  if (typeof window === 'undefined' || !window.DOMParser) return '';
  const doc = new DOMParser().parseFromString(
    `<div id="__root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return '';

  /* Walks by index and deliberately does NOT advance after a removal or an
     unwrap: whatever now sits at that position has to be inspected in turn.
     Iterating a snapshot of the children instead let anything nested inside a
     disallowed element escape — `<section><img onerror=…>` unwrapped the
     section, moved the img up, and never looked at it again. */
  const walk = (node) => {
    let i = 0;
    while (i < node.childNodes.length) {
      const el = node.childNodes[i];
      if (el.nodeType === 8) { el.remove(); continue; }   // comment
      if (el.nodeType !== 1) { i += 1; continue; }        // text
      // Upper-cased, because tagName only comes back upper-case for HTML
      // elements: inside foreign content an <svg> reports 'svg' and the
      // <script> nested in it reports 'script', so a case-sensitive check
      // matched neither and unwrapped them both instead of dropping them.
      const tag = el.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) { el.remove(); continue; }
      if (!ALLOWED_TAGS.has(tag)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      const keep = ALLOWED_ATTRS[tag] || [];
      [...el.attributes].forEach(({ name, value }) => {
        const attr = name.toLowerCase();
        // Everything not explicitly allowed goes, which covers every on*
        // handler and style= without having to enumerate them.
        if (!keep.includes(attr)) { el.removeAttribute(name); return; }
        // An allowed href or src still has to point somewhere safe:
        // javascript: and data: are the two that turn a link into a script.
        if ((attr === 'href' || attr === 'src') && !SAFE_URL.test(value.trim())) {
          el.removeAttribute(name);
        }
      });
      if (tag === 'A' && el.getAttribute('href')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      walk(el);
      i += 1;
    }
  };
  walk(root);
  return root.innerHTML;
}

function renderContent(src) {
  if (!src) return '';
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(src);
  if (looksHtml) return sanitizeHtml(src);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = src.split(/\r?\n/);
  let html = '';
  let inList = false;
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (/^### /.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${esc(line.slice(4))}</h3>`; continue; }
    if (/^## /.test(line))  { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${esc(line.slice(3))}</h2>`; continue; }
    if (/^# /.test(line))   { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${esc(line.slice(2))}</h2>`; continue; }
    if (/^[-*] /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(esc(line.slice(2)))}</li>`; continue; }
    if (line === '') { if (inList) { html += '</ul>'; inList = false; } continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${inline(esc(line))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
}

export default function BlogPost() {
  const { t, lang } = useI18n();
  const { slug } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/blog/${slug}`)
      .then(({ data }) => setPost(data.post))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Metadata and Article markup for one post. The <Seo> component owns the
  // tags it sets, emits a canonical URL and Open Graph pair that this page
  // never had, and restores the shell's defaults when it unmounts.
  const articleSchema = useMemo(() => (post ? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description || post.excerpt || '',
    author: { '@type': 'Organization', name: post.author || 'prepfrancais' },
    publisher: {
      '@type': 'Organization',
      name: 'prepfrancais',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` },
    },
    datePublished: post.created_at,
    dateModified: post.updated_at || post.created_at,
    image: post.cover_image || `${SITE_URL}/og-image.png`,
    mainEntityOfPage: `${SITE_URL}/blog/${slug}`,
  } : null), [post, slug]);

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </main>
    );
  }

  if (notFound || !post) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-heading text-2xl font-bold text-gray-900">{t('blog.notFoundTitle')}</h1>
        <p className="mt-2 text-gray-600">{t('blog.notFoundBody')}</p>
        <button onClick={() => navigate('/blog')} className="btn-primary mt-6 !bg-gradient-to-r !from-primary !to-fuchsia-600">
          <ArrowLeft size={18} /> {t('blog.backToBlog')}
        </button>
      </main>
    );
  }

  return (
    <main className="overflow-x-clip bg-white">
      <Seo
        title={post.title}
        description={post.meta_description || post.excerpt || ''}
        path={`/blog/${slug}`}
        type="article"
        image={post.cover_image}
        jsonLd={articleSchema}
      />
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-10 sm:px-6">
          <BackLink to="/blog" label={t('blog.allArticles')} className="!mb-0" />
          <h1 className="mt-4 font-heading text-3xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-4xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1.5"><User size={15} /> {post.author || 'prepfrancais'}</span>
            <span className="flex items-center gap-1.5"><CalendarBlank size={15} /> {formatDate(post.created_at, lang)}</span>
            {Array.isArray(post.tags) && post.tags.map((tag) => (
              <span key={tag} className="pill bg-white/80 capitalize text-primary">{tag}</span>
            ))}
          </div>
        </div>
      </section>

      {/* COVER */}
      {post.cover_image && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {/* The hero image of the article: eager, high priority, and given a
              ratio so nothing below it shifts when it lands. */}
          <img src={post.cover_image} alt={post.title}
            width="1200" height="630" decoding="async" fetchPriority="high"
            style={{ aspectRatio: '1200 / 630' }}
            className="mt-8 w-full rounded-3xl object-cover shadow-xl shadow-violet-200/40" />
        </div>
      )}

      {/* BODY */}
      <article
        className="prose-blog mx-auto max-w-3xl px-4 py-12 sm:px-6"
        dangerouslySetInnerHTML={{ __html: renderContent(post.content) }}
      />

      {/* FOOTER CTA */}
      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <div className="rounded-3xl bg-gradient-to-r from-primary via-purple-600 to-fuchsia-600 p-8 text-center">
          <h2 className="font-heading text-2xl font-extrabold text-white">{t('blog.ctaTitle')}</h2>
          <p className="mt-2 text-sm text-violet-100/90">{t('blog.ctaBody')}</p>
          <Link to="/practice" className="btn-primary mt-5 !bg-white !text-primary hover:!brightness-100">
            {t('blog.ctaLink')}
          </Link>
        </div>
      </section>
    </main>
  );
}
