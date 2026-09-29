/* The roleplay must hand the grader every word the candidate said.
 *
 * A turn only becomes a turn at a pause, so the words of the turn still being
 * heard when the tâche ended were thrown away — in a two-minute tâche 1 that
 * is most of the answer — and the words the recogniser settles as it stops
 * were dropped after every pause. The transcript, the corrected version and
 * the stronger version are all built from what reaches the grader, so all
 * three came back short.
 *
 * The browser's recogniser is replaced by a fake that behaves like Chrome's:
 * results arrive as final or interim, and stop() settles the interim words
 * as a final result before it reports the end.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';

jest.mock('../lib/api', () => ({
  api: { post: jest.fn() },
  errMsg: (e, fallback) => fallback,
}));

class FakeRecognition {
  constructor() {
    FakeRecognition.last = this;
    this.pending = '';
  }

  start() { setTimeout(() => this.onstart?.(), 0); }

  // One recogniser event: some words settled, some still being decided.
  hear(settled, guessing = '') {
    const results = [];
    if (settled) results.push(Object.assign([{ transcript: settled }], { isFinal: true }));
    if (guessing) results.push(Object.assign([{ transcript: guessing }], { isFinal: false }));
    this.pending = guessing;
    this.onresult?.({ resultIndex: 0, results });
  }

  stop() {
    setTimeout(() => {
      if (this.pending) {
        const settled = this.pending;
        this.pending = '';
        this.onresult?.({ resultIndex: 0,
          results: [Object.assign([{ transcript: settled }], { isFinal: true })] });
      }
      this.onend?.();
    }, 30);
  }

  abort() { this.pending = ''; }
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let api;
let ConversationModal;

beforeAll(() => {
  window.webkitSpeechRecognition = FakeRecognition;
  // jsdom has no scrolling; the dialogue scrolls to its newest line.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
  });
  // Required, not imported: the recogniser is read once when the module loads.
  api = require('../lib/api').api;
  ConversationModal = require('./ConversationModal').default;
});

// Set per test: the runner resets every mock's implementation before each one.
beforeEach(() => { api.post.mockImplementation(() => Promise.resolve({ data: {} })); });

async function openTache1(mode = 'tache1') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSubmitted = jest.fn();
  act(() => {
    root.render(
      <I18nProvider>
        <ConversationModal mode={mode} tacheTitle="Tâche 1" consigne="Présentez-vous."
          examSet={23} onCancel={() => {}} onSubmitted={onSubmitted} />
      </I18nProvider>,
    );
  });
  const button = (label) => [...host.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === label);
  await act(async () => { button('Start speaking').click(); await sleep(60); });
  return {
    host,
    finish: () => act(async () => { button('Finish').click(); await sleep(150); }),
    unmount: () => act(() => root.unmount()),
  };
}

const graded = () => {
  const call = api.post.mock.calls.find(([url]) => url === '/api/speaking/converse/grade');
  return call && call[1];
};
const candidateLines = (body) => body.history
  .filter((t) => t.role === 'candidate').map((t) => t.text);

describe('the roleplay transcript', () => {
  it('keeps the words of a turn still being spoken when the tâche ends', async () => {
    const modal = await openTache1();
    act(() => {
      FakeRecognition.last.hear("Je m'appelle Anna ", "et j'habite à Toronto depuis deux ans");
    });
    await modal.finish();
    const body = graded();
    expect(body).toBeTruthy();
    expect(body.exam_set).toBe(23);
    expect(candidateLines(body))
      .toEqual(["Je m'appelle Anna et j'habite à Toronto depuis deux ans"]);
    modal.unmount();
  });

  it('keeps the words the recogniser settles as a pause ends the turn', async () => {
    const modal = await openTache1();
    act(() => { FakeRecognition.last.hear('Je suis ingénieure ', 'dans une banque'); });
    // The pause: past the silence window, the turn is stopped and handed over.
    await act(async () => { await sleep(2300); });
    const second = FakeRecognition.last;
    act(() => { second.hear("J'aime le sport."); });
    await modal.finish();
    expect(candidateLines(graded()))
      .toEqual(['Je suis ingénieure dans une banque', "J'aime le sport."]);
    modal.unmount();
  }, 10000);

  it('sends what was already said when nothing is in progress', async () => {
    const modal = await openTache1();
    await modal.finish();
    expect(candidateLines(graded())).toEqual([]);
    modal.unmount();
  });
});

/* The candidate's voice, recorded for the whole tâche.
 *
 * A fake MediaRecorder that logs what the modal asks of it. The recording must
 * start paused, run only on the candidate's turn, and reach the server with
 * the answer — the server keeps it and times every word in it, which is what
 * lets a correction play the candidate's own voice.
 */
class FakeMediaRecorder {
  static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }

  constructor(stream, options) {
    this.state = 'inactive';
    this.mimeType = (options && options.mimeType) || 'audio/webm';
    this.log = [];
    FakeMediaRecorder.made.push(this);
  }

  start() { this.state = 'recording'; this.log.push('start'); }

  pause() { this.state = 'paused'; this.log.push('pause'); }

  resume() { this.state = 'recording'; this.log.push('resume'); }

  stop() {
    this.state = 'inactive';
    this.log.push('stop');
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
      this.onstop?.();
    }, 0);
  }
}

describe('the recording', () => {
  beforeEach(() => {
    FakeMediaRecorder.made = [];
    window.MediaRecorder = FakeMediaRecorder;
  });
  afterEach(() => { delete window.MediaRecorder; });

  const session = () => FakeMediaRecorder.made[0];

  it('is sent with a tâche 1 answer, recorded only while the candidate speaks', async () => {
    const modal = await openTache1();
    // Opened at the press and paused straight away; resumed for the answer.
    expect(session().log.slice(0, 3)).toEqual(['start', 'pause', 'resume']);
    act(() => { FakeRecognition.last.hear("Je m'appelle Anna ", 'et je suis ingénieure'); });
    await modal.finish();
    await act(async () => { await sleep(30); });

    expect(session().log[session().log.length - 1]).toBe('stop');
    const call = api.post.mock.calls.find(([url]) => url === '/api/speaking/converse/grade-audio');
    expect(call).toBeTruthy();
    const form = call[1];
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(form.get('mime_type')).toBe('audio/webm');
    const payload = JSON.parse(form.get('payload'));
    expect(payload.mode).toBe('tache1');
    expect(payload.exam_set).toBe(23);
    expect(payload.history.filter((t) => t.role === 'candidate').map((t) => t.text))
      .toEqual(["Je m'appelle Anna et je suis ingénieure"]);
    // The text-only route is not used as well.
    expect(api.post.mock.calls.some(([url]) => url === '/api/speaking/converse/grade')).toBe(false);
    modal.unmount();
  });

  it("pauses while the examiner answers, so only the candidate's voice is kept", async () => {
    // The examiner takes a moment to answer, as it does over a network.
    api.post.mockImplementation((url) => new Promise((resolve) => {
      setTimeout(() => resolve(
        { data: url === '/api/speaking/converse' ? { reply: 'Très bien, continuez.' } : {} }), 100);
    }));
    const before = FakeRecognition.last;
    const modal = await openTache1('free');
    // The examiner opens the scene first; the candidate's turn starts after.
    await act(async () => { await sleep(300); });
    expect(FakeRecognition.last).not.toBe(before);
    act(() => { FakeRecognition.last.hear("J'aimerais parler de mon travail."); });
    // The pause ends the turn; the examiner then thinks and speaks. Advanced
    // in short steps: inside one long act() React commits only the final
    // state, and the examiner's turn would never be on screen at all.
    for (let i = 0; i < 90; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await sleep(30); });
    }
    const log = session().log;
    const firstResume = log.indexOf('resume');
    expect(firstResume).toBeGreaterThan(-1);
    expect(log.indexOf('pause', firstResume)).toBeGreaterThan(firstResume);
    // And the candidate's next turn records again.
    expect(log.lastIndexOf('resume')).toBeGreaterThan(log.indexOf('pause', firstResume));
    await modal.finish();
    modal.unmount();
  }, 10000);
});

/* Tâche 2: one turn, one request.
 *
 * The candidate drives the turn here — press to switch the microphone on,
 * press again to switch it off — and what used to follow was two round trips
 * in a row: the audio to be transcribed, then the dialogue to be answered,
 * with the examiner silent through both. /api/speaking/turn/reply does both
 * in one, so the old transcription endpoint must not be called on this path
 * at all.
 */
describe('a tâche 2 turn', () => {
  beforeEach(() => {
    FakeMediaRecorder.made = [];
    window.MediaRecorder = FakeMediaRecorder;
  });
  afterEach(() => { delete window.MediaRecorder; });

  const openTache2 = async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider>
          <ConversationModal mode="tache2" tacheTitle="Tâche 2"
            consigne="Vous téléphonez à un hôtel." onCancel={() => {}} onGraded={() => {}} />
        </I18nProvider>,
      );
    });
    const button = (label) => [...host.querySelectorAll('button')]
      .find((b) => b.textContent.includes(label));
    await act(async () => { button('Start preparation').click(); await sleep(30); });
    await act(async () => { button('Start the conversation').click(); await sleep(400); });
    return { host, button, unmount: () => act(() => root.unmount()) };
  };

  it('asks for the words and the reply together', async () => {
    api.post.mockImplementation((url) => Promise.resolve({
      data: url === '/api/speaking/turn/reply'
        ? { text: 'Bonjour, vous avez des chambres libres ?', reply: 'Oui, pour quelle date ?' }
        : { reply: 'Bonjour, je vous écoute.' },
    }));
    const modal = await openTache2();

    // The microphone is off, and the button says so before it is pressed.
    const off = modal.host.querySelector('[data-testid="conv-start-speaking"]');
    expect(off).toBeTruthy();
    expect(off.textContent).toContain('Mic off');
    expect(off.getAttribute('aria-pressed')).toBe('false');

    await act(async () => { off.click(); await sleep(30); });
    const on = modal.host.querySelector('[data-testid="conv-stop-speaking"]');
    expect(on).toBeTruthy();
    expect(on.textContent).toContain('Mic on');
    expect(on.getAttribute('aria-pressed')).toBe('true');

    await act(async () => { on.click(); await sleep(200); });
    const turn = api.post.mock.calls.find(([url]) => url === '/api/speaking/turn/reply');
    expect(turn).toBeTruthy();
    const payload = JSON.parse(turn[1].get('payload'));
    expect(payload.mode).toBe('tache2');
    expect(payload.consigne).toBe('Vous téléphonez à un hôtel.');
    expect(turn[1].get('audio')).toBeInstanceOf(Blob);
    // Neither of the two calls it replaces is made as well.
    expect(api.post.mock.calls.some(([url]) => url === '/api/speaking/turn/transcribe')).toBe(false);
    expect(api.post.mock.calls.filter(([url]) => url === '/api/speaking/converse').length).toBe(1);
    modal.unmount();
  }, 10000);
});

/* The examiner's voice must be off before the microphone is on.
 *
 * A fake speech engine whose voice keeps coming out of the speakers after
 * each utterance reports that it ended — which is what a slow voice, or an
 * end event that fires early, looks like from the page. The microphone used
 * to open on the end event and heard the examiner's last words as the
 * candidate's.
 */
describe("the examiner's voice", () => {
  let synth;
  beforeEach(() => {
    synth = {
      speaking: false,
      pending: false,
      speak(u) { this.speaking = true; setTimeout(() => u.onend && u.onend(), 5); },
      cancel() { this.speaking = false; },
      resume() {},
      getVoices() { return []; },
    };
    window.speechSynthesis = synth;
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
  });
  afterEach(() => {
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
  });

  it('is finished before the microphone opens, echo tail included', async () => {
    const before = FakeRecognition.last;
    const modal = await openTache1();
    // Every utterance has reported its end, but the voice is still playing.
    await act(async () => { await sleep(1500); });
    expect(FakeRecognition.last).toBe(before);
    // The speakers go quiet; a moment is still left for the room.
    synth.speaking = false;
    await act(async () => { await sleep(200); });
    expect(FakeRecognition.last).toBe(before);
    await act(async () => { await sleep(500); });
    expect(FakeRecognition.last).not.toBe(before);
    await modal.finish();
    modal.unmount();
  }, 10000);

  it("cuts the examiner's echo off the start of the candidate's turn", async () => {
    synth.speak = function speak(u) { setTimeout(() => u.onend && u.onend(), 5); };
    const modal = await openTache1();
    await act(async () => { await sleep(1200); });
    act(() => {
      FakeRecognition.last.hear("s'il vous plaît bonjour je m'appelle Anna");
    });
    await modal.finish();
    expect(candidateLines(graded())).toEqual(["bonjour je m'appelle Anna"]);
    modal.unmount();
  }, 10000);
});
