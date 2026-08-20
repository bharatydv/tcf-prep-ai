/* One-time rename of the localStorage namespace, monfrancais.* -> prepfrancais.*
 *
 * The keys carry the brand name, so the rebrand would have orphaned everything
 * already in a returning visitor's browser: their interface language, the
 * dismissed-state of the verify-email banner, the anonymous-session marker, and
 * — the one that actually costs someone work — a half-finished exam-simulator
 * draft, which is the whole reason that key exists.
 *
 * Runs once at boot, before anything reads a key. Old names are copied only
 * when the new name is absent, so a second run can never clobber fresher data,
 * and the old key is removed either way.
 */
const OLD_PREFIX = 'monfrancais.';
const NEW_PREFIX = 'prepfrancais.';

export default function migrateStorageKeys() {
  if (typeof localStorage === 'undefined') return;
  try {
    const stale = Object.keys(localStorage).filter((k) => k.startsWith(OLD_PREFIX));
    stale.forEach((oldKey) => {
      const newKey = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
      localStorage.removeItem(oldKey);
    });
  } catch {
    /* Storage blocked (private mode). Nothing was persisted, so nothing is lost. */
  }
}
