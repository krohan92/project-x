import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

export default function ShopItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [item, setItem] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.shopItem(String(id)).then(setItem).catch(() => {});
  }, [id]);

  const isMine = item && deviceId && item.device_id === deviceId;

  const interested = async () => {
    if (!deviceId || !item) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await api.expressInterest(item.id, deviceId);
      router.push(`/shop-thread/${res.thread_id}`);
    } catch {}
    setBusy(false);
  };

  const markGiven = async () => {
    if (!item) return;
    Alert.alert("Mark as given?", "This removes it from the board.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes, given",
        onPress: async () => {
          await api.claimShopItem(item.id);
          router.back();
        },
      },
    ]);
  };

  if (!item) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={styles.iconWrap}>
          <Feather name="gift" size={36} color={colors.brand} />
        </View>
        <Txt display style={{ fontSize: fontSize["2xl"] }}>{item.title}</Txt>
        <View style={styles.metaRow}>
          <View style={styles.pill}>
            <Txt style={{ color: colors.onSurfaceSecondary, fontSize: fontSize.sm }}>{item.condition}</Txt>
          </View>
          <View style={styles.pill}>
            <Txt style={{ color: colors.onSurfaceSecondary, fontSize: fontSize.sm }}>
              {item.price_type === "free" ? "Free" : item.price_type === "trade" ? "Trade" : `$${item.price ?? "—"}`}
            </Txt>
          </View>
        </View>
        {item.description && <Txt style={{ color: colors.onSurface, lineHeight: 22 }}>{item.description}</Txt>}
        {item.location_label && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Feather name="map-pin" size={14} color={colors.muted} />
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{item.location_label}</Txt>
          </View>
        )}

        {isMine ? (
          <Card style={{ gap: spacing.sm }}>
            <Txt style={{ color: colors.muted }}>This is your listing.</Txt>
            <Button label="Mark as given" variant="secondary" onPress={markGiven} />
          </Card>
        ) : (
          <Button label="I'm interested" onPress={interested} loading={busy} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "50",
    alignItems: "center",
    justifyContent: "center",
  },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  pill: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
