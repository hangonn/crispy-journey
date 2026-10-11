
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AppState {
  // Bookmarked article IDs
  bookmarks: string[];
  // Read article IDs (max 5, most recent first)
  readIds: string[];
  // Titles seen for articles, so the Recently read strip can show them
  titles: Record<string, string>;
  // Font scale (1.0 = default)
  fontScale: number;
  // Theme
  theme: 'light' | 'dark';
  // Actions
  toggleBookmark: (articleId: string) => void;
  addReadArticle: (articleId: string) => void;
  setArticleTitle: (articleId: string, title: string) => void;
  setFontScale: (scale: number) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  // Getters
  isBookmarked: (articleId: string) => boolean;
  isRead: (articleId: string) => boolean;
}

const MAX_READ_ARTICLES = 5;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      bookmarks: [],
      readIds: [],
      titles: {},
      fontScale: 1.0,
      theme: 'dark',
      
      toggleBookmark: (articleId: string) => {
        set((state) => {
          const isBookmarked = state.bookmarks.includes(articleId);
          return {
            bookmarks: isBookmarked
              ? state.bookmarks.filter((id) => id !== articleId)
              : [...state.bookmarks, articleId],
          };
        });
      },
      
      addReadArticle: (articleId: string) => {
        set((state) => {
          // Don't add if already the most recent
          if (state.readIds[0] === articleId) return state;
          
          const filtered = state.readIds.filter((id) => id !== articleId);
          const updated = [articleId, ...filtered].slice(0, MAX_READ_ARTICLES);
          return { readIds: updated };
        });
      },

      setArticleTitle: (articleId: string, title: string) => {
        if (!title) return;
        set((state) => {
          if (state.titles[articleId] === title) return state;
          return { titles: { ...state.titles, [articleId]: title } };
        });
      },
      
      setFontScale: (scale: number) => {
        set({ fontScale: Math.max(0.5, Math.min(2.0, scale)) });
      },
      
      setTheme: (theme: 'light' | 'dark') => {
        set({ theme });
      },
      
      isBookmarked: (articleId: string) => {
        return get().bookmarks.includes(articleId);
      },
      
      isRead: (articleId: string) => {
        return get().readIds.includes(articleId);
      },
    }),
    {
      name: 'app-state',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        bookmarks: state.bookmarks,
        readIds: state.readIds,
        titles: state.titles,
        fontScale: state.fontScale,
        theme: state.theme,
      }),
    }
  )
);

// Selectors for subscribing to specific state slices
export const useBookmarks = () => useAppStore((state) => state.bookmarks);
export const useReadIds = () => useAppStore((state) => state.readIds);
export const useTitles = () => useAppStore((state) => state.titles);
export const useFontScale = () => useAppStore((state) => state.fontScale);
export const useTheme = () => useAppStore((state) => state.theme);
export const useToggleBookmark = () => useAppStore((state) => state.toggleBookmark);
export const useAddReadArticle = () => useAppStore((state) => state.addReadArticle);
export const useSetArticleTitle = () => useAppStore((state) => state.setArticleTitle);
export const useSetFontScale = () => useAppStore((state) => state.setFontScale);
export const useSetTheme = () => useAppStore((state) => state.setTheme);
export const useIsBookmarked = () => useAppStore((state) => state.isBookmarked);
export const useIsRead = () => useAppStore((state) => state.isRead);
