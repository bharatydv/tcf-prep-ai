/* Privacy, Terms and Contact.
 *
 * None of these existed as a route. A paid product needs them before a payment
 * processor will onboard it, search engines weigh them for anything
 * commercial, and a service that stores learner writing and voice recordings
 * owes its users a plain statement under Quebec's Law 25 and PIPEDA.
 *
 * All three share one layout so they read as one document set. Copy lives in
 * the dictionaries, so the French version is a translation rather than a
 * separate legal text that can drift from it.
 */
import { Link } from 'react-router-dom';
import { EnvelopeSimple, ShieldCheck, Scales, ChatCircleText } from '@phosphor-icons/react';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { SUPPORT_EMAIL } from '../components/Footer';

/* The date the wording last changed. Hardcoded on purpose: "last updated"
   must mean the text changed, not that the page was rendered today. */
const LAST_UPDATED = '2026-08-18';

function Shell({ icon, title, intro, children }) {
  const t = useT();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-primary">
        {icon}
      </span>
      <h1 className="mt-5 font-heading text-3xl font-extrabold text-gray-900 sm:text-4xl">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-gray-600">{intro}</p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('legal.updated', { date: LAST_UPDATED })}
      </p>
      <div className="mt-10 space-y-8">{children}</div>
      <Link to="/" className="mt-12 inline-block text-sm font-semibold text-primary hover:underline">
        ← {t('legal.backHome')}
      </Link>
    </main>
  );
}

function Clause({ heading, body }) {
  return (
    <section>
      <h2 className="font-heading text-lg font-bold text-gray-900">{heading}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-gray-600">{body}</p>
    </section>
  );
}

export function Privacy() {
  const t = useT();
  return (
    <>
      <Seo titleKey="seo.privacy.title" descKey="seo.privacy.desc" path="/privacy" />
      <Shell icon={<ShieldCheck size={26} weight="duotone" />}
        title={t('privacy.h')} intro={t('privacy.intro')}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Clause key={n} heading={t(`privacy.h${n}`)} body={t(`privacy.p${n}`)} />
        ))}
        <Clause heading={t('privacy.h7')} body={t('privacy.p7', { email: SUPPORT_EMAIL })} />
      </Shell>
    </>
  );
}

export function Terms() {
  const t = useT();
  return (
    <>
      <Seo titleKey="seo.terms.title" descKey="seo.terms.desc" path="/terms" />
      <Shell icon={<Scales size={26} weight="duotone" />}
        title={t('terms.h')} intro={t('terms.intro')}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <Clause key={n} heading={t(`terms.h${n}`)} body={t(`terms.p${n}`)} />
        ))}
        <Clause heading={t('terms.h9')} body={t('terms.p9', { email: SUPPORT_EMAIL })} />
      </Shell>
    </>
  );
}

export function Contact() {
  const t = useT();
  const rows = [
    ['contact.supportH', 'contact.supportP'],
    ['contact.gradingH', 'contact.gradingP'],
    ['contact.partnerH', 'contact.partnerP'],
  ];
  return (
    <>
      <Seo
        titleKey="seo.contact.title"
        descKey="seo.contact.desc"
        path="/contact"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'ContactPage',
          name: t('contact.h'),
          mainEntity: {
            '@type': 'Organization',
            name: 'prepfrancais',
            email: SUPPORT_EMAIL,
            contactPoint: {
              '@type': 'ContactPoint',
              contactType: 'customer support',
              email: SUPPORT_EMAIL,
              availableLanguage: ['French', 'English'],
            },
          },
        }}
      />
      <Shell icon={<ChatCircleText size={26} weight="duotone" />}
        title={t('contact.h')} intro={t('contact.intro')}>
        <a href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-center gap-3 rounded-2xl border-2 border-violet-100 bg-violet-50/60 px-5 py-4 transition hover:border-primary">
          <EnvelopeSimple size={22} weight="duotone" className="shrink-0 text-primary" />
          <span className="font-heading text-lg font-bold text-gray-900 break-all">{SUPPORT_EMAIL}</span>
        </a>
        {rows.map(([h, p]) => <Clause key={h} heading={t(h)} body={t(p)} />)}
        <Clause heading={t('contact.responseH')} body={t('contact.responseP')} />
      </Shell>
    </>
  );
}
