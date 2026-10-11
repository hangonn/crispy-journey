
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { WebView } from 'react-native-webview';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { handleWebViewMessage } from '../protocol/bridge';
import {
  dispatchAllState,
  dispatchFontScale,
  dispatchTheme,
  dispatchBookmarks,
  dispatchRead,
  dispatchInsets,
  markPageReady,
  requestTitle,
} from '../protocol/dispatch';
import { getInjectedJavaScript, getPageUrl, withConsent } from '../protocol/inject';
import { useFontScale, useTheme, useBookmarks, useReadIds } from '../state/store';
import { useConsentString, useConsentResolved } from '../state/consent';
import { trackScreenView } from '../tracking/trackerManager';
import { APP_VERSION, APP_BUILD } from '../config';

export type PageType = 'front' | 'article';
export type PageStatus = 'loading' | 'ready' | 'error';

export interface NewsWebViewHandle {
  /** Reload the page, picking up the newest consent string. */
  reload: () => void;
}

export interface NewsWebViewProps {
  pageType: PageType;
  articleId?: string;
  queryString?: string;
  insets: { top: number; bottom: number };
  /** When set, the page is loaded from a saved copy instead of the server. */
  savedUrl?: string;
  onHeightChange?: (height: number) => void;
  onOpenArticle?: (path: string) => void;
  onToggleBookmark?: (articleId: string) => void;
  onArticleRead?: (articleId: string) => void;
  onScrollTo?: (offset: number) => void;
  onTitle?: (title: string) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/** How long a page may take to become ready before the app gives up and shows the error state. */
const READY_TIMEOUT_MS = 15000;

interface DispatchedState {
  documentId: string;
  fontScale: number;
  theme: 'light' | 'dark';
  bookmarks: string[];
  readIds: string[];
  insets: { top: number; bottom: number };
}

export const NewsWebView = forwardRef<NewsWebViewHandle, NewsWebViewProps>(function NewsWebView(
  {
    pageType,
    articleId,
    queryString,
    insets,
    savedUrl,
    onHeightChange,
    onOpenArticle,
    onToggleBookmark,
    onArticleRead,
    onScrollTo,
    onTitle,
    onReady,
    onError,
  },
  ref,
) {
  const webviewRef = useRef<WebView>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [documentId, setDocumentId] = useState('');

  const fontScale = useFontScale();
  const theme = useTheme();
  const bookmarks = useBookmarks();
  const readIds = useReadIds();
  const consentString = useConsentString();
  const consentResolved = useConsentResolved();

  const isSaved = !!savedUrl;

  // The URL is captured once per document. A consent string that arrives while the page is
  // open must not reload it, so the source only changes when we deliberately reload.
  const buildUrl = useCallback(
    () => (savedUrl ? savedUrl : withConsent(getPageUrl(pageType, articleId, queryString), consentString)),
    [savedUrl, pageType, articleId, queryString, consentString],
  );
  const [sourceUrl, setSourceUrl] = useState('');

  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchedRef = useRef<DispatchedState | null>(null);
  // The consent string the current document was loaded with (null = loaded without one).
  const urlConsentRef = useRef<string | null>(null);
  const reloadedForConsentRef = useRef(false);
  // One screen view per loaded document, even if the page announces itself more than once.
  const screenViewTrackedRef = useRef(false);
  // Some teasers announce the tap themselves *and* are ordinary links, so the same
  // openArticle can arrive twice. Only the first within a short window is acted on.
  const lastOpenRef = useRef<{ path: string; at: number } | null>(null);

  const clearReadyTimer = useCallback(() => {
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  }, []);

  // An online page does not start loading until the app knows the consent string, or knows
  // there is none. The first load therefore already carries the resolved consent.
  useEffect(() => {
    if (sourceUrl) return;
    if (!isSaved && !consentResolved) return;
    urlConsentRef.current = consentString;
    setSourceUrl(buildUrl());
  }, [sourceUrl, isSaved, consentResolved, consentString, buildUrl]);

  const reload = useCallback(() => {
    setStatus('loading');
    dispatchedRef.current = null;
    urlConsentRef.current = consentString;
    const next = buildUrl();
    if (sourceUrl === next) {
      // Same URL: ask the web view to reload in place.
      webviewRef.current?.reload();
    } else {
      setSourceUrl(next);
    }
  }, [buildUrl, consentString, sourceUrl]);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  // A page that was loaded with no consent at all reloads once, as soon as one is available,
  // so its ads can load. A page loaded with consent is never reloaded by a later change.
  useEffect(() => {
    if (isSaved) return;
    if (!consentString) return;
    if (reloadedForConsentRef.current) return;
    if (urlConsentRef.current !== null) return;
    if (status !== 'ready') return;

    reloadedForConsentRef.current = true;
    reload();
  }, [isSaved, consentString, status, reload]);

  const onMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      const message = handleWebViewMessage(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case 'ready': {
          if (message.protocol !== 1) return;
          clearReadyTimer();
          const doc = message.articleId || 'document';
          setDocumentId(doc);
          setStatus('ready');
          markPageReady(webviewRef.current);
          requestTitle(webviewRef.current);
          onReady?.();
          if (!screenViewTrackedRef.current) {
            screenViewTrackedRef.current = true;
            if (pageType === 'front') trackScreenView({ name: 'front' });
            else if (articleId) trackScreenView({ name: 'article', id: articleId });
          }
          break;
        }
        case 'height':
          if (typeof message.value === 'number') onHeightChange?.(message.value);
          break;
        case 'toggleBookmark':
          if (message.articleId) onToggleBookmark?.(message.articleId);
          break;
        case 'openArticle':
          if (message.path) {
            const now = Date.now();
            const last = lastOpenRef.current;
            if (!last || last.path !== message.path || now - last.at > 500) {
              lastOpenRef.current = { path: message.path, at: now };
              onOpenArticle?.(message.path);
            }
          }
          break;
        case 'articleRead':
          if (message.articleId) onArticleRead?.(message.articleId);
          break;
        case 'scrollTo':
          if (typeof message.offset === 'number') onScrollTo?.(message.offset);
          break;
        case 'title':
          if (message.value) onTitle?.(message.value);
          break;
        case 'pullToRefresh':
          reload();
          break;
        case 'openExternal':
          if (message.url) Linking.openURL(message.url).catch(() => {});
          break;
      }
    },
    [
      pageType,
      articleId,
      clearReadyTimer,
      onReady,
      onHeightChange,
      onToggleBookmark,
      onOpenArticle,
      onArticleRead,
      onScrollTo,
      onTitle,
      reload,
    ],
  );

  const onLoadStart = useCallback(() => {
    setStatus('loading');
    screenViewTrackedRef.current = false;
    clearReadyTimer();
    readyTimerRef.current = setTimeout(() => {
      setStatus('error');
      onError?.(new Error(`The page did not become ready in time (${sourceUrl}).`));
    }, READY_TIMEOUT_MS);
  }, [clearReadyTimer, onError, sourceUrl]);

  const onLoadError = useCallback(
    (event: { nativeEvent?: { description?: string } }) => {
      clearReadyTimer();
      setStatus('error');
      onError?.(new Error(event.nativeEvent?.description || 'Failed to load the page.'));
    },
    [clearReadyTimer, onError],
  );

  const onHttpError = useCallback(
    (event: { nativeEvent?: { statusCode?: number; url?: string } }) => {
      const url = event.nativeEvent?.url ?? '';
      // Only the page itself matters; a missing image must not fail the screen.
      if (url && sourceUrl && url.split('#')[0] !== sourceUrl.split('#')[0]) return;
      clearReadyTimer();
      setStatus('error');
      onError?.(new Error(`The page answered with HTTP ${event.nativeEvent?.statusCode ?? 'error'}.`));
    },
    [clearReadyTimer, onError, sourceUrl],
  );

  // A web view never leaves the page it was opened for. Only an external http(s) navigation
  // is handed to the operating system; the page itself, its files (file://) and data: URLs
  // all load in the web view.
  const onShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      const url = request.url;
      if (!/^https?:\/\//i.test(url)) return true;
      const base = sourceUrl.split('#')[0];
      if (url.split('#')[0] === base) return true;
      Linking.openURL(url).catch(() => {});
      return false;
    },
    [sourceUrl],
  );

  // Dispatch app state: everything once when a document becomes ready, then only what changed.
  useEffect(() => {
    if (status !== 'ready' || !documentId) return;
    const webview = webviewRef.current;
    if (!webview) return;

    const previous = dispatchedRef.current;
    if (!previous || previous.documentId !== documentId) {
      dispatchAllState(webview, { fontScale, theme, bookmarks, readIds, insets });
    } else {
      if (previous.fontScale !== fontScale) dispatchFontScale(webview, fontScale);
      if (previous.theme !== theme) dispatchTheme(webview, theme);
      if (previous.bookmarks !== bookmarks) dispatchBookmarks(webview, bookmarks);
      if (previous.readIds !== readIds) dispatchRead(webview, readIds);
      if (previous.insets.top !== insets.top || previous.insets.bottom !== insets.bottom) {
        dispatchInsets(webview, insets.top, insets.bottom);
      }
    }

    dispatchedRef.current = { documentId, fontScale, theme, bookmarks, readIds, insets };
  }, [status, documentId, fontScale, theme, bookmarks, readIds, insets]);

  useEffect(() => clearReadyTimer, [clearReadyTimer]);

  // A page that could not be loaded because the server was unreachable retries by itself
  // once the device is back online. Only a real offline -> online transition retries, so a
  // device that is online but cannot reach the server does not loop.
  useEffect(() => {
    if (status !== 'error') return;
    let wasOffline = false;
    const unsubscribe = NetInfo.addEventListener((netInfo) => {
      if (netInfo.isConnected === false) {
        wasOffline = true;
      } else if (netInfo.isConnected === true && wasOffline) {
        wasOffline = false;
        reload();
      }
    });
    return () => unsubscribe();
  }, [status, reload]);

  // Online pages wait for the consent answer (or the five-second timeout) before loading.
  if (!isSaved && !consentResolved) return null;
  if (!sourceUrl) return null;

  const injectedJavaScript = getInjectedJavaScript({
    pageType,
    insets,
    appVersion: APP_VERSION,
    appBuild: APP_BUILD,
    articleId,
  });

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        source={{ uri: sourceUrl }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScript}
        onMessage={onMessage}
        onLoadStart={onLoadStart}
        onError={onLoadError}
        onHttpError={onHttpError}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        originWhitelist={['*']}
        mixedContentMode="always"
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        scalesPageToFit={false}
        scrollEnabled={pageType === 'article'}
        contentInsetAdjustmentBehavior="never"
        setSupportMultipleWindows={false}
        androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
