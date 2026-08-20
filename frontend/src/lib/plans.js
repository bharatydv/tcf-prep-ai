/* The subscription plans, in one place.
 *
 * Both the pricing page and the paywall render these. Keeping the list inside
 * Pricing.jsx would have been enough for the page, but the paywall is mounted
 * in the app shell — importing it from there would have pulled the whole
 * lazy-loaded pricing page into the main bundle to read three prices.
 *
 * Payment is not open yet, so `price` is indicative. See pricing.faq1a.
 */
export const PLANS = [
  { name: 'Bronze', price: '$14.99', durationKey: 'pricing.duration5d', bonus: 3, grad: 'from-amber-700 to-amber-500', popular: false },
  { name: 'Silver', price: '$29.99', durationKey: 'pricing.duration1m', bonus: 8, grad: 'from-gray-500 to-gray-400', popular: true },
  { name: 'Gold', price: '$49.99', durationKey: 'pricing.duration2m', bonus: 15, grad: 'from-yellow-500 to-amber-400', popular: false },
];
