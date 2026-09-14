import { legacyLocalePath } from './locale';

describe('legacy /fr redirects', () => {
  test('maps a French URL to its English page', () => {
    expect(legacyLocalePath('/fr/pricing')).toBe('/pricing');
    expect(legacyLocalePath('/fr/tcf-canada-speaking')).toBe('/tcf-canada-speaking');
    expect(legacyLocalePath('/fr')).toBe('/');
  });

  test('leaves English URLs alone', () => {
    expect(legacyLocalePath('/')).toBeNull();
    expect(legacyLocalePath('/pricing')).toBeNull();
  });

  test('slugs that merely start with "fr" are not French URLs', () => {
    // Redirecting either of these would break a live page.
    expect(legacyLocalePath('/french-guide')).toBeNull();
    expect(legacyLocalePath('/fr-tcf')).toBeNull();
  });
});
