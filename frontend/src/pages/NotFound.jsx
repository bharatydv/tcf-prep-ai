/* A real 404.
 *
 * Every unmatched URL used to redirect to the landing page. That is a soft 404:
 * search engines index the homepage under a dozen wrong addresses, and — the
 * expensive part — it hides broken internal links from us. Four dead routes
 * (/methodology, /faq and the two listening ones) shipped that way and were
 * only found by reading the router, because each one silently looked like a
 * visit to the homepage.
 *
 * noindex, and it offers the four places people are actually trying to reach.
 */
import { Link, useLocation } from 'react-router-dom';
import { Compass } from '@phosphor-icons/react';
import { useT } from '../i18n';
import { useSeo } from '../lib/seo';

export default function NotFound() {
  const t = useT();
  const { pathname } = useLocation();
  useSeo({ titleKey: 'notFound.title', descKey: 'notFound.body', noindex: true });

  const links = [
    ['/practice', 'nav.writing'],
    ['/speaking', 'nav.speaking'],
    ['/reading', 'nav.reading'],
    ['/resources', 'nav.resources'],
  ];

  return (
    <main className="mx-auto flex min-h-[62vh] max-w-2xl items-center px-4 py-12 sm:px-6">
      <div className="w-full overflow-hidden rounded-3xl border border-violet-100 bg-white text-center shadow-soft">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary to-fuchsia-500" />
        <div className="px-6 py-12">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-violet-100 text-primary">
            <Compass size={30} weight="duotone" />
          </span>
          <p className="mt-5 font-heading text-5xl font-extrabold text-primary">404</p>
          <h1 className="mt-2 font-heading text-2xl font-extrabold text-gray-900">
            {t('notFound.title')}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
            {t('notFound.body')}
          </p>
          {/* The address itself, so a mistyped or out-of-date link is
              recognisable — and quotable in a support message. */}
          <p className="mt-3 break-all font-mono text-xs text-gray-400">{pathname}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            <Link to="/" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
              {t('notFound.home')}
            </Link>
            {links.map(([to, key]) => (
              <Link key={to} to={to} className="btn-outline">{t(key)}</Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
