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
import { registerSiriIntentHandlers } from "@/src/lib/siri-intents";
import { registerForPushNotifications } from "@/src/lib/push-notifications";
import { getDeviceId, api } from "@/src/lib/api";
import { colors } from "@/src/theme/theme";
import { Fraunces_500Medium } from "@expo-google-fonts/fraunces";
import { Quicksand_500Medium } from "@expo-google-fonts/quicksand";

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
    "Fraunces-Medium": Fraunces_500Medium,
    Quicksand: require("../assets/fonts/Quicksand-Regular.ttf"),
    "Quicksand-Medium": Quicksand_500Medium,
  });

  const ready = (iconsLoaded || iconsError) && (appFontsLoaded || appFontsError);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  useEffect(() => {
    // iOS-only — this package has no web or Android implementation at all
    // (verified directly against its source), so calling it on any other
    // platform would throw. Guarded here, and the handler itself has its
    // own try/catch as a second layer of safety.
    if (Platform.OS === "ios") {
      try {
        registerSiriIntentHandlers();
      } catch (e) {
        console.log("Siri intent registration failed:", e);
      }
    }
  }, []);

  useEffect(() => {
    // A simple heartbeat so the backend knows whether the app has actually
    // been opened recently, separate from whether anything was logged —
    // this is what the "haven't seen you in a while" reminder depends on.
    // Also doubles as a safety net for push permission: this used to only
    // ever be requested from inside the Tag Team card, so anyone who set
    // up their profile before that was fixed in onboarding, or who never
    // adds a household, was never asked at all. requestPermissionsAsync
    // is safe to call repeatedly — it only shows the real OS prompt once,
    // and is a no-op after that either way.
    (async () => {
      try {
        const deviceId = await getDeviceId();
        await api.activityPing(deviceId);
        registerForPushNotifications(deviceId);
      } catch (e) {
        console.log("activity ping failed:", e);
      }
    })();
  }, []);

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
                  name="nearby-settings"
                  options={{ presentation: "modal", animation: "slide_from_bottom" }}
                />
                <Stack.Screen name="thread/[id]" />
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
                <Stack.Screen name="cuddle-calendar" />
                <Stack.Screen name="support-directory" />
                <Stack.Screen name="privacy" />
                <Stack.Screen name="support" />
                <Stack.Screen name="newborn-basics" />
                <Stack.Screen name="guide" />
                <Stack.Screen name="send-encouragement" />
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
