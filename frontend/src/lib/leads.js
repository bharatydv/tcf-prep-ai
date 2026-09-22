/* The free vocabulary PDF: what the offer is, and what the browser remembers
 * about it.
 *
 * Split out of LeadMagnetModal because the offer is now made in two places —
 * the exit dialog and the guide page's own hero — and both have to agree on
 * the slug, on the download URL and on whether this visitor has already
 * given their number. Two copies of "have they answered yet?" is how one of
 * them ends up asking somebody for what they handed over last week.
 *
 * Everything here is storage and strings. The form itself is LeadCaptureForm.
 */

/* The resource this offer is for. One slug, matching backend DOWNLOADS. */
export const LEAD_RESOURCE = 'tcf-vocabulary';

export const CAPTURED_KEY = 'prepfrancais.leadCaptured';
export const DISMISSED_KEY = 'prepfrancais.leadDismissed';
export const SOURCE_KEY = 'prepfrancais.leadSource';

/* How long a closed dialog stays closed. */
export const DISMISSED_FOR_MS = 24 * 60 * 60 * 1000;

export function stored(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function remember(key) {
  try { window.localStorage.setItem(key, '1'); } catch { /* private mode */ }
}

/* The moment it was closed, so that the day can be counted from it. */
export function rememberDismissed() {
  try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); }
  catch { /* private mode */ }
}

/* Closed less than a day ago. The value used to be a bare '1' — meaning
   "ever" — and a browser still carrying one is read as closed today rather
   than as never closed, so the change does not open the dialog on everybody
   who had already said no. */
export function recentlyDismissed() {
  const raw = stored(DISMISSED_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at) || at < DISMISSED_FOR_MS) return true;
  return Date.now() - at < DISMISSED_FOR_MS;
}

export function rememberSource(value) {
  try { window.sessionStorage.setItem(SOURCE_KEY, value); } catch { /* ditto */ }
}

/* Where the offer was made, for the lead record. */
export function lastSource() {
  try { return window.sessionStorage.getItem(SOURCE_KEY) || 'exit_intent'; }
  catch { return 'exit_intent'; }
}

export function alreadyCaptured() {
  return stored(CAPTURED_KEY) === '1';
}

/* The signed-in path. Serves anybody with an account; refuses everybody else,
   which is why the form exists at all. */
export function downloadPath(resource = LEAD_RESOURCE) {
  return `/api/downloads/${resource}`;
}

/* Start the download without leaving the page. A plain <a download> click
   rather than fetch+blob, so the browser's own download UI handles it and a
   3 MB PDF never sits in a tab's memory. */
export function startDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
