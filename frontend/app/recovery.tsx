import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const BLEEDING_OPTIONS = ["None", "Light", "Moderate", "Heavy"];
const INCISION_OPTIONS = ["Good", "Concerning"];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Recovery() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, profile } = useProfile();

  const [warningSigns, setWarningSigns] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [pain, setPain] = useState<number | null>(null);
  const [bleeding, setBleeding] = useState<string | null>(null);
  const [incision, setIncision] = useState<string | null>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isCSection = profile?.delivery_type === "c-section";

  useEffect(() => {
    api.recoveryWarningSigns().then(setWarningSigns).catch(() => {});
    if (deviceId) {
      api.recoveryCheckins(deviceId).then(setRecent).catch(() => {});
    }
  }, [deviceId]);

  const toggleSymptom = (key: string) => {
    Haptics.selectionAsync();
    setSymptoms((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  };

  const save = async () => {
    if (!deviceId) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.recoveryCheckin({
        device_id: deviceId,
        pain_level: pain,
        bleeding_level: bleeding,
        incision_status: isCSection ? incision : null,
        symptoms,
        note: note.trim() || null,
      });
      setSaved(true);
      const r = await api.recoveryCheckins(deviceId);
      setRecent(r);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  };

  const hasWarningSelected = symptoms.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>How's your body feeling?</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
            This is about your recovery, not the baby's
          </Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.lg }}>
        <View>
          <Txt weight="500" style={styles.q}>Pain level today</Txt>
          <View style={styles.chipWrap}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => { Haptics.selectionAsync(); setPain(n); }}
                style={[styles.scaleDot, pain === n && styles.scaleDotActive]}
              >
                <Txt style={{ color: pain === n ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{n}</Txt>
              </Pressable>
            ))}
          </View>
          <Txt style={styles.scaleHint}>1 = barely there · 5 = severe</Txt>
        </View>

        <View>
          <Txt weight="500" style={styles.q}>Bleeding</Txt>
          <View style={styles.chipWrap}>
            {BLEEDING_OPTIONS.map((b) => (
              <Pressable
                key={b}
                onPress={() => { Haptics.selectionAsync(); setBleeding(b.toLowerCase()); }}
                style={[styles.chip, bleeding === b.toLowerCase() && styles.chipActive]}
              >
                <Txt style={{ color: bleeding === b.toLowerCase() ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{b}</Txt>
              </Pressable>
            ))}
          </View>
        </View>

        {isCSection && (
          <View>
            <Txt weight="500" style={styles.q}>Incision healing</Txt>
            <View style={styles.chipWrap}>
              {INCISION_OPTIONS.map((o) => (
                <Pressable
                  key={o}
                  onPress={() => { Haptics.selectionAsync(); setIncision(o.toLowerCase()); }}
                  style={[styles.chip, incision === o.toLowerCase() && styles.chipActive]}
                >
                  <Txt style={{ color: incision === o.toLowerCase() ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{o}</Txt>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View>
          <Txt weight="500" style={styles.q}>Any of these right now?</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginBottom: spacing.sm }}>
            Select any that apply — these are the well-established signs doctors ask about.
          </Txt>
          <View style={{ gap: spacing.sm }}>
            {warningSigns.map((w) => {
              const active = symptoms.includes(w.key);
              return (
                <Pressable
                  key={w.key}
                  onPress={() => toggleSymptom(w.key)}
                  style={[styles.symptomRow, active && styles.symptomRowActive]}
                >
                  <View style={[styles.checkbox, active && styles.checkboxActive]}>
                    {active && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <Txt style={{ flex: 1, color: colors.onSurface, fontSize: fontSize.sm }}>{w.label}</Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        {hasWarningSelected && (
          <Animated.View entering={FadeIn}>
            <Card style={styles.urgentCard}>
              <Feather name="alert-triangle" size={20} color="#B23B3B" />
              <Txt style={{ color: "#7A2B2B", flex: 1, lineHeight: 20 }}>
                If you're experiencing any of these right now, please contact your provider or go to
                the ER — don't wait to hear back from this app. Trust what your body is telling you.
              </Txt>
            </Card>
          </Animated.View>
        )}

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything else worth noting (optional)"
          placeholderTextColor={colors.muted}
          multiline
          style={styles.noteInput}
        />

        <Button label="Save check-in" onPress={save} loading={saving} disabled={pain == null && !bleeding} />
        {saved && <Txt style={{ color: colors.success, textAlign: "center" }}>Saved — thank you for checking in on yourself.</Txt>}

        {recent.length > 0 && (
          <View>
            <Txt display style={{ fontSize: fontSize.lg, marginBottom: spacing.sm }}>Recent check-ins</Txt>
            {recent.slice(0, 5).map((r, i) => (
              <Card key={i} style={styles.recentRow}>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm, width: 70 }}>{timeAgo(r.created_at)}</Txt>
                <Txt style={{ flex: 1, fontSize: fontSize.sm }}>
                  {r.pain_level != null ? `Pain ${r.pain_level}/5` : ""}
                  {r.bleeding_level ? ` · ${r.bleeding_level} bleeding` : ""}
                  {r.has_warning_sign ? " · flagged a symptom" : ""}
                </Txt>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  q: { fontSize: fontSize.lg, marginBottom: spacing.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  scaleDot: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scaleDotActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  scaleHint: { color: colors.muted, fontSize: 11, marginTop: spacing.xs },
  symptomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  symptomRowActive: { borderColor: "#B23B3B", backgroundColor: "#F7E4E4" },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: { backgroundColor: "#B23B3B", borderColor: "#B23B3B" },
  urgentCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: "#F7E4E4",
    borderColor: "#E3B3B3",
  },
  noteInput: {
    minHeight: 80,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: fontSize.base,
    color: colors.onSurface,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
});
