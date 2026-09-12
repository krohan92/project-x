import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput, Share } from "react-native";
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
const LOCHIA_OPTIONS = [
  { key: "red", label: "Red" },
  { key: "pink_brown", label: "Pink / brown" },
  { key: "yellow_white", label: "Yellow / white" },
];
const DIASTASIS_OPTIONS = [
  { key: "no_gap", label: "No gap felt" },
  { key: "small_gap", label: "Small gap" },
  { key: "large_gap", label: "Larger gap" },
];

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
  const [timeline, setTimeline] = useState<any | null>(null);
  const [waterCups, setWaterCups] = useState(0);
  const [todaysMedications, setTodaysMedications] = useState<string[]>([]);
  const [knownMedications, setKnownMedications] = useState<string[]>([]);
  const [newMedication, setNewMedication] = useState("");
  const [pain, setPain] = useState<number | null>(null);
  const [bleeding, setBleeding] = useState<string | null>(null);
  const [incision, setIncision] = useState<string | null>(null);
  const [lochia, setLochia] = useState<string | null>(null);
  const [pelvicFloor, setPelvicFloor] = useState<boolean | null>(null);
  const [diastasis, setDiastasis] = useState<string | null>(null);
  const [showDiastasisGuide, setShowDiastasisGuide] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);

  const isCSection = profile?.delivery_type === "c-section";

  useEffect(() => {
    api.recoveryWarningSigns().then(setWarningSigns).catch(() => {});
    if (deviceId) {
      api.recoveryCheckins(deviceId).then(setRecent).catch(() => {});
      api.recoveryTimeline(deviceId).then(setTimeline).catch(() => {});
      api.momWellnessToday(deviceId).then((w) => {
        setWaterCups(w.water_cups || 0);
        setTodaysMedications(w.medications_taken || []);
      }).catch(() => {});
      api.momWellnessMedicationNames(deviceId).then(setKnownMedications).catch(() => {});
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
        lochia_color: lochia,
        pelvic_floor_done: pelvicFloor,
        diastasis_check: diastasis,
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

  const shareReport = async () => {
    if (!deviceId) return;
    setSharing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { report_text } = await api.recoveryReport(deviceId);
      await Share.share({ message: report_text });
    } catch {}
    setSharing(false);
  };

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
        {timeline?.available && (
          <Card style={styles.timelineCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs }}>
              <Feather name="calendar" size={16} color={colors.brand} />
              <Txt style={{ color: colors.brand, fontSize: fontSize.sm }} weight="500">
                Day {timeline.days_postpartum} postpartum · {timeline.title}
              </Txt>
            </View>
            <Txt style={{ fontSize: fontSize.sm, lineHeight: 20, color: colors.onSurface }}>
              {timeline.body}
            </Txt>
            <Txt style={{ fontSize: 11, color: colors.muted, marginTop: spacing.sm }}>
              General patterns, not a promise about your specific recovery. Trust what your own body is telling you.
            </Txt>
          </Card>
        )}

        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Txt weight="500" style={styles.q}>Water today</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{waterCups} {waterCups === 1 ? "cup" : "cups"}</Txt>
          </View>
          <Pressable
            testID="log-water-cup"
            onPress={async () => {
              if (!deviceId) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await api.momWellnessLog(deviceId, "water");
              setWaterCups((c) => c + 1);
            }}
            style={styles.waterButton}
          >
            <Feather name="plus" size={18} color={colors.brand} />
            <Txt style={{ color: colors.brand }} weight="500">Log a cup of water</Txt>
          </Pressable>
        </View>

        <View>
          <Txt weight="500" style={styles.q}>Medications</Txt>
          {todaysMedications.length > 0 && (
            <View style={{ marginBottom: spacing.sm }}>
              {todaysMedications.map((m, i) => (
                <Txt key={i} style={{ color: colors.muted, fontSize: fontSize.sm }}>✓ {m} taken today</Txt>
              ))}
            </View>
          )}
          {knownMedications.length > 0 && (
            <View style={[styles.chipWrap, { marginBottom: spacing.sm }]}>
              {knownMedications.filter((m) => !todaysMedications.includes(m)).map((m) => (
                <Pressable
                  key={m}
                  testID={`log-known-med-${m}`}
                  onPress={async () => {
                    if (!deviceId) return;
                    Haptics.selectionAsync();
                    await api.momWellnessLog(deviceId, "medication", m);
                    setTodaysMedications((prev) => [...prev, m]);
                  }}
                  style={styles.chip}
                >
                  <Txt style={{ color: colors.onSurfaceSecondary }}>+ {m}</Txt>
                </Pressable>
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <TextInput
              testID="new-medication-input"
              value={newMedication}
              onChangeText={setNewMedication}
              placeholder="e.g. prenatal vitamin, pain medication"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable
              testID="log-new-medication"
              onPress={async () => {
                const name = newMedication.trim();
                if (!name || !deviceId) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                await api.momWellnessLog(deviceId, "medication", name);
                setTodaysMedications((prev) => [...prev, name]);
                if (!knownMedications.includes(name)) setKnownMedications((prev) => [...prev, name]);
                setNewMedication("");
              }}
              style={styles.customAreaConfirm}
            >
              <Feather name="check" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </View>

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

        <View>
          <Txt weight="500" style={styles.q}>Lochia color</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginBottom: spacing.sm }}>
            This naturally shifts over the weeks. A useful thing to track, not a cause for worry on its own.
          </Txt>
          <View style={styles.chipWrap}>
            {LOCHIA_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                testID={`lochia-${o.key}`}
                onPress={() => { Haptics.selectionAsync(); setLochia(o.key); }}
                style={[styles.chip, lochia === o.key && styles.chipActive]}
              >
                <Txt style={{ color: lochia === o.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{o.label}</Txt>
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
          <Txt weight="500" style={styles.q}>Pelvic floor exercises today?</Txt>
          <View style={styles.chipWrap}>
            {[{ v: true, l: "Yes" }, { v: false, l: "Not yet" }].map((o) => (
              <Pressable
                key={o.l}
                onPress={() => { Haptics.selectionAsync(); setPelvicFloor(o.v); }}
                style={[styles.chip, pelvicFloor === o.v && styles.chipActive]}
              >
                <Txt style={{ color: pelvicFloor === o.v ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{o.l}</Txt>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Txt weight="500" style={styles.q}>Diastasis recti check</Txt>
            <Pressable testID="diastasis-guide-toggle" onPress={() => setShowDiastasisGuide((s) => !s)} hitSlop={8}>
              <Txt style={{ color: colors.brand, fontSize: fontSize.sm, textDecorationLine: "underline" }}>
                {showDiastasisGuide ? "Hide how" : "How do I check?"}
              </Txt>
            </Pressable>
          </View>
          {showDiastasisGuide && (
            <Card style={styles.guideCard}>
              <Txt style={{ fontSize: fontSize.sm, lineHeight: 20, color: colors.onSurface }}>
                Lie on your back, knees bent, feet flat. Lift just your head and shoulders slightly, like a small
                crunch. Feel along the midline of your belly, above and below your belly button, for a gap between
                the two sides of your abdominal muscles. This is a rough self-check, not a diagnosis. A pelvic
                floor physical therapist can assess it properly.
              </Txt>
            </Card>
          )}
          <View style={[styles.chipWrap, { marginTop: spacing.sm }]}>
            {DIASTASIS_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                testID={`diastasis-${o.key}`}
                onPress={() => { Haptics.selectionAsync(); setDiastasis(o.key); }}
                style={[styles.chip, diastasis === o.key && styles.chipActive]}
              >
                <Txt style={{ color: diastasis === o.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{o.label}</Txt>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Txt weight="500" style={styles.q}>Any of these right now?</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginBottom: spacing.sm }}>
            Select any that apply. These are the well-established signs doctors ask about.
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
                the ER. Don't wait to hear back from this app. Trust what your body is telling you.
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
        {saved && <Txt style={{ color: colors.success, textAlign: "center" }}>Saved. Thank you for checking in on yourself.</Txt>}

        {recent.length > 0 && (
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Txt display style={{ fontSize: fontSize.lg }}>Recent check-ins</Txt>
              <Pressable testID="share-recovery-report" onPress={shareReport} disabled={sharing} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Feather name="share" size={14} color={colors.brand} />
                <Txt style={{ color: colors.brand, fontSize: fontSize.sm }}>{sharing ? "Preparing..." : "Share with provider"}</Txt>
              </Pressable>
            </View>
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
  guideCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
  },
  waterButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customAreaConfirm: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineCard: {
    backgroundColor: colors.brandTertiary + "25",
    borderColor: colors.brandTertiary,
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
