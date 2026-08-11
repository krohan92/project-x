import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const CONDITIONS = ["New", "Like new", "Gently used", "Well loved"];
const PRICE_TYPES = [
  { key: "free", label: "Free" },
  { key: "low-cost", label: "Low cost" },
  { key: "trade", label: "Trade" },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Shop() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId } = useProfile();

  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // compose form state
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("clothes");
  const [condition, setCondition] = useState(CONDITIONS[0]);
  const [priceType, setPriceType] = useState("free");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async (c: string) => {
    try {
      const [its, cats] = await Promise.all([
        api.shopItems({ category: c === "all" ? undefined : c }),
        categories.length ? Promise.resolve(categories) : api.shopCategories(),
      ]);
      setItems(its);
      if (!categories.length) setCategories(cats);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(useCallback(() => { load(category); }, [category, load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load(category);
    setRefreshing(false);
  };

  const resetForm = () => {
    setTitle(""); setCat("clothes"); setCondition(CONDITIONS[0]);
    setPriceType("free"); setPrice(""); setDescription(""); setLocationLabel("");
  };

  const submitItem = async () => {
    if (!deviceId || !title.trim()) return;
    setPosting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.createShopItem({
        device_id: deviceId,
        title: title.trim(),
        category: cat,
        condition,
        description: description.trim() || null,
        price_type: priceType,
        price: priceType === "low-cost" && price ? parseFloat(price) : null,
        location_label: locationLabel.trim() || null,
      });
      resetForm();
      setComposeOpen(false);
      await load(category);
    } catch {}
    setPosting(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt display style={styles.title}>Give & Share</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
              Free and low-cost baby & mom things, mom to mom
            </Txt>
          </View>
          <Pressable
            testID="shop-my-threads"
            onPress={() => router.push("/shop-threads")}
            hitSlop={10}
          >
            <Feather name="message-circle" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Pressable
            onPress={() => setCategory("all")}
            style={[styles.chip, category === "all" && styles.chipActive]}
          >
            <Txt style={{ color: category === "all" ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>All</Txt>
          </Pressable>
          {categories.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setCategory(c.key)}
              style={[styles.chip, category === c.key && styles.chipActive]}
            >
              <Feather
                name={c.icon}
                size={13}
                color={category === c.key ? colors.onBrandPrimary : colors.onSurfaceSecondary}
              />
              <Txt style={{ color: category === c.key ? colors.onBrandPrimary : colors.onSurfaceSecondary, marginLeft: 6 }}>
                {c.label}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        ListEmptyComponent={
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="gift" size={30} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm, textAlign: "center" }}>
              Nothing posted here yet — be the first to share something.
            </Txt>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`shop-item-${item.id}`}
            onPress={() => router.push(`/shop-item/${item.id}`)}
            style={styles.itemCard}
          >
            <View style={styles.itemIconWrap}>
              <Feather
                name={(categories.find((c) => c.key === item.category)?.icon || "box") as any}
                size={22}
                color={colors.brand}
              />
            </View>
            <Txt weight="500" numberOfLines={2} style={{ marginTop: spacing.sm }}>{item.title}</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>{item.condition}</Txt>
            <View style={styles.priceRow}>
              <Txt style={{ color: colors.brand, fontSize: fontSize.sm }} weight="500">
                {item.price_type === "free" ? "Free" : item.price_type === "trade" ? "Trade" : `$${item.price ?? "—"}`}
              </Txt>
              <Txt style={{ color: colors.muted, fontSize: 11 }}>{timeAgo(item.created_at)}</Txt>
            </View>
          </Pressable>
        )}
      />

      <Pressable
        testID="shop-add-button"
        onPress={() => setComposeOpen(true)}
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
      >
        <Feather name="plus" size={24} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Txt display style={{ fontSize: fontSize.xl }}>Share something</Txt>
              <Pressable onPress={() => setComposeOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
              <TextInput
                testID="shop-title-input"
                value={title}
                onChangeText={setTitle}
                placeholder="What are you sharing? (e.g. 0-3mo onesies, bundle of 8)"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />

              <Txt weight="500">Category</Txt>
              <View style={styles.chipWrap}>
                {categories.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => setCat(c.key)}
                    style={[styles.formChip, cat === c.key && styles.chipActive]}
                  >
                    <Txt style={{ color: cat === c.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{c.label}</Txt>
                  </Pressable>
                ))}
              </View>

              <Txt weight="500">Condition</Txt>
              <View style={styles.chipWrap}>
                {CONDITIONS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCondition(c)}
                    style={[styles.formChip, condition === c && styles.chipActive]}
                  >
                    <Txt style={{ color: condition === c ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{c}</Txt>
                  </Pressable>
                ))}
              </View>

              <Txt weight="500">Price</Txt>
              <View style={styles.chipWrap}>
                {PRICE_TYPES.map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => setPriceType(p.key)}
                    style={[styles.formChip, priceType === p.key && styles.chipActive]}
                  >
                    <Txt style={{ color: priceType === p.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{p.label}</Txt>
                  </Pressable>
                ))}
              </View>
              {priceType === "low-cost" && (
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  placeholder="Amount ($)"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  style={styles.input}
                />
              )}

              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Any details — size, brand, why you're sharing it..."
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
              />
              <TextInput
                value={locationLabel}
                onChangeText={setLocationLabel}
                placeholder="General area (e.g. 'North Fresno') — never an exact address"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />

              <Button label="Post it" onPress={submitItem} loading={posting} disabled={!title.trim()} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { fontSize: fontSize.xl },
  chipsRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  itemCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  itemIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "50",
    alignItems: "center",
    justifyContent: "center",
  },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "88%",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
