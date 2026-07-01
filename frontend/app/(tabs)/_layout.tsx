import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { colors, fonts } from "@/src/theme/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 88 : 64,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.text,
          fontSize: 11,
        },
      }}
      screenListeners={{
        tabPress: () => Haptics.selectionAsync(),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color, size }) => (
            <Feather name="sun" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="talk"
        options={{
          title: "Talk",
          tabBarIcon: ({ color, size }) => (
            <Feather name="message-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Circle",
          tabBarIcon: ({ color, size }) => (
            <Feather name="users" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="journey"
        options={{
          title: "Journey",
          tabBarIcon: ({ color, size }) => (
            <Feather name="trending-up" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          title: "Care",
          tabBarIcon: ({ color, size }) => (
            <Feather name="heart" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
