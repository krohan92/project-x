import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const MOOD_EMOJI = ["😔", "😟", "😐", "🙂", "😊"];
const MOOD_COLORS = [colors.error, colors.warning, colors.info, colors.brandSecondary, colors.success];

const BANDS: Record<string, { label: string; color: string; note: string }> = {
  low: {
    label: "Low likelihood",
    color: colors.success,
    note: "Your responses suggest you're coping reasonably well right now. Keep checking in with yourself.",
  },
  possible: {
    label: "Worth a gentle look",
    color: colors.warning,
    note: "Some responses suggest you may be struggling a little. Consider talking to someone you trust or your provider.",
  },
  likely: {
    label: "Please reach out",
    color: colors.error,
    note: "Your responses suggest you may be going through a hard time. You deserve support — please talk to your healthcare provider.",
  },
};

export default function Journey() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useProfile();

  const [moods, setMoods] = useState<any[]>([]);
  const [epds, setEpds] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [m, e] = await Promise.all([
        api.getMoods(profile.device_id),
        api.epdsHistory(profile.device_id),
      ]);
      setMoods(m);
      setEpds(e);
    } catch {}
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const recent = moods.slice(-14);
  const avg =
    moods.length > 0
      ? (moods.reduce((s, m) => s + m.mood, 0) / moods.length).toFixed(1)
      : "–";
  const latestEpds = epds[0];

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={styles.title}>Your Journey</Txt>
        <Txt style={{ color: colors.muted }}>Gentle patterns over time — never a judgment</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {/* Summary */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Txt display style={styles.statValue}>{moods.length}</Txt>
            <Txt style={styles.statLabel}>check-ins</Txt>
          </Card>
          <Card style={styles.statCard}>
            <Txt display style={styles.statValue}>{avg}</Txt>
            <Txt style={styles.statLabel}>avg mood</Txt>
          </Card>
          <Card style={styles.statCard}>
            <Txt display style={styles.statValue}>{epds.length}</Txt>
            <Txt style={styles.statLabel}>wellbeing checks</Txt>
          </Card>
        </View>

        {/* Mood chart */}
        <Txt display style={styles.sectionTitle}>Mood, last 14 check-ins</Txt>
        <Card>
          {recent.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Feather name="feather" size={32} color={colors.borderStrong} />
              <Txt style={{ color: colors.muted, marginTop: spacing.sm, textAlign: "center" }}>
                Log your first mood to begin your journey.
              </Txt>
            </View>
          ) : (
            <View style={styles.chart}>
              {recent.map((m, i) => (
                <View key={i} style={styles.barWrap}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: 20 + (m.mood / 5) * 100,
                        backgroundColor: MOOD_COLORS[m.mood - 1],
                      },
                    ]}
                  />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Actions */}
        <View style={styles.actionRow}>
          <Button
            testID="log-mood-button"
            label="Log mood"
            variant="secondary"
            onPress={() => router.push("/checkin")}
            style={{ flex: 1 }}
            icon={<Feather name="plus" size={18} color={colors.onSurface} />}
          />
          <Button
            testID="start-epds-button"
            label="Wellbeing check"
            onPress={() => router.push("/epds")}
            style={{ flex: 1 }}
          />
        </View>

        {/* EPDS latest */}
        <Txt display style={styles.sectionTitle}>Wellbeing check-in (EPDS)</Txt>
        <Card>
          <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 22, marginBottom: spacing.md }}>
            The Edinburgh Postnatal Depression Scale is a validated 10-question self-assessment
            (Cox et al., 1987) used worldwide. It is informational, not a diagnosis.
          </Txt>
          {latestEpds ? (
            <View>
              <View style={styles.epdsResultRow}>
                <View style={[styles.epdsDot, { backgroundColor: BANDS[latestEpds.band].color }]} />
                <View style={{ flex: 1 }}>
                  <Txt weight="500" style={{ fontSize: fontSize.lg }}>
                    {BANDS[latestEpds.band].label}
                  </Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                    Score {latestEpds.total}/30 · {new Date(latestEpds.created_at).toLocaleDateString()}
                  </Txt>
                </View>
              </View>
              <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 22, marginTop: spacing.sm }}>
                {BANDS[latestEpds.band].note}
              </Txt>
              {(latestEpds.band !== "low" || latestEpds.self_harm_flag) && (
                <Pressable
                  testID="epds-resources-link"
                  onPress={() => router.push("/care")}
                  style={styles.resourceLink}
                >
                  <Feather name="life-buoy" size={16} color={colors.brand} />
                  <Txt style={{ color: colors.brand }} weight="500">View support & resources</Txt>
                </Pressable>
              )}
            </View>
          ) : (
            <Txt style={{ color: colors.muted }}>
              {"You haven't taken a wellbeing check yet. It takes about 2 minutes."}
            </Txt>
          )}
        </Card>

        {/* Recent notes */}
        {moods.filter((m) => m.note).length > 0 && (
          <>
            <Txt display style={styles.sectionTitle}>Journal notes</Txt>
            {[...moods]
              .reverse()
              .filter((m) => m.note)
              .slice(0, 10)
              .map((m, i) => (
                <Card key={i} style={styles.noteCard}>
                  <Txt style={{ fontSize: 26 }}>{MOOD_EMOJI[m.mood - 1]}</Txt>
                  <View style={{ flex: 1 }}>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                      {new Date(m.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </Txt>
                    <Txt style={{ color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 21 }}>
                      {m.note}
                    </Txt>
                  </View>
                </Card>
              ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize["2xl"] },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, alignItems: "center", paddingVertical: spacing.lg },
  statValue: { fontSize: fontSize["2xl"], color: colors.brand },
  statLabel: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  sectionTitle: { fontSize: fontSize.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 130,
    gap: 4,
  },
  barWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "80%", borderRadius: radius.sm, minHeight: 8 },
  chartEmpty: { alignItems: "center", paddingVertical: spacing.xl },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  epdsResultRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  epdsDot: { width: 14, height: 14, borderRadius: radius.pill },
  resourceLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  noteCard: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md, alignItems: "center" },
});
