import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { colors, fonts } from "@/src/theme/theme";
import { useT } from "@/src/lib/i18n";
import { useAmbient } from "@/src/lib/ambient-context";

export default function TabLayout() {
  const { t } = useT();
  const { tint: ambientTint } = useAmbient();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: ambientTint,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 88 : 64,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: fonts.text, fontSize: 11 },
      }}
      screenListeners={{ tabPress: () => Haptics.selectionAsync() }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tab.today"),
          tabBarIcon: ({ color, size }) => <Feather name="sun" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="beacon"
        options={{
          title: t("tab.beacon"),
          tabBarIcon: ({ color, size }) => <Feather name="radio" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="track"
        options={{
          title: t("tab.track"),
          tabBarIcon: ({ color, size }) => <Feather name="activity" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: t("tab.circle"),
          tabBarIcon: ({ color, size }) => <Feather name="users" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="meetups"
        options={{
          title: "Meetups",
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          title: t("tab.care"),
          tabBarIcon: ({ color, size }) => <Feather name="heart" size={size} color={color} />,
        }}
      />
      {/* Kept accessible via navigation, hidden from the tab bar */}
      <Tabs.Screen name="talk" options={{ href: null }} />
      <Tabs.Screen name="journey" options={{ href: null }} />
    </Tabs>
  );
}
