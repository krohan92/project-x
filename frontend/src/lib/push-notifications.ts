import { Platform } from "react-native";
import { api } from "@/src/lib/api";

/**
 * Registers this device for push notifications and saves the token so the
 * backend can nudge the other caregiver when it's a good time to tag out.
 *
 * IMPORTANT LIMITATION: this only works in a real native build (installed
 * via EAS Build to a phone) — not in a plain web browser tab, and not in
 * Expo Go without a configured project. On web this quietly no-ops instead
 * of showing errors, since there's nothing broken — the feature just isn't
 * available in that environment yet.
 */
export async function registerForPushNotifications(deviceId: string): Promise<boolean> {
  if (Platform.OS === "web" || !deviceId) return false;

  try {
    // Dynamic import so this native-only module never gets bundled/evaluated on web.
    const Notifications = await import("expo-notifications");

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return false;

    // Android needs an explicit high-importance channel for the SOS push to
    // actually alert loudly — without this, "priority: high" from the
    // server is capped by the default channel's quieter settings.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("sos", {
        name: "Cuddle SOS",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 400, 200, 400, 200, 400],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse?.data;
    if (!token) return false;

    await api.registerPush({ device_id: deviceId, expo_push_token: token });
    return true;
  } catch {
    // Most commonly: no EAS project configured yet, or running in an
    // environment (like Expo Go without setup) that can't issue a token.
    // Safe to fail quietly — Tag Team still works without push, it just
    // won't proactively nudge until this is set up.
    return false;
  }
}
