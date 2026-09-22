/* The whole guide, read in the browser, for anybody entitled to it.
 *
 * "Entitled" is not decided here. The frame's source is the same download
 * endpoint as the button beside it, asking for the file to be displayed
 * rather than saved; the server serves it to an account and refuses everyone
 * else. Somebody who edits this component still gets a 403, and somebody who
 * can read the pages could have pressed download for the same bytes — so
 * there is no weaker gate here, only a second way to open the same door.
 *
 * Why a frame over the real PDF rather than twenty-five pictures: the pages
 * past 4 exist on this site only as blurred thumbnails, and publishing sharp
 * copies would put the gated half of the guide on a public URL. The file
 * itself is already theirs.
 */
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, DownloadSimple, CircleNotch } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { downloadPath, readerPath } from '../lib/leads';
import { VOCAB_PATH } from './VocabularyGuide';

export const VOCAB_READ_PATH = '/tcf-canada-vocabulary/read';

export default function VocabularyReader() {
  const t = useT();
  const { user, loading } = useAuth();
  const [ready, setReady] = useState(false);

  /* `loading` is the session still settling. Without waiting for it, a
     reader who reloads this page is bounced to the form for the second
     /auth/me takes to answer. */
  if (loading) {
    return (
      <main className="grid min-h-[60vh] place-items-center bg-white">
        <CircleNotch size={28} className="animate-spin text-primary" />
      </main>
    );
  }
  if (!user) return <Navigate to={VOCAB_PATH} replace />;

  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col bg-gray-50">
      {/* noindex: the page is worthless to a crawler, which has no account
          and would be served a 403 inside the frame. */}
      <Seo title={t('vocab.readTitle')} description={t('vocab.docDesc')}
        path={VOCAB_READ_PATH} noindex />

      <div className="flex flex-wrap items-center gap-3 border-b border-violet-100 bg-white px-4 py-3 sm:px-6">
        <Link to={VOCAB_PATH}
          className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gray-600 transition hover:text-primary"
          data-testid="reader-back">
          <ArrowLeft size={16} weight="bold" /> {t('vocab.readBack')}
        </Link>
        <p className="min-w-0 flex-1 truncate font-heading text-sm font-extrabold text-gray-900">
          {t('vocab.readTitle')}
        </p>
        <a href={downloadPath()} download data-testid="reader-download"
          className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-4 !py-2 text-[13px]">
          <DownloadSimple size={15} weight="bold" /> {t('vocab.download')}
        </a>
      </div>

      <div className="relative min-h-0 flex-1">
        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <CircleNotch size={28} className="animate-spin text-primary" />
          </div>
        )}
        {/* A PDF in an <iframe> rather than a rendering library: every
            browser that matters has a viewer, with its own page controls,
            search and zoom, and none of it is ours to keep working. */}
        <iframe src={readerPath()} title={t('vocab.readTitle')}
          onLoad={() => setReady(true)}
          className="h-full w-full border-0" data-testid="reader-frame" />
      </div>
    </main>
  );
}
