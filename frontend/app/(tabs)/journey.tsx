import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { formatVolume } from "@/src/lib/units";
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
  const [doctorReport, setDoctorReport] = useState<any>(null);
  const [activityReport, setActivityReport] = useState<any>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [sharingActivity, setSharingActivity] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [sharing, setSharing] = useState(false);

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

  const loadDoctorReport = useCallback(async () => {
    if (!profile) return;
    setLoadingReport(true);
    try {
      const report = await api.doctorReport(profile.device_id, 90);
      setDoctorReport(report);
    } catch {}
    setLoadingReport(false);
  }, [profile]);

  const loadActivityReport = useCallback(async () => {
    if (!profile) return;
    setLoadingActivity(true);
    try {
      const report = await api.exportFullReport(profile.device_id, 90);
      setActivityReport(report);
    } catch {}
    setLoadingActivity(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadDoctorReport();
      loadActivityReport();
    }, [load, loadDoctorReport, loadActivityReport])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadDoctorReport(), loadActivityReport()]);
    setRefreshing(false);
  };

  const heatmapCells = useMemo(() => {
    if (!doctorReport?.heatmap) return [];
    const byDate: Record<string, any> = {};
    doctorReport.heatmap.forEach((d: any) => { byDate[d.date] = d; });

    const days = doctorReport.range_days || 90;
    const cells: { date: string; mood: number | null }[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      cells.push({ date: key, mood: byDate[key]?.mood ?? null });
    }
    // pad to a full multiple of 7 so the grid stays rectangular
    while (cells.length % 7 !== 0) cells.unshift({ date: "", mood: null });
    return cells;
  }, [doctorReport]);

  const heatmapColor = (mood: number | null) => {
    if (mood === null) return colors.border;
    const idx = Math.min(4, Math.max(0, Math.round(mood) - 1));
    return MOOD_COLORS[idx];
  };

  const shareWithDoctor = async () => {
    if (!doctorReport) return;
    setSharing(true);
    const tagLines = (doctorReport.top_tags || [])
      .map((t: any) => `- ${t.tag} (logged ${t.count}x)`)
      .join("\n");
    const text = [
      `Cuddle mood summary — last ${doctorReport.range_days} days`,
      `${doctorReport.total_check_ins} check-ins logged`,
      "",
      doctorReport.summary || "Not enough data yet for a summary.",
      tagLines ? "\nMost logged concerns:\n" + tagLines : "",
    ].join("\n");
    try {
      await Share.share({ message: text });
    } catch {}
    setSharing(false);
  };

  const shareActivityReport = async () => {
    if (!activityReport) return;
    setSharingActivity(true);
    const unit = profile?.unit_system || "oz";
    const a = activityReport.daily_averages || {};
    const t = activityReport.totals || {};
    const sd = activityReport.standard_deviation || {};
    const meetupLines = (activityReport.meetups_attended || [])
      .map((m: any) => `- ${m.title} (${m.date})`)
      .join("\n");
    const text = [
      `Cuddle activity summary — last ${activityReport.range_days} days`,
      `${activityReport.days_with_data} days with logged activity`,
      "",
      `FEEDS: ${t.feed_count} total, ${formatVolume(t.feed_ml, unit)} (avg ${a.feed_count_per_day}/day, ${formatVolume(a.feed_ml_per_day, unit)}/day, std dev ${sd.feed_ml != null ? formatVolume(sd.feed_ml, unit) : "n/a"})`,
      `PUMPING: ${t.pump_count} sessions, ${formatVolume(t.pump_ml, unit)} total (avg ${formatVolume(a.pump_ml_per_day, unit)}/day, std dev ${sd.pump_ml != null ? formatVolume(sd.pump_ml, unit) : "n/a"})`,
      `DIAPERS: ${t.pee_count} pee, ${t.poop_count} poop (avg ${a.pee_per_day}/day pee, ${a.poop_per_day}/day poop)`,
      `BABY'S SLEEP: ${Math.round(t.sleep_minutes / 60)} hours total (avg ${a.sleep_hours_per_day} hrs/day, std dev ${sd.baby_sleep_minutes ?? "n/a"} min)`,
      `MOM'S REST: ${Math.round(t.mom_rest_minutes / 60)} hours total (avg ${a.mom_rest_hours_per_day} hrs/day)`,
      `SOCIAL: ${t.meetups_attended} meetup${t.meetups_attended === 1 ? "" : "s"} attended${meetupLines ? "\n" + meetupLines : ""}`,
      "",
      activityReport.disclaimer,
    ].join("\n");
    try {
      await Share.share({ message: text });
    } catch {}
    setSharingActivity(false);
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

        {/* Anxiety & mood heatmap for doctor visits */}
        <Txt display style={styles.sectionTitle}>Share with your doctor</Txt>
        <Card>
          <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 22, marginBottom: spacing.md }}>
            A visual pattern of your last {doctorReport?.range_days || 90} days, built only from what
            you've logged yourself — something concrete to bring to an appointment.
          </Txt>

          {loadingReport && !doctorReport ? (
            <Txt style={{ color: colors.muted }}>Building your report...</Txt>
          ) : !doctorReport || doctorReport.total_check_ins === 0 ? (
            <Txt style={{ color: colors.muted }}>
              Log a few mood check-ins and a pattern will start to appear here.
            </Txt>
          ) : (
            <>
              <View style={styles.heatmapGrid}>
                {heatmapCells.map((cell, i) => (
                  <View
                    key={i}
                    style={[
                      styles.heatmapCell,
                      { backgroundColor: cell.date ? heatmapColor(cell.mood) : "transparent" },
                    ]}
                  />
                ))}
              </View>

              {doctorReport.top_tags?.length > 0 && (
                <View style={styles.tagRow}>
                  {doctorReport.top_tags.map((t: any, i: number) => (
                    <View key={i} style={styles.tagChip}>
                      <Txt style={{ fontSize: fontSize.sm, color: colors.onSurfaceSecondary }}>
                        {t.tag} · {t.count}x
                      </Txt>
                    </View>
                  ))}
                </View>
              )}

              {doctorReport.summary && (
                <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 22, marginTop: spacing.md }}>
                  {doctorReport.summary}
                </Txt>
              )}

              <Button
                testID="share-doctor-report"
                label="Share with your doctor"
                onPress={shareWithDoctor}
                loading={sharing}
                variant="secondary"
                icon={<Feather name="share" size={18} color={colors.onSurface} />}
                style={{ marginTop: spacing.md }}
              />
            </>
          )}
        </Card>

        {/* Feeds, pumping, diapers, sleep — the full activity export */}
        <Txt display style={styles.sectionTitle}>Everything else, one tap</Txt>
        <Card>
          <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 22, marginBottom: spacing.md }}>
            Feeds, pumping output, diapers, and sleep from the last {activityReport?.range_days || 30} days — exactly
            what's already in Track, ready to bring to an appointment.
          </Txt>

          {loadingActivity && !activityReport ? (
            <Txt style={{ color: colors.muted }}>Building your report...</Txt>
          ) : !activityReport || activityReport.days_with_data === 0 ? (
            <Txt style={{ color: colors.muted }}>
              Log a few feeds, diapers, or sleep sessions in Track and this fills in automatically.
            </Txt>
          ) : (
            <>
              <View style={styles.statGrid}>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{formatVolume(activityReport.totals.feed_ml, profile?.unit_system || "oz")}</Txt>
                  <Txt style={styles.statLabel}>Feeds ({activityReport.totals.feed_count})</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{formatVolume(activityReport.totals.pump_ml, profile?.unit_system || "oz")}</Txt>
                  <Txt style={styles.statLabel}>Pumped ({activityReport.totals.pump_count})</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{activityReport.totals.pee_count}</Txt>
                  <Txt style={styles.statLabel}>Pee diapers</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{activityReport.totals.poop_count}</Txt>
                  <Txt style={styles.statLabel}>Poop diapers</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{Math.round(activityReport.totals.sleep_minutes / 60)}h</Txt>
                  <Txt style={styles.statLabel}>Baby's sleep</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{Math.round(activityReport.totals.mom_rest_minutes / 60)}h</Txt>
                  <Txt style={styles.statLabel}>Mom's rest</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{activityReport.totals.meetups_attended}</Txt>
                  <Txt style={styles.statLabel}>Meetups joined</Txt>
                </View>
                <View style={styles.statBox}>
                  <Txt display style={styles.statNumber}>{activityReport.days_with_data}</Txt>
                  <Txt style={styles.statLabel}>Days logged</Txt>
                </View>
              </View>

              {activityReport.weekly?.length > 1 && (
                <View style={{ marginTop: spacing.lg }}>
                  <Txt weight="500" style={{ fontSize: fontSize.sm, marginBottom: spacing.sm }}>
                    Weekly feed volume trend
                  </Txt>
                  <View style={styles.trendChart}>
                    {activityReport.weekly.map((w: any, i: number) => {
                      const maxMl = Math.max(...activityReport.weekly.map((x: any) => x.feed_ml || 0), 1);
                      const heightPct = w.feed_ml ? Math.max(6, (w.feed_ml / maxMl) * 100) : 0;
                      return (
                        <View key={i} style={styles.trendBarWrap}>
                          <View style={styles.trendBarTrack}>
                            <View style={[styles.trendBar, { height: `${heightPct}%` }]} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.xs }}>
                    {activityReport.weekly.length} weeks, oldest to most recent
                  </Txt>
                </View>
              )}

              {(activityReport.standard_deviation?.feed_ml != null || activityReport.standard_deviation?.baby_sleep_minutes != null) && (
                <View style={styles.sdBox}>
                  <Txt weight="500" style={{ fontSize: fontSize.sm, marginBottom: 4 }}>Consistency (standard deviation)</Txt>
                  <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.xs, lineHeight: 18 }}>
                    {activityReport.standard_deviation.feed_ml != null && `Feed size varies by about ±${formatVolume(activityReport.standard_deviation.feed_ml, profile?.unit_system || "oz")} per feed. `}
                    {activityReport.standard_deviation.baby_sleep_minutes != null && `Baby's sleep sessions vary by about ±${activityReport.standard_deviation.baby_sleep_minutes} min.`}
                  </Txt>
                </View>
              )}

              <Button
                testID="share-activity-report"
                label="Share activity report"
                onPress={shareActivityReport}
                loading={sharingActivity}
                variant="secondary"
                icon={<Feather name="share" size={18} color={colors.onSurface} />}
                style={{ marginTop: spacing.md }}
              />
            </>
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
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statBox: {
    width: "31%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 20,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    marginTop: 2,
  },
  trendChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 70,
    gap: 3,
  },
  trendBarWrap: {
    flex: 1,
    alignItems: "center",
  },
  trendBarTrack: {
    width: "100%",
    height: 60,
    justifyContent: "flex-end",
  },
  trendBar: {
    width: "100%",
    backgroundColor: colors.brand,
    borderRadius: 3,
    minHeight: 2,
  },
  sdBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
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
  heatmapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  heatmapCell: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  tagChip: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
});
