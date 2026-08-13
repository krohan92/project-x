import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

const DAYS_AHEAD = 14;
const TOKENS_KEY = "meal_slot_tokens";

function nextDays(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

async function loadTokens(): Promise<Record<string, string>> {
  const raw = await storage.getItem(TOKENS_KEY, "{}");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
async function saveToken(slotId: string, token: string) {
  const tokens = await loadTokens();
  tokens[slotId] = token;
  await storage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export default function MealTrainJoin() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const insets = useSafeAreaInsets();

  const [train, setTrain] = useState<any | null>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [myTokens, setMyTokens] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [signupDate, setSignupDate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [mealDesc, setMealDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!code) return;
    try {
      const res = await api.getMealTrain(String(code).toUpperCase());
      setTrain(res.train);
      setSlots(res.slots || []);
      setMyTokens(await loadTokens());
    } catch {
      setError("This link doesn't seem to work anymore — ask whoever shared it to resend it.");
    }
    setLoading(false);
  }, [code]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const days = nextDays(DAYS_AHEAD);
  const slotByDate: Record<string, any> = {};
  slots.forEach((s) => { slotByDate[s.date] = s; });

  const openSignup = (date: string) => {
    Haptics.selectionAsync();
    setSignupDate(date);
    setName(""); setContact(""); setMealDesc("");
  };

  const submitSignup = async () => {
    if (!signupDate || !name.trim() || !code) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const slot = await api.signUpMealSlot(String(code).toUpperCase(), {
        date: signupDate,
        giver_name: name.trim(),
        giver_contact: contact.trim() || undefined,
        meal_description: mealDesc.trim() || undefined,
      });
      await saveToken(slot.id, slot.slot_token);
      setSignupDate(null);
      await load();
    } catch {
      // most likely someone else just took this date
      setSignupDate(null);
      await load();
    }
    setSaving(false);
  };

  const cancelSlot = async (slot: any) => {
    const token = myTokens[slot.id];
    if (!token || !code) return;
    await api.cancelMealSlot(String(code).toUpperCase(), slot.id, token);
    await load();
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  if (error) {
    return (
      <View style={[styles.centerScreen, { paddingTop: insets.top }]}>
        <Feather name="alert-circle" size={32} color={colors.muted} />
        <Txt style={{ color: colors.muted, textAlign: "center", marginTop: spacing.md }}>{error}</Txt>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={{ fontSize: fontSize.xl }}>{train?.title}</Txt>
        {train?.notes && <Txt style={{ color: colors.muted, marginTop: 4 }}>{train.notes}</Txt>}
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing["3xl"] }}>
        {days.map((date) => {
          const slot = slotByDate[date];
          const isMine = slot && myTokens[slot.id];
          return (
            <Card key={date} style={styles.dayRow}>
              <View style={{ flex: 1 }}>
                <Txt weight="500">{dayLabel(date)}</Txt>
                {slot ? (
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                    {slot.giver_name}{slot.meal_description ? ` — ${slot.meal_description}` : ""}
                  </Txt>
                ) : (
                  <Txt style={{ color: colors.brand, fontSize: fontSize.sm, marginTop: 2 }}>Open</Txt>
                )}
              </View>
              {!slot && (
                <Button label="Sign up" variant="secondary" onPress={() => openSignup(date)} />
              )}
              {isMine && (
                <Pressable onPress={() => cancelSlot(slot)}>
                  <Txt style={{ color: colors.error, fontSize: fontSize.sm }}>Cancel</Txt>
                </Pressable>
              )}
            </Card>
          );
        })}
      </ScrollView>

      <Modal visible={!!signupDate} animationType="slide" transparent onRequestClose={() => setSignupDate(null)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Txt display style={{ fontSize: fontSize.lg }}>
                {signupDate ? dayLabel(signupDate) : ""}
              </Txt>
              <Pressable onPress={() => setSignupDate(null)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <TextInput
              value={contact}
              onChangeText={setContact}
              placeholder="Phone or email (optional, in case plans change)"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <TextInput
              value={mealDesc}
              onChangeText={setMealDesc}
              placeholder="What are you thinking of bringing? (optional)"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Button label="Confirm sign-up" onPress={submitSignup} loading={saving} disabled={!name.trim()} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centerScreen: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  dayRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
