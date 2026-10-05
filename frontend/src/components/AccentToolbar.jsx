/* The accented characters a QWERTY keyboard will not give you.
 *
 * Its own file rather than one more export from shared.jsx, which reaches for
 * the router, the auth context and the API client the moment it is imported.
 * Nothing here needs any of that — it is a row of buttons over a text field —
 * and the review cards that use it are worth being able to mount on their own.
 *
 * On a phone it is one row that scrolls sideways and sticks under the header,
 * not three rows of 32px buttons that scroll away the moment the keyboard
 * opens. Seventeen 40px targets do not fit in 358px, and a toolbar you have to
 * scroll back up to is a toolbar nobody uses. Desktop keeps the wrapped grid.
 */
import { ACCENTS } from '../lib/api';

export function AccentToolbar({ textareaRef, onInsert }) {
  return (
    <div
      className="sticky top-16 z-20 -mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain rounded-xl border border-gray-200 bg-gray-50 p-2 [scrollbar-width:none] sm:static sm:mx-0 sm:flex-wrap sm:overflow-visible"
      data-testid="accent-toolbar"
    >
      {ACCENTS.map((c) => (
        <button key={c} type="button"
          className="h-10 w-10 shrink-0 rounded-lg bg-white text-base font-medium shadow-sm transition hover:bg-primary hover:text-white sm:h-8 sm:w-8 sm:text-sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const ta = textareaRef?.current;
            if (!ta) return onInsert?.(c);
            const start = ta.selectionStart ?? ta.value.length;
            const end = ta.selectionEnd ?? start;
            const next = ta.value.slice(0, start) + c + ta.value.slice(end);
            onInsert(c, next, start + c.length);
            requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + c.length, start + c.length); });
          }}>
          {c}
        </button>
      ))}
    </div>
  );
}
