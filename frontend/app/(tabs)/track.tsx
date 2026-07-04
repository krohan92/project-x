import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT } from "@/src/lib/i18n";

const KINDS = [
  { key: "feed", labelKey: "track.logFeed", icon: "coffee", color: "#D68C7A" },
  { key: "sleep", labelKey: "track.logSleep", icon: "moon", color: "#98A99B" },
  { key: "diaper", labelKey: "track.logDiaper", icon: "droplet", color: "#DEB068" },
] as const;

const KIND_META: Record<string, { icon: any; color: string; label: string }> = {
  feed: { icon: "coffee", color: "#D68C7A", label: "Feed" },
  sleep: { icon: "moon", color: "#98A99B", label: "Sleep" },
  diaper: { icon: "droplet", color: "#DEB068", label: "Diaper" },
};

function timeStr(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function dayStr(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Track() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();
  const { t } = useT();

  const [logs, setLogs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [justLogged, setJustLogged] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const l = await api.babyLogs(deviceId);
      setLogs(l);
    } catch {}
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const log = async (kind: string) => {
    if (!deviceId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setJustLogged(kind);
    try {
      await api.babyLog({ device_id: deviceId, kind });
      await load();
    } catch {}
    setTimeout(() => setJustLogged(null), 1200);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={styles.title}>{t("track.title")}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {/* Quick log */}
        <Txt display style={styles.section}>{t("track.section.baby")}</Txt>
        <View style={styles.quickRow}>
          {KINDS.map((k) => (
            <Pressable
              key={k.key}
              testID={`log-${k.key}`}
              onPress={() => log(k.key)}
              style={styles.quickCard}
            >
              <View style={[styles.quickIcon, { backgroundColor: k.color + "30" }]}>
                <Feather name={k.icon as any} size={26} color={k.color} />
              </View>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>{t(k.labelKey)}</Txt>
              {justLogged === k.key && (
                <Txt style={{ color: colors.success, fontSize: fontSize.sm }}>✓ {t("track.logged")}</Txt>
              )}
            </Pressable>
          ))}
        </View>

        {/* Recent */}
        <Txt display style={styles.section}>{t("track.recent")}</Txt>
        {logs.length === 0 ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="clock" size={30} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm, textAlign: "center" }}>
              {t("track.noLogs")}
            </Txt>
          </Card>
        ) : (
          <Card style={{ padding: spacing.sm }}>
            {logs.map((l, i) => {
              const m = KIND_META[l.kind] || KIND_META.feed;
              return (
                <View
                  key={i}
                  style={[styles.logRow, i < logs.length - 1 && styles.logBorder]}
                >
                  <View style={[styles.logIcon, { backgroundColor: m.color + "25" }]}>
                    <Feather name={m.icon} size={18} color={m.color} />
                  </View>
                  <Txt weight="500" style={{ flex: 1 }}>{m.label}</Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                    {dayStr(l.at)} · {timeStr(l.at)}
                  </Txt>
                </View>
              );
            })}
          </Card>
        )}

        {/* For you */}
        <Txt display style={styles.section}>{t("track.section.me")}</Txt>
        <Pressable testID="track-mood" onPress={() => router.push("/checkin")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: colors.brandTertiary + "60" }]}>
              <Feather name="smile" size={20} color={colors.brand} />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>{t("track.logMood")}</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="track-trends" onPress={() => router.push("/journey")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: colors.brandSecondary + "40" }]}>
              <Feather name="trending-up" size={20} color={colors.onBrandSecondary} />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>{t("track.moodTrends")}</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="track-epds" onPress={() => router.push("/epds")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: colors.info + "30" }]}>
              <Feather name="clipboard" size={20} color={colors.info} />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>{t("track.wellbeing")}</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
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
  section: { fontSize: fontSize.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  quickRow: { flexDirection: "row", gap: spacing.md },
  quickCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  quickIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  logBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  logIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  linkCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  linkIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
