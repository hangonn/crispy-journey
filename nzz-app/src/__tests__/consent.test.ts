import { useConsentStore } from '../state/consent';

const originalFetch = globalThis.fetch;

function resetStore() {
  useConsentStore.getState().reset();
}

describe('consent store', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    resetStore();
  });

  it('resolves to "no consent" when the request fails, so a page can load', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await useConsentStore.getState().fetchConsent();

    const state = useConsentStore.getState();
    expect(state.resolved).toBe(true);
    expect(state.consentString).toBeNull();
  });

  it('resolves to "no consent" after the five-second timeout', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const pending = useConsentStore.getState().fetchConsent();
    jest.advanceTimersByTime(5000);
    await pending;

    expect(useConsentStore.getState().resolved).toBe(true);
    expect(useConsentStore.getState().consentString).toBeNull();
  });

  it('counts an answer that arrives later as consent arriving late', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ consent: 'cs1-abc' }),
    }) as unknown as typeof fetch;

    await useConsentStore.getState().fetchConsent();

    const state = useConsentStore.getState();
    expect(state.resolved).toBe(true);
    expect(state.consentString).toBe('cs1-abc');
    expect(state.consentRevision).toBe(1);
  });

  it('bumps the revision only when the string actually changes', () => {
    const { setConsent } = useConsentStore.getState();

    setConsent('cs1');
    expect(useConsentStore.getState().consentRevision).toBe(1);

    setConsent('cs1');
    expect(useConsentStore.getState().consentRevision).toBe(1);

    setConsent('cs2');
    expect(useConsentStore.getState().consentRevision).toBe(2);
  });
});
