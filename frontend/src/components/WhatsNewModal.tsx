import React, { useEffect, useState } from "react";
import { View, StyleSheet, Modal, ScrollView, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { storage } from "@/src/utils/storage";

// Bump this whenever there's a new batch of features worth announcing.
// Each version shows once per device, ever — not once per app open.
const WHATS_NEW_VERSION = "2026-09-pantry-voice-memory";
const STORAGE_KEY = `whats_new_seen_${WHATS_NEW_VERSION}`;

type WhatsNewItem = { icon: keyof typeof Feather.glyphMap; title: string; body: string };

const ITEMS: WhatsNewItem[] = [
  {
    icon: "camera",
    title: "Pantry Snap",
    body: "Snap a photo of your pantry or fridge and get a real recipe matched to what you already have.",
  },
  {
    icon: "mic",
    title: "Talk to Cuddle now listens",
    body: "Tap the mic and just talk instead of typing — perfect for when your hands are full.",
  },
  {
    icon: "heart",
    title: "Cuddle remembers more",
    body: "Talk to Cuddle now knows what you've shared in Recovery and Tag Team, so conversations pick up where your day left off.",
  },
  {
    icon: "bar-chart-2",
    title: "Share your mood with your doctor",
    body: "Your Journey tab now builds a visual pattern of your check-ins, ready to bring to an appointment.",
  },
];

export function WhatsNewModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    storage.getItem<boolean>(STORAGE_KEY, false).then((seen) => {
      if (mounted && !seen) {
        // small delay so it doesn't compete with the screen's own entrance
        setTimeout(() => setVisible(true), 500);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVisible(false);
    storage.setItem(STORAGE_KEY, true);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Pressable testID="whats-new-close" onPress={dismiss} style={styles.closeBtn} hitSlop={10}>
            <Feather name="x" size={20} color={colors.muted} />
          </Pressable>

          <Txt style={{ color: colors.brand, fontSize: fontSize.xs, fontWeight: "700", letterSpacing: 0.5 }}>
            WHAT'S NEW
          </Txt>
          <Txt display style={{ fontSize: fontSize.xl, marginTop: spacing.xs, marginBottom: spacing.lg }}>
            A few things just got better
          </Txt>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {ITEMS.map((item, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.iconBubble}>
                  <Feather name={item.icon} size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="500" style={{ fontSize: fontSize.md }}>{item.title}</Txt>
                  <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2, lineHeight: 20 }}>
                    {item.body}
                  </Txt>
                </View>
              </View>
            ))}
          </ScrollView>

          <Button
            testID="whats-new-dismiss"
            label="Got it"
            onPress={dismiss}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(20,17,15,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  closeBtn: {
    alignSelf: "flex-end",
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary + "35",
    alignItems: "center",
    justifyContent: "center",
  },
});
