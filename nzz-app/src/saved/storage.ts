import * as FileSystem from "expo-file-system/legacy";
import { enforceMaxSavedArticles } from "./downloader";

export interface SavedArticle {
  articleId: string;
  title: string;
  version: string;
  savedAt: number;
  size: number;
  fileCount: number;
  path: string;
}

const SAVED_ARTICLES_DIR = "saved-articles/";

interface SavedMeta {
  articleId: string;
  title: string;
  version: string;
  savedAt: number;
}

/**
 * The truth for "this article is saved" is the file system: a folder that holds a verified
 * `index.html` and a `meta.json`. Nothing is taken from the app's own records.
 */
export async function getSavedArticles(): Promise<SavedArticle[]> {
  const baseDir = `${FileSystem.documentDirectory}${SAVED_ARTICLES_DIR}`;

  try {
    const dirInfo = await FileSystem.getInfoAsync(baseDir);
    if (!dirInfo.exists || !dirInfo.isDirectory) return [];

    const entries = await FileSystem.readDirectoryAsync(baseDir);
    const articles: SavedArticle[] = [];

    for (const entry of entries) {
      const articlePath = `${baseDir}${entry}/`;
      const info = await FileSystem.getInfoAsync(articlePath);
      if (!info.exists || !info.isDirectory) continue;

      // A copy is only valid if its page is there.
      const indexInfo = await FileSystem.getInfoAsync(
        `${articlePath}index.html`,
      );
      if (!indexInfo.exists) continue;

      const meta = await readMeta(articlePath);
      const { size, fileCount } = await measure(articlePath);

      articles.push({
        articleId: meta?.articleId ?? entry,
        title: meta?.title ?? entry,
        version: meta?.version ?? entry,
        savedAt:
          meta?.savedAt ??
          (info.modificationTime ? info.modificationTime * 1000 : Date.now()),
        size,
        fileCount,
        path: articlePath,
      });
    }

    articles.sort((a, b) => b.savedAt - a.savedAt);

    // One entry per article: if an update left an older version on disk, show the newest.
    const newestByArticle = new Map<string, SavedArticle>();
    for (const article of articles) {
      if (!newestByArticle.has(article.articleId))
        newestByArticle.set(article.articleId, article);
    }

    return [...newestByArticle.values()];
  } catch {
    return [];
  }
}

async function readMeta(articlePath: string): Promise<SavedMeta | null> {
  try {
    const metaPath = `${articlePath}meta.json`;
    const info = await FileSystem.getInfoAsync(metaPath);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(metaPath);
    return JSON.parse(raw) as SavedMeta;
  } catch {
    return null;
  }
}

async function measure(
  dir: string,
): Promise<{ size: number; fileCount: number }> {
  let size = 0;
  let fileCount = 0;

  const walk = async (current: string) => {
    const entries = await FileSystem.readDirectoryAsync(current);
    for (const entry of entries) {
      const path = `${current}${entry}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) continue;
      if (info.isDirectory) {
        await walk(`${path}/`);
      } else {
        size += info.size ?? 0;
        fileCount += 1;
      }
    }
  };

  await walk(dir);
  return { size, fileCount };
}

/**
 * Total size and file count of the saved-articles folder, measured from the file system.
 */
export async function getSavedArticlesStats(): Promise<{
  totalSize: number;
  totalFiles: number;
}> {
  const baseDir = `${FileSystem.documentDirectory}${SAVED_ARTICLES_DIR}`;

  try {
    const info = await FileSystem.getInfoAsync(baseDir);
    if (!info.exists) return { totalSize: 0, totalFiles: 0 };
    const { size, fileCount } = await measure(baseDir);
    return { totalSize: size, totalFiles: fileCount };
  } catch {
    return { totalSize: 0, totalFiles: 0 };
  }
}

/** Check if an article is saved (any version). */
export async function isArticleSaved(articleId: string): Promise<boolean> {
  const articles = await getSavedArticles();
  return articles.some((article) => article.articleId === articleId);
}

/** Get the saved version of an article, if any. */
export async function getSavedArticleVersion(
  articleId: string,
): Promise<string | null> {
  const articles = await getSavedArticles();
  return (
    articles.find((article) => article.articleId === articleId)?.version ?? null
  );
}

/** Get the local file URL for a saved article's index.html. */
export async function getSavedArticleUrl(
  articleId: string,
  version: string,
): Promise<string | null> {
  const path = `${FileSystem.documentDirectory}${SAVED_ARTICLES_DIR}${articleId}-${version}/index.html`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  // `documentDirectory` already starts with `file://` on both platforms; only add the scheme
  // if it is missing, so the URL is never `file://file:///...`.
  return path.startsWith("file://") ? path : `file://${path}`;
}

/** Clean up any stale temporary directories left by a download that was killed. */
export async function cleanupStaleTempDirs(): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return;

  try {
    const entries = await FileSystem.readDirectoryAsync(cacheDir);
    for (const entry of entries) {
      if (entry.startsWith("article-") && entry.endsWith("-tmp")) {
        await FileSystem.deleteAsync(`${cacheDir}${entry}/`, {
          idempotent: true,
        });
      }
    }
  } catch {
    // Ignore.
  }
}

/** Delete every saved version of an article. */
export async function deleteSavedArticle(articleId: string): Promise<void> {
  const baseDir = `${FileSystem.documentDirectory}${SAVED_ARTICLES_DIR}`;

  try {
    const info = await FileSystem.getInfoAsync(baseDir);
    if (!info.exists) return;

    const entries = await FileSystem.readDirectoryAsync(baseDir);
    for (const entry of entries) {
      const path = `${baseDir}${entry}/`;
      const meta = await readMeta(path);
      const id = meta?.articleId ?? entry.replace(/-[0-9a-f]{8}$/, "");
      if (id === articleId)
        await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch {
    // Best effort.
  }
}

/** Delete all saved articles. */
export async function deleteAllSavedArticles(): Promise<void> {
  const baseDir = `${FileSystem.documentDirectory}${SAVED_ARTICLES_DIR}`;
  await FileSystem.deleteAsync(baseDir, { idempotent: true });
}

export { enforceMaxSavedArticles };
