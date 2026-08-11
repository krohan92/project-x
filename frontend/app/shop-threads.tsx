import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

export default function ShopThreads() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();
  const [threads, setThreads] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!deviceId) return;
      api.myShopThreads(deviceId).then(setThreads).catch(() => {});
    }, [deviceId])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Txt display style={{ fontSize: fontSize.xl }}>Your conversations</Txt>
      </View>
      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        ListEmptyComponent={
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="message-circle" size={28} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm }}>No conversations yet</Txt>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/shop-thread/${item.id}`)}>
            <Card style={styles.row}>
              <View style={styles.icon}>
                <Feather name="gift" size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="500">{item.item_title}</Txt>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                  {item.am_poster ? "Someone's interested" : "You reached out"}
                </Txt>
              </View>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "50",
    alignItems: "center",
    justifyContent: "center",
  },
});
