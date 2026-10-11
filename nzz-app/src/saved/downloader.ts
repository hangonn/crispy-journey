
import * as FileSystem from 'expo-file-system/legacy';
import { ArticleManifest, ManifestFile, absoluteFileUrl } from './manifest';
import { MAX_SAVED_ARTICLES } from '../config';

export interface DownloadProgress {
  articleId: string;
  version: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  currentFile?: string;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const SAVED_DIR = 'saved-articles/';

/**
 * Downloads that are running right now, so the Saved screen can list them and a second tap
 * on the same article does not start a second download.
 */
const activeDownloads = new Map<string, Promise<string>>();
const activeProgress = new Map<string, DownloadProgress>();

export function getActiveDownloads(): DownloadProgress[] {
  return [...activeProgress.values()];
}

export function isDownloading(articleId: string): boolean {
  return activeProgress.has(articleId);
}

/**
 * Download every file in an article's manifest to a temporary directory, then move it into
 * place in one step. A copy is saved completely or not at all: on any failure the temporary
 * directory is removed and nothing is left behind.
 */
export function downloadArticle(
  manifest: ArticleManifest,
  onProgress: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<string> {
  const key = `${manifest.articleId}-${manifest.version}`;
  const existing = activeDownloads.get(key);
  if (existing) return existing;

  const run = runDownload(manifest, onProgress, abortSignal).finally(() => {
    activeDownloads.delete(key);
    activeProgress.delete(manifest.articleId);
  });

  activeDownloads.set(key, run);
  return run;
}

async function runDownload(
  manifest: ArticleManifest,
  onProgress: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { articleId, version } = manifest;
  const tempDir = `${FileSystem.cacheDirectory}article-${articleId}-${version}-tmp/`;
  const finalDir = `${FileSystem.documentDirectory}${SAVED_DIR}${articleId}-${version}/`;

  await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

  const totalFiles = manifest.files.length;
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  let completedFiles = 0;
  let downloadedBytes = 0;

  const report = (status: DownloadProgress['status'], currentFile?: string, error?: string) => {
    const progress: DownloadProgress = {
      articleId,
      version,
      totalFiles,
      completedFiles,
      totalBytes,
      downloadedBytes,
      currentFile,
      status,
      error,
    };
    activeProgress.set(articleId, progress);
    onProgress(progress);
  };

  const checkAbort = () => {
    if (abortSignal?.aborted) throw new Error('Download cancelled');
  };

  async function downloadFile(file: ManifestFile, attempt = 0): Promise<void> {
    checkAbort();

    const filePath = `${tempDir}${file.path}`;
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    await FileSystem.makeDirectoryAsync(fileDir, { intermediates: true });

    report('downloading', file.path);

    try {
      const result = await FileSystem.downloadAsync(absoluteFileUrl(file.url), filePath);
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);

      completedFiles += 1;
      downloadedBytes += file.bytes;
      report('downloading', file.path);
    } catch (error) {
      if (attempt < MAX_RETRIES && !abortSignal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        return downloadFile(file, attempt + 1);
      }
      throw error;
    }
  }

  try {
    for (const file of manifest.files) {
      checkAbort();
      await downloadFile(file);
    }

    // Verify every file is there before the copy counts as saved.
    for (const file of manifest.files) {
      const info = await FileSystem.getInfoAsync(`${tempDir}${file.path}`);
      if (!info.exists) throw new Error(`Missing file after download: ${file.path}`);
    }

    // Our own bookkeeping, written into the temporary copy so the move stays atomic.
    await FileSystem.writeAsStringAsync(
      `${tempDir}meta.json`,
      JSON.stringify({ articleId, title: manifest.title, version, savedAt: Date.now() }),
    );

    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}${SAVED_DIR}`, { intermediates: true });
    await FileSystem.moveAsync({ from: tempDir, to: finalDir });

    report('completed');
    await enforceMaxSavedArticles();

    return finalDir;
  } catch (error) {
    await FileSystem.deleteAsync(tempDir, { idempotent: true }).catch(() => {});
    report('failed', undefined, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

/**
 * Keep at most {@link MAX_SAVED_ARTICLES} articles. Saving one more removes the article that
 * was saved longest ago, together with all of its versions. An update adds a version to an
 * article that is already counted, so it never evicts a different article.
 */
export async function enforceMaxSavedArticles(): Promise<void> {
  const baseDir = `${FileSystem.documentDirectory}${SAVED_DIR}`;

  try {
    const info = await FileSystem.getInfoAsync(baseDir);
    if (!info.exists) return;

    const entries = await FileSystem.readDirectoryAsync(baseDir);
    const byArticle = new Map<string, { paths: string[]; savedAt: number }>();

    for (const entry of entries) {
      const path = `${baseDir}${entry}/`;
      const dirInfo = await FileSystem.getInfoAsync(path);
      if (!dirInfo.exists || !dirInfo.isDirectory) continue;

      const meta = await readMeta(path);
      const articleId = meta?.articleId ?? entry.replace(/-[0-9a-f]{8}$/, '');
      const savedAt = meta?.savedAt ?? (dirInfo.modificationTime ? dirInfo.modificationTime * 1000 : 0);

      const group = byArticle.get(articleId) ?? { paths: [], savedAt: Number.POSITIVE_INFINITY };
      group.paths.push(path);
      group.savedAt = Math.min(group.savedAt, savedAt);
      byArticle.set(articleId, group);
    }

    if (byArticle.size <= MAX_SAVED_ARTICLES) return;

    const ordered = [...byArticle.values()].sort((a, b) => a.savedAt - b.savedAt);
    for (const group of ordered.slice(0, byArticle.size - MAX_SAVED_ARTICLES)) {
      for (const path of group.paths) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    }
  } catch {
    // Best effort.
  }
}

async function readMeta(articlePath: string): Promise<{ articleId: string; savedAt: number } | null> {
  try {
    const metaPath = `${articlePath}meta.json`;
    const info = await FileSystem.getInfoAsync(metaPath);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(metaPath));
  } catch {
    return null;
  }
}

/** Cancel an in-progress download by removing its temporary directory. */
export async function cancelDownload(articleId: string, version: string): Promise<void> {
  const tempDir = `${FileSystem.cacheDirectory}article-${articleId}-${version}-tmp/`;
  await FileSystem.deleteAsync(tempDir, { idempotent: true });
}
