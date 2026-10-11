import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import {
  getSavedArticles,
  getSavedArticlesStats,
  deleteSavedArticle,
  deleteAllSavedArticles,
  SavedArticle,
} from "../saved/storage";
import {
  getActiveDownloads,
  cancelDownload,
  DownloadProgress,
} from "../saved/downloader";
import { LoadingView } from "../components/LoadingView";
import { ErrorView } from "../components/ErrorView";

export function SavedScreen() {
  const [articles, setArticles] = useState<SavedArticle[]>([]);
  const [stats, setStats] = useState({ totalSize: 0, totalFiles: 0 });
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Everything is measured from the file system each time the screen is shown.
  const loadData = useCallback(async () => {
    try {
      setError(null);

      const [savedArticles, savedStats] = await Promise.all([
        getSavedArticles(),
        getSavedArticlesStats(),
      ]);
      setArticles(savedArticles);
      setStats(savedStats);
      setDownloads(getActiveDownloads());
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to load saved articles"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Measured from the file system every time the screen is shown.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // Keep the in-progress list fresh while downloads run.
  useEffect(() => {
    const timer = setInterval(() => setDownloads(getActiveDownloads()), 500);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const handleOpenArticle = useCallback((article: SavedArticle) => {
    // The article screen decides whether to open the saved copy or the online page.
    router.push(`/article/${article.articleId}`);
  }, []);

  const handleDeleteArticle = useCallback(
    (article: SavedArticle) => {
      Alert.alert("Delete article", `Delete "${article.title}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteSavedArticle(article.articleId);
            loadData();
          },
        },
      ]);
    },
    [loadData],
  );

  const handleCancelDownload = useCallback(
    async (download: DownloadProgress) => {
      await cancelDownload(download.articleId, download.version);
      setDownloads(getActiveDownloads());
    },
    [],
  );

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      "Delete all saved articles",
      "This removes every saved article. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            await deleteAllSavedArticles();
            loadData();
          },
        },
      ],
    );
  }, [loadData]);

  if (loading) {
    return <LoadingView message="Loading saved articles…" />;
  }

  if (error) {
    return <ErrorView message={error.message} onRetry={loadData} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved</Text>
        {articles.length > 0 ? (
          <TouchableOpacity
            style={styles.deleteAllButton}
            onPress={handleDeleteAll}
          >
            <Text style={styles.deleteAllButtonText}>Delete all</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <View style={styles.statsBar}>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{articles.length}</Text> articles
        </Text>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{stats.totalFiles}</Text> files
        </Text>
        <Text style={styles.statItem}>
          <Text style={styles.statValue}>{formatBytes(stats.totalSize)}</Text>
        </Text>
      </View>

      {downloads.length > 0 && (
        <View style={styles.downloadsSection}>
          <Text style={styles.sectionTitle}>Downloading</Text>
          {downloads.map((download) => (
            <View key={download.articleId} style={styles.downloadRow}>
              <Text style={styles.downloadText}>
                Article {download.articleId} — {download.completedFiles}/
                {download.totalFiles} files
              </Text>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => handleCancelDownload(download)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {articles.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No saved articles yet</Text>
          <Text style={styles.emptySubtext}>
            Save an article to read it without a connection.
          </Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => `${item.articleId}-${item.version}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={["#2c32bd"]}
              tintColor="#2c32bd"
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.articleItem}
              onPress={() => handleOpenArticle(item)}
              activeOpacity={0.7}
            >
              <View style={styles.articleInfo}>
                <Text style={styles.articleTitle}>{item.title}</Text>
                <View style={styles.articleMeta}>
                  <Text style={styles.metaItem}>v{item.version}</Text>
                  <Text style={styles.metaItem}>{formatBytes(item.size)}</Text>
                  <Text style={styles.metaItem}>
                    {formatDate(item.savedAt)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteArticle(item)}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
    backgroundColor: "#fff",
  },
  backButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backButtonText: {
    fontSize: 22,
    color: "#121212",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#121212",
  },
  headerSpacer: {
    width: 60,
  },
  deleteAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#dc3545",
    borderRadius: 6,
  },
  deleteAllButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  statsBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
    backgroundColor: "#f8f9fa",
  },
  statItem: {
    fontSize: 13,
    color: "#434343",
  },
  statValue: {
    fontWeight: "600",
    color: "#121212",
  },
  downloadsSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#121212",
    marginBottom: 8,
  },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  downloadText: {
    flex: 1,
    fontSize: 13,
    color: "#434343",
  },
  cancelButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#ffc107",
  },
  cancelButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#121212",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#121212",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#868686",
    textAlign: "center",
    lineHeight: 20,
  },
  articleItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
  },
  articleInfo: {
    flex: 1,
  },
  articleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#121212",
    marginBottom: 6,
  },
  articleMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metaItem: {
    fontSize: 12,
    color: "#868686",
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dc3545",
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc3545",
  },
});
