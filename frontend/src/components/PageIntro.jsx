/**
 * PageIntro - Improves text-HTML ratio and SEO by adding structured
 * introductory content to pages. This component should be placed near
 * the top of each page's main content area.
 *
 * Usage:
 *   <PageIntro
 *     title="Blog"
 *     description="Explore articles and tips about TCF and TEF Canada exam preparation."
 *   />
 */
export function PageIntro({ title, description, children }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {title && (
        <h1 className="font-heading text-3xl font-extrabold text-gray-900 mb-4">
          {title}
        </h1>
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
