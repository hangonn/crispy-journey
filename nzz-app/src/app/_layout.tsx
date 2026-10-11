import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cleanupStaleTempDirs } from '../saved/storage';

export default function RootLayout() {
  // A download that was killed with the app leaves a temporary folder behind. Remove it on
  // launch so nothing of a partial copy survives.
  useEffect(() => {
    cleanupStaleTempDirs();
  }, []);

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" options={{ presentation: 'card' }} />
        <Stack.Screen name="article/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="saved" options={{ presentation: 'card' }} />
      </Stack>
    </SafeAreaProvider>
  );
}