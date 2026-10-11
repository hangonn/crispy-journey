# NOTES.md

## How events reach the collector, and what happens to the ones from before the reader chose

The tracker SDK (`src/tracking/tracker.ts`, copied unchanged) batches events and POSTs them to
`<endpoint>/collect`. The app owns one tracker, created by `initializeTracker()` in
`src/tracking/trackerManager.ts` with namespace `news-app`, the server address, the app version
and the platform.

Consent gates the tracker, not the events. Until `/consent` answers with a string there is **no
tracker**, so nothing can reach the collector. Events tracked in the meantime are not lost: the
manager keeps two buffers — app events (`trackScreenView`, `trackArticleRead`) and raw web-view
messages (the page's own tracker, handed over by `handleWebViewMessage`). The moment a consent
string arrives, the tracker is created and both buffers are replayed in order. If the reader
never consents, the buffers are simply never flushed. The SDK's own queue is in memory only, so
nothing survives a restart — matching the SDK's documented behaviour.

## How I modelled the loading state and the consent rule, and why

**Loading.** `NewsWebView` owns a small state machine: `loading → ready | error`. A page is
`ready` only when it sends `{ type: 'ready', protocol: 1 }`. `onLoadStart` (a real load, including
a reload) sets `loading`; in-page navigation never fires it. A 15-second watchdog turns a page
that never becomes ready into the error state, and `onError` / `onHttpError` (for the page itself,
not its images) do the same. The screens render a native loading/error overlay over the web view.
On the front page, the overlay fills the web-view slot, hiding the page's own loading indicator;
the loading overlay lets touches through so pull-to-refresh still works. When the device goes
offline → online while in the error state, the web view reloads itself (NetInfo).

**Consent.** The store (`src/state/consent.ts`) has three states: `idle`, `waiting`, `resolved`.
An online page does not start loading until `resolved` is true — i.e. until `/consent` answered,
or five seconds passed, or the request failed. The URL is built once, when the page first loads,
so it carries the newest consent string the app has. A consent string that arrives or changes
while a page is open does **not** reload it; it applies to the next load. The one exception: a
page whose URL was built with no consent at all reloads exactly once when a string arrives, so
its ads can load. Saved copies never use consent.

**Why five seconds and one reload.** Waiting forever would leave the reader on a spinner whenever
the consent service is slow or down. Loading at once would show empty ad slots even when consent
is a moment away. Five seconds is the compromise: the reader gets a page quickly, and the single
reload recovers the ad revenue for the common "consent arrives late" case without ever
interrupting a page that already had consent.

## How the two page layouts share code, and where they differ

Both screens use `NewsWebView`, which owns the protocol, the injected script, consent, the
loading state, app-state dispatch and the tracker hand-off. They differ only in layout:

- **Front** (`FrontScreen`): a native `ScrollView` holds the Recently-read strip, the web view
  (with `scrollEnabled={false}`) and a footer. The web-view slot initially uses the window height
  so it can load reliably, then resizes to the page's reported height. The native scroll view
  scrolls; the page does not. Pull-to-refresh is a native `RefreshControl`. "Jump to" links arrive
  as a `scrollTo` message and move the native scroll view.
- **Article** (`ArticleScreen`): the web view fills the screen and scrolls itself
  (`scrollEnabled`). `ArticleHeader` floats over it; the page reserves the header's measured
  height via `window.appInsets` and `app:insets`. Pull-to-refresh is detected in the page (a pull
  at the top) and reported as a `pullToRefresh` message, because a native `RefreshControl` cannot
  wrap a self-scrolling web view. "Contents"/"Jump" links scroll the page itself.

## How the app finds the end of the article text, and what I would ask the web team for

The injected script (in `src/protocol/inject.ts`) selects the last `.articlecomponent.text p`,
compares its `getBoundingClientRect().bottom` against the viewport minus the insets, and reports
`articleRead` once. It only starts once the app has set `window.__appReady`, so a read is never
reported while the native loading state is up. The app tracks the read once per opened screen
(`ArticleScreen` guards it), and the page's own "end of text" line is never read by the app.

This depends on the web team's markup. I would ask them for a stable hook: a
`data-article-end` attribute on the last text paragraph, or a `window.articleEndElement`
reference, or an `articleEnd` event. Any of those would make the detection independent of CSS
class names and of what comes after the text.

## Part 3: reading offline

**Where copies live.** `${FileSystem.documentDirectory}saved-articles/<articleId>-<version>/`,
holding every manifest file at its `path`, plus a small `meta.json` (title, version, savedAt).

**Completely or not at all.** A download writes into
`${cacheDirectory}article-<id>-<version>-tmp/`, verifies every file exists, writes `meta.json`,
then `moveAsync`s the whole folder into place. Any failure or cancel deletes the temp folder. A
partial copy is therefore never shown and never left on disk. Stale temp folders are removed on
launch.

**Truth for "saved".** The file system: a folder that contains a verified `index.html` and
`meta.json`. Nothing is taken from the app's own records. The Saved screen measures file count
and bytes by walking that folder each time it is shown.

**Other rules.** At most five copies; saving a sixth removes the oldest (`enforceMaxSavedArticles`
runs after each successful save). A second tap on an article that is already downloading is a
no-op (a registry keyed by article+version). Failed downloads retry three times, then the reader
is told and nothing is left behind. An article that is saved opens from its copy whether or not
the server is reachable; when it is reachable, the app checks the manifest and, if the version
differs, downloads the new copy in the background while the old one stays readable, then offers a
"Switch" banner — the reader is never moved under their eyes.

## What I verified on iOS and Android, what differed, and what I assume

I ran the app against the fixture server on the Android emulator. Verified there: the front page
scrolls natively with the strip and footer; the article scrolls itself under the floating header;
font scale, theme, bookmarks and read marks reach both pages and survive a restart; the consent
flow (wait, load without consent, reload once when it arrives); the read event at the end of the
text; saving, opening offline, and the update banner. I have not tested the app on iOS.

Android needs `usesCleartextTraffic` (set in `app.json`) and reaches the host on `10.0.2.2`.

For a physical device, set `EXPO_PUBLIC_SERVER_URL` in the local `.env` to the fixture server's
current LAN address and port (`8787`). This override also takes precedence over the simulator
defaults in `src/config.ts`; update it when the host's LAN address changes.

Assumed without checking: real-device performance with the CDN photos, background download
behaviour when the app is suspended, and web-view process death (below).

## What I left out, and known bugs

Left out: a screen recording, E2E tests, landscape/tablet layouts, accessibility labels on every
control, and image preloading for saved copies.

### iOS testing

I have not tested the app on iOS, either on a simulator or a physical Apple device. I do not have
access to an Apple device or someone who can help test it, so iOS behavior remains unverified.

Known issues: the read heuristic depends on the web team's markup (above); the article header
height is measured at runtime, so the first paint reserves a default until `onLayout` fires. The
front page uses the window height until the first page-height message arrives, then resizes the
web-view slot to the reported height.

## Web-view process death in the background

The OS may kill a web view's content process while the app is backgrounded. On return the web
view can show a blank page. What should happen: detect it (`onContentProcessDidTerminate` on iOS,
`onRenderProcessGone` on Android), keep the app's own state (font scale, theme, bookmarks, read
ids, scroll position) in the store, reload the page with the same URL and consent, and restore
the scroll position with injected JS. The loading overlay should show during the reload. I did
not build this; the app's state already lives outside the web view, so only the reload and scroll
restore are missing.

## AI tools

Helped with: the Expo Router structure, the Zustand stores, the atomic-download pattern, and the
test scaffolding. I had to correct: the consent model (the first draft dropped pre-consent events
instead of buffering them), the tracker hand-off (it must buffer web-view messages too, not just
app events), the read detection (it must not fire while the loading overlay is up), and the
pull-to-refresh approach (a native `RefreshControl` cannot wrap a self-scrolling web view).
