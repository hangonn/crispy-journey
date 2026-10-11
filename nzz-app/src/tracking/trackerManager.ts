import { Platform } from "react-native";
import { SERVER_URL, APP_VERSION } from "../config";
import {
  newTracker,
  getWebViewCallback,
  Tracker,
  SelfDescribingJson,
  ScreenViewEvent,
  WebViewMessage,
} from "./tracker";

let trackerInstance: Tracker | null = null;

/**
 * Events tracked before the reader had chosen. They are replayed, in order, the moment the
 * tracker is created, so nothing is lost and nothing reaches the collector before consent.
 */
const pendingAppEvents: ((tracker: Tracker) => void)[] = [];
const pendingWebViewMessages: WebViewMessage[] = [];

const MAX_PENDING = 500;

const webViewCallback = getWebViewCallback();

/**
 * Create the tracker once `/consent` has answered with a consent string.
 *
 * Calling this with `null` does nothing: the reader has not chosen, so no tracker exists and
 * nothing is sent. Calling it again with a string after a tracker already exists is a no-op.
 */
export function initializeTracker(consentString: string | null): void {
  if (trackerInstance) return;
  if (!consentString) return;

  trackerInstance = newTracker({
    namespace: "news-app",
    endpoint: SERVER_URL,
    appVersion: APP_VERSION,
    platform: Platform.OS as "ios" | "android",
  });

  // Replay everything that happened before consent, in order.
  const appEvents = pendingAppEvents.splice(0, pendingAppEvents.length);
  appEvents.forEach((send) => send(trackerInstance as Tracker));

  const webMessages = pendingWebViewMessages.splice(
    0,
    pendingWebViewMessages.length,
  );
  webMessages.forEach((message) => webViewCallback(message));
}

export function getTrackerInstance(): Tracker | null {
  return trackerInstance;
}

export function isTrackerReady(): boolean {
  return trackerInstance !== null;
}

/** Track a screen view. Buffered until the tracker exists. */
export function trackScreenView(
  event: ScreenViewEvent,
  contexts?: SelfDescribingJson[],
): void {
  if (trackerInstance) {
    trackerInstance.trackScreenViewEvent(event, contexts);
    return;
  }

  pushPending((tracker) => tracker.trackScreenViewEvent(event, contexts));
}

/** Track the article-read event. Buffered until the tracker exists. */
export function trackArticleRead(articleId: string): void {
  const event: SelfDescribingJson = {
    schema: "iglu:com.example.news/article_read/jsonschema/1-0-0",
    data: { articleId },
  };

  if (trackerInstance) {
    trackerInstance.trackSelfDescribingEvent(event);
    return;
  }

  pushPending((tracker) => tracker.trackSelfDescribingEvent(event));
}

/**
 * Hand a raw message from a page to the tracker SDK. The SDK picks out the web tracker's
 * events and ignores everything else. Buffered until the tracker exists so the page's own
 * events (page views, teaser taps) are not lost either.
 */
export function handleTrackerMessage(rawMessage: string): void {
  const message: WebViewMessage = { nativeEvent: { data: rawMessage } };

  if (trackerInstance) {
    webViewCallback(message);
    return;
  }

  if (pendingWebViewMessages.length >= MAX_PENDING)
    pendingWebViewMessages.shift();
  pendingWebViewMessages.push(message);
}

function pushPending(send: (tracker: Tracker) => void): void {
  if (pendingAppEvents.length >= MAX_PENDING) pendingAppEvents.shift();
  pendingAppEvents.push(send);
}

/** Reset tracker state (tests only). */
export function resetTracker(): void {
  trackerInstance = null;
  pendingAppEvents.length = 0;
  pendingWebViewMessages.length = 0;
}
