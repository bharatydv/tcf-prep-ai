/* Google Analytics bootstrap.
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
 */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-E829Q86M96');
