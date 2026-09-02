/* Privacy, Terms, Refunds, Delivery and Contact.
 *
 * None of these existed as a route. A paid product needs them before a payment
 * processor will onboard it, search engines weigh them for anything
 * commercial, and a service that stores learner writing and voice recordings
 * owes its users a plain statement under Quebec's Law 25 and PIPEDA.
 *
 * The refund and delivery pages were added when Cashfree's site check bounced
 * the account for them. Nothing is shipped here, but a delivery policy is
 * still required of a digital merchant, so it says how access reaches the
 * account instead of how a parcel reaches a door.
 *
 * They all share one layout so they read as one document set. Copy lives in
 * the dictionaries, so the French version is a translation rather than a
 * separate legal text that can drift from it.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  EnvelopeSimple, ShieldCheck, Scales, ChatCircleText, Phone, MapPin,
  ArrowUUpLeft, Package,
} from '@phosphor-icons/react';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import {
  SUPPORT_EMAIL, SUPPORT_PHONE, BUSINESS_NAME, BUSINESS_LEGAL_NAME, BUSINESS_ADDRESS,
} from '../components/Footer';

/* The date the wording last changed. Hardcoded on purpose: "last updated"
   must mean the text changed, not that the page was rendered today. */
const LAST_UPDATED = '2026-09-01';

/* Who the merchant actually is.
 *
 * Every policy page named the brand and never the business behind it, which
 * leaves a reader — and a payment aggregator's reviewer — with no way to tell
 * who they would be contracting with. It sits at the foot of all four
 * documents rather than in one of them, because whichever page a reviewer
 * opens is the page that has to answer the question.
 *
 * Contact repeats none of this: there the address is the content, not the
 * footnote. */
function Operator() {
  const t = useT();
  if (!BUSINESS_NAME) return null;
  return (
    <section className="mt-12 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-[13px] leading-relaxed text-gray-600">
      <p className="font-heading font-bold text-gray-900">{t('legal.operatorH')}</p>
      <p className="mt-1">{t('legal.operatorP', { name: BUSINESS_NAME })}</p>
      {/* The trading name is not the name on the KYC. Naming the proprietor
          is what lets a reader — or a reviewer — tell who the counterparty
          to the contract actually is. */}
      {BUSINESS_LEGAL_NAME && (
        <p className="mt-1">{t('legal.proprietorP', { name: BUSINESS_NAME, legal: BUSINESS_LEGAL_NAME })}</p>
      )}
      {BUSINESS_ADDRESS && (
        <address className="mt-2 whitespace-pre-line not-italic">{BUSINESS_ADDRESS}</address>
      )}
      <p className="mt-2">
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-primary hover:underline">
          {SUPPORT_EMAIL}
        </a>
        {SUPPORT_PHONE && (
          <>
            {' · '}
            <a href={`tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`}
              className="font-semibold text-primary hover:underline">
              {SUPPORT_PHONE}
            </a>
          </>
        )}
      </p>
    </section>
  );
}

function Shell({ icon, title, intro, children, operator = true }) {
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
      {operator && <Operator />}
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

export function Refund() {
  const t = useT();
  return (
    <>
      <Seo titleKey="seo.refund.title" descKey="seo.refund.desc" path="/refund" />
      <Shell icon={<ArrowUUpLeft size={26} weight="duotone" />}
        title={t('refund.h')} intro={t('refund.intro')}>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <Clause key={n} heading={t(`refund.h${n}`)} body={t(`refund.p${n}`, { email: SUPPORT_EMAIL })} />
        ))}
        <Clause heading={t('refund.h8')} body={t('refund.p8', { email: SUPPORT_EMAIL })} />
      </Shell>
    </>
  );
}

export function Shipping() {
  const t = useT();
  return (
    <>
      <Seo titleKey="seo.shipping.title" descKey="seo.shipping.desc" path="/shipping" />
      <Shell icon={<Package size={26} weight="duotone" />}
        title={t('shipping.h')} intro={t('shipping.intro')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Clause key={n} heading={t(`shipping.h${n}`)} body={t(`shipping.p${n}`, { email: SUPPORT_EMAIL })} />
        ))}
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
  /* Memoised: jsonLd is a dependency of useSeo's effect, and a new object
     literal every render rebuilt the ld+json script and every meta tag. */
  const contactSchema = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: t('contact.h'),
    mainEntity: {
      '@type': 'Organization',
      name: BUSINESS_NAME || 'prepfrancais',
      ...(BUSINESS_LEGAL_NAME ? { legalName: BUSINESS_LEGAL_NAME } : {}),
      email: SUPPORT_EMAIL,
      ...(SUPPORT_PHONE ? { telephone: SUPPORT_PHONE } : {}),
      ...(BUSINESS_ADDRESS ? { address: { '@type': 'PostalAddress', streetAddress: BUSINESS_ADDRESS } } : {}),
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: SUPPORT_EMAIL,
        ...(SUPPORT_PHONE ? { telephone: SUPPORT_PHONE } : {}),
        availableLanguage: ['French', 'English'],
      },
    },
  }), [t]);
  return (
    <>
      <Seo
        titleKey="seo.contact.title"
        descKey="seo.contact.desc"
        path="/contact"
        jsonLd={contactSchema}
      />
      <Shell icon={<ChatCircleText size={26} weight="duotone" />}
        title={t('contact.h')} intro={t('contact.intro')} operator={false}>
        <a href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-center gap-3 rounded-2xl border-2 border-violet-100 bg-violet-50/60 px-5 py-4 transition hover:border-primary">
          <EnvelopeSimple size={22} weight="duotone" className="shrink-0 text-primary" />
          <span className="font-heading text-lg font-bold text-gray-900 break-all">{SUPPORT_EMAIL}</span>
        </a>
        {/* A payment aggregator's site check wants a reachable phone number
            and the registered address on this page, both matching the KYC on
            file. Each row is skipped while its constant is empty rather than
            rendering an empty label. */}
        {SUPPORT_PHONE && (
          <a href={`tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`}
            className="flex items-center gap-3 rounded-2xl border-2 border-violet-100 bg-violet-50/60 px-5 py-4 transition hover:border-primary">
            <Phone size={22} weight="duotone" className="shrink-0 text-primary" />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('contact.phoneH')}</span>
              <span className="font-heading text-lg font-bold text-gray-900">{SUPPORT_PHONE}</span>
            </span>
          </a>
        )}
        {BUSINESS_ADDRESS && (
          <div className="flex items-start gap-3 rounded-2xl border-2 border-violet-100 bg-violet-50/60 px-5 py-4">
            <MapPin size={22} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('contact.addressH')}</span>
              <address className="mt-0.5 whitespace-pre-line font-heading text-[15px] font-bold not-italic leading-relaxed text-gray-900">
                {BUSINESS_NAME && <span className="block">{BUSINESS_NAME}</span>}
                {BUSINESS_LEGAL_NAME && (
                  <span className="block font-sans text-[13px] font-semibold text-gray-600">
                    {t('contact.proprietor', { legal: BUSINESS_LEGAL_NAME })}
                  </span>
                )}
                {BUSINESS_ADDRESS}
              </address>
            </span>
          </div>
        )}
        {rows.map(([h, p]) => <Clause key={h} heading={t(h)} body={t(p)} />)}
        <Clause heading={t('contact.responseH')} body={t('contact.responseP')} />
      </Shell>
    </>
  );
}
