import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";

export default function SupportDirectory() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [categories, setCategories] = useState<any[]>([]);
  const [active, setActive] = useState("lactation");
  const [providers, setProviders] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      api.supportCategories().then(setCategories).catch(() => {});
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      api.supportProviders(active).then(setProviders).catch(() => setProviders([]));
    }, [active])
  );

  const callNumber = (phone: string) => Linking.openURL(`tel:${phone.replace(/[^\d+]/g, "")}`).catch(() => {});
  const openWebsite = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Postpartum Support</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Real local professionals, one tap away</Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
        <Card style={styles.crisisNote}>
          <Feather name="info" size={15} color="#8A6D3B" />
          <Txt style={styles.crisisNoteText}>
            If you're in crisis right now, call or text 988 (Suicide & Crisis Lifeline), or Postpartum
            Support International at 1-800-944-4773 — this directory is for finding ongoing care, not
            emergencies.
          </Txt>
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, alignItems: "flex-start" }}>
          {categories.map((c) => (
            <Pressable
              key={c.key}
              testID={`support-category-${c.key}`}
              onPress={() => setActive(c.key)}
              style={[styles.catChip, active === c.key && styles.catChipActive]}
            >
              <Feather name={c.icon as any} size={14} color={active === c.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
              <Txt style={{ color: active === c.key ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontSize: fontSize.sm, marginLeft: 6 }}>
                {c.label}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>

        {providers.map((p) => (
          <Card key={p.name} style={{ gap: spacing.xs }}>
            <Txt weight="500" style={{ fontSize: fontSize.base }}>{p.name}</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{p.note}</Txt>
            <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.xs }}>
              {p.phone && (
                <Pressable onPress={() => callNumber(p.phone)} style={styles.actionBtn}>
                  <Feather name="phone-call" size={13} color={colors.brand} />
                  <Txt style={{ color: colors.brand, fontSize: fontSize.sm }}>{p.phone}</Txt>
                </Pressable>
              )}
              {p.website && (
                <Pressable onPress={() => openWebsite(p.website)} style={styles.actionBtn}>
                  <Feather name="external-link" size={13} color={colors.brand} />
                  <Txt style={{ color: colors.brand, fontSize: fontSize.sm }}>Website</Txt>
                </Pressable>
              )}
            </View>
          </Card>
        ))}

        <Txt style={{ color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.sm }}>
          These are independent professionals, not affiliated with Cuddle — reaching out is always up to
          you, nothing here contacts anyone automatically.
        </Txt>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  crisisNote: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: "#FBF3E0",
    borderWidth: 1,
    borderColor: "#EAD9AE",
  },
  crisisNoteText: { flex: 1, color: "#6B5426", fontSize: fontSize.sm, lineHeight: 19 },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
});
