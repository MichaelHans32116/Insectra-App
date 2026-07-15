import React from 'react';
import { Tabs } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Type } from '@/constants/theme';
import { useLocalText } from '@/services/i18n';
import { useThemeMode } from '@/services/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const text = useLocalText();
  const { resolved } = useThemeMode();

  return (
    <Tabs
      key={resolved}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.tabActive,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarLabelStyle: { ...Type.micro, marginTop: 2 },
        tabBarStyle: {
          backgroundColor: Colors.tabBarBg,
          borderTopColor: Colors.tabBarBorder,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 10),
          height: 58 + Math.max(insets.bottom, 10),
        },
        sceneStyle: {
          backgroundColor: Colors.background,
          paddingTop: Math.max(insets.top, 8),
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: text('Home', 'Sakahan'),
          tabBarLabel: text('Home', 'Sakahan'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="view-dashboard-outline"
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{
          title: text('Traps', 'Mga Trap'),
          tabBarLabel: text('Traps', 'Mga Trap'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cctv" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: text('Community', 'Komunidad'),
          tabBarLabel: text('Community', 'Komunidad'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="forum-outline"
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="operations"
        options={{
          title: text('Tasks', 'Gawain'),
          tabBarLabel: text('Tasks', 'Gawain'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="clipboard-list-outline"
              color={color}
              size={size}
            />
          ),
        }}
      />

      {/* Hidden legacy routes — accessible from per-device page, not in tab bar. */}
      <Tabs.Screen name="detect" options={{ href: null, title: text('Live Detect', 'Live Detection') }} />
      <Tabs.Screen name="analytics" options={{ href: null, title: text('Analytics', 'Analytics') }} />
      <Tabs.Screen name="maintenance" options={{ href: null, title: text('Maintenance', 'Maintenance') }} />
    </Tabs>
  );
}
