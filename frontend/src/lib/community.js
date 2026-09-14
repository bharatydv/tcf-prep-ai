/* The community group links, and whether there are any.
 *
 * The invite URLs are configuration, not code: a WhatsApp invite can be
 * revoked or rotated when a group is full or gets spammed, and a link baked
 * into the bundle would need a rebuild and a redeploy to change. They come
 * from the environment at build time and are read in exactly one place — here
 * — so nothing else has to know whether a group exists.
 *
 * Set them in frontend/.env.local (see .env.local.example):
 *   REACT_APP_WHATSAPP_URL=https://chat.whatsapp.com/XXXXXXXXXXXXXXX
 *   REACT_APP_TELEGRAM_URL=https://t.me/XXXXXXXXXXX
 *
 * Neither is required. With both unset, COMMUNITY_LINKS is empty and every
 * component that renders them renders nothing at all — no empty heading, no
 * dead button. That is deliberate: the feature has to be safe to ship before
 * the groups exist, and safe to switch off by clearing one variable.
 */

/* An invite must be an absolute https: URL.
 *
 * A misconfigured value is dropped rather than rendered. Pasting a group NAME
 * instead of its link is the obvious mistake here, and "https://" + a name is
 * a link to nowhere — better to show no button than one that 404s in front of
 * someone who just signed up. Checked with the URL parser rather than a regex
 * so a javascript: or data: value cannot reach an href.
 */
function clean(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
}

export const WHATSAPP_URL = clean(process.env.REACT_APP_WHATSAPP_URL);
export const TELEGRAM_URL = clean(process.env.REACT_APP_TELEGRAM_URL);

/* [{ id, url, labelKey }], in the order they should appear. `id` is what the
   click is reported as, so the two groups can be compared in analytics. */
export const COMMUNITY_LINKS = [
  { id: 'whatsapp', url: WHATSAPP_URL, labelKey: 'community.whatsapp' },
  { id: 'telegram', url: TELEGRAM_URL, labelKey: 'community.telegram' },
].filter((link) => link.url);

export const HAS_COMMUNITY = COMMUNITY_LINKS.length > 0;

export default COMMUNITY_LINKS;
