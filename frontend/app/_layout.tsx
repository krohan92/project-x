import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import {
  LogBox,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ProfileProvider } from "@/src/lib/profile-context";
import { LanguageProvider } from "@/src/lib/i18n";
import { AmbientProvider } from "@/src/lib/ambient-context";
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
          <AmbientProvider>
          <LanguageProvider>
            <WebFrame>
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
                <Stack.Screen
                  name="night-light"
                  options={{ presentation: "modal", animation: "slide_from_bottom" }}
                />
                <Stack.Screen
                  name="beacon-settings"
                  options={{ presentation: "modal", animation: "slide_from_bottom" }}
                />
                <Stack.Screen name="thread/[id]" />
                <Stack.Screen name="peer/[room]" />
                <Stack.Screen name="join/[code]" />
                <Stack.Screen name="shop" />
                <Stack.Screen name="shop-item/[id]" />
                <Stack.Screen name="shop-thread/[id]" />
                <Stack.Screen name="shop-threads" />
                <Stack.Screen name="recovery" />
                <Stack.Screen name="meals/index" />
                <Stack.Screen name="meals/[code]" />
                <Stack.Screen name="dad-corner" />
                <Stack.Screen name="brain-notes" />
                <Stack.Screen name="meetup/[id]" />
                <Stack.Screen name="celebrations" />
                <Stack.Screen
                  name="yoga"
                  options={{ presentation: "modal", animation: "slide_from_bottom" }}
                />
              </Stack>
            </WebFrame>
          </LanguageProvider>
          </AmbientProvider>
        </ProfileProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// On wide web browsers, constrain the native app to a centered phone-width
// column so the preview reads as a mobile app instead of stretching full width.
function WebFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const framed = Platform.OS === "web" && width > 480;
  if (!framed) return <>{children}</>;
  return (
    <View style={styles.webBg}>
      <View style={styles.webFrame}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  webBg: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#211E1A",
  },
  webFrame: {
    width: 430,
    height: "100%",
    maxHeight: 932,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderRadius: 24,
    // @ts-ignore web-only shadow
    boxShadow: "0 12px 48px rgba(0,0,0,0.35)",
  },
});
