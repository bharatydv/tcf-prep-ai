/* The dashboard's result rows, mounted.
 *
 * The point of this file existing is that writing and speaking now go through
 * one component: a test that passes for one skill and fails for the other
 * would mean the two had drifted apart again, which is exactly the bug these
 * rows were written to end.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import { ResultRow, ResultSection, taskLine } from './resultRows';

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (ui) => act(() => root.render(<I18nProvider>{ui}</I18nProvider>));

describe('ResultRow', () => {
  it('prints the mark out of 20 and the band, never the grader 0-100', () => {
    mount(<ResultRow skill="writing" href="/x" testid="row"
      badge="3" title="Writing test" meta="2026-10-01"
      mark={12} band="8" complete />);
    const row = host.querySelector('[data-testid="row"]');
    expect(row.textContent).toContain('12/20');
    expect(row.textContent).toContain('CLB 8');
    expect(row.textContent).not.toContain('62');
  });

  it('shows an em dash rather than a confident zero when nothing was marked', () => {
    mount(<ResultRow skill="speaking" href="/x" testid="row"
      badge="1" title="Tâche 1" meta="today" mark={null} band={null} />);
    expect(host.querySelector('[data-testid="row"]').textContent).toContain('—/20');
  });

  /* A paper two tâches into three has no result for the skill yet, and a mark
     averaged over the two that happen to be done would read as though it
     did. */
  it('replaces the mark with the pending badge on an unfinished paper', () => {
    mount(<ResultRow skill="speaking" href="/x" testid="row"
      badge="2" title="Speaking test" meta="today"
      mark={14} band="9" pending="2 of 3 tâches" />);
    const row = host.querySelector('[data-testid="row"]');
    expect(row.textContent).toContain('2 of 3 tâches');
    expect(row.textContent).not.toContain('14/20');
    expect(row.textContent).not.toContain('CLB 9');
  });

  /* Both skills render the same element with the same parts; only the hue
     differs. If one of these ever stops matching the other, the two sections
     have diverged again. */
  it('reads identically for writing and for speaking', () => {
    const props = {
      href: '/x', testid: 'row', badge: '2', title: 'Paper',
      meta: 'meta', mark: 11, band: '7', complete: true,
    };
    /* Read into plain strings before the second render, not held as DOM
       handles: React reuses the same element for the same position, so a
       handle taken from the first render is the SECOND render's node by the
       time it is read, and every comparison below would pass trivially. */
    mount(<ResultRow {...props} skill="speaking" />);
    const spoken = host.querySelector('[data-testid="row"]');
    const spokenText = spoken.textContent;
    const spokenShape = spoken.querySelectorAll('span').length;
    const spokenClass = spoken.className;

    mount(<ResultRow {...props} skill="writing" />);
    const written = host.querySelector('[data-testid="row"]');
    expect(written.textContent).toBe(spokenText);
    expect(written.querySelectorAll('span').length).toBe(spokenShape);
    // The tint is the one thing that is allowed to differ.
    expect(written.className).not.toBe(spokenClass);
  });

  it('puts the link on `href` for an anchor and `to` for a router link', () => {
    mount(<ResultRow skill="writing" href="/practice/simulator?attempt=a1"
      testid="row" badge="1" title="p" meta="m" mark={9} band="6" />);
    expect(host.querySelector('[data-testid="row"]').getAttribute('href'))
      .toBe('/practice/simulator?attempt=a1');
    expect(host.querySelector('[data-testid="row"]').getAttribute('to')).toBeNull();
  });
});

describe('ResultSection', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => (
    <ResultRow key={i} skill="writing" href="/x" testid={`r${i}`}
      badge={`${i}`} title={`row ${i}`} meta="m" mark={10} band="7" />
  ));

  it('renders nothing at all when there is nothing to show', () => {
    mount(<ResultSection testid="sec" title="Writing tests" rows={[]} />);
    expect(host.querySelector('[data-testid="sec"]')).toBeNull();
  });

  /* Marking is in flight: there are no rows yet and the card still has to
     appear, because the notice is the whole message. */
  it('renders for a notice with no rows', () => {
    mount(<ResultSection testid="sec" title="Speaking tests" rows={[]}
      notice={<p data-testid="notice">being marked</p>} />);
    expect(host.querySelector('[data-testid="sec"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="notice"]')).not.toBeNull();
  });

  it('shows the newest five and opens the rest on request', () => {
    mount(<ResultSection testid="sec" title="Writing practice" rows={rows(8)} />);
    expect(host.querySelectorAll('[data-testid^="r"]').length).toBe(5);
    const more = host.querySelector('[data-testid="sec-more"]');
    expect(more.textContent).toContain('3');
    act(() => more.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelectorAll('[data-testid^="r"]').length).toBe(8);
    expect(host.querySelector('[data-testid="sec-more"]')).toBeNull();
  });

  it('leaves the toggle off when everything already fits', () => {
    mount(<ResultSection testid="sec" title="Writing tests" rows={rows(3)} />);
    expect(host.querySelector('[data-testid="sec-more"]')).toBeNull();
  });
});

describe('taskLine', () => {
  /* Three tâches always occupy three slots, so a paper missing its middle one
     is readable as exactly that rather than as a two-tâche paper. */
  it('holds a slot for a tâche that was never answered', () => {
    const t = (key, vars) => (key === 'hist.tache' ? `T${vars.n}` : key);
    mount(<p data-testid="line">{taskLine(t, { 1: { tcf_level: 'B2' }, 3: { tcf_level: 'B1' } })}</p>);
    const text = host.querySelector('[data-testid="line"]').textContent;
    expect(text).toContain('T1 B2');
    expect(text).toContain('T2 —');
    expect(text).toContain('T3 B1');
  });
});
