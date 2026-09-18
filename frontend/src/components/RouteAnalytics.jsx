/* GA4 pageviews for React Router navigations.
 *
 * gtag('config') in public/gtag-init.js sends exactly one page_view, on the
 * hard load, and then never hears about anything again: a SPA changes the URL
 * without the tag noticing, so every route after the first was invisible in
 * GA4 — /pricing, /practice, the exam pages, all of them folded into whatever
 * address the visitor happened to arrive on.
 *
 * Two things this must not do, which is most of why it exists as its own
 * component rather than a line inside ScrollToTop:
 *
 *   1. Double-count the hard load. The first render IS the page gtag('config')
 *      already reported, so it is skipped. Nothing here re-sends it, and
 *      nothing in gtag-init.js was changed to stop sending it — one pageview
 *      per page, from whichever of the two saw it first.
 *
 *   2. Report the previous page's title. document.title is set by an effect in
 *      lib/seo.jsx, inside the route that just mounted. This component sits
 *      above <Routes>, and React flushes effects depth-first, so at the moment
 *      this one runs the title still belongs to the page being left. Deferring
 *      to a macrotask lets the new route's Seo effect land first.
 *
 * It renders nothing and is mounted once, beside ScrollToTop, which watches
 * the same location for the same reason.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView, sanitizePath } from '../lib/analytics';

export default function RouteAnalytics() {
  const { pathname, search } = useLocation();
  // Not state: flipping it must not re-render, and it has to survive the
  // effect re-running without being part of what triggers it.
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    const path = sanitizePath(pathname, search);
    const timer = setTimeout(() => trackPageView({ path }), 0);
    // A navigation that lands and leaves inside one tick reported the page it
    // was already past; cancelling on unmount keeps the count honest.
    return () => clearTimeout(timer);
  }, [pathname, search]);

  return null;
}
