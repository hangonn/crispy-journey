import { Platform } from 'react-native';

const PORT = 8787;

/**
 * Base address of the fixture server.
 *
 * - iOS simulator reaches the host on `localhost`.
 * - Android emulator reaches the host on `10.0.2.2`.
 * - A physical device needs the computer's LAN address; set `EXPO_PUBLIC_SERVER_URL`.
 *
 * The fixture server prints all three addresses when it starts.
 */
export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL ??
  (Platform.OS === 'android' ? `http://10.0.2.2:${PORT}` : `http://localhost:${PORT}`);

/** How long the app waits for `/consent` before loading a page without one. */
export const CONSENT_TIMEOUT_MS = 5000;

/** At most this many articles are kept in the saved-articles folder. */
export const MAX_SAVED_ARTICLES = 5;

/** App identity handed to the tracker and to `window.appContext`. */
export const APP_VERSION = '1.0.0';
export const APP_BUILD = '1';