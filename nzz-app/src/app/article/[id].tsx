import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ArticleScreen } from '../../screens/ArticleScreen';

export default function ArticleRoute() {
  const { id, ...rest } = useLocalSearchParams<{ id: string }>();

  // Everything except the id travels as the article's query string.
  const queryString = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return (
    <View style={styles.container}>
      <ArticleScreen articleId={id} queryString={queryString || undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});