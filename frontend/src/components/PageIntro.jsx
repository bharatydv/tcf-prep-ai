/**
 * PageIntro - Improves text-HTML ratio and SEO by adding structured
 * introductory content to pages. This component should be placed near
 * the top of each page's main content area.
 *
 * Heading level is h2 by DEFAULT, not h1.
 *
 * Every page using this already had a heading of its own, so it was emitting
 * two h1 elements - on /blog, /reading, /listening and /resources, in both
 * locales. A page with two h1s has no single stated subject, and the crawl
 * that found this reported ten pages in that state.
 *
 * Pass as="h1" where THIS is the page's main heading rather than an
 * introduction to it - true on the reading and listening hubs, where the
 * intro sits above the page's own smaller section heading. Whichever heading
 * is visually dominant should be the h1; the markup follows the design, not
 * the other way round.
 *
 * Usage:
 *   <PageIntro title="Blog" description="..." />          // h2
 *   <PageIntro as="h1" title="Reading" description="..." />
 */
export function PageIntro({ title, description, children, as: Heading = 'h2' }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {title && (
        <Heading className="font-heading text-3xl font-extrabold text-gray-900 mb-4">
          {title}
        </Heading>
      )}
      {description && (
        <p className="text-lg text-gray-600 leading-relaxed mb-6">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

export default PageIntro;
