
/**
 * Page -> app messages. See AGENTS.md "Message protocol".
 * The web tracker sends messages with a `command` field and no `type`;
 * those are routed to the tracker SDK, not handled here.
 */

export interface ReadyMessage {
  type: 'ready';
  protocol: 1;
  page: 'front' | 'article';
  articleId?: string; // article only
}

export interface HeightMessage {
  type: 'height';
  value: number; // content height in CSS pixels
}

export interface ToggleBookmarkMessage {
  type: 'toggleBookmark';
  articleId: string;
}

export interface OpenArticleMessage {
  type: 'openArticle';
  path: string; // e.g. /article/2?ref=related — may carry a query string
}

/**
 * App-internal messages, sent by the JavaScript the app injects into the page.
 * They are not part of the page protocol, but they share the same channel.
 */
export interface ArticleReadMessage {
  type: 'articleRead';
  articleId: string;
}

/** The front page reports the offset of a "Jump to" target so the native scroll view can move. */
export interface ScrollToMessage {
  type: 'scrollTo';
  offset: number;
}

/** The reader pulled down at the top of a page. */
export interface PullToRefreshMessage {
  type: 'pullToRefresh';
}

/** A link that is not ours; the app hands it to the operating system. */
export interface OpenExternalMessage {
  type: 'openExternal';
  url: string;
}

/** The page's title, asked for once the page is ready, so the app can label it. */
export interface TitleMessage {
  type: 'title';
  value: string;
}

export type PageMessage =
  | ReadyMessage
  | HeightMessage
  | ToggleBookmarkMessage
  | OpenArticleMessage
  | ArticleReadMessage
  | ScrollToMessage
  | PullToRefreshMessage
  | OpenExternalMessage
  | TitleMessage;

/** Returns the parsed page message, or null if this message belongs to
 *  another script on the page (e.g. the web tracker). */
export function parsePageMessage(raw: string): PageMessage | null {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    if (typeof msg !== 'object' || msg === null) return null;
    switch (msg.type) {
      case 'ready':
      case 'height':
      case 'toggleBookmark':
      case 'openArticle':
      case 'articleRead':
      case 'scrollTo':
      case 'pullToRefresh':
      case 'openExternal':
      case 'title':
        return msg as unknown as PageMessage;
      default:
        return null; // command-field messages etc. -> tracker callback
    }
  } catch {
    return null;
  }
}

/** App -> page events, dispatched as CustomEvents on window. */
export type AppEvent =
  | { name: 'app:fontScale'; detail: { value: number } }
  | { name: 'app:theme'; detail: { value: 'light' | 'dark' } }
  | { name: 'app:bookmarks'; detail: { ids: string[] } }
  | { name: 'app:read'; detail: { ids: string[] } }
  | { name: 'app:insets'; detail: { top: number; bottom: number } };
