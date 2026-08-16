import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

type AgendaItem = {
  id: string;
  kind: "event" | "meetup";
  title: string;
  date: string;
  timeLabel?: string;
  subtitle?: string;
  icsUrl?: string;
  onPress: () => void;
};

export default function CuddleCalendar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const [events, myMeetups] = await Promise.all([
        api.listEvents(deviceId),
        api.myMeetups(deviceId),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const eventItems: AgendaItem[] = (events || []).map((e: any) => ({
        id: `event-${e.event_id}`,
        kind: "event",
        title: e.title,
        date: e.date,
        timeLabel: e.time_label,
        subtitle: e.location,
        icsUrl: api.eventIcsUrl(e.event_id),
        onPress: () => router.push("/celebrations"),
      }));
      const meetupItems: AgendaItem[] = (myMeetups || [])
        .filter((m: any) => m.date >= today)
        .map((m: any) => ({
          id: `meetup-${m.meetup_id}`,
          kind: "meetup",
          title: m.title,
          date: m.date,
          timeLabel: m.time_label,
          subtitle: m.venue_name,
          icsUrl: api.meetupIcsUrl(m.meetup_id),
          onPress: () => router.push(`/meetup/${m.meetup_id}`),
        }));
      const merged = [...eventItems, ...meetupItems].sort((a, b) => a.date.localeCompare(b.date));
      setItems(merged);
    } catch {}
    setLoading(false);
  }, [deviceId, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addToCalendar = (url: string) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = url;
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const grouped: { date: string; items: AgendaItem[] }[] = [];
  for (const item of items) {
    const group = grouped.find((g) => g.date === item.date);
    if (group) group.items.push(item);
    else grouped.push({ date: item.date, items: [item] });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Full Agenda</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Appointments, celebrations, and meetups — all in one place</Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {!loading && grouped.length === 0 && (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="calendar" size={28} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm, textAlign: "center" }}>
              Nothing coming up yet — anything you add to Mama's Calendar or Meetups will show here.
            </Txt>
          </Card>
        )}

        {grouped.map((g) => (
          <View key={g.date} style={{ gap: spacing.sm }}>
            <Txt weight="500" style={{ color: colors.muted, fontSize: fontSize.sm }}>
              {dayLabel(g.date).toUpperCase()}
            </Txt>
            {g.items.map((item) => (
              <Card key={item.id} style={styles.itemCard}>
                <Pressable onPress={item.onPress} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={[styles.dot, { backgroundColor: item.kind === "meetup" ? "#93B4D6" : "#D68C7A" }]} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="500">{item.title}</Txt>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                      {item.timeLabel ? `${item.timeLabel} · ` : ""}{item.subtitle || (item.kind === "meetup" ? "Meetup" : "Event")}
                    </Txt>
                  </View>
                </Pressable>
                {item.icsUrl && (
                  <Pressable onPress={() => addToCalendar(item.icsUrl!)} hitSlop={8} style={{ padding: 4 }}>
                    <Feather name="calendar" size={18} color={colors.brand} />
                  </Pressable>
                )}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
