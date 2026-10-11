import { WebView } from "react-native-webview";

/**
 * Dispatch an app event to a webview by injecting JavaScript that fires a CustomEvent.
 */
function dispatchEvent(
  webview: WebView | null,
  eventName: string,
  detail: unknown,
): void {
  if (!webview) return;

  const script = `
    (function() {
      var event = new CustomEvent('${eventName}', { detail: ${JSON.stringify(detail)} });
      window.dispatchEvent(event);
    })();
  `;

  webview.injectJavaScript(script);
}

export function dispatchFontScale(
  webview: WebView | null,
  value: number,
): void {
  dispatchEvent(webview, "app:fontScale", { value });
}

export function dispatchTheme(
  webview: WebView | null,
  value: "light" | "dark",
): void {
  dispatchEvent(webview, "app:theme", { value });
}

export function dispatchBookmarks(
  webview: WebView | null,
  ids: string[],
): void {
  dispatchEvent(webview, "app:bookmarks", { ids });
}

export function dispatchRead(webview: WebView | null, ids: string[]): void {
  dispatchEvent(webview, "app:read", { ids });
}

export function dispatchInsets(
  webview: WebView | null,
  top: number,
  bottom: number,
): void {
  dispatchEvent(webview, "app:insets", { top, bottom });
}

/**
 * Dispatch all current app state to a webview (called when page becomes ready).
 */
export function dispatchAllState(
  webview: WebView | null,
  state: {
    fontScale: number;
    theme: "light" | "dark";
    bookmarks: string[];
    readIds: string[];
    insets: { top: number; bottom: number };
  },
): void {
  dispatchFontScale(webview, state.fontScale);
  dispatchTheme(webview, state.theme);
  dispatchBookmarks(webview, state.bookmarks);
  dispatchRead(webview, state.readIds);
  dispatchInsets(webview, state.insets.top, state.insets.bottom);
}

/**
 * Tell the injected script that the app is ready to receive the read event.
 * Until this runs, the read watcher stays quiet, so a read is never reported while the
 * native loading state is still on screen.
 */
export function markPageReady(webview: WebView | null): void {
  if (!webview) return;
  webview.injectJavaScript("window.__appReady = true; true;");
}

/** Ask the page for its title, so the app can label the article. */
export function requestTitle(webview: WebView | null): void {
  if (!webview) return;
  webview.injectJavaScript(
    "if (window.__appReportTitle) window.__appReportTitle(); true;",
  );
}
