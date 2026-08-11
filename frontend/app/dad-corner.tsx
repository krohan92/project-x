import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

type Q = { q: string; options: { label: string; score: number }[] };

export default function DadsCorner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [questions, setQuestions] = useState<Q[]>([]);
  const [tips, setTips] = useState<any[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([null, null]);
  const [result, setResult] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.dadCheckinQuestions().then((q) => { setQuestions(q); setAnswers(q.map(() => null)); }).catch(() => {});
    api.dadTips().then(setTips).catch(() => {});
  }, []);

  const setAnswer = (i: number, score: number) => {
    Haptics.selectionAsync();
    setAnswers((a) => a.map((v, idx) => (idx === i ? score : v)));
  };

  const canSubmit = answers.every((a) => a != null);

  const submit = async () => {
    if (!deviceId || !canSubmit) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await api.submitDadCheckin({ device_id: deviceId, answers: answers as number[] });
      setResult(res);
    } catch {}
    setSubmitting(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Dad's Corner</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>For dads and partners too</Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {!result ? (
          <>
            <Txt style={{ color: colors.onSurface, lineHeight: 22 }}>
              Postpartum depression isn't just a "mom thing" — partners go through real hormonal, sleep, and
              identity shifts too. This is a quick, private check-in for you, not her.
            </Txt>
            {questions.map((q, i) => (
              <View key={i}>
                <Txt weight="500" style={styles.q}>{q.q}</Txt>
                <View style={{ gap: spacing.sm }}>
                  {q.options.map((o) => (
                    <Pressable
                      key={o.score}
                      onPress={() => setAnswer(i, o.score)}
                      style={[styles.option, answers[i] === o.score && styles.optionActive]}
                    >
                      <Txt style={{ color: answers[i] === o.score ? colors.onBrandPrimary : colors.onSurface }}>
                        {o.label}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <Button label="See how you're doing" onPress={submit} loading={submitting} disabled={!canSubmit} />
          </>
        ) : (
          <Animated.View entering={FadeIn}>
            <Card style={[styles.resultCard, { borderColor: result.band === "low" ? colors.success : colors.warning }]}>
              <Txt display style={{ fontSize: fontSize.xl }}>
                {result.band === "low" ? "You're holding up" : "Worth paying attention to"}
              </Txt>
              <Txt style={{ color: colors.onSurface, marginTop: spacing.sm, lineHeight: 22 }}>
                {result.band === "low"
                  ? "Your answers suggest you're managing okay right now. Keep checking in with yourself — this changes week to week."
                  : "Your answers suggest things have felt harder than usual lately. That's real, common, and worth talking about — with a friend, your partner, or a professional."}
              </Txt>
              {result.band !== "low" && (
                <Pressable onPress={() => Linking.openURL("tel:18009444773")} style={styles.callBtn}>
                  <Feather name="phone" size={16} color={colors.onBrandPrimary} />
                  <Txt style={{ color: colors.onBrandPrimary }} weight="500">Call Postpartum Support International</Txt>
                </Pressable>
              )}
            </Card>
          </Animated.View>
        )}

        <Txt display style={{ fontSize: fontSize.lg, marginTop: spacing.md }}>Good to know</Txt>
        {tips.map((t, i) => (
          <Card key={i} style={styles.tipCard}>
            <View style={styles.tipIcon}>
              <Feather name={t.icon} size={18} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ marginBottom: 4 }}>{t.title}</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, lineHeight: 20 }}>{t.body}</Txt>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  q: { fontSize: fontSize.lg, marginBottom: spacing.sm },
  option: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  optionActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  resultCard: { gap: spacing.sm, borderWidth: 1 },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
  tipCard: { flexDirection: "row", gap: spacing.md },
  tipIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "60",
    alignItems: "center",
    justifyContent: "center",
  },
});
