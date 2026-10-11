import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from "react-native";
import { useReadIds, useTitles } from "../state/store";

interface RecentlyReadStripProps {
  onPressArticle: (articleId: string) => void;
}

/**
 * Up to five articles the reader has read, most recent first. Hidden while nothing has been read.
 */
export function RecentlyReadStrip({ onPressArticle }: RecentlyReadStripProps) {
  const readIds = useReadIds();
  const titles = useTitles();

  if (readIds.length === 0) {
    return null;
  }

  const items = readIds.slice(0, 5);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recently read</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => onPressArticle(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.itemTitle} numberOfLines={3}>
              {titles[item] ?? `Article ${item}`}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#121212",
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  item: {
    width: 160,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "#121212",
    lineHeight: 18,
  },
});
