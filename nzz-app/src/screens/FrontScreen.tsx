import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  AppState,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  NewsWebView,
  NewsWebViewHandle,
  PageStatus,
} from "../webview/NewsWebView";
import { LoadingView } from "../components/LoadingView";
import { ErrorView } from "../components/ErrorView";
import { RecentlyReadStrip } from "../components/RecentlyReadStrip";
import { useFetchConsent, useConsentString } from "../state/consent";
import { useAddReadArticle } from "../state/store";
import { initializeTracker } from "../tracking/trackerManager";

export function FrontScreen() {
  const webviewRef = useRef<NewsWebViewHandle>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const webviewOffsetRef = useRef(0);

  const [pageHeight, setPageHeight] = useState(0);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The web view needs a real height to load. Until the page reports its own height, give it
  // the window height; a 1px-tall web view can fail to load on Android.
  const { height: windowHeight } = useWindowDimensions();
  const slotHeight = pageHeight > 0 ? pageHeight : windowHeight;

  const consentString = useConsentString();
  const fetchConsent = useFetchConsent();
  const addReadArticle = useAddReadArticle();

  // Ask for consent at launch and each time the app comes back to the foreground.
  useEffect(() => {
    fetchConsent();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") fetchConsent();
    });
    return () => subscription.remove();
  }, [fetchConsent]);

  // Create the tracker once consent has answered with a string.
  useEffect(() => {
    initializeTracker(consentString);
  }, [consentString]);

  const handleOpenArticle = useCallback((path: string) => {
    const match = path.match(/\/article\/([^?]+)(?:\?(.*))?/);
    if (!match) return;
    const articleId = match[1];
    const queryString = match[2] || "";
    router.push(
      queryString
        ? `/article/${articleId}?${queryString}`
        : `/article/${articleId}`,
    );
  }, []);

  const handleScrollTo = useCallback((offset: number) => {
    scrollViewRef.current?.scrollTo({
      y: webviewOffsetRef.current + offset,
      animated: true,
    });
  }, []);

  const handleReady = useCallback(() => {
    setStatus("ready");
    setError(null);
    setRefreshing(false);
  }, []);

  const handleError = useCallback((err: Error) => {
    setStatus("error");
    setError(err);
    setRefreshing(false);
  }, []);

  const reload = useCallback(() => {
    setStatus("loading");
    setError(null);
    webviewRef.current?.reload();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload();
  }, [reload]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>NZZ</Text>
        <TouchableOpacity
          style={styles.savedButton}
          onPress={() => router.push("/saved")}
        >
          <Text style={styles.savedButtonText}>Saved</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#2c32bd"]}
            tintColor="#2c32bd"
          />
        }
        scrollEventThrottle={16}
        nestedScrollEnabled
      >
        <RecentlyReadStrip
          onPressArticle={(id) => router.push(`/article/${id}`)}
        />

        <View
          style={[styles.webviewSlot, { height: slotHeight }]}
          onLayout={(event) => {
            webviewOffsetRef.current = event.nativeEvent.layout.y;
          }}
        >
          <NewsWebView
            ref={webviewRef}
            pageType="front"
            insets={{ top: 0, bottom: 0 }}
            onHeightChange={setPageHeight}
            onOpenArticle={handleOpenArticle}
            onArticleRead={addReadArticle}
            onScrollTo={handleScrollTo}
            onReady={handleReady}
            onError={handleError}
          />

          {status === "loading" && (
            <View style={styles.overlay} pointerEvents="none">
              <LoadingView message="Loading front page…" />
            </View>
          )}

          {status === "error" && (
            <View style={styles.overlay}>
              <ErrorView
                message={error?.message || "Failed to load the front page."}
                onRetry={reload}
              />
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>NZZ App — Front Page</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#121212",
  },
  savedButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#2c32bd",
    borderRadius: 6,
  },
  savedButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  webviewSlot: {
    width: "100%",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  footer: {
    padding: 16,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#dee2e6",
    marginTop: 16,
  },
  footerText: {
    fontSize: 12,
    color: "#868686",
  },
});
