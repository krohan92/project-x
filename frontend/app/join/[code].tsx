import React, { useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, roleAccent } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const ROLE_OPTIONS = [
  { value: "mom", label: "Mom" },
  { value: "dad", label: "Dad" },
  { value: "caregiver", label: "Caregiver" },
];

export default function JoinHousehold() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, profile } = useProfile();

  const [role, setRole] = useState("dad");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (!deviceId || !code) return;
    setBusy(true);
    setError(null);
    try {
      await api.joinHousehold({
        device_id: deviceId,
        household_code: String(code).toUpperCase(),
        name: profile?.name || "Partner",
        role,
      });
      router.replace("/(tabs)/track");
    } catch {
      setError("That code didn't work — double check it with whoever sent it.");
    }
    setBusy(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      <Card style={{ gap: spacing.md, margin: spacing.lg }}>
        <Txt display style={{ fontSize: fontSize.xl }}>You've been invited to Cuddle</Txt>
        <Txt style={{ color: colors.muted }}>
          Someone wants to tag-team caring for the baby with you. Join code:
        </Txt>
        <View style={styles.codeBox}>
          <Txt display style={{ fontSize: fontSize["2xl"], letterSpacing: 4 }}>
            {String(code || "").toUpperCase()}
          </Txt>
        </View>

        <Txt style={{ color: colors.muted, marginTop: spacing.sm }}>Who are you?</Txt>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {ROLE_OPTIONS.map((opt) => {
            const active = role === opt.value;
            const accent = roleAccent(opt.value);
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setRole(opt.value);
                }}
                style={[
                  styles.roleChip,
                  {
                    backgroundColor: active ? accent?.tint : colors.surface,
                    borderColor: active ? accent?.fg : colors.borderStrong,
                  },
                ]}
              >
                <Txt style={{ fontSize: fontSize.sm, color: active ? colors.onSurface : colors.muted }}>
                  {opt.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        {error && <Txt style={{ color: colors.error, fontSize: fontSize.sm }}>{error}</Txt>}

        <Button label="Join household" onPress={join} loading={busy} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  codeBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  roleChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
  },
});
