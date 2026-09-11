/* Google Analytics bootstrap, with Consent Mode v2.
 *
 * Served from this origin rather than written inline in index.html, because the
 * Content-Security-Policy has no 'unsafe-inline' in script-src — an inline
 * gtag() block is dropped silently and the dashboard stays at zero, which is
 * exactly the "data collection isn't active" symptom it is meant to fix.
 *
 * The gtag.js loader itself is a <script src> on googletagmanager.com, so that
 * host is named in script-src; the beacons it sends afterwards go to
 * google-analytics.com, which is why connect-src and img-src name it too. Miss
 * any one of the three and this fails without an error anyone will notice.
 *
 * ---------------------------------------------------------------------------
 * Consent
 * ---------------------------------------------------------------------------
 * Everything is DENIED until a visitor says otherwise, and the defaults are
 * set before gtag('config'), which is the only ordering that works: config is
 * what fires the first pageview, and a default arriving after it has already
 * written the _ga cookie is a cookie set without consent.
 *
 * This matters here more than it would elsewhere. Cloudflare Web Analytics was
 * chosen for this site precisely because it is cookieless and needs no banner,
 * and a large share of TCF Canada candidates sit the exam from France, Belgium
 * and North Africa — so an unconsented GA4 cookie undid the reasoning behind
 * the other analytics choice.
 *
 * `wait_for_update` holds the first beacon briefly so a returning visitor's
 * stored consent can be replayed before anything is sent, rather than
 * measuring them as a fresh denial and then correcting it.
 *
 * The banner that collects the answer is src/components/ConsentBanner.jsx.
 * The storage key is shared between the two files and must not drift.
 */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }

gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  // Not cookies in the consent sense: these cover things the site needs to
  // work at all and to not be abused, and denying them measures nothing.
  functionality_storage: 'granted',
  security_storage: 'granted',
  wait_for_update: 500,
});

/* A choice already made on a previous visit, replayed before the first
   pageview. Wrapped because localStorage throws outright in some privacy
   modes — and a storage error must not take the whole page's scripts down. */
try {
  if (window.localStorage.getItem('prepfrancais.consent') === 'granted') {
    gtag('consent', 'update', { analytics_storage: 'granted' });
  }
} catch (e) { /* no stored answer available; the denied defaults stand */ }

gtag('js', new Date());
/* URL passthrough keeps campaign attribution working for a visitor who has
   not consented to storage, without setting anything on their device. */
gtag('config', 'G-E829Q86M96', { url_passthrough: true });
