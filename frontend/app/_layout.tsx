import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ProfileProvider } from "@/src/lib/profile-context";
import { colors } from "@/src/theme/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [appFontsLoaded, appFontsError] = useFonts({
    Fraunces: require("../assets/fonts/Fraunces-Regular.ttf"),
    "Fraunces-Italic": require("../assets/fonts/Fraunces-Italic.ttf"),
    Quicksand: require("../assets/fonts/Quicksand-Regular.ttf"),
  });

  const ready = (iconsLoaded || iconsError) && (appFontsLoaded || appFontsError);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ProfileProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surface },
              animation: "fade",
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="checkin"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
            <Stack.Screen
              name="epds"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
            <Stack.Screen
              name="breathe"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
            <Stack.Screen name="thread/[id]" />
          </Stack>
        </ProfileProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
