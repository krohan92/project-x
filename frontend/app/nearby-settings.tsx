import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT, LANGUAGES, Lang } from "@/src/lib/i18n";

const PREFS = [
  { key: "similar", label: "settings.pref.similar" },
  { key: "none", label: "settings.pref.none" },
  { key: "diverse", label: "settings.pref.diverse" },
];

export default function NearbySettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId, refresh } = useProfile();
  const { t, lang, setLang } = useT();

  const [tags, setTags] = useState<string[]>([]);
  const [ethnicity, setEthnicity] = useState<string | null>(profile?.ethnicity ?? null);
  const [pref, setPref] = useState<string>(profile?.matching_preference ?? "none");
  const [displayTags, setDisplayTags] = useState<boolean>(!!profile?.display_tags);
  const [allowCultural, setAllowCultural] = useState<boolean>(profile?.allow_cultural_match ?? true);

  useEffect(() => {
    api.nearbyMeta().then((m) => setTags(m.ethnicity_tags || [])).catch(() => {});
  }, []);

  const persist = async (patch: any) => {
    if (!deviceId) return;
    await api.updateNearbySettings({ device_id: deviceId, ...patch });
    await refresh();
  };

  const chooseLang = (l: Lang) => {
    Haptics.selectionAsync();
    setLang(l);
    persist({ language: l });
  };

  const choosePref = (p: string) => {
    Haptics.selectionAsync();
    setPref(p);
    persist({ matching_preference: p });
  };

  const chooseEthnicity = (e: string) => {
    Haptics.selectionAsync();
    const next = ethnicity === e ? null : e;
    setEthnicity(next);
    persist({ ethnicity: next });
  };

  const removeData = async () => {
    if (!deviceId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await api.deleteEthnicity(deviceId);
    setEthnicity(null);
    setPref("none");
    setDisplayTags(false);
    await refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={{ fontSize: fontSize.xl }}>{t("settings.title")}</Txt>
        <Pressable testID="settings-close" onPress={() => router.back()} hitSlop={12}>
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        {/* Language */}
        <Txt display style={styles.section}>{t("settings.language")}</Txt>
        <Card style={{ padding: spacing.sm }}>
          {LANGUAGES.map((l, i) => (
            <Pressable
              key={l.code}
              testID={`lang-${l.code}`}
              onPress={() => chooseLang(l.code)}
              style={[styles.row, i < LANGUAGES.length - 1 && styles.rowBorder]}
            >
              <Txt style={{ fontSize: fontSize.lg }}>{l.label}</Txt>
              {lang === l.code && <Feather name="check" size={20} color={colors.brand} />}
            </Pressable>
          ))}
        </Card>

        {/* Matching preference */}
        <Txt display style={styles.section}>{t("settings.matching")}</Txt>
        <Card style={{ padding: spacing.sm }}>
          {PREFS.map((p, i) => (
            <Pressable
              key={p.key}
              testID={`pref-${p.key}`}
              onPress={() => choosePref(p.key)}
              style={[styles.row, i < PREFS.length - 1 && styles.rowBorder]}
            >
              <Txt style={{ fontSize: fontSize.lg, flex: 1 }}>{t(p.label)}</Txt>
              {pref === p.key && <Feather name="check" size={20} color={colors.brand} />}
            </Pressable>
          ))}
        </Card>

        {/* Cultural background (optional) */}
        <View style={styles.sectionRow}>
          <Txt display style={styles.section}>{t("settings.culturalBg")}</Txt>
          <Txt style={styles.optionalPill}>{t("common.optional")}</Txt>
        </View>
        <Txt style={styles.hint}>{t("settings.culturalBgHint")}</Txt>
        <View style={styles.chipWrap}>
          {tags.map((e) => (
            <Pressable
              key={e}
              testID={`ethnicity-${e}`}
              onPress={() => chooseEthnicity(e)}
              style={[styles.chip, ethnicity === e && styles.chipActive]}
            >
              <Txt style={{ color: ethnicity === e ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                {e}
              </Txt>
            </Pressable>
          ))}
        </View>

        {/* Toggles */}
        <Card style={{ marginTop: spacing.lg }}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>{t("settings.displayTags")}</Txt>
              <Txt style={styles.toggleHint}>{t("settings.displayTagsHint")}</Txt>
            </View>
            <Switch
              testID="display-tags-toggle"
              value={displayTags}
              onValueChange={(v) => { setDisplayTags(v); persist({ display_tags: v }); }}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brandSecondary }}
              thumbColor={displayTags ? colors.brandPrimary : "#fff"}
            />
          </View>
          <View style={[styles.toggleRow, { marginTop: spacing.md }]}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>{t("settings.allowCultural")}</Txt>
            </View>
            <Switch
              testID="allow-cultural-toggle"
              value={allowCultural}
              onValueChange={(v) => { setAllowCultural(v); persist({ allow_cultural_match: v }); }}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brandSecondary }}
              thumbColor={allowCultural ? colors.brandPrimary : "#fff"}
            />
          </View>
        </Card>

        {/* Delete cultural data */}
        <Pressable testID="remove-cultural-data" onPress={removeData} style={styles.deleteBtn}>
          <Feather name="trash-2" size={18} color={colors.error} />
          <Txt weight="500" style={{ color: colors.error }}>{t("settings.removeData")}</Txt>
        </Pressable>
        <Txt style={styles.hint}>{t("settings.removeDataHint")}</Txt>

        <View style={styles.privacyBox}>
          <Feather name="lock" size={16} color={colors.success} />
          <Txt style={{ color: colors.onSurfaceTertiary, flex: 1, fontSize: fontSize.sm, lineHeight: 19 }}>
            {t("settings.privacy")}
          </Txt>
        </View>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  section: { fontSize: fontSize.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  optionalPill: {
    color: colors.success,
    fontSize: fontSize.sm,
    backgroundColor: colors.success + "22",
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  hint: { color: colors.muted, lineHeight: 20, marginBottom: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
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
  toggleRow: { flexDirection: "row", alignItems: "center" },
  toggleHint: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2, lineHeight: 18 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.error + "60",
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  privacyBox: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
  },
});
