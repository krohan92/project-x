import React, { useState } from "react";
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
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const MOODS = ["😔", "😟", "😐", "🙂", "😊"];
const MOOD_LABELS = ["Struggling", "Low", "Okay", "Good", "Great"];
const TAGS = ["Tired", "Anxious", "Grateful", "Overwhelmed", "Hopeful", "Lonely", "Proud", "Numb"];

export default function Checkin() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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
          {MOODS.map((m, i) => (
            <Pressable
              key={i}
              testID={`checkin-mood-${i + 1}`}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMood(i + 1);
              }}
              style={[styles.moodItem, mood === i + 1 && styles.moodSelected]}
            >
              <Txt style={{ fontSize: 32 }}>{m}</Txt>
            </Pressable>
          ))}
        </View>
        {mood != null && (
          <Animated.View entering={FadeIn}>
            <Txt display style={styles.moodLabel}>{MOOD_LABELS[mood - 1]}</Txt>
          </Animated.View>
        )}

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
              }}
              style={[styles.chip, sleep === h && styles.chipActive]}
            >
              <Txt style={{ color: sleep === h ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                {h === 8 ? "8+" : `~${h}`} hrs
              </Txt>
            </Pressable>
          ))}
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
  moodRow: { flexDirection: "row", justifyContent: "space-between" },
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
  moodLabel: { textAlign: "center", color: colors.brand, fontSize: fontSize.lg, marginTop: spacing.md },
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
