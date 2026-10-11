import { getInjectedJavaScript, withConsent, getPageUrl } from '../protocol/inject';

describe('withConsent', () => {
  it('appends the consent fragment when there is a string', () => {
    expect(withConsent('http://localhost:8787/front', 'cs1-abc')).toBe('http://localhost:8787/front#consent=cs1-abc');
  });

  it('leaves the URL alone when there is no consent', () => {
    expect(withConsent('http://localhost:8787/front', null)).toBe('http://localhost:8787/front');
  });

  it('encodes the consent value', () => {
    expect(withConsent('http://x/front', 'a b&c')).toBe('http://x/front#consent=a%20b%26c');
  });
});

describe('getPageUrl', () => {
  it('builds front and article URLs with a query string', () => {
    expect(getPageUrl('front')).toContain('/front');
    expect(getPageUrl('article', '2', 'ref=related')).toContain('/article/2?ref=related');
  });
});

describe('getInjectedJavaScript', () => {
  it('sets the insets and app context before the page runs', () => {
    const js = getInjectedJavaScript({
      pageType: 'article',
      insets: { top: 88, bottom: 20 },
      appVersion: '1.0.0',
      appBuild: '1',
      articleId: '2',
    });

    expect(js).toContain('window.appInsets = { top: 88, bottom: 20 }');
    expect(js).toContain('window.appContext');
    expect(js).toContain('window.__appReady = false');
  });

  it('only refreshes an article after a downward pull from the top', () => {
    const js = getInjectedJavaScript({
      pageType: 'article',
      insets: { top: 0, bottom: 0 },
      appVersion: '1',
      appBuild: '1',
      articleId: '2',
    });

    expect(js).toContain('touchStartY = event.touches[0].clientY');
    expect(js).toContain('event.touches[0].clientY - touchStartY > 90');
    expect(js).not.toContain('event.touches[0].clientY > 90');
  });

  it('only watches for the end of the text on an article', () => {
    const article = getInjectedJavaScript({
      pageType: 'article',
      insets: { top: 0, bottom: 0 },
      appVersion: '1',
      appBuild: '1',
      articleId: '2',
    });
    const front = getInjectedJavaScript({
      pageType: 'front',
      insets: { top: 0, bottom: 0 },
      appVersion: '1',
      appBuild: '1',
    });

    expect(article).toContain('articleRead');
    expect(front).not.toContain('articleRead');
  });

  it('produces syntactically valid JavaScript for both pages', () => {
    for (const pageType of ['front', 'article'] as const) {
      const js = getInjectedJavaScript({
        pageType,
        insets: { top: 88, bottom: 20 },
        appVersion: '1.0.0',
        appBuild: '1',
        articleId: pageType === 'article' ? '2' : undefined,
      });
      // Throws on a syntax error; does not execute.
      expect(() => new Function(js)).not.toThrow();
    }
  });
});
