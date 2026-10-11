
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { NewsWebView, NewsWebViewHandle, PageStatus } from '../webview/NewsWebView';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { ArticleHeader } from '../components/ArticleHeader';
import { useConsentString, useFetchConsent } from '../state/consent';
import { useAddReadArticle, useToggleBookmark, useSetArticleTitle } from '../state/store';
import { initializeTracker, trackArticleRead } from '../tracking/trackerManager';
import { isArticleSaved, getSavedArticleVersion, getSavedArticleUrl } from '../saved/storage';
import { fetchManifest, ArticleManifest } from '../saved/manifest';
import { downloadArticle, cancelDownload } from '../saved/downloader';
import { checkForUpdate } from '../saved/updateChecker';

interface ArticleScreenProps {
  articleId: string;
  queryString?: string;
}

type UpdateStatus = 'idle' | 'downloading' | 'ready' | 'failed';

export function ArticleScreen({ articleId, queryString }: ArticleScreenProps) {
  const webviewRef = useRef<NewsWebViewHandle>(null);
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState<Error | null>(null);

  // The header floats over the page; the page reserves the space it covers.
  const [headerHeight, setHeaderHeight] = useState(insets.top + 44);
  const pageInsets = { top: headerHeight, bottom: insets.bottom };

  // Saved copy state
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [checkingSaved, setCheckingSaved] = useState(true);

  // Save / update state
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<number | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateManifest, setUpdateManifest] = useState<ArticleManifest | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | undefined>(undefined);

  const saveAbortRef = useRef<AbortController | null>(null);
  const savingVersionRef = useRef<string | null>(null);
  const updateAbortRef = useRef<AbortController | null>(null);
  // One read event per opened article screen, never twice for the same screen.
  const readTrackedRef = useRef(false);

  const consentString = useConsentString();
  const fetchConsent = useFetchConsent();
  const addReadArticle = useAddReadArticle();
  const toggleBookmark = useToggleBookmark();
  const setArticleTitle = useSetArticleTitle();

  // Consent at launch and on foreground.
  useEffect(() => {
    fetchConsent();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') fetchConsent();
    });
    return () => subscription.remove();
  }, [fetchConsent]);

  useEffect(() => {
    initializeTracker(consentString);
  }, [consentString]);

  // Decide whether to open the saved copy or the online page.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const saved = await isArticleSaved(articleId);
      if (cancelled) return;

      if (saved) {
        const version = await getSavedArticleVersion(articleId);
        if (cancelled) return;
        if (version) {
          const url = await getSavedArticleUrl(articleId, version);
          if (cancelled) return;
          setSavedVersion(version);
          setSavedUrl(url);
        }
      }

      setCheckingSaved(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [articleId]);

  // When a saved article is opened and the server can be reached, look for a newer version.
  useEffect(() => {
    if (!savedVersion) return;
    let cancelled = false;

    (async () => {
      const result = await checkForUpdate(articleId);
      if (cancelled) return;
      if (!result.updateInfo.hasUpdate || !result.updateInfo.latestManifest) return;

      const manifest = result.updateInfo.latestManifest;
      setUpdateManifest(manifest);

      // If the newer version is already on disk (a previous attempt finished), just offer it.
      const alreadyDownloaded = await getSavedArticleUrl(articleId, manifest.version);
      if (cancelled) return;
      if (alreadyDownloaded) {
        setUpdateStatus('ready');
        return;
      }

      setUpdateStatus('downloading');
      setUpdateProgress(0);

      const controller = new AbortController();
      updateAbortRef.current = controller;

      try {
        await downloadArticle(
          manifest,
          (progress) => {
            if (progress.totalFiles > 0) {
              setUpdateProgress((progress.completedFiles / progress.totalFiles) * 100);
            }
          },
          controller.signal,
        );
        if (cancelled) return;
        setUpdateStatus('ready');
        setUpdateProgress(undefined);
      } catch {
        if (cancelled) return;
        setUpdateStatus('failed');
        setUpdateProgress(undefined);
      } finally {
        updateAbortRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [articleId, savedVersion]);

  const handleOpenArticle = useCallback((path: string) => {
    const match = path.match(/\/article\/([^?]+)(?:\?(.*))?/);
    if (!match) return;
    const nextId = match[1];
    const nextQuery = match[2] || '';
    router.push(nextQuery ? `/article/${nextId}?${nextQuery}` : `/article/${nextId}`);
  }, []);

  const handleArticleRead = useCallback(
    (readId: string) => {
      if (readId !== articleId) return;
      if (readTrackedRef.current) return;
      readTrackedRef.current = true;
      addReadArticle(articleId);
      trackArticleRead(articleId);
    },
    [articleId, addReadArticle],
  );

  const handleReady = useCallback(() => {
    setStatus('ready');
    setError(null);
  }, []);

  const handleError = useCallback((err: Error) => {
    setStatus('error');
    setError(err);
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setError(null);
    webviewRef.current?.reload();
  }, []);

  // --- Saving -------------------------------------------------------------
  const handleSavePress = useCallback(async () => {
    if (isSaving || savedVersion) return;

    setIsSaving(true);
    setSaveProgress(0);

    const controller = new AbortController();
    saveAbortRef.current = controller;

    try {
      const manifest = await fetchManifest(articleId);
      savingVersionRef.current = manifest.version;
      await downloadArticle(
        manifest,
        (progress) => {
          if (progress.totalFiles > 0) {
            setSaveProgress((progress.completedFiles / progress.totalFiles) * 100);
          }
        },
        controller.signal,
      );

      const url = await getSavedArticleUrl(articleId, manifest.version);
      setSavedVersion(manifest.version);
      setSavedUrl(url);
      setIsSaving(false);
      setSaveProgress(undefined);
    } catch (err) {
      setIsSaving(false);
      setSaveProgress(undefined);
      if (!controller.signal.aborted) {
        Alert.alert('Save failed', err instanceof Error ? err.message : 'The article could not be saved.');
      }
    } finally {
      saveAbortRef.current = null;
      savingVersionRef.current = null;
    }
  }, [articleId, isSaving, savedVersion]);

  const handleCancelSave = useCallback(async () => {
    saveAbortRef.current?.abort();
    // Remove anything the attempt left behind.
    if (savingVersionRef.current) await cancelDownload(articleId, savingVersionRef.current);
    setIsSaving(false);
    setSaveProgress(undefined);
  }, [articleId]);

  // --- Updates ------------------------------------------------------------
  const handleSwitchToUpdate = useCallback(async () => {
    if (!updateManifest) return;
    const url = await getSavedArticleUrl(articleId, updateManifest.version);
    setSavedVersion(updateManifest.version);
    setSavedUrl(url);
    setUpdateStatus('idle');
    setUpdateManifest(null);
    reload();
  }, [articleId, updateManifest, reload]);

  const handleCancelUpdate = useCallback(async () => {
    updateAbortRef.current?.abort();
    if (updateManifest) await cancelDownload(articleId, updateManifest.version);
    setUpdateStatus('idle');
    setUpdateManifest(null);
    setUpdateProgress(undefined);
  }, [articleId, updateManifest]);

  // "Later" keeps the downloaded copy on disk; it only hides the banner.
  const handleDismissUpdate = useCallback(() => {
    setUpdateStatus('idle');
    setUpdateManifest(null);
    setUpdateProgress(undefined);
  }, []);

  if (checkingSaved) {
    return <LoadingView message="Opening article…" />;
  }

  return (
    <View style={styles.container}>
      <NewsWebView
        ref={webviewRef}
        pageType="article"
        articleId={articleId}
        queryString={queryString}
        insets={pageInsets}
        savedUrl={savedUrl ?? undefined}
        onOpenArticle={handleOpenArticle}
        onToggleBookmark={toggleBookmark}
        onArticleRead={handleArticleRead}
        onTitle={(title) => setArticleTitle(articleId, title)}
        onReady={handleReady}
        onError={handleError}
      />

      {status === 'loading' && (
        <View style={styles.overlay}>
          <LoadingView message="Loading article…" />
        </View>
      )}

      {status === 'error' && (
        <View style={styles.overlay}>
          <ErrorView message={error?.message || 'Failed to load the article.'} onRetry={reload} />
        </View>
      )}

      <ArticleHeader
        articleId={articleId}
        onBack={() => router.back()}
        topInset={insets.top}
        onHeightChange={setHeaderHeight}
        isSaved={!!savedVersion}
        isSaving={isSaving}
        saveProgress={saveProgress}
        onSavePress={handleSavePress}
        onCancelSave={handleCancelSave}
      />

      {updateStatus === 'ready' && (
        <View style={[styles.updateBanner, { bottom: insets.bottom + 12 }]}>
          <Text style={styles.updateText}>A newer version is ready.</Text>
          <TouchableOpacity style={styles.updateButton} onPress={handleSwitchToUpdate}>
            <Text style={styles.updateButtonText}>Switch</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.updateDismiss} onPress={handleDismissUpdate}>
            <Text style={styles.updateDismissText}>Later</Text>
          </TouchableOpacity>
        </View>
      )}

      {updateStatus === 'downloading' && (
        <View style={[styles.updateBanner, { bottom: insets.bottom + 12 }]}>
          <Text style={styles.updateText}>
            Downloading a newer version… {updateProgress !== undefined ? `${Math.round(updateProgress)}%` : ''}
          </Text>
          <TouchableOpacity style={styles.updateDismiss} onPress={handleCancelUpdate}>
            <Text style={styles.updateDismissText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
  },
  updateBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#121212',
  },
  updateText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  updateButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#2c32bd',
  },
  updateButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  updateDismiss: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  updateDismissText: {
    color: '#fff',
    opacity: 0.8,
  },
});
