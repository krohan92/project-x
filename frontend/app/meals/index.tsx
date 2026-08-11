import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput, Share, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

function appBaseUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return null;
}

function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function Meals() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, profile } = useProfile();

  const [train, setTrain] = useState<any | null>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [title, setTitle] = useState(profile?.name ? `Meals for ${profile.name}` : "Meals for us");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const t = await api.mealTrainForDevice(deviceId);
      if (t) {
        setTrain(t);
        const full = await api.getMealTrain(t.meal_train_code);
        setSlots(full.slots || []);
      }
    } catch {}
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!deviceId || !title.trim()) return;
    setCreating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const t = await api.createMealTrain({ device_id: deviceId, title: title.trim(), notes: notes.trim() || undefined });
      setTrain(t);
      setSlots([]);
    } catch {}
    setCreating(false);
  };

  const shareLink = async () => {
    if (!train) return;
    const base = appBaseUrl();
    const link = base ? `${base}/meals/${train.meal_train_code}` : null;
    const message = link
      ? `Would you help bring a meal for us? Pick any open day here: ${link}\n\n(Or open Cuddle and enter code ${train.meal_train_code})`
      : `Would you help bring a meal for us? Open Cuddle and enter code ${train.meal_train_code}`;
    try {
      if (Platform.OS !== "web") {
        await Share.share({ message });
        return;
      }
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title: "Meal Train", text: message });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Meal Train</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Let people bring you food</Txt>
        </View>
      </View>

      {!train ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Txt style={{ color: colors.onSurface }}>
            Start a meal train and share the link — friends and family can pick a day and bring
            (or send) a meal, no app or account needed on their end.
          </Txt>
          <Txt weight="500">Title</Txt>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Meals for us" placeholderTextColor={colors.muted} />
          <Txt weight="500">Notes for helpers (allergies, preferences, delivery instructions)</Txt>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
            placeholder="e.g. Dairy-free please, leave on the porch, ring the bell..."
            placeholderTextColor={colors.muted}
            multiline
          />
          <Button label="Create meal train" onPress={create} loading={creating} disabled={!title.trim()} />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
          <Card style={{ gap: spacing.sm }}>
            <Txt style={{ color: colors.muted }}>Share this with anyone who wants to help:</Txt>
            <View style={styles.codeBox}>
              <Txt display style={{ fontSize: fontSize["2xl"], letterSpacing: 4 }}>{train.meal_train_code}</Txt>
            </View>
            <Button label={copied ? "Copied!" : "Share link"} variant="secondary" onPress={shareLink} />
          </Card>

          <Txt display style={{ fontSize: fontSize.lg, marginTop: spacing.md }}>Sign-ups</Txt>
          {slots.length === 0 ? (
            <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
              <Feather name="calendar" size={28} color={colors.borderStrong} />
              <Txt style={{ color: colors.muted, marginTop: spacing.sm }}>No one's signed up yet</Txt>
            </Card>
          ) : (
            slots.map((s: any) => (
              <Card key={s.id} style={styles.slotRow}>
                <View style={{ flex: 1 }}>
                  <Txt weight="500">{dayLabel(s.date)} — {s.giver_name}</Txt>
                  {s.meal_description && <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{s.meal_description}</Txt>}
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  slotRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
