import React, { useState } from "react";
import { View, StyleSheet, Pressable, Modal, ActivityIndicator, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

// Clears the bottom tab bar (90pt iOS / 68pt Android, per the tab layout)
// with a little breathing room above it.
const TAB_BAR_CLEARANCE = Platform.OS === "ios" ? 100 : 78;

/**
 * A small persistent "catch me up" assistant, in the spirit of the Copilot
 * side-panel pattern — always one tap away from wherever she is, gives a
 * quick AI-written snapshot rather than making her go find and piece
 * together Tag Team status, today's log, and what's coming up herself.
 *
 * Rendered once, in the tabs layout, so it floats above every tab screen.
 */
export function CatchUpButton() {
  const router = useRouter();
  const { deviceId } = useProfile();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const openPanel = async () => {
    if (!deviceId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(true);
    setLoading(true);
    setSummary(null);
    try {
      const res = await api.catchUp(deviceId);
      setSummary(res.summary);
    } catch {
      setSummary("Couldn't pull that together just now — try again in a moment.");
    }
    setLoading(false);
  };

  return (
    <>
      <Pressable
        testID="catchup-button"
        onPress={openPanel}
        style={[styles.fab, { bottom: TAB_BAR_CLEARANCE }]}
      >
        <Feather name="zap" size={18} color="#fff" />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalWrap}>
          <Animated.View entering={FadeIn} style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Feather name="zap" size={18} color={colors.brand} />
                <Txt display style={{ fontSize: fontSize.lg }}>Catch me up</Txt>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <Txt style={{ color: colors.onSurface, lineHeight: 22 }}>{summary}</Txt>
            )}

            <Button
              label="Ask Cuddle more"
              variant="secondary"
              onPress={() => { setOpen(false); router.push("/talk"); }}
              style={{ marginTop: spacing.lg }}
            />
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 20,
  },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing["3xl"],
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  loadingBox: { paddingVertical: spacing.lg, alignItems: "center" },
});
