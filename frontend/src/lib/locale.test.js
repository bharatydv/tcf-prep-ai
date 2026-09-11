import {
  localeFromPath, stripLocale, pathForLocale, basenameFor,
} from './locale';

describe('locale routing', () => {
  test('only /fr and /fr/... are French', () => {
    expect(localeFromPath('/fr')).toBe('fr');
    expect(localeFromPath('/fr/pricing')).toBe('fr');
    expect(localeFromPath('/')).toBe('en');
    expect(localeFromPath('/pricing')).toBe('en');
    // Slugs that merely start the same way are English pages.
    expect(localeFromPath('/french-guide')).toBe('en');
    expect(localeFromPath('/fr-tcf')).toBe('en');
  });

  test('stripLocale returns the route the router sees', () => {
    expect(stripLocale('/fr/pricing')).toBe('/pricing');
    expect(stripLocale('/fr')).toBe('/');
    expect(stripLocale('/pricing')).toBe('/pricing');
    expect(stripLocale('/')).toBe('/');
  });

  test('pathForLocale never produces a trailing-slash duplicate', () => {
    expect(pathForLocale('fr', '/')).toBe('/fr');
    expect(pathForLocale('en', '/')).toBe('/');
    expect(pathForLocale('fr', '/pricing')).toBe('/fr/pricing');
    expect(pathForLocale('en', '/pricing')).toBe('/pricing');
  });

  test('round-trips: strip then re-prefix is stable', () => {
    for (const p of ['/', '/pricing', '/tcf-canada', '/blog/a-post']) {
      expect(pathForLocale('en', stripLocale(p))).toBe(p);
      expect(stripLocale(pathForLocale('fr', p))).toBe(p);
    }
  });

  test('basename is undefined for English, /fr for French', () => {
    expect(basenameFor('/pricing')).toBeUndefined();
    expect(basenameFor('/fr/pricing')).toBe('/fr');
  });
});
