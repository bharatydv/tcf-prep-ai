/* The learner's own recording, wherever their result is shown.
 *
 * The audio is behind the session, not behind an unguessable URL — see
 * /api/submissions/{id}/audio. That is why the <audio> tag points straight at
 * the API instead of at a blob: the browser sends the session cookie with a
 * same-origin media request, so playback needs no fetch, no object URL and
 * nothing held in memory. The download link is the same endpoint with
 * ?download=1, which only adds a Content-Disposition header.
 *
 * A missing recording is normal, not an error: nothing was stored before this
 * feature, the roleplay has a dozen turn recordings and no single file, and an
 * admin can delete one. All three land on the same line of copy, and the
 * transcript underneath is unaffected.
 */
import { useState } from 'react';
import { DownloadSimple, Microphone } from '@phosphor-icons/react';
import { useT } from '../i18n';

export function RecordingPlayer({ submissionId, className = '' }) {
  const t = useT();
  const [missing, setMissing] = useState(false);
  const src = `/api/submissions/${submissionId}/audio`;

  if (missing) {
    return (
      <p className={`text-xs text-gray-400 ${className}`} data-testid="recording-missing">
        {t('fb.audioMissing')}
      </p>
    );
  }

  return (
    <div className={`rounded-2xl border border-gray-100 bg-gray-50/60 p-4 ${className}`}
      data-testid="recording-player">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
          <Microphone size={14} weight="fill" className="text-rose-500" />
          {t('fb.audioTitle')}
        </p>
        <a href={`${src}?download=1`} download
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          data-testid="recording-download">
          <DownloadSimple size={14} /> {t('fb.audioDownload')}
        </a>
      </div>
      {/* onError rather than a HEAD request first: one round trip instead of
          two, and the element tells us the same thing. */}
      <audio src={src} controls preload="metadata" className="mt-3 w-full"
        onError={() => setMissing(true)} data-testid="recording-audio" />
    </div>
  );
}
