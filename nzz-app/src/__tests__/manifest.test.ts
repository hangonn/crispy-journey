import { absoluteFileUrl } from '../saved/manifest';
import { SERVER_URL } from '../config';

describe('absoluteFileUrl', () => {
  it('leaves full URLs (the image CDN) untouched', () => {
    const cdn = 'https://img-msp-prod.nzz.ch/2026/08/25/photo.jpg?width=960';
    expect(absoluteFileUrl(cdn)).toBe(cdn);
  });

  it('resolves a server path against the server address', () => {
    expect(absoluteFileUrl('/bundle/1/v/abc/index.html')).toBe(`${SERVER_URL}/bundle/1/v/abc/index.html`);
  });

  it('adds the missing slash for a path without a leading one', () => {
    expect(absoluteFileUrl('bundle/1/v/abc/index.html')).toBe(`${SERVER_URL}/bundle/1/v/abc/index.html`);
  });
});
