// AsyncStorage has no native module under Jest; use its official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The tracker SDK calls fetch; keep it off the network in tests.
if (!globalThis.fetch) {
  globalThis.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204, json: async () => ({}) }));
}
