/* Audio capture that works on iOS.
 *
 * Both recording surfaces used to do this:
 *
 *   const mr = new MediaRecorder(stream);              // no mimeType
 *   const blob = new Blob(chunks, { type: 'audio/webm' });   // hardcoded
 *   upload(blob, 'answer.webm');
 *
 * Safari does not produce WebM. On iPhone and iPad the recorder emits MP4/AAC,
 * so the blob and the filename both lied about the contents. The backend picks
 * its MIME type from that filename, so Gemini received MP4 bytes labelled
 * audio/webm and OpenAI received a .webm name over MP4 content. Transcription
 * failed, the error was swallowed, and the learner was charged a credit for
 * "(no speech detected)".
 *
 * Everything here negotiates the container instead of assuming one, and keeps
 * the real type on the Blob, the filename and the upload field so all three
 * agree by construction.
 */

/* Ordered by preference: Opus in WebM is the smallest and what Chrome, Edge
   and Firefox produce; MP4/AAC is what Safari produces. The bare entries are
   fallbacks for browsers that reject a codec-qualified string. */
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/mpeg',
];

const EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
};

export function isRecordingSupported() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/* The base type without its codec parameters: 'audio/webm;codecs=opus' ->
   'audio/webm'. Both the extension table and the server key off this. */
export function baseMimeType(type) {
  return String(type || '').split(';')[0].trim().toLowerCase();
}

export function extensionFor(type) {
  return EXTENSIONS[baseMimeType(type)] || 'webm';
}

/* The first candidate this browser will actually record. Returns '' when none
   match, which is the signal to let MediaRecorder pick its own default — and
   then to read the type back off the recorder rather than guessing. */
export function pickMimeType() {
  if (typeof window === 'undefined' || !window.MediaRecorder) return '';
  const supported = window.MediaRecorder.isTypeSupported;
  if (typeof supported !== 'function') return '';
  return CANDIDATES.find((type) => {
    try { return window.MediaRecorder.isTypeSupported(type); } catch { return false; }
  }) || '';
}

/**
 * Start recording. Resolves with a handle whose stop() returns
 * { blob, filename, mimeType } — all three describing the same bytes.
 *
 * @param {object} options
 * @param {string} options.basename filename stem, e.g. 'answer' or 'turn'
 * @returns {Promise<{stop: () => Promise<object>, cancel: () => void, mimeType: string}>}
 */
export async function startRecording({ basename = 'answer' } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const preferred = pickMimeType();

  let recorder;
  try {
    recorder = preferred
      ? new MediaRecorder(stream, { mimeType: preferred })
      : new MediaRecorder(stream);
  } catch {
    // A browser can advertise support for a type and still refuse it for this
    // particular track. Falling back to the default is better than failing.
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const release = () => stream.getTracks().forEach((track) => track.stop());

  const stop = () => new Promise((resolve, reject) => {
    if (recorder.state === 'inactive') { release(); reject(new Error('Recorder already stopped')); return; }
    recorder.onerror = (e) => { release(); reject(e.error || new Error('Recording failed')); };
    recorder.onstop = () => {
      release();
      // recorder.mimeType is what was actually used, which is the only value
      // that is right on every browser — including the ones that ignored the
      // requested type. Fall back to the first chunk's own type.
      const mimeType = baseMimeType(recorder.mimeType || chunks[0]?.type || preferred || 'audio/webm');
      resolve({
        blob: new Blob(chunks, { type: mimeType }),
        mimeType,
        filename: `${basename}.${extensionFor(mimeType)}`,
      });
    };
    recorder.stop();
  });

  const cancel = () => {
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
    release();
  };

  recorder.start();
  return { recorder, stop, cancel, mimeType: recorder.mimeType || preferred };
}

/* Uploads carry the true type in a field of its own, so the server never has
   to infer the format from a file extension. */
export function appendAudio(form, { blob, filename, mimeType }, field = 'audio') {
  form.append(field, blob, filename);
  if (mimeType) form.append('mime_type', mimeType);
  return form;
}
