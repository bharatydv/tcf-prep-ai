/* Site footer.
 *
 * It used to live inside Landing, so 31 of 32 routes ended with no navigation
 * at all — no internal linking for crawlers, and nowhere for a reader to go
 * from a deep page. It is rendered once in the app shell now.
 *
 * The newsletter form posts to a real endpoint. Before, it showed a success
 * toast and discarded the address, which told people they had subscribed when
 * nothing had happened.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useT } from '../i18n';

export const SUPPORT_EMAIL = 'bonjour@prepfrancais.com';

function Wordmark() {
  return (
    /* Set in Poppins rather than drawn as paths — see the header wordmark in
       shared.jsx. On the ink ground "prep" lightens and "francais" goes white,
       which is the split the drawn footer logo used. */
    <span role="img" aria-label="prepfrancais"
      className="block select-none font-heading text-[26px] font-extrabold leading-none tracking-tight">
      <span style={{ color: '#AE8BFF' }}>prep</span>
      <span style={{ color: '#FFFFFF' }}>fran</span>
      <span style={{ color: '#E8179B' }}>c</span>
      <span style={{ color: '#FFFFFF' }}>ais</span>
    </span>
  );
}

function Column({ title, links }) {
  return (
    <div>
      <p className="font-heading text-sm font-bold text-white">{title}</p>
      <ul className="mt-4 space-y-2.5 text-xs">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="inline-block py-1.5 transition hover:text-white">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const subscribe = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await api.post('/newsletter', { email: value });
      toast.success(t('land.subscribed'));
      setEmail('');
    } catch (err) {
      toast.error(errMsg(err, t('land.newsletterFail')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="bg-ink text-violet-200/70" style={{ background: '#120822' }}>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Wordmark />
          <p className="mt-3 text-sm font-semibold text-violet-100">{t('land.footerTag')}</p>
          <p className="mt-3 max-w-xs text-xs leading-relaxed">{t('land.footerBlurb')}</p>
        </div>

        <Column title={t('land.footProduct')} links={[
          ['/practice', t('land.footWriting')],
          ['/speaking', t('land.footSpeaking')],
          ['/exam-simulator', t('land.footSimulator')],
          ['/exam/reading-comprehension', t('land.footMock')],
        ]} />

        <Column title={t('land.footResources')} links={[
          ['/tef-tcf-writing-guide', t('land.footGuide')],
          ['/blog', t('land.footBlog')],
          ['/recent-topics', t('land.footRecent')],
          ['/resources', t('land.footPacks')],
        ]} />

        <Column title={t('nav.reading')} links={[
          ['/reading', t('land.footReading')],
          ['/listening', t('land.footListening')],
          ['/combinations', t('land.footCombos')],
          ['/pricing', t('nav.pricing')],
        ]} />

        <div>
          <p className="font-heading text-sm font-bold text-white">{t('land.newsletter')}</p>
          <p className="mt-4 text-xs">{t('land.newsletterSub')}</p>
          <form className="mt-3 flex overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/15"
            onSubmit={subscribe}>
            <label className="sr-only" htmlFor="newsletter-email">{t('land.emailPlaceholder')}</label>
            <input id="newsletter-email" name="email" value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" autoComplete="email" placeholder={t('land.emailPlaceholder')}
              className="min-h-[44px] w-full bg-transparent px-3.5 py-2.5 text-xs text-white placeholder-violet-300/50 outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
              data-testid="newsletter-input" />
            <button type="submit" disabled={busy}
              className="bg-gradient-to-r from-primary to-fuchsia-600 px-4 text-white transition hover:brightness-110 disabled:opacity-60"
              aria-label={busy ? t('land.newsletterBusy') : t('land.subscribe')}
              data-testid="newsletter-button">
              <PaperPlaneTilt size={15} weight="fill" />
            </button>
          </form>

          <p className="mt-6 font-heading text-sm font-bold text-white">{t('land.footCompany')}</p>
          <ul className="mt-3 space-y-2 text-xs">
            <li><Link to="/contact" className="inline-block py-1.5 transition hover:text-white">{t('land.footContact')}</Link></li>
            <li><Link to="/privacy" className="inline-block py-1.5 transition hover:text-white">{t('land.footPrivacy')}</Link></li>
            <li><Link to="/terms" className="inline-block py-1.5 transition hover:text-white">{t('land.footTerms')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-[11px] text-violet-300/75">
        {t('land.copyright', { year: new Date().getFullYear() })}
      </div>
    </footer>
  );
}
