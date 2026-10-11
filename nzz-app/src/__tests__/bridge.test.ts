import { handleWebViewMessage } from '../protocol/bridge';
import { initializeTracker, resetTracker, getTrackerInstance } from '../tracking/trackerManager';

describe('handleWebViewMessage', () => {
  beforeEach(() => resetTracker());
  afterEach(() => resetTracker());

  it('returns protocol messages to the caller', () => {
    const message = handleWebViewMessage(JSON.stringify({ type: 'ready', protocol: 1, page: 'front' }));
    expect(message).toEqual({ type: 'ready', protocol: 1, page: 'front' });
  });

  it('ignores the pages\u2019 other scripts', () => {
    expect(handleWebViewMessage('tp:heartbeat')).toBeNull();
    expect(handleWebViewMessage(JSON.stringify({ type: 'ad:viewable', slot: 'top' }))).toBeNull();
  });

  it('does not create a tracker before consent, and buffers web events', () => {
    // A web tracker event arrives before the reader has chosen.
    handleWebViewMessage(
      JSON.stringify({ command: 'trackPageView', event: { pageUrl: 'http://x/front' }, context: [] }),
    );

    expect(getTrackerInstance()).toBeNull();

    // Consent arrives: the tracker is created and the buffered event is replayed.
    initializeTracker('cs1');
    expect(getTrackerInstance()).not.toBeNull();
  });

  it('never creates a tracker without a consent string', () => {
    initializeTracker(null);
    expect(getTrackerInstance()).toBeNull();
  });
});
