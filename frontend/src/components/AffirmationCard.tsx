import React, { useEffect, useState } from "react";
import { View, Pressable, Switch, StyleSheet, Platform, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import {
  DEFAULT_SETTINGS,
  loadAffirmationSettings,
  saveAffirmationSettings,
  type AffirmationSettings,
} from "@/src/lib/daily-affirmation";

const TIMES: { label: string; hour: number; minute: number }[] = [
  { label: "6:30 AM", hour: 6, minute: 30 },
  { label: "8:00 AM", hour: 8, minute: 0 },
  { label: "10:00 AM", hour: 10, minute: 0 },
  { label: "12:00 PM", hour: 12, minute: 0 },
  { label: "3:00 PM", hour: 15, minute: 0 },
  { label: "8:00 PM", hour: 20, minute: 0 },
];

export function AffirmationCard() {
  const [s, setS] = useState<AffirmationSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadAffirmationSettings().then(setS);
  }, []);

  if (Platform.OS === "web") return null;

  const apply = async (next: AffirmationSettings) => {
    const ok = await saveAffirmationSettings(next);
    if (!ok && next.enabled) {
      Alert.alert(
        "Notifications are off",
        "To get a daily note, allow notifications for Cuddle in your phone's Settings.",
      );
      setS({ ...next, enabled: false });
      return;
    }
    setS(next);
  };

  return (
    <Card testID="affirmation-card" style={{ marginBottom: spacing.md }}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Feather name="heart" size={18} color={colors.brandPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={styles.title}>Daily gentle note</Txt>
          <Txt style={styles.sub}>A kind thought on your lock screen, once a day.</Txt>
        </View>
        <Switch
          testID="affirmation-switch"
          value={s.enabled}
          onValueChange={(v) => {
            Haptics.selectionAsync().catch(() => {});
            apply({ ...s, enabled: v });
          }}
        />
      </View>
      {s.enabled && (
        <View style={styles.chips}>
          {TIMES.map((t) => {
            const active = t.hour === s.hour && t.minute === s.minute;
            return (
              <Pressable
                key={t.label}
                testID={`affirmation-time-${t.hour}-${t.minute}`}
                onPress={() => apply({ ...s, hour: t.hour, minute: t.minute })}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Txt style={[styles.chipText, active && { color: "#fff" }]}>{t.label}</Txt>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontWeight: "600" },
  sub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: fontSize.sm },
});
