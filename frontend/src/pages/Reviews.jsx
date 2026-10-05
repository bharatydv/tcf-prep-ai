import ReviewsSection from '../components/ReviewsSection';
import { Seo } from '../lib/seo';

/* Every approved review on one page. */
export default function Reviews() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <Seo titleKey="seo.reviews.title" descKey="seo.reviews.desc" path="/reviews" />
      <ReviewsSection variant="list" limit={50} showEmpty showAllLink={false} />
    </main>
  );
}
