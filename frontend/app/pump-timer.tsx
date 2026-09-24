import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api, getDeviceId } from "@/src/lib/api";

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PumpTimer() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const [leftRunning, setLeftRunning] = useState(false);
  const [rightRunning, setRightRunning] = useState(false);
  const [leftSeconds, setLeftSeconds] = useState(0);
  const [rightSeconds, setRightSeconds] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [justFinished, setJustFinished] = useState<{ left: number; right: number } | null>(null);
  const [leftMlInput, setLeftMlInput] = useState("");
  const [rightMlInput, setRightMlInput] = useState("");
  const [insight, setInsight] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [symptomPromptDismissed, setSymptomPromptDismissed] = useState(false);
  const [symptomGuidance, setSymptomGuidance] = useState<string | null>(null);
  const [checkingSymptom, setCheckingSymptom] = useState(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadActive = useCallback(async (id: string) => {
    try {
      const active = await api.pumpSessionActive(id);
      setLeftRunning(active.left_running);
      setRightRunning(active.right_running);
      setLeftSeconds(active.left_seconds);
      setRightSeconds(active.right_seconds);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const id = await getDeviceId();
        setDeviceId(id);
        await loadActive(id);
        try {
          const ins = await api.pumpSessionInsight(id);
          setInsight(ins);
        } catch {}
        try {
          const t = await api.pumpSessionTrend(id, 14);
          setTrend(t.trend || []);
        } catch {}
      })();
    }, [loadActive])
  );

  // local ticking for a smooth live display; re-syncs with the server on toggle/finish
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setLeftSeconds((s) => (leftRunning ? s + 1 : s));
      setRightSeconds((s) => (rightRunning ? s + 1 : s));
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [leftRunning, rightRunning]);

  const toggleSide = async (side: "left" | "right") => {
    if (!deviceId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setJustFinished(null);
    try {
      const result = await api.pumpSessionToggle(deviceId, side);
      setLeftRunning(result.left_running);
      setRightRunning(result.right_running);
      setLeftSeconds(result.left_seconds);
      setRightSeconds(result.right_seconds);
    } catch {}
  };

  const finish = async () => {
    if (!deviceId) return;
    if (leftSeconds === 0 && rightSeconds === 0) return;
    setFinishing(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const leftMl = leftMlInput ? parseFloat(leftMlInput) * 29.5735 : undefined;
    const rightMl = rightMlInput ? parseFloat(rightMlInput) * 29.5735 : undefined;
    try {
      const result = await api.pumpSessionFinish(deviceId, leftMl, rightMl);
      setJustFinished({ left: result.left_minutes, right: result.right_minutes });
      setLeftRunning(false);
      setRightRunning(false);
      setLeftSeconds(0);
      setRightSeconds(0);
      setLeftMlInput("");
      setRightMlInput("");
      try {
        setInsight(await api.pumpSessionInsight(deviceId));
      } catch {}
    } catch {}
    setFinishing(false);
  };

  const hasAnyTime = leftSeconds > 0 || rightSeconds > 0;

  const answerSymptomCheck = async (hasSymptoms: boolean) => {
    if (!deviceId || !insight?.lower_side) return;
    setCheckingSymptom(true);
    try {
      const result = await api.pumpSymptomCheck(deviceId, insight.lower_side, hasSymptoms, hasSymptoms ? ["pain", "redness"] : []);
      setSymptomGuidance(result.guidance);
    } catch {}
    setSymptomPromptDismissed(true);
    setCheckingSymptom(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="pump-timer-back" onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Txt display style={{ fontSize: fontSize.lg }}>Pump Timer</Txt>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        {justFinished && (
          <Card style={{ marginBottom: spacing.md, backgroundColor: colors.brandTertiary + "22" }}>
            <Txt weight="500">Logged: {justFinished.left} min left, {justFinished.right} min right.</Txt>
          </Card>
        )}

        {insight?.has_insight && !insight.balanced && (
          <Card style={{ marginBottom: spacing.md, backgroundColor: "#F3E4DC" }}>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
              <Feather name="trending-up" size={18} color="#B5627E" style={{ marginTop: 2 }} />
              <Txt style={{ flex: 1, lineHeight: 21 }}>{insight.message}</Txt>
            </View>

            {!symptomPromptDismissed && !symptomGuidance && (
              <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "#E5CFC3" }}>
                <Txt style={{ fontSize: fontSize.sm, marginBottom: spacing.sm }}>
                  Quick check — any pain, redness, or fever on your {insight.lower_side} side?
                </Txt>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button
                    testID="symptom-check-no"
                    label="No, feels fine"
                    variant="secondary"
                    onPress={() => answerSymptomCheck(false)}
                    loading={checkingSymptom}
                    style={{ flex: 1 }}
                  />
                  <Button
                    testID="symptom-check-yes"
                    label="Yes, something's off"
                    onPress={() => answerSymptomCheck(true)}
                    loading={checkingSymptom}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            )}

            {symptomGuidance && (
              <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "#E5CFC3" }}>
                <Txt style={{ fontSize: fontSize.sm, lineHeight: 20, color: "#8A4A3A" }}>{symptomGuidance}</Txt>
              </View>
            )}
          </Card>
        )}

        <Txt style={{ color: colors.onSurfaceTertiary, marginBottom: spacing.lg, lineHeight: 22 }}>
          Tap a side to start timing it. Tap it again to pause. Both sides run independently, so you can pump one at a time or both together.
        </Txt>

        <View style={styles.timersRow}>
          <Pressable
            testID="pump-timer-left"
            onPress={() => toggleSide("left")}
            style={[styles.timerCard, leftRunning && styles.timerCardActive]}
          >
            <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginBottom: spacing.xs }}>LEFT</Txt>
            <Txt display style={styles.timerNumber}>{formatTime(leftSeconds)}</Txt>
            <View style={[styles.timerBtn, leftRunning && styles.timerBtnActive]}>
              <Feather name={leftRunning ? "pause" : "play"} size={20} color={leftRunning ? "#fff" : colors.brand} />
            </View>
          </Pressable>

          <Pressable
            testID="pump-timer-right"
            onPress={() => toggleSide("right")}
            style={[styles.timerCard, rightRunning && styles.timerCardActive]}
          >
            <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginBottom: spacing.xs }}>RIGHT</Txt>
            <Txt display style={styles.timerNumber}>{formatTime(rightSeconds)}</Txt>
            <View style={[styles.timerBtn, rightRunning && styles.timerBtnActive]}>
              <Feather name={rightRunning ? "pause" : "play"} size={20} color={rightRunning ? "#fff" : colors.brand} />
            </View>
          </Pressable>
        </View>

        {hasAnyTime && (
          <View style={styles.mlRow}>
            <View style={styles.mlInputWrap}>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginBottom: 4 }}>Left, oz (optional)</Txt>
              <TextInput
                testID="pump-timer-left-ml"
                value={leftMlInput}
                onChangeText={setLeftMlInput}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor={colors.muted}
                style={styles.mlInput}
              />
            </View>
            <View style={styles.mlInputWrap}>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginBottom: 4 }}>Right, oz (optional)</Txt>
              <TextInput
                testID="pump-timer-right-ml"
                value={rightMlInput}
                onChangeText={setRightMlInput}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor={colors.muted}
                style={styles.mlInput}
              />
            </View>
          </View>
        )}

        <Button
          testID="pump-timer-finish"
          label="Done — log this session"
          onPress={finish}
          loading={finishing}
          disabled={!hasAnyTime}
          style={{ marginTop: spacing.xl }}
        />

        <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: spacing.lg, textAlign: "center" }}>
          In a hurry? Just tell Cuddle in Talk — "I pumped 12 minutes on the left and 10 on the right, 3oz and 2oz" logs it the same way.
        </Txt>

        {trend.some((d) => d.total_ml !== null) && (
          <View style={{ marginTop: spacing.xl }}>
            <Txt display style={{ fontSize: fontSize.md, marginBottom: spacing.md }}>Daily output, last 2 weeks</Txt>
            <View style={styles.trendChart}>
              {trend.map((d, i) => {
                const maxMl = Math.max(...trend.map((t) => t.total_ml || 0), 1);
                const heightPct = d.total_ml ? Math.max(6, (d.total_ml / maxMl) * 100) : 0;
                return (
                  <View key={i} style={styles.trendBarWrap}>
                    <View style={styles.trendBarTrack}>
                      <View style={[styles.trendBar, { height: `${heightPct}%` }]} />
                    </View>
                    {d.total_ml !== null && (
                      <Txt style={{ fontSize: 9, color: colors.muted, marginTop: 2 }}>{Math.round(d.total_ml)}</Txt>
                    )}
                  </View>
                );
              })}
            </View>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.sm }}>
              Total ml per day, from sessions where you logged ounces.
            </Txt>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  timersRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  timerCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
  },
  timerCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary + "18",
  },
  timerNumber: {
    fontSize: 38,
    marginBottom: spacing.md,
  },
  timerBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  timerBtnActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  mlRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  mlInputWrap: {
    flex: 1,
  },
  mlInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  trendChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 120,
    gap: 4,
  },
  trendBarWrap: {
    flex: 1,
    alignItems: "center",
  },
  trendBarTrack: {
    width: "100%",
    height: 100,
    justifyContent: "flex-end",
  },
  trendBar: {
    width: "100%",
    backgroundColor: colors.brand,
    borderRadius: 4,
    minHeight: 3,
  },
});
