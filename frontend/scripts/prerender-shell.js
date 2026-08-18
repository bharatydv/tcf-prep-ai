/* Prerender housekeeping, run either side of react-snap.
 *
 *   node scripts/prerender-shell.js save    (before react-snap)
 *   node scripts/prerender-shell.js prune   (after react-snap)
 *
 * Why both halves are needed:
 *
 * react-snap replaces build/index.html with the *prerendered homepage*. That
 * file is also the SPA fallback, so without `save` every unmatched URL — a
 * correction at /feedback/<id>, a blog post added after the build — would
 * serve the landing page's markup and flash it before hydration. `save` keeps
 * a pristine copy first, and nginx falls back to that instead.
 *
 * react-snap has no exclude option, so it also writes files for routes behind
 * ProtectedRoute. Those redirect to /login during the crawl, which baked a
 * login form into build/dashboard/index.html: a signed-in learner hard-loading
 * their dashboard would have seen a login page until React took over. `prune`
 * deletes them, and the pristine shell takes over for those paths.
 */
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const INDEX = path.join(BUILD, 'index.html');
const SHELL = path.join(BUILD, 'app-shell.html');

// Anything behind ProtectedRoute, plus the token-driven pages, whose content
// depends entirely on the signed-in user or a URL parameter.
const NOT_PRERENDERABLE = [
  'dashboard', 'review', 'check-writing', 'exam-simulator', 'admin',
  'forgot-password', 'reset-password', 'verify-email',
  path.join('practice', 'simulator'),
];

function save() {
  if (!fs.existsSync(INDEX)) {
    console.error('[prerender] no build/index.html — run the build first');
    process.exit(1);
  }
  fs.copyFileSync(INDEX, SHELL);
  console.log('[prerender] saved pristine shell -> build/app-shell.html');
}

function prune() {
  let removed = 0;
  for (const route of NOT_PRERENDERABLE) {
    const file = path.join(BUILD, route, 'index.html');
    if (!fs.existsSync(file)) continue;
    fs.rmSync(path.join(BUILD, route), { recursive: true, force: true });
    console.log('[prerender] pruned /' + route.split(path.sep).join('/'));
    removed += 1;
  }
  if (!fs.existsSync(SHELL)) {
    console.warn('[prerender] app-shell.html missing — did `save` run?');
  }
  console.log(`[prerender] pruned ${removed} signed-in route(s)`);
}

const mode = process.argv[2];
if (mode === 'save') save();
else if (mode === 'prune') prune();
else {
  console.error('usage: prerender-shell.js save|prune');
  process.exit(1);
}
