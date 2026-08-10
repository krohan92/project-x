import React, { useCallback, useState } from "react";
import { View, StyleSheet, TextInput, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const LEVEL_COLOR: Record<string, string> = {
  steady: colors.success,
  check_in: colors.warning,
  suggest: colors.error,
};

const LEVEL_LABEL: Record<string, string> = {
  steady: "Steady",
  check_in: "Worth a check-in",
  suggest: "Good time to tag out",
};

export function HandoffCard() {
  const { deviceId, profile } = useProfile();

  const [household, setHousehold] = useState<any | null>(null);
  const [score, setScore] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // setup form state
  const [mode, setMode] = useState<"create" | "join" | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [showBreakdown, setShowBreakdown] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const h = await api.householdForDevice(deviceId);
      setHousehold(h);
      if (h) {
        const s = await api.handoffScore(h.household_code);
        setScore(s);
      }
    } catch {
      // no household yet, or transient error — safe to ignore, shows setup state
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!deviceId) return;
    setBusy(true);
    try {
      const h = await api.createHousehold({
        device_id: deviceId,
        name: profile?.name || "Me",
      });
      setHousehold(h);
      setMode(null);
    } catch {}
    setBusy(false);
  };

  const join = async () => {
    if (!deviceId || !codeInput.trim()) return;
    setBusy(true);
    try {
      const h = await api.joinHousehold({
        device_id: deviceId,
        household_code: codeInput.trim().toUpperCase(),
        name: profile?.name || "Partner",
      });
      setHousehold(h);
      setMode(null);
      const s = await api.handoffScore(h.household_code);
      setScore(s);
    } catch {
      // likely an invalid code — keep the form open so they can retry
    }
    setBusy(false);
  };

  const tagIn = async () => {
    if (!deviceId || !household) return;
    setBusy(true);
    try {
      const h = await api.handoffSwitch({
        household_code: household.household_code,
        device_id: deviceId,
      });
      setHousehold(h);
      const s = await api.handoffScore(h.household_code);
      setScore(s);
    } catch {}
    setBusy(false);
  };

  if (loading) return null;

  // ---- No household yet: setup ----
  if (!household) {
    return (
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name="repeat" size={20} color={colors.brand} />
          <Txt display style={{ fontSize: fontSize.lg }}>Tag Team</Txt>
        </View>
        <Txt style={{ color: colors.muted }}>
          Link up with your partner or another caregiver so Cuddle can gently nudge when
          it might be a good time to switch off.
        </Txt>

        {mode === null && (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button label="Start a household" onPress={() => setMode("create")} style={{ flex: 1 }} />
            <Button label="I have a code" variant="secondary" onPress={() => setMode("join")} style={{ flex: 1 }} />
          </View>
        )}

        {mode === "create" && (
          <View style={{ gap: spacing.sm }}>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
              We'll generate a short code to share with your partner or caregiver.
            </Txt>
            <Button label="Generate code" onPress={create} loading={busy} />
          </View>
        )}

        {mode === "join" && (
          <View style={{ gap: spacing.sm }}>
            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder="Enter household code"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              style={styles.input}
            />
            <Button label="Join" onPress={join} loading={busy} disabled={!codeInput.trim()} />
          </View>
        )}
      </Card>
    );
  }

  // ---- Household set up but only one member so far ----
  if (household.members.length < 2) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name="repeat" size={20} color={colors.brand} />
          <Txt display style={{ fontSize: fontSize.lg }}>Tag Team</Txt>
        </View>
        <Txt style={{ color: colors.muted }}>Share this code with your partner or caregiver:</Txt>
        <View style={styles.codeBox}>
          <Txt display style={{ fontSize: fontSize["2xl"], letterSpacing: 4 }}>
            {household.household_code}
          </Txt>
        </View>
      </Card>
    );
  }

  // ---- Active household with score ----
  const onDutyMember = household.members.find((m: any) => m.device_id === score?.on_duty_device_id);
  const isMeOnDuty = score?.on_duty_device_id === deviceId;
  const levelColor = LEVEL_COLOR[score?.level] || colors.muted;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Feather name="repeat" size={20} color={colors.brand} />
        <Txt display style={{ fontSize: fontSize.lg, flex: 1 }}>Tag Team</Txt>
        <View style={[styles.badge, { backgroundColor: levelColor + "25" }]}>
          <View style={[styles.dot, { backgroundColor: levelColor }]} />
          <Txt weight="500" style={{ color: levelColor, fontSize: fontSize.sm }}>
            {LEVEL_LABEL[score?.level] || ""}
          </Txt>
        </View>
      </View>

      <Txt style={{ color: colors.onSurface }}>
        {onDutyMember?.name || "Someone"} has been on duty for{" "}
        <Txt weight="500">{score?.hours_on_duty ?? 0}h</Txt>. {score?.message}
      </Txt>

      <Pressable onPress={() => setShowBreakdown((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
          {showBreakdown ? "Hide" : "Why this suggestion?"}
        </Txt>
        <Feather name={showBreakdown ? "chevron-up" : "chevron-down"} size={14} color={colors.muted} />
      </Pressable>

      {showBreakdown && score?.breakdown && (
        <View style={styles.breakdownBox}>
          <BreakdownRow label="Hours on duty" value={`${score.breakdown.hours_on_duty}h`} />
          <BreakdownRow label="Interruptions this shift" value={String(score.breakdown.interruptions_since_shift_start)} />
          <BreakdownRow label="Overnight interruptions" value={String(score.breakdown.overnight_interruptions)} />
          <BreakdownRow
            label="Latest energy"
            value={score.breakdown.latest_energy_1to5 != null ? `${score.breakdown.latest_energy_1to5}/5` : "—"}
          />
          <BreakdownRow
            label="Latest mood"
            value={score.breakdown.latest_mood_1to5 != null ? `${score.breakdown.latest_mood_1to5}/5` : "—"}
          />
        </View>
      )}

      {!isMeOnDuty && (
        <Button label="I've got it — tag me in" onPress={tagIn} loading={busy} />
      )}
      {isMeOnDuty && (
        <Txt style={{ color: colors.muted, fontSize: fontSize.sm, textAlign: "center" }}>
          You're on duty. {score?.suggested_next?.name || "Your partner"} can tag in from their phone.
        </Txt>
      )}
    </Card>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{label}</Txt>
      <Txt style={{ fontSize: fontSize.sm }} weight="500">{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  codeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  breakdownBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
