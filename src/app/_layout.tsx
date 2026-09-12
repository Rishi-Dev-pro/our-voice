import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AudioPlayerProvider } from '@/services/audioPlayerContext';
import { TeddyReactionBanner } from '@/components/teddy-reaction-banner';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AudioPlayerProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="record" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="imported" />
          <Stack.Screen name="recorded" />
          <Stack.Screen name="liked" />
          <Stack.Screen name="albums" />
          <Stack.Screen name="album/[id]" />
          <Stack.Screen
            name="player/[id]"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
        </Stack>
        <TeddyReactionBanner />
        <StatusBar style="auto" />
      </AudioPlayerProvider>
    </ThemeProvider>
  );
}

