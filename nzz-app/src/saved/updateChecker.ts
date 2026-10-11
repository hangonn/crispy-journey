
import { fetchManifest, ArticleManifest } from './manifest';
import { getSavedArticleVersion } from './storage';

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  latestManifest?: ArticleManifest;
}

export interface UpdateCheckResult {
  articleId: string;
  updateInfo: UpdateInfo;
  error?: string;
}

/**
 * Check whether a saved article has a newer version on the server. A different `version`
 * value means the article changed.
 */
export async function checkForUpdate(articleId: string): Promise<UpdateCheckResult> {
  try {
    const currentVersion = await getSavedArticleVersion(articleId);
    if (!currentVersion) {
      return {
        articleId,
        updateInfo: { hasUpdate: false, currentVersion: '', latestVersion: '' },
        error: 'Article not saved',
      };
    }

    const latestManifest = await fetchManifest(articleId);
    const hasUpdate = latestManifest.version !== currentVersion;

    return {
      articleId,
      updateInfo: {
        hasUpdate,
        currentVersion,
        latestVersion: latestManifest.version,
        latestManifest: hasUpdate ? latestManifest : undefined,
      },
    };
  } catch (error) {
    return {
      articleId,
      updateInfo: { hasUpdate: false, currentVersion: '', latestVersion: '' },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
