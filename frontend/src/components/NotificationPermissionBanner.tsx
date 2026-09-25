import React, { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { storage } from "@/src/utils/storage";

const DISMISS_KEY = "notif_banner_dismissed_at";
const RE_SHOW_AFTER_DAYS = 7; // gentle reminder, not a daily nag

export function NotificationPermissionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (Platform.OS === "web") return;
      try {
        // Dynamic import, same reason as registerForPushNotifications —
        // keeps this native-only module out of the web bundle entirely.
        const Notifications = await import("expo-notifications");
        const { status } = await Notifications.getPermissionsAsync();
        // Only "denied" means she was actually asked and said no — the
        // ordinary "undetermined" case is already handled by the real
        // permission prompt firing on launch, so no banner needed there.
        if (status !== "denied") return;

        const dismissedAt = await storage.getItem<string>(DISMISS_KEY, "");
        if (dismissedAt) {
          const daysSince = (Date.now() - new Date(dismissedAt).getTime()) / 86400000;
          if (daysSince < RE_SHOW_AFTER_DAYS) return;
        }
        if (mounted) setVisible(true);
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVisible(false);
    storage.setItem(DISMISS_KEY, new Date().toISOString());
  };

  const openSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openSettings();
    // Treat opening Settings the same as a dismiss — she's taken the
    // action available to her; no reason to keep nagging in the meantime.
    setVisible(false);
    storage.setItem(DISMISS_KEY, new Date().toISOString());
  };

  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <Feather name="bell-off" size={18} color={colors.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Txt weight="500" style={{ fontSize: fontSize.sm }}>Notifications are off</Txt>
        <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.xs, marginTop: 2, lineHeight: 17 }}>
          You'll miss Tag Team nudges and check-ins. Turn them on in Settings.
        </Txt>
        <Pressable testID="notif-banner-open-settings" onPress={openSettings} style={{ marginTop: spacing.xs }}>
          <Txt style={{ color: colors.brand, fontSize: fontSize.xs, fontWeight: "700" }}>Open Settings →</Txt>
        </Pressable>
      </View>
      <Pressable testID="notif-banner-dismiss" onPress={dismiss} hitSlop={10}>
        <Feather name="x" size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
});
