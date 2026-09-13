/* The accented characters a QWERTY keyboard will not give you.
 *
 * Its own file rather than one more export from shared.jsx, which reaches for
 * the router, the auth context and the API client the moment it is imported.
 * Nothing here needs any of that — it is a row of buttons over a text field —
 * and the review cards that use it are worth being able to mount on their own.
 */
import { ACCENTS } from '../lib/api';

export function AccentToolbar({ textareaRef, onInsert }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-gray-200 bg-gray-50 p-2" data-testid="accent-toolbar">
      {ACCENTS.map((c) => (
        <button key={c} type="button"
          className="h-8 w-8 rounded-lg bg-white text-sm font-medium shadow-sm transition hover:bg-primary hover:text-white"
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
