import { Platform } from "react-native";
import { SERVER_URL } from "../config";

export interface InjectParams {
  pageType: "front" | "article";
  insets: { top: number; bottom: number };
  appVersion: string;
  appBuild: string;
  articleId?: string;
}

/**
 * JavaScript injected before the page's own scripts run.
 *
 * It sets `window.appInsets` and `window.appContext` (both read once, at document start),
 * intercepts links, and — on an article — watches for the end of the article text.
 *
 * The read watcher only starts once the app has told the page it is ready
 * (`window.__appReady`), so it never fires while the native loading state is still up.
 */
export function getInjectedJavaScript(params: InjectParams): string {
  const { pageType, insets, appVersion, appBuild, articleId } = params;
  const isArticle = pageType === "article";

  return `
(function () {
  'use strict';

  // --- Read once, at document start --------------------------------------
  window.appInsets = { top: ${insets.top}, bottom: ${insets.bottom} };
  window.appContext = {
    appVersion: ${JSON.stringify(appVersion)},
    appBuild: ${JSON.stringify(appBuild)},
    os: ${JSON.stringify(Platform.OS)},
    deviceType: ${JSON.stringify(Platform.OS === "ios" ? "phone" : "phone")}
  };
  window.__appReady = false;

  function post(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  // The app asks for the title once the page is ready, so it can label the article.
  window.__appReportTitle = function () {
    post({ type: 'title', value: document.title || '' });
  };

  ${
    isArticle
      ? `
  // --- Pull to refresh ----------------------------------------------------
  // The article page scrolls itself, so the app cannot use a native RefreshControl. A pull
  // down at the very top of the page is reported instead, and the app reloads the page.
  var pullArmed = false;
  var touchStartY = 0;
  window.addEventListener('scroll', function () {
    if (window.scrollY <= 0) pullArmed = true;
    else if (window.scrollY > 24) pullArmed = false;
  }, { passive: true });

  window.addEventListener('touchstart', function (event) {
    if (window.scrollY <= 0 && event.touches && event.touches.length === 1) {
      pullArmed = true;
      touchStartY = event.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('touchmove', function (event) {
    if (!pullArmed || !event.touches || event.touches.length !== 1) return;
    if (window.scrollY > 0) return;
    if (event.touches[0].clientY - touchStartY > 90) {
      pullArmed = false;
      post({ type: 'pullToRefresh' });
    }
  }, { passive: true });

  window.addEventListener('touchend', function () {
    pullArmed = false;
  }, { passive: true });

  window.addEventListener('touchcancel', function () {
    pullArmed = false;
  }, { passive: true });
  `
      : ""
  }

  // --- Links --------------------------------------------------------------
  function isExternal(href) {
    if (!href) return false;
    if (/^(mailto:|tel:|sms:)/i.test(href)) return true;
    if (/^https?:\\/\\//i.test(href)) {
      try {
        return new URL(href, location.href).origin !== location.origin;
      } catch (error) {
        return true;
      }
    }
    return false;
  }

  function articlePath(href) {
    var match = String(href).match(/\\/article\\/([\\w-]+)(\\?[^#]*)?/);
    return match ? '/article/' + match[1] + (match[2] || '') : null;
  }

  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;

    var href = anchor.getAttribute('href') || '';

    // Anything that is not ours goes to the operating system.
    if (isExternal(href)) {
      event.preventDefault();
      try {
        post({ type: 'openExternal', url: new URL(href, location.href).href });
      } catch (error) {}
      return;
    }

    // A link to an article pushes a new article screen, query string and all.
    var path = articlePath(href);
    if (path) {
      event.preventDefault();
      post({ type: 'openArticle', path: path });
      return;
    }

    // An in-page anchor.
    if (href.charAt(0) === '#') {
      var id = href.slice(1);
      var target = id ? document.getElementById(id) : null;
      if (!target) return;
      event.preventDefault();
      ${
        isArticle
          ? `target.scrollIntoView({ block: 'start' });`
          : `post({ type: 'scrollTo', offset: Math.round(target.getBoundingClientRect().top) });`
      }
    }
  }, true);

  ${
    isArticle
      ? `
  // The "Jump" button changes location.hash without a click on an anchor.
  window.addEventListener('hashchange', function () {
    var id = location.hash.slice(1);
    var target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView({ block: 'start' });
  });

  // --- End of the article text -------------------------------------------
  var articleId = ${JSON.stringify(articleId ?? "")};
  var readReported = false;

  function insetValue(name) {
    var value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return isFinite(value) ? value : 0;
  }

  function lastTextLine() {
    var paragraphs = document.querySelectorAll('.articlecomponent.text p');
    return paragraphs.length ? paragraphs[paragraphs.length - 1] : null;
  }

  function checkEndOfText() {
    if (readReported || !window.__appReady) return;

    var last = lastTextLine();
    if (!last) return;

    var bounds = last.getBoundingClientRect();
    var visibleTop = insetValue('--inset-top');
    var visibleBottom = window.innerHeight - insetValue('--inset-bottom');

    if (bounds.height <= 0) return;
    if (bounds.bottom > visibleBottom + 1) return;
    if (bounds.bottom < visibleTop) return;

    readReported = true;
    post({ type: 'articleRead', articleId: articleId });
  }

  window.addEventListener('scroll', checkEndOfText, { passive: true });
  window.addEventListener('resize', checkEndOfText);
  setInterval(checkEndOfText, 400);
  `
      : ""
  }
})();
true;
`;
}

/** Get the base URL for a page (front or article). */
export function getPageUrl(
  page: "front" | "article",
  articleId?: string,
  queryString?: string,
): string {
  let url = `${SERVER_URL}/${page === "front" ? "front" : "article/" + articleId}`;
  if (queryString) {
    url += "?" + queryString;
  }
  return url;
}

/** Append the consent fragment to a URL, if there is a consent string. */
export function withConsent(url: string, consent: string | null): string {
  if (!consent) return url;
  return `${url}#consent=${encodeURIComponent(consent)}`;
}
