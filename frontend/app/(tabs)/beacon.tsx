import React, { useCallback, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { PresenceMap } from "@/src/components/PresenceMap";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT } from "@/src/lib/i18n";

const PREF_LABEL: Record<string, string> = {
  similar: "settings.pref.similar",
  none: "settings.pref.none",
  diverse: "settings.pref.diverse",
};

export default function Beacon() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId } = useProfile();
  const { t } = useT();

  const [awake, setAwake] = useState(false);
  const [anchor, setAnchor] = useState({ lat: 40.7128, lng: -74.006 });
  const [pins, setPins] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [matching, setMatching] = useState(false);
  const [permBlocked, setPermBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<any>(null);

  const loadActive = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await api.presenceActive(deviceId);
      setPins(res.pins || []);
      setCount(res.count || 0);
      if (res.anchor) setAnchor(res.anchor);
    } catch {}
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      loadActive();
      pollRef.current = setInterval(loadActive, 6000);
      return () => clearInterval(pollRef.current);
    }, [loadActive])
  );

  const getCoords = async (): Promise<{ lat: number; lng: number } | null> => {
    // Contextual permission handling per platform contract.
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      if (!perm.canAskAgain) {
        setPermBlocked(true);
        return null;
      }
      perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        if (!perm.canAskAgain) setPermBlocked(true);
        return null;
      }
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  };

  const toggleBeacon = async (next: boolean) => {
    if (!deviceId) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      let coords: { lat: number; lng: number } | null = null;
      if (next) coords = await getCoords();
      await api.presenceToggle({
        device_id: deviceId,
        awake: next,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
      setAwake(next);
      await loadActive();
    } catch {}
    setBusy(false);
  };

  const findPeer = async () => {
    if (!deviceId) return;
    setMatching(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await api.matchRequest(deviceId);
      router.push(`/peer/${res.room_id}?handle=${encodeURIComponent(res.peer_handle)}&outcome=${res.outcome}&tag=${encodeURIComponent(res.peer_tag || "")}`);
    } catch {}
    setMatching(false);
  };

  const pref = profile?.matching_preference || "none";

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Txt display style={styles.title}>{t("beacon.title")}</Txt>
          <Txt style={{ color: colors.muted }}>{t("beacon.subtitle")}</Txt>
        </View>
        <Pressable testID="beacon-settings-button" onPress={() => router.push("/beacon-settings")} hitSlop={10}>
          <Feather name="settings" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
      >
        {/* Light beacon */}
        <Card style={[styles.beaconCard, awake && styles.beaconCardOn]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={[styles.beaconGlow, awake && styles.beaconGlowOn]}>
              <Feather name="radio" size={24} color={awake ? colors.onBrandPrimary : colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt display style={{ fontSize: fontSize.xl }}>
                {awake ? t("beacon.on") : t("beacon.light")}
              </Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 20 }}>
                {awake ? t("beacon.onDesc") : t("beacon.offDesc")}
              </Txt>
            </View>
            {busy ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Switch
                testID="beacon-toggle"
                value={awake}
                onValueChange={toggleBeacon}
                trackColor={{ false: colors.surfaceTertiary, true: colors.brandSecondary }}
                thumbColor={awake ? colors.brandPrimary : "#fff"}
              />
            )}
          </View>
        </Card>

        {permBlocked && (
          <Pressable testID="open-settings" onPress={() => Linking.openSettings()} style={styles.permNote}>
            <Feather name="map-pin" size={16} color={colors.warning} />
            <Txt style={{ color: colors.onSurfaceTertiary, flex: 1, fontSize: fontSize.sm, lineHeight: 18 }}>
              Location is off, so your pin uses an approximate area. Tap to enable precise (still randomized) placement in Settings.
            </Txt>
          </Pressable>
        )}

        {/* Active count */}
        <View style={styles.countRow}>
          <View style={styles.countDot} />
          <Txt weight="500" style={{ fontSize: fontSize.lg }}>
            {count} {t("beacon.momsAwake")}
          </Txt>
        </View>

        {/* Map */}
        <PresenceMap anchor={anchor} pins={pins} awake={awake} height={320} />
        <View style={styles.privacyRow}>
          <Feather name="shield" size={14} color={colors.success} />
          <Txt style={{ color: colors.muted, flex: 1, fontSize: fontSize.sm, lineHeight: 18 }}>
            {t("beacon.mapPrivacy")}
          </Txt>
        </View>

        {/* Matching */}
        <Card style={{ marginTop: spacing.lg }}>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{t("beacon.prefLabel")}</Txt>
          <Pressable
            testID="matching-pref-link"
            onPress={() => router.push("/beacon-settings")}
            style={styles.prefRow}
          >
            <Txt weight="500" style={{ fontSize: fontSize.lg, flex: 1 }}>
              {t(PREF_LABEL[pref])}
            </Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
          <Button
            testID="find-peer-button"
            label={matching ? t("beacon.finding") : t("beacon.findPeer")}
            onPress={findPeer}
            loading={matching}
            icon={!matching ? <Feather name="message-circle" size={18} color={colors.onBrandPrimary} /> : undefined}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize["2xl"] },
  beaconCard: { marginBottom: spacing.md },
  beaconCardOn: { backgroundColor: colors.brandTertiary + "40", borderColor: colors.brandPrimary },
  beaconGlow: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  beaconGlowOn: { backgroundColor: colors.brandPrimary },
  permNote: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.warning + "22",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  countRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  countDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.success },
  privacyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginTop: 2,
  },
});
