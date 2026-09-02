import React, { useEffect, useState } from "react";
import { StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { storage } from "@/src/utils/storage";

/**
 * A small dismissible "hey, this is new" banner that shows exactly once
 * per person, ever, per hintKey: for features easy to miss on a screen
 * they've already used before (a new button added to an existing screen,
 * not something onboarding would have covered).
 */
export function FirstTimeHint({ hintKey, text }: { hintKey: string; text: string }) {
  const storageKey = `hint_seen_${hintKey}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    storage.getItem<boolean>(storageKey, false).then((seen) => {
      if (mounted && !seen) setVisible(true);
    });
    return () => { mounted = false; };
  }, [storageKey]);

  const dismiss = () => {
    setVisible(false);
    storage.setItem(storageKey, true);
  };

  if (!visible) return null;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.card}>
      <Feather name="star" size={14} color={colors.brand} style={{ marginTop: 2 }} />
      <Txt style={{ flex: 1, fontSize: fontSize.sm, color: colors.onSurface }}>{text}</Txt>
      <Pressable testID={`hint-dismiss-${hintKey}`} onPress={dismiss} hitSlop={8}>
        <Feather name="x" size={16} color={colors.muted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary + "30",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});
