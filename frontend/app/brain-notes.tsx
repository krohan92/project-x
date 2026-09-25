import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";
import Animated, { FadeIn, FadeOutLeft } from "react-native-reanimated";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const CATEGORIES = [
  { key: "doctor", label: "For the Doctor", icon: "clipboard", color: "#93B4D6" },
  { key: "reminder", label: "Remember", icon: "bell", color: "#DEB068" },
  { key: "other", label: "Other", icon: "edit-3", color: "#B6AFA3" },
];

export default function BrainNotes() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [notes, setNotes] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("other");
  const [filter, setFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!deviceId) return;
    api.brainNotes(deviceId).then(setNotes).catch(() => {});
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!deviceId || !text.trim()) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.createBrainNote({ device_id: deviceId, text: text.trim(), category });
      setText("");
      load();
    } catch {}
    setSaving(false);
  };

  const complete = async (id: string) => {
    if (!deviceId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setNotes((n) => n.filter((x) => x.id !== id)); // optimistic
    try {
      await api.completeBrainNote(id, deviceId);
    } catch {
      load();
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Baby Brain Capture</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
            Jot it before it's gone — tap to check off later
          </Txt>
        </View>
      </View>

      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setFilter(null)}
          style={[styles.filterChip, filter === null && styles.filterChipActive]}
        >
          <Txt style={{ fontSize: fontSize.sm, color: filter === null ? colors.onSurface : colors.muted }}>All</Txt>
        </Pressable>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            testID={`brain-notes-filter-${c.key}`}
            onPress={() => setFilter(filter === c.key ? null : c.key)}
            style={[styles.filterChip, filter === c.key && { backgroundColor: c.color + "30", borderColor: c.color }]}
          >
            <Feather name={c.icon as any} size={12} color={filter === c.key ? colors.onSurface : colors.muted} />
            <Txt style={{ fontSize: fontSize.sm, color: filter === c.key ? colors.onSurface : colors.muted, marginLeft: 4 }}>
              {c.label}
            </Txt>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filter ? notes.filter((n) => n.category === filter) : notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl }}
        ListEmptyComponent={
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="feather" size={26} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm }}>
              {filter ? "Nothing in this category yet." : "Nothing on your mind yet — good."}
            </Txt>
          </Card>
        }
        renderItem={({ item }) => {
          const cat = CATEGORIES.find((c) => c.key === item.category) || CATEGORIES[CATEGORIES.length - 1];
          return (
            <Animated.View entering={FadeIn} exiting={FadeOutLeft}>
              <Pressable onPress={() => complete(item.id)}>
                <Card style={styles.noteRow}>
                  <View style={[styles.dot, { backgroundColor: cat.color }]} />
                  <Txt style={{ flex: 1, color: colors.onSurface }}>{item.text}</Txt>
                  <Feather name="check" size={18} color={colors.muted} />
                </Card>
              </Pressable>
            </Animated.View>
          );
        }}
      />

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => { Haptics.selectionAsync(); setCategory(c.key); }}
              style={[styles.catChip, category === c.key && { backgroundColor: c.color + "40", borderColor: c.color }]}
            >
              <Feather name={c.icon as any} size={12} color={category === c.key ? colors.onSurface : colors.muted} />
              <Txt style={{ fontSize: 11, color: category === c.key ? colors.onSurface : colors.muted, marginLeft: 4 }}>
                {c.label}
              </Txt>
            </Pressable>
          ))}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ask pediatrician about the rash..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            onSubmitEditing={add}
          />
          <Pressable onPress={add} style={styles.sendBtn} disabled={!text.trim() || saving}>
            <Feather name="plus" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  filterChipActive: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  noteRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  composer: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  catRow: { flexDirection: "row", gap: spacing.sm },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
