import React, { useCallback, useState } from "react";
import { View, StyleSheet, TextInput, Pressable, Share, Platform, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { registerForPushNotifications } from "@/src/lib/push-notifications";
import { useAmbient } from "@/src/lib/ambient-context";

function appBaseUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  return null; // native build without a known web URL — code-only sharing still works
}

function buildInviteMessage(code: string) {
  const base = appBaseUrl();
  const link = base ? `${base}/join/${code}` : null;
  return link
    ? `Join me on Cuddle so we can tag-team caring for the baby. Tap this link and it'll walk you through it: ${link}\n\n(Or open Cuddle and enter code ${code})`
    : `Join me on Cuddle so we can tag-team caring for the baby. Open Cuddle and enter this code: ${code}`;
}

// Opens the Messages/iMessage app directly with the invite pre-filled — no
// picker, no extra taps. Works on phones (iOS/Android); on desktop browsers
// there's no Messages app to hand off to, so it simply won't do anything.
function textInvite(code: string, phone: string) {
  const message = buildInviteMessage(code);
  const digits = phone.replace(/[^\d+]/g, "");
  const encoded = encodeURIComponent(message);
  // iOS wants '&body=', Android's SMS handler wants '?body=' — '&' also
  // works broadly enough in practice, but we detect where we can.
  const sep = Platform.OS === "ios" ? "&" : "?";
  const url = `sms:${digits}${sep}body=${encoded}`;
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.location.href = url;
  } else {
    Linking.openURL(url).catch(() => {});
  }
}

async function shareInvite(code: string, onCopied: () => void) {
  const message = buildInviteMessage(code);
  try {
    if (Platform.OS !== "web") {
      await Share.share({ message });
      return;
    }
    // Web: use the native share sheet if the browser supports it (most mobile
    // browsers do), otherwise fall back to copying the link to the clipboard.
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      await (navigator as any).share({ title: "Join me on Cuddle", text: message });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(message);
      onCopied();
    }
  } catch {
    // user cancelled the share sheet — not an error
  }
}

const LEVEL_COLOR: Record<string, string> = {
  steady: colors.success,
  check_in: colors.warning,
  suggest: colors.error,
  urgent: colors.error,
};

const LEVEL_LABEL: Record<string, string> = {
  steady: "Steady",
  check_in: "Worth a check-in",
  suggest: "Good time to tag out",
  urgent: "Please check in",
};

const ROLE_OPTIONS: { value: string; label: string; icon: any }[] = [
  { value: "mom", label: "Mom", icon: "heart" },
  { value: "dad", label: "Dad", icon: "shield" },
  { value: "caregiver", label: "Caregiver", icon: "users" },
];

// Soft pastel accent by role — kept subtle on purpose so the app stays calm,
// this is an accent touch, not a full re-theme.
function roleAccent(role?: string | null) {
  const r = (role || "").toLowerCase();
  if (r.includes("mom") || r.includes("mother") || r === "primary") {
    return { fg: colors.roleMom, tint: colors.roleMomTint };
  }
  if (r.includes("dad") || r.includes("father") || r === "partner") {
    return { fg: colors.roleDad, tint: colors.roleDadTint };
  }
  return { fg: colors.roleNeutral, tint: colors.roleNeutralTint };
}

export function HandoffCard() {
  const { deviceId, profile } = useProfile();
  const { refresh: refreshAmbient } = useAmbient();

  const [household, setHousehold] = useState<any | null>(null);
  const [score, setScore] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // setup form state
  const [mode, setMode] = useState<"create" | "join" | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [selectedRole, setSelectedRole] = useState("mom");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteePhone, setInviteePhone] = useState("");
  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState("mom");
  const [savingRole, setSavingRole] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const [sosSent, setSosSent] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const h = await api.householdForDevice(deviceId);
      setHousehold(h);
      if (h) {
        const s = await api.handoffScore(h.household_code);
        setScore(s);
        // Best-effort — silently no-ops on web / without a native build.
        registerForPushNotifications(deviceId);
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
        role: selectedRole,
      });
      setHousehold(h);
      setMode(null);
      refreshAmbient();
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
        role: selectedRole,
      });
      setHousehold(h);
      setMode(null);
      const s = await api.handoffScore(h.household_code);
      setScore(s);
      refreshAmbient();
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
      refreshAmbient();
    } catch {}
    setBusy(false);
  };

  const sendSOS = async () => {
    if (!deviceId || !household) return;
    setSosSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await api.sos({ household_code: household.household_code, device_id: deviceId });
      setSosSent(true);
      setTimeout(() => setSosSent(false), 4000);
    } catch {}
    setSosSending(false);
  };

  const changeRole = async () => {
    if (!deviceId || !household) return;
    setSavingRole(true);
    try {
      const h = await api.updateRole({
        household_code: household.household_code,
        device_id: deviceId,
        role: roleDraft,
      });
      setHousehold(h);
      if (score) {
        const s = await api.handoffScore(h.household_code);
        setScore(s);
      }
      refreshAmbient();
      setEditingRole(false);
    } catch {}
    setSavingRole(false);
  };

  if (loading) return null;

  // ---- No household yet: setup ----
  if (!household) {
    return (
      <Animated.View entering={FadeInDown.duration(400)}>
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {mode !== null && (
              <Pressable onPress={() => setMode(null)} hitSlop={10} testID="tag-team-back">
                <Feather name="arrow-left" size={18} color={colors.muted} />
              </Pressable>
            )}
            <Feather name="repeat" size={20} color={colors.brand} />
            <Txt display style={{ fontSize: fontSize.lg }}>Tag Team</Txt>
          </View>
          <Txt style={{ color: colors.muted }}>
            Link up with your partner or another caregiver so Cuddle can gently nudge when
            it might be a good time to switch off.
          </Txt>

          <RolePicker selected={selectedRole} onSelect={setSelectedRole} />

          {mode === null && (
            <Animated.View entering={FadeIn} style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button label="Start a household" onPress={() => setMode("create")} style={{ flex: 1 }} />
              <Button label="I have a code" variant="secondary" onPress={() => setMode("join")} style={{ flex: 1 }} />
            </Animated.View>
          )}

          {mode === "create" && (
            <Animated.View entering={FadeInDown.duration(250)} style={{ gap: spacing.sm }}>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                We'll generate a short code to share with your partner or caregiver.
              </Txt>
              <Button label="Generate code" onPress={create} loading={busy} />
            </Animated.View>
          )}

          {mode === "join" && (
            <Animated.View entering={FadeInDown.duration(250)} style={{ gap: spacing.sm }}>
              <TextInput
                value={codeInput}
                onChangeText={setCodeInput}
                placeholder="Enter household code"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                style={styles.input}
              />
              <Button label="Join" onPress={join} loading={busy} disabled={!codeInput.trim()} />
            </Animated.View>
          )}
        </Card>
      </Animated.View>
    );
  }

  // ---- Household set up but only one member so far ----
  if (household.members.length < 2) {
    const myRole = household.members.find((m: any) => m.device_id === deviceId)?.role;
    const meAccent = roleAccent(myRole);
    const roleLabel = myRole ? myRole.charAt(0).toUpperCase() + myRole.slice(1) : "";
    return (
      <Animated.View entering={FadeInDown.duration(400)}>
        <Card style={{ gap: spacing.sm, backgroundColor: meAccent.tint, borderColor: meAccent.fg + "40", borderWidth: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={[styles.avatarDot, { backgroundColor: meAccent.fg }]} />
            <Txt display style={{ fontSize: fontSize.lg }}>Tag Team</Txt>
            {!!roleLabel && !editingRole && (
              <Animated.View entering={FadeIn}>
                <Pressable
                  onPress={() => { setRoleDraft(myRole); setEditingRole(true); }}
                  style={[styles.roleBadge, { backgroundColor: meAccent.fg + "30", flexDirection: "row", alignItems: "center", gap: 4 }]}
                >
                  <Txt style={{ color: meAccent.fg, fontSize: fontSize.sm }} weight="500">You're {roleLabel}</Txt>
                  <Feather name="edit-2" size={11} color={meAccent.fg} />
                </Pressable>
              </Animated.View>
            )}
          </View>

          {editingRole ? (
            <Animated.View entering={FadeInDown.duration(250)} style={{ gap: spacing.sm }}>
              <RolePicker selected={roleDraft} onSelect={setRoleDraft} />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Button label="Save" onPress={changeRole} loading={savingRole} style={{ flex: 1 }} />
                <Button label="Cancel" variant="secondary" onPress={() => setEditingRole(false)} style={{ flex: 1 }} />
              </View>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn} style={{ gap: spacing.sm }}>
              <Txt style={{ color: colors.muted }}>Text this invite straight to your partner or caregiver:</Txt>
              <TextInput
                value={inviteePhone}
                onChangeText={setInviteePhone}
                placeholder="Their phone number"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                style={styles.input}
              />
              <Button
                label="Text it"
                onPress={() => textInvite(household.household_code, inviteePhone)}
                disabled={!inviteePhone.trim()}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>or share the code directly</Txt>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              </View>
              <View style={styles.codeBox}>
                <Txt display style={{ fontSize: fontSize["2xl"], letterSpacing: 4 }}>
                  {household.household_code}
                </Txt>
              </View>
              <Button
                label={copied ? "Copied — paste it in a text" : "More share options"}
                variant="secondary"
                onPress={() => shareInvite(household.household_code, () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                })}
              />
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                If they already have Cuddle, they can just type in the code. If not, the link walks
                them to a page where they enter it themselves after installing — either way, no
                account or login needed.
              </Txt>
            </Animated.View>
          )}
        </Card>
      </Animated.View>
    );
  }

  // ---- Active household with score ----
  const onDutyMember = household.members.find((m: any) => m.device_id === score?.on_duty_device_id);
  const isMeOnDuty = score?.on_duty_device_id === deviceId;
  const levelColor = LEVEL_COLOR[score?.level] || colors.muted;
  const accent = roleAccent(score?.on_duty_role || onDutyMember?.role);
  const myMember = household.members.find((m: any) => m.device_id === deviceId);
  const myRoleLabel = myMember?.role ? myMember.role.charAt(0).toUpperCase() + myMember.role.slice(1) : "";

  return (
    <Animated.View entering={FadeInDown.duration(400)}>
      <Card style={{ gap: spacing.md, backgroundColor: accent.tint, borderColor: accent.fg + "40", borderWidth: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={[styles.avatarDot, { backgroundColor: accent.fg }]} />
          <Txt display style={{ fontSize: fontSize.lg, flex: 1 }}>Tag Team</Txt>
          {!editingRole && (
            <Pressable
              onPress={() => { setRoleDraft(myMember?.role || "mom"); setEditingRole(true); }}
              style={[styles.roleBadge, { backgroundColor: colors.surface + "AA", flexDirection: "row", alignItems: "center", gap: 4 }]}
            >
              <Txt style={{ color: colors.onSurface, fontSize: fontSize.sm }} weight="500">You're {myRoleLabel}</Txt>
              <Feather name="edit-2" size={11} color={colors.onSurface} />
            </Pressable>
          )}
          {!editingRole && (
            <View style={[styles.badge, { backgroundColor: levelColor + "25" }]}>
              <View style={[styles.dot, { backgroundColor: levelColor }]} />
              <Txt weight="500" style={{ color: levelColor, fontSize: fontSize.sm }}>
                {LEVEL_LABEL[score?.level] || ""}
              </Txt>
            </View>
          )}
        </View>

        {editingRole ? (
          <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOut} style={{ gap: spacing.sm }}>
            <RolePicker selected={roleDraft} onSelect={setRoleDraft} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button label="Save" onPress={changeRole} loading={savingRole} style={{ flex: 1 }} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditingRole(false)} style={{ flex: 1 }} />
            </View>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={{ gap: spacing.md }}>
            <Txt style={{ color: colors.onSurface }}>
              {onDutyMember?.name || "Someone"} has been on duty for{" "}
              <Txt weight="500">{score?.hours_on_duty ?? 0}h</Txt>. {score?.message}
            </Txt>

            {score?.emotion_signal?.detected && (
              <Animated.View entering={FadeIn} style={[styles.emotionBanner, { borderColor: accent.fg + "50" }]}>
                <Feather name="heart" size={14} color={accent.fg} />
                <Txt style={{ color: colors.onSurface, fontSize: fontSize.sm, flex: 1 }}>
                  {score.emotion_signal.suggested_note}
                </Txt>
              </Animated.View>
            )}

            <Pressable onPress={() => setShowBreakdown((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                {showBreakdown ? "Hide" : "Why this suggestion?"}
              </Txt>
              <Feather name={showBreakdown ? "chevron-up" : "chevron-down"} size={14} color={colors.muted} />
            </Pressable>

            {showBreakdown && score?.breakdown && (
              <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut} style={styles.breakdownBox}>
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
              </Animated.View>
            )}

            {!isMeOnDuty && (
              <Button label="I've got it — tag me in" onPress={tagIn} loading={busy} />
            )}
            {isMeOnDuty && (
              <>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm, textAlign: "center" }}>
                  You're on duty. {score?.suggested_next?.name || "Your partner"} can tag in from their phone.
                </Txt>
                <SOSSection
                  onNotify={sendSOS}
                  sosSending={sosSending}
                  sosSent={sosSent}
                />
              </>
            )}
            {Platform.OS === "web" && (
              <Txt style={{ color: colors.muted, fontSize: 11, textAlign: "center" }}>
                Push nudges need the phone app (not this web version) — this card still updates live either way.
              </Txt>
            )}
          </Animated.View>
        )}
      </Card>
    </Animated.View>
  );
}

function SOSSection({
  onNotify,
  sosSending,
  sosSent,
}: {
  onNotify: () => void;
  sosSending: boolean;
  sosSent: boolean;
}) {
  const [confirm, setConfirm] = useState(false);

  if (sosSent) {
    return (
      <Animated.View entering={FadeIn} style={styles.sosSentBox}>
        <Feather name="check-circle" size={18} color={colors.success} />
        <Txt style={{ color: colors.success, fontSize: fontSize.sm }} weight="500">
          Sent — they've been notified.
        </Txt>
      </Animated.View>
    );
  }

  return (
    <View style={{ alignItems: "center", gap: spacing.sm }}>
      {!confirm ? (
        <Pressable
          testID="sos-button"
          onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setConfirm(true); }}
          style={styles.sosCircle}
        >
          <Txt style={{ color: "#fff", fontSize: fontSize.lg }} weight="500">SOS</Txt>
        </Pressable>
      ) : (
        <Animated.View entering={FadeIn} style={{ width: "100%", gap: spacing.sm }}>
          <Txt style={{ textAlign: "center", color: colors.onSurface }}>
            This notifies your partner right now. Are you sure?
          </Txt>
          <Button label="Yes, notify them now" onPress={onNotify} loading={sosSending} />
          <Button label="Cancel" variant="secondary" onPress={() => setConfirm(false)} />
        </Animated.View>
      )}
    </View>
  );
}

function RolePicker({ selected, onSelect }: { selected: string; onSelect: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      {ROLE_OPTIONS.map((opt) => {
        const active = selected === opt.value;
        const accent = roleAccent(opt.value);
        return (
          <View key={opt.value} style={{ flex: 1 }}>
            <Pressable
              onPress={() => onSelect(opt.value)}
              style={[
                styles.roleChip,
                {
                  backgroundColor: active ? accent.tint : colors.surface,
                  borderColor: active ? accent.fg : colors.borderStrong,
                  borderWidth: active ? 2 : 1,
                },
              ]}
            >
              <View style={[styles.roleIconBadge, { backgroundColor: accent.fg }]}>
                <Feather name={opt.icon} size={15} color="#fff" />
              </View>
              <Txt style={{ fontSize: fontSize.sm, color: active ? colors.onSurface : colors.muted, marginTop: 4 }} weight={active ? "500" : "400"}>
                {opt.label}
              </Txt>
            </Pressable>
          </View>
        );
      })}
    </View>
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
  roleBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  sosCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.sm,
    shadowColor: colors.error,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sosSentBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.success + "15",
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
  avatarDot: { width: 10, height: 10, borderRadius: 5 },
  emotionBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surface + "CC",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  roleChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  roleIconBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
