import { parsePageMessage } from '../protocol/types';

describe('parsePageMessage', () => {
  it('parses protocol messages', () => {
    expect(parsePageMessage(JSON.stringify({ type: 'ready', protocol: 1, page: 'front' }))).toEqual({
      type: 'ready',
      protocol: 1,
      page: 'front',
    });
    expect(parsePageMessage(JSON.stringify({ type: 'height', value: 120 }))).toEqual({ type: 'height', value: 120 });
  });

  it('ignores the web tracker and other scripts on the channel', () => {
    expect(parsePageMessage(JSON.stringify({ command: 'trackPageView', event: {} }))).toBeNull();
    expect(parsePageMessage(JSON.stringify({ type: 'ad:viewable', slot: 'top' }))).toBeNull();
    expect(parsePageMessage('tp:heartbeat')).toBeNull();
    expect(parsePageMessage('not json')).toBeNull();
  });
});
