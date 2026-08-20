import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { LinearGradient } from "expo-linear-gradient";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

// A gentle "bloom" motif instead of a smiley row — each stage is a softly
// growing, warming blob rather than a face. Deliberately not another
// emoji-mood-tracker; the metaphor is "how open/blooming do you feel today."
const MOOD_GRADIENTS: [string, string][] = [
  ["#B9C4CE", "#98A6B3"],   // closed, muted — struggling
  ["#B7C6D6", "#9FB6CC"],   // low
  ["#D9CBB8", "#CBB495"],   // okay, warming
  ["#E8B9A0", "#E39A78"],   // good
  ["#EFA98D", "#E8825C"],   // great, fully warm
];
const MOOD_SCALES = [0.55, 0.7, 0.82, 0.92, 1];
const MOOD_LABELS = ["Struggling", "Low", "Okay", "Good", "Great"];
const TAGS = ["Tired", "Anxious", "Grateful", "Overwhelmed", "Hopeful", "Lonely", "Proud", "Numb"];

export default function Checkin() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [customSleep, setCustomSleep] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // If she already checked in today, load her answers instead of starting blank —
  // editing should pick up where she left off, not throw it all away.
  useEffect(() => {
    if (!deviceId) return;
    api.moodToday(deviceId).then((res) => {
      if (res?.entry) {
        const e = res.entry;
        if (e.mood != null) setMood(e.mood);
        if (e.energy != null) setEnergy(e.energy);
        if (e.sleep_hours != null) setSleep(e.sleep_hours);
        if (e.note) setNote(e.note);
        if (e.tags) setTags(e.tags);
      }
    }).catch(() => {});
  }, [deviceId]);

  const toggleTag = (t: string) => {
    Haptics.selectionAsync();
    setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  };

  const save = async () => {
    if (mood == null || !deviceId) return;
    setSaving(true);
    try {
      await api.addMood({
        device_id: deviceId,
        mood,
        energy,
        sleep_hours: sleep,
        note: note.trim() || null,
        tags,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={{ fontSize: fontSize.xl }}>Daily check-in</Txt>
        <Pressable testID="checkin-close" onPress={() => router.back()} hitSlop={12}>
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["2xl"] }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Txt display style={styles.q}>How are you feeling?</Txt>
        <View style={styles.moodRow}>
          {MOOD_GRADIENTS.map((grad, i) => (
            <Pressable
              key={i}
              testID={`checkin-mood-${i + 1}`}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMood(i + 1);
              }}
              style={styles.moodColumn}
            >
              <View style={[styles.moodItem, mood === i + 1 && styles.moodSelected]}>
                <LinearGradient
                  colors={grad}
                  style={[
                    styles.moodBlob,
                    { transform: [{ scale: MOOD_SCALES[i] }], opacity: mood === i + 1 ? 1 : 0.75 },
                  ]}
                />
              </View>
              <Txt
                style={[styles.moodItemLabel, mood === i + 1 && { color: colors.brand }]}
                weight={mood === i + 1 ? "500" : "400"}
              >
                {MOOD_LABELS[i]}
              </Txt>
            </Pressable>
          ))}
        </View>

        <Txt display style={styles.q}>Energy level</Txt>
        <View style={styles.scaleRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              testID={`energy-${n}`}
              onPress={() => {
                Haptics.selectionAsync();
                setEnergy(n);
              }}
              style={[styles.scaleDot, energy === n && styles.scaleDotActive]}
            >
              <Txt style={{ color: energy === n ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{n}</Txt>
            </Pressable>
          ))}
        </View>

        <Txt display style={styles.q}>Hours of sleep last night</Txt>
        <View style={styles.wrapRow}>
          {[2, 4, 6, 8].map((h) => (
            <Pressable
              key={h}
              testID={`sleep-${h}`}
              onPress={() => {
                Haptics.selectionAsync();
                setSleep(h);
                setCustomSleep("");
              }}
              style={[styles.chip, !customSleep && sleep === h && styles.chipActive]}
            >
              <Txt style={{ color: !customSleep && sleep === h ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                {h === 8 ? "8+" : `~${h}`} hrs
              </Txt>
            </Pressable>
          ))}
        </View>
        <View style={styles.customSleepRow}>
          <TextInput
            testID="custom-sleep-input"
            value={customSleep}
            onChangeText={(txt) => {
              setCustomSleep(txt);
              const n = parseFloat(txt);
              if (Number.isFinite(n) && n >= 0) setSleep(n);
            }}
            placeholder="Or enter any amount (e.g. 0.5, 1.5, 3)"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            style={styles.customSleepInput}
          />
          {customSleep !== "" && (
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>hrs</Txt>
          )}
        </View>

        <Txt display style={styles.q}>{"What's present for you?"}</Txt>
        <View style={styles.wrapRow}>
          {TAGS.map((t) => (
            <Pressable
              key={t}
              testID={`tag-${t}`}
              onPress={() => toggleTag(t)}
              style={[styles.chip, tags.includes(t) && styles.chipActive]}
            >
              <Txt style={{ color: tags.includes(t) ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{t}</Txt>
            </Pressable>
          ))}
        </View>

        <Txt display style={styles.q}>A note to yourself (optional)</Txt>
        <TextInput
          testID="checkin-note"
          value={note}
          onChangeText={setNote}
          placeholder="Whatever you'd like to remember about today..."
          placeholderTextColor={colors.muted}
          multiline
          style={styles.noteInput}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          testID="save-checkin-button"
          label="Save check-in"
          onPress={save}
          disabled={mood == null}
          loading={saving}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  q: { fontSize: fontSize.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  moodRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  moodColumn: { alignItems: "center", flex: 1 },
  moodItemLabel: { fontSize: 11, color: colors.muted, marginTop: 6, textAlign: "center" },
  moodItem: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    borderColor: "transparent",
  },
  moodSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary + "50" },
  moodBlob: { width: 30, height: 30, borderRadius: radius.pill },
  scaleRow: { flexDirection: "row", justifyContent: "space-between" },
  scaleDot: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scaleDotActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  customSleepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  customSleepInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  noteInput: {
    minHeight: 100,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    textAlignVertical: "top",
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
