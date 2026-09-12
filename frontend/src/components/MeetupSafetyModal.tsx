import React from "react";
import { View, StyleSheet, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

const TIPS = [
  { icon: "map-pin" as const, text: "Every spot on Meetups is a real public place, a park, cafe, or community space. Never a private address." },
  { icon: "users" as const, text: "For a first meetup with someone new, consider bringing baby, a friend, or letting someone know where you'll be." },
  { icon: "heart" as const, text: "Trust your gut. If anything feels off before or during, it's okay to leave, no explanation needed." },
  { icon: "message-circle" as const, text: "A quick message beforehand to confirm plans is a normal, good idea, not overly cautious." },
];

export function MeetupSafetyModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Feather name="shield" size={22} color={colors.brand} />
            <Txt display style={{ fontSize: fontSize.lg }}>Before you meet up</Txt>
          </View>
          {TIPS.map((tip, i) => (
            <View key={i} style={styles.tipRow}>
              <Feather name={tip.icon} size={16} color={colors.brand} style={{ marginTop: 2 }} />
              <Txt style={{ flex: 1, fontSize: fontSize.sm, lineHeight: 20, color: colors.onSurface }}>
                {tip.text}
              </Txt>
            </View>
          ))}
          <Button testID="meetup-safety-dismiss" label="Got it" onPress={onClose} style={{ marginTop: spacing.md }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    maxWidth: 400,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
});
