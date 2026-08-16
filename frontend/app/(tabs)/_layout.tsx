import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Platform, View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { colors, fonts, radius } from "@/src/theme/theme";
import { useT } from "@/src/lib/i18n";
import { useAmbient } from "@/src/lib/ambient-context";
import { CatchUpButton } from "@/src/components/CatchUpButton";

function GlassTabBackground() {
  return (
    <BlurView
      intensity={70}
      tint="light"
      style={StyleSheet.absoluteFill}
    />
  );
}

function TabIcon({ name, color, focused }: { name: any; color: string; focused: boolean }) {
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: colors.brand + "20" }]}>
      <Feather name={name} size={focused ? 22 : 20} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const { t } = useT();
  const { tint: ambientTint } = useAmbient();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brand,
          tabBarInactiveTintColor: colors.muted,
          tabBarBackground: GlassTabBackground,
          tabBarStyle: {
            backgroundColor: ambientTint + "B0",
            borderTopColor: colors.border,
            borderTopWidth: 0.5,
            height: Platform.OS === "ios" ? 90 : 68,
            paddingTop: 10,
          },
          tabBarLabelStyle: { fontFamily: fonts.text, fontSize: 11, marginTop: 2 },
        }}
        screenListeners={{ tabPress: () => Haptics.selectionAsync() }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("tab.today"),
            tabBarIcon: ({ color, focused }) => <TabIcon name="sun" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="nearby"
          options={{
            title: "Nearby",
            tabBarIcon: ({ color, focused }) => <TabIcon name="radio" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="track"
          options={{
            title: t("tab.track"),
            tabBarIcon: ({ color, focused }) => <TabIcon name="activity" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: t("tab.circle"),
            tabBarIcon: ({ color, focused }) => <TabIcon name="users" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="meetups"
          options={{
            title: "Meetups",
            tabBarIcon: ({ color, focused }) => <TabIcon name="calendar" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="care"
          options={{
            title: t("tab.care"),
            tabBarIcon: ({ color, focused }) => <TabIcon name="heart" color={color} focused={focused} />,
          }}
        />
        {/* Kept accessible via navigation, hidden from the tab bar */}
        <Tabs.Screen name="talk" options={{ href: null }} />
        <Tabs.Screen name="journey" options={{ href: null }} />
      </Tabs>
      <CatchUpButton />
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 40,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
