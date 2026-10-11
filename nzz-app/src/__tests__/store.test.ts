import { useAppStore } from '../state/store';

function resetStore() {
  useAppStore.setState({ bookmarks: [], readIds: [], titles: {}, fontScale: 1, theme: 'dark' });
}

describe('app store', () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  it('toggles a bookmark on and off', () => {
    const { toggleBookmark } = useAppStore.getState();

    toggleBookmark('2');
    expect(useAppStore.getState().bookmarks).toEqual(['2']);

    toggleBookmark('2');
    expect(useAppStore.getState().bookmarks).toEqual([]);
  });

  it('keeps at most five read articles, most recent first, without duplicates', () => {
    const { addReadArticle } = useAppStore.getState();

    ['1', '2', '3', '4', '5', '6'].forEach(addReadArticle);
    expect(useAppStore.getState().readIds).toEqual(['6', '5', '4', '3', '2']);

    // Reading an older article again moves it to the front.
    addReadArticle('4');
    expect(useAppStore.getState().readIds).toEqual(['4', '6', '5', '3', '2']);
  });

  it('clamps the font scale', () => {
    const { setFontScale } = useAppStore.getState();

    setFontScale(5);
    expect(useAppStore.getState().fontScale).toBe(2);

    setFontScale(0);
    expect(useAppStore.getState().fontScale).toBe(0.5);
  });

  it('remembers article titles for the Recently read strip', () => {
    useAppStore.getState().setArticleTitle('2', 'A headline');
    expect(useAppStore.getState().titles['2']).toBe('A headline');
  });
});
