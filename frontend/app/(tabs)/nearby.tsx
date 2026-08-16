import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter, useFocusEffect } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";

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

function RippleRing({ delayMs, active }: { delayMs: number; active: boolean }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (active) {
      scale.value = withDelay(
        delayMs,
        withRepeat(withTiming(2.1, { duration: 1800, easing: Easing.out(Easing.ease) }), -1, false)
      );
      opacity.value = withDelay(
        delayMs,
        withRepeat(
          withTiming(0, { duration: 1800, easing: Easing.out(Easing.ease) }),
          -1,
          false
        )
      );
    } else {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = 1;
      opacity.value = 0;
    }
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [active, delayMs, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: active ? (1 - (scale.value - 1) / 1.1) * 0.45 : 0,
  }));

  return <Animated.View style={[styles.rippleRing, style]} />;
}

function WaveButton({ awake, busy, onPress }: { awake: boolean; busy: boolean; onPress: () => void }) {
  return (
    <View style={styles.waveWrap}>
      <RippleRing delayMs={0} active={awake} />
      <RippleRing delayMs={600} active={awake} />
      <RippleRing delayMs={1200} active={awake} />
      <Pressable
        testID="wave-button"
        onPress={onPress}
        disabled={busy}
        style={[styles.waveCircle, awake && styles.waveCircleOn]}
      >
        {busy ? (
          <ActivityIndicator color={awake ? "#fff" : colors.brand} />
        ) : (
          <Txt style={styles.waveEmoji}>👋</Txt>
        )}
      </Pressable>
    </View>
  );
}

export default function Nearby() {
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

  const toggleAwake = async () => {
    if (!deviceId) return;
    const next = !awake;
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
          <Txt display style={styles.title}>{t("nearby.title")}</Txt>
          <Txt style={{ color: colors.muted }}>{t("nearby.subtitle")}</Txt>
        </View>
        <Pressable testID="nearby-settings-button" onPress={() => router.push("/nearby-settings")} hitSlop={10}>
          <Feather name="settings" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
      >
        {/* Wave */}
        <Card style={[styles.waveCard, awake && styles.waveCardOn]}>
          <WaveButton awake={awake} busy={busy} onPress={toggleAwake} />
          <Txt display style={{ fontSize: fontSize.xl, textAlign: "center", marginTop: spacing.md }}>
            {awake ? t("nearby.on") : t("nearby.light")}
          </Txt>
          <Txt style={{ color: colors.onSurfaceTertiary, marginTop: 4, lineHeight: 20, textAlign: "center" }}>
            {awake ? t("nearby.onDesc") : t("nearby.offDesc")}
          </Txt>
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
            {count} {t("nearby.momsAwake")}
          </Txt>
        </View>

        {/* Map */}
        <PresenceMap anchor={anchor} pins={pins} awake={awake} height={320} />
        <View style={styles.privacyRow}>
          <Feather name="shield" size={14} color={colors.success} />
          <Txt style={{ color: colors.muted, flex: 1, fontSize: fontSize.sm, lineHeight: 18 }}>
            {t("nearby.mapPrivacy")}
          </Txt>
        </View>

        {/* Matching */}
        <Card style={{ marginTop: spacing.lg }}>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{t("nearby.prefLabel")}</Txt>
          <Pressable
            testID="matching-pref-link"
            onPress={() => router.push("/nearby-settings")}
            style={styles.prefRow}
          >
            <Txt weight="500" style={{ fontSize: fontSize.lg, flex: 1 }}>
              {t(PREF_LABEL[pref])}
            </Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
          <Button
            testID="find-peer-button"
            label={matching ? t("nearby.finding") : t("nearby.findPeer")}
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
  waveCard: { marginBottom: spacing.md, alignItems: "center", paddingVertical: spacing.xl },
  waveCardOn: { backgroundColor: colors.brandTertiary + "40", borderColor: colors.brandPrimary },
  waveWrap: {
    width: 130,
    height: 130,
    alignItems: "center",
    justifyContent: "center",
  },
  rippleRing: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  waveCircle: {
    width: 90,
    height: 90,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  waveCircleOn: { backgroundColor: colors.brandPrimary },
  waveEmoji: { fontSize: 40 },
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
