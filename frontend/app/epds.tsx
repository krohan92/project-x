import React, { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";

import { Txt, Button, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

type Q = { q: string; options: { label: string; score: number }[] };

const BANDS: Record<string, { label: string; color: string; head: string; note: string }> = {
  low: {
    label: "Low likelihood",
    color: colors.success,
    head: "You're holding up",
    note: "Your responses suggest you're coping reasonably well right now. That said, feelings shift day to day — keep checking in with yourself, and know Aura is always here.",
  },
  possible: {
    label: "Worth a gentle look",
    color: colors.warning,
    head: "Be extra kind to yourself",
    note: "Some responses suggest you may be finding things harder than usual. This is common and it is not your fault. Consider sharing how you feel with someone you trust or your healthcare provider.",
  },
  likely: {
    label: "Please reach out",
    color: colors.error,
    head: "You deserve support",
    note: "Your responses suggest you may be going through a genuinely hard time. Many mothers feel this way, and support truly helps. Please talk to your healthcare provider soon — you don't have to carry this alone.",
  },
};

export default function Epds() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [questions, setQuestions] = useState<Q[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  useEffect(() => {
    api
      .epdsQuestions()
      .then((qs) => {
        setQuestions(qs);
        setAnswers(new Array(qs.length).fill(-1));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const select = async (score: number) => {
    Haptics.selectionAsync();
    const na = [...answers];
    na[idx] = score;
    setAnswers(na);
    if (idx < questions.length - 1) {
      setTimeout(() => setIdx((i) => i + 1), 180);
    } else {
      // submit
      setSubmitting(true);
      try {
        const res = await api.submitEpds({ device_id: deviceId, answers: na });
        setResult(res);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      setSubmitting(false);
    }
  };

  if (loading || submitting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} size="large" />
        {submitting && <Txt style={{ color: colors.muted, marginTop: spacing.md }}>Gently reviewing your answers...</Txt>}
      </View>
    );
  }

  // Result screen
  if (result) {
    const band = BANDS[result.band];
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={{ width: 24 }} />
          <Txt display style={{ fontSize: fontSize.xl }}>Your check-in</Txt>
          <Pressable testID="epds-close" onPress={() => router.replace("/(tabs)/journey")} hitSlop={12}>
            <Feather name="x" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          <Animated.View entering={FadeInDown.duration(500)}>
            <View style={[styles.scoreCircle, { borderColor: band.color }]}>
              <Txt display style={{ fontSize: fontSize["4xl"], color: band.color }}>{result.total}</Txt>
              <Txt style={{ color: colors.muted }}>out of 30</Txt>
            </View>
            <Txt display style={styles.resultHead}>{band.head}</Txt>
            <View style={[styles.bandPill, { backgroundColor: band.color + "22" }]}>
              <View style={[styles.bandDot, { backgroundColor: band.color }]} />
              <Txt weight="500" style={{ color: colors.onSurface }}>{band.label}</Txt>
            </View>
            <Txt style={styles.resultNote}>{band.note}</Txt>
          </Animated.View>

          {result.self_harm_flag && (
            <Animated.View entering={FadeIn.delay(200)}>
              <Card style={styles.safetyCard}>
                <View style={styles.safetyHead}>
                  <Feather name="heart" size={20} color={colors.onError} />
                  <Txt weight="500" style={{ color: colors.onSurface, fontSize: fontSize.lg }}>
                    You matter deeply
                  </Txt>
                </View>
                <Txt style={{ color: colors.onSurfaceSecondary, lineHeight: 22, marginTop: spacing.sm }}>
                  You mentioned thoughts of harming yourself. Please reach out right now — you deserve
                  immediate, caring support. You are not a burden.
                </Txt>
                <Button
                  testID="crisis-call-button"
                  label="Call or text 988 now"
                  variant="primary"
                  onPress={() => Linking.openURL("tel:988")}
                  style={{ marginTop: spacing.md, backgroundColor: colors.error }}
                />
              </Card>
            </Animated.View>
          )}

          <Card style={{ marginTop: spacing.lg }}>
            <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 22 }}>
              This screening is based on the Edinburgh Postnatal Depression Scale (Cox, Holden &
              Sagovsky, 1987). It is a supportive self-check, not a diagnosis. Only a qualified
              clinician can assess your health.
            </Txt>
          </Card>

          <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
            <Button
              testID="result-resources-button"
              label="See support & resources"
              onPress={() => router.replace("/(tabs)/care")}
              icon={<Feather name="life-buoy" size={18} color={colors.onBrandPrimary} />}
            />
            <Button
              testID="result-talk-button"
              label="Talk to Aura"
              variant="secondary"
              onPress={() => router.replace("/(tabs)/talk")}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  // Question screen
  const q = questions[idx];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          testID="epds-back"
          onPress={() => (idx === 0 ? router.back() : setIdx((i) => i - 1))}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Txt style={{ color: colors.muted }}>{idx + 1} of {questions.length}</Txt>
        <Pressable testID="epds-exit" onPress={() => router.back()} hitSlop={12}>
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((idx + 1) / questions.length) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Animated.View key={idx} entering={FadeInDown.duration(350)}>
          <Txt style={styles.intro}>In the past 7 days...</Txt>
          <Txt display style={styles.question}>{q.q}</Txt>
          <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
            {q.options.map((o, i) => (
              <Pressable
                key={i}
                testID={`epds-option-${i}`}
                onPress={() => select(o.score)}
                style={({ pressed }) => [
                  styles.optionCard,
                  answers[idx] === o.score && styles.optionSelected,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Txt style={{ fontSize: fontSize.lg, color: colors.onSurfaceSecondary, flex: 1 }}>
                  {o.label}
                </Txt>
                {answers[idx] === o.score && (
                  <Feather name="check-circle" size={20} color={colors.brand} />
                )}
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceTertiary,
    marginHorizontal: spacing.lg,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  intro: { color: colors.muted, marginTop: spacing.xl, fontSize: fontSize.lg },
  question: { fontSize: fontSize["2xl"], lineHeight: 34, marginTop: spacing.sm },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    minHeight: 56,
  },
  optionSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary + "40" },
  scoreCircle: {
    alignSelf: "center",
    width: 140,
    height: 140,
    borderRadius: radius.pill,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  resultHead: { fontSize: fontSize["2xl"], textAlign: "center" },
  bandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  bandDot: { width: 10, height: 10, borderRadius: radius.pill },
  resultNote: {
    fontSize: fontSize.lg,
    lineHeight: 25,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  safetyCard: {
    backgroundColor: colors.error + "18",
    borderColor: colors.error + "50",
    marginTop: spacing.lg,
  },
  safetyHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
