import React, { useEffect, useState } from "react";
import { View, StyleSheet, Modal, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";

/**
 * Celebrates HER, not the baby — every checkpoint here is about what she's
 * come through, not what the baby's grown into. Checked once when the
 * Today screen loads; shows at most one milestone at a time.
 */
export function MomMilestoneCard({ deviceId }: { deviceId: string | null }) {
  const [visible, setVisible] = useState(false);
  const [milestone, setMilestone] = useState<{ week: number; title: string; message: string } | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let mounted = true;
    api.momMilestonePending(deviceId).then((r) => {
      if (mounted && r.has_milestone) {
        setMilestone({ week: r.week, title: r.title, message: r.message });
        setTimeout(() => setVisible(true), 600);
      }
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, [deviceId]);

  const dismiss = () => {
    if (!deviceId || !milestone) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setVisible(false);
    api.momMilestoneMarkSeen(deviceId, milestone.week).catch(() => {});
  };

  if (!milestone) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Pressable testID="mom-milestone-close" onPress={dismiss} style={styles.closeBtn} hitSlop={10}>
            <Feather name="x" size={20} color={colors.muted} />
          </Pressable>

          <View style={styles.iconWrap}>
            <Feather name="heart" size={28} color={colors.brand} />
          </View>

          <Txt display style={styles.title}>{milestone.title}</Txt>
          <Txt style={styles.message}>{milestone.message}</Txt>

          <Button
            testID="mom-milestone-dismiss"
            label="Thank you"
            onPress={dismiss}
            style={{ marginTop: spacing.lg, width: "100%" }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(20,17,15,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
  closeBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTertiary + "30",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: fontSize.md,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    lineHeight: 24,
  },
});
