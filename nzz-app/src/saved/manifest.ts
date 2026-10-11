import { SERVER_URL } from "../config";

export interface ManifestFile {
  path: string;
  url: string;
  bytes: number;
}

export interface ArticleManifest {
  articleId: string;
  title: string;
  version: string;
  files: ManifestFile[];
}

/**
 * A file's `url` is either a full URL (the article's photos, on the image CDN) or a path on
 * the server (`/bundle/...`). `FileSystem.downloadAsync` needs an absolute URL on both
 * platforms, so relative paths are resolved against the server here.
 */
export function absoluteFileUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  const base = SERVER_URL.replace(/\/+$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Fetch and validate the article manifest from the server.
 */
export async function fetchManifest(
  articleId: string,
): Promise<ArticleManifest> {
  const response = await fetch(
    `${SERVER_URL}/bundle/${articleId}/manifest.json`,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status}`);
  }

  const data = await response.json();

  // Validate the manifest structure
  if (
    !data.articleId ||
    !data.title ||
    !data.version ||
    !Array.isArray(data.files)
  ) {
    throw new Error("Invalid manifest format");
  }

  const files: ManifestFile[] = data.files.map((file: ManifestFile) => ({
    ...file,
    url: absoluteFileUrl(file.url),
  }));

  return { ...data, files } as ArticleManifest;
}
