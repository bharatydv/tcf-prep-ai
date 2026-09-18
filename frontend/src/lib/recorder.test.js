/* When the clock starts for a tâche that gives no preparation.
 *
 * Tâche 3 arms the microphone on the button but holds the countdown until the
 * candidate actually speaks, so reading the question costs them none of their
 * 4 min 30. Everything that decides "they have started" lives here.
 */
import { listenForSpeech } from './recorder';

/* A microphone whose loudness the test drives frame by frame. `level` is the
   sample amplitude, 0 (silence) to 1 (clipping), in the byte domain the
   analyser reports: 128 is silence. */
function fakeAudio({ state = 'running' } = {}) {
  const mic = { level: 0, state, closed: false, disconnected: false };
  const analyser = {
    fftSize: 1024,
    connect: () => {},
    getByteTimeDomainData: (buf) => {
      for (let i = 0; i < buf.length; i += 1) {
        // Alternating either side of centre: a DC offset would read as silence.
        buf[i] = 128 + Math.round(mic.level * 127) * (i % 2 ? 1 : -1);
      }
    },
  };
  mic.Ctx = function AudioContextStub() {
    return {
      get state() { return mic.state; },
      createMediaStreamSource: () => ({
        connect: () => {},
        disconnect: () => { mic.disconnected = true; },
      }),
      createAnalyser: () => analyser,
      resume: () => Promise.resolve(),
      close: () => { mic.closed = true; },
    };
  };
  return mic;
}

const STREAM = { id: 'fake-stream' };

describe('listenForSpeech', () => {
  let saved;

  beforeEach(() => {
    jest.useFakeTimers();
    saved = window.AudioContext;
  });

  afterEach(() => {
    jest.useRealTimers();
    window.AudioContext = saved;
  });

  const listen = (mic, onSpeech) => {
    window.AudioContext = mic.Ctx;
    return listenForSpeech(STREAM, onSpeech);
  };

  it('does not start the clock while the room is quiet', () => {
    const mic = fakeAudio();
    const onSpeech = jest.fn();
    listen(mic, onSpeech);
    jest.advanceTimersByTime(5000);
    expect(onSpeech).not.toHaveBeenCalled();
  });

  it('starts the clock once the candidate speaks', () => {
    const mic = fakeAudio();
    const onSpeech = jest.fn();
    listen(mic, onSpeech);
    jest.advanceTimersByTime(600);
    mic.level = 0.3;
    jest.advanceTimersByTime(600);
    expect(onSpeech).toHaveBeenCalledTimes(1);
  });

  it('is not started by a single click or a chair creak', () => {
    /* One loud frame is a noise; speech holds the level across several. */
    const mic = fakeAudio();
    const onSpeech = jest.fn();
    listen(mic, onSpeech);
    mic.level = 0.9;
    jest.advanceTimersByTime(60);
    mic.level = 0;
    jest.advanceTimersByTime(3000);
    expect(onSpeech).not.toHaveBeenCalled();
  });

  it('only ever reports the start once', () => {
    const mic = fakeAudio();
    const onSpeech = jest.fn();
    listen(mic, onSpeech);
    mic.level = 0.4;
    jest.advanceTimersByTime(10000);
    expect(onSpeech).toHaveBeenCalledTimes(1);
  });

  it('releases the audio graph when it stops', () => {
    const mic = fakeAudio();
    listen(mic, () => {});
    mic.level = 0.4;
    jest.advanceTimersByTime(600);
    expect(mic.closed).toBe(true);
    expect(mic.disconnected).toBe(true);
  });

  it('tears down when the caller abandons the recording', () => {
    const mic = fakeAudio();
    const onSpeech = jest.fn();
    const stop = listen(mic, onSpeech);
    stop();
    mic.level = 0.9;
    jest.advanceTimersByTime(5000);
    expect(onSpeech).not.toHaveBeenCalled();
    expect(mic.closed).toBe(true);
  });

  it('gives up on a context that never resumes, rather than stalling', () => {
    /* Safari can refuse to resume a context built after an await. A detector
       that cannot hear must not hold the countdown at zero forever. */
    const mic = fakeAudio({ state: 'suspended' });
    const onSpeech = jest.fn();
    listen(mic, onSpeech);
    jest.advanceTimersByTime(300);
    expect(onSpeech).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1200);
    expect(onSpeech).toHaveBeenCalledTimes(1);
  });

  it('reports no detector at all when the browser has no AudioContext', () => {
    /* null is the caller's signal to start the clock on the button instead. */
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
    expect(listenForSpeech(STREAM, () => {})).toBeNull();
  });

  it('reports no detector without a stream', () => {
    const mic = fakeAudio();
    window.AudioContext = mic.Ctx;
    expect(listenForSpeech(null, () => {})).toBeNull();
  });
});
