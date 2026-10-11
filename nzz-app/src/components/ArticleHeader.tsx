
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFontScale, useTheme, useSetFontScale, useSetTheme, useToggleBookmark, useIsBookmarked } from '../state/store';

interface ArticleHeaderProps {
  articleId: string;
  onBack: () => void;
  /** Space the status bar covers, so the header sits below it. */
  topInset: number;
  /** Height of the header, so the page can reserve the space it covers. */
  onHeightChange?: (height: number) => void;
  // Save control
  isSaved: boolean;
  isSaving: boolean;
  saveProgress?: number;
  onSavePress: () => void;
  onCancelSave: () => void;
}

/**
 * The native header that floats over the article page. It scrolls with nothing: the page
 * scrolls underneath it.
 */
export function ArticleHeader({
  articleId,
  onBack,
  topInset,
  onHeightChange,
  isSaved,
  isSaving,
  saveProgress,
  onSavePress,
  onCancelSave,
}: ArticleHeaderProps) {
  const fontScale = useFontScale();
  const theme = useTheme();
  const setFontScale = useSetFontScale();
  const setTheme = useSetTheme();
  const toggleBookmark = useToggleBookmark();
  const isBookmarked = useIsBookmarked()(articleId);

  const handleFontSizeChange = (delta: number) => {
    setFontScale(Math.max(0.5, Math.min(2.0, fontScale + delta)));
  };

  const handleThemeToggle = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <View
      style={[styles.container, { paddingTop: topInset }]}
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.button} onPress={onBack} activeOpacity={0.7} accessibilityLabel="Back">
          <Text style={styles.buttonText}>←</Text>
        </TouchableOpacity>

        <View style={styles.controlGroup}>
          <TouchableOpacity
            style={styles.button}
            onPress={() => handleFontSizeChange(-0.1)}
            activeOpacity={0.7}
            accessibilityLabel="Smaller text"
          >
            <Text style={styles.buttonText}>A−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            onPress={() => handleFontSizeChange(0.1)}
            activeOpacity={0.7}
            accessibilityLabel="Larger text"
          >
            <Text style={styles.buttonText}>A+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleThemeToggle}
          activeOpacity={0.7}
          accessibilityLabel="Toggle light or dark"
        >
          <Text style={styles.buttonText}>{theme === 'light' ? '☀️' : '🌙'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={() => toggleBookmark(articleId)}
          activeOpacity={0.7}
          accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          <Text style={styles.buttonText}>{isBookmarked ? '★' : '☆'}</Text>
        </TouchableOpacity>

        {isSaving ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonSaving]}
            onPress={onCancelSave}
            activeOpacity={0.7}
            accessibilityLabel="Cancel saving"
          >
            <View style={styles.savingContent}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.savingText}>
                {saveProgress !== undefined ? `${Math.round(saveProgress)}%` : '…'}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, isSaved && styles.buttonSaved]}
            onPress={onSavePress}
            activeOpacity={0.7}
            accessibilityLabel={isSaved ? 'Saved' : 'Save for offline'}
          >
            <Text style={styles.buttonText}>{isSaved ? '✓' : '💾'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: '#dee2e6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
  },
  controlGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    minWidth: 36,
    alignItems: 'center',
  },
  buttonSaved: {
    backgroundColor: '#28a745',
  },
  buttonSaving: {
    backgroundColor: '#2c32bd',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#121212',
  },
  savingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
