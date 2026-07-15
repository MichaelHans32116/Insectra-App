import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { ActiveGroupProvider } from '@/services/activeGroup';
import { ThemeProvider, useThemeMode, useThemeStyles } from '@/services/theme';
import { Colors } from '@/constants/theme';
import OfflineBanner from '@/components/OfflineBanner';
import ToastHost from '@/components/ToastHost';
import { usePrimaryCloudDevice } from '@/services/activeDevice';
import { attachRemotePiListener, detachRemotePiListener } from '@/services/remotePi';

function RemotePiBridge() {
  const { cloudDeviceId } = usePrimaryCloudDevice();

  React.useEffect(() => {
    if (!cloudDeviceId) {
      detachRemotePiListener();
      return;
    }

    attachRemotePiListener(cloudDeviceId);
    return () => {
      detachRemotePiListener();
    };
  }, [cloudDeviceId]);

  return null;
}

function RootShell() {
  const { resolved } = useThemeMode();
  const styles = useThemeStyles(() => ({ root: { flex: 1, backgroundColor: Colors.background } }));
  return (
    <ActiveGroupProvider>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} backgroundColor={Colors.background} />
      <View style={styles.root}>
        <RemotePiBridge />
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register-role" />
          <Stack.Screen name="register" />
          <Stack.Screen name="verify-email" />
          <Stack.Screen name="create-group" />
          <Stack.Screen name="join-group" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="device/[id]" />
          <Stack.Screen name="device/edit/[id]" />
          <Stack.Screen name="analytics/[id]" />
          <Stack.Screen name="alerts" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="spray-settings" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="remote-access" />
        </Stack>
        <ToastHost />
      </View>
    </ActiveGroupProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}