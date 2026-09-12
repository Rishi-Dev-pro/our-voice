import React, { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { AudioPlayerProvider } from '@/services/audioPlayerContext';
import { TeddyReactionBanner } from '@/components/teddy-reaction-banner';
import { IncomingPackageModal } from '@/components/incoming-package-modal';
import {
  subscribeToIncomingPackages,
  IncomingPackagePayload,
} from '@/services/incomingPackageService';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [incomingOvpUri, setIncomingOvpUri] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToIncomingPackages((payload: IncomingPackagePayload) => {
      console.log('[INCOMING DIAGNOSTIC] modal trigger for URI:', payload.uri);
      setIncomingOvpUri(payload.uri);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AudioPlayerProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            animationDuration: 280,
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen
            name="record"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              animationDuration: 300,
            }}
          />
          <Stack.Screen name="imported" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="recorded" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="liked" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="albums" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="album/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="recent" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="player/[id]"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              animationDuration: 320,
            }}
          />
          <Stack.Screen
            name="queue"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              animationDuration: 320,
            }}
          />
        </Stack>
        <TeddyReactionBanner />
        <IncomingPackageModal
          incomingUri={incomingOvpUri}
          onDismiss={() => setIncomingOvpUri(null)}
        />
        <StatusBar style="auto" />
      </AudioPlayerProvider>
    </ThemeProvider>
  );
}

