import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput, Platform, Linking, Share } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
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

function isPast(iso: string) {
  const d = new Date(iso + "T23:59:59");
  return d.getTime() < Date.now();
}

export default function MeetupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, profile } = useProfile();

  const [meetup, setMeetup] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [reflectMood, setReflectMood] = useState<number | null>(null);
  const [reflectNote, setReflectNote] = useState("");
  const [reflectSubmitting, setReflectSubmitting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const m = await api.getMeetup(String(id));
      setMeetup(m);
    } catch {}
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const iAmGoing = meetup && deviceId && meetup.attendees?.some((a: any) => a.device_id === deviceId);

  const rsvp = async () => {
    if (!deviceId || !meetup) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const m = await api.rsvpMeetup(meetup.meetup_id, { device_id: deviceId, name: profile?.name || "A mom" });
      setMeetup(m);
    } catch {}
    setBusy(false);
  };

  const cancelRsvp = async () => {
    if (!deviceId || !meetup) return;
    setBusy(true);
    try {
      await api.cancelRsvp(meetup.meetup_id, deviceId);
      await load();
    } catch {}
    setBusy(false);
  };

  const addToCalendar = () => {
    if (!meetup) return;
    const url = api.meetupIcsUrl(meetup.meetup_id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = url;
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const shareInvite = async () => {
    if (!meetup) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const base =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : process.env.EXPO_PUBLIC_APP_URL || null;
    const link = base ? `${base}/meetup/${meetup.meetup_id}` : null;
    const message = link
      ? `Want to join? ${meetup.title} — ${dayLabel(meetup.date)} at ${meetup.time_label || "TBD"}, ${meetup.venue_name}. Tap here: ${link}`
      : `Want to join? ${meetup.title} — ${dayLabel(meetup.date)} at ${meetup.time_label || "TBD"}, ${meetup.venue_name}.`;
    try {
      if (Platform.OS !== "web") {
        await Share.share({ message });
        return;
      }
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title: meetup.title, text: message, url: link || undefined });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard && link) {
        await navigator.clipboard.writeText(message);
      }
    } catch {}
  };

  const submitReflection = async () => {
    if (!deviceId || !meetup || reflectMood == null) return;
    setReflectSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await api.submitMeetupReflection(meetup.meetup_id, {
        device_id: deviceId,
        mood_after: reflectMood,
        note: reflectNote.trim() || undefined,
      });
      setAiNote(res.ai_note || null);
    } catch {}
    setReflectSubmitting(false);
  };

  if (!meetup) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  }

  const showReflectionPrompt = iAmGoing && isPast(meetup.date) && !aiNote;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Txt display style={{ fontSize: fontSize["2xl"] }}>{meetup.title}</Txt>

        <Card style={{ gap: spacing.sm }}>
          <View style={styles.row}>
            <Feather name="calendar" size={16} color={colors.brand} />
            <Txt>{dayLabel(meetup.date)} · {meetup.time_label}</Txt>
          </View>
          <View style={styles.row}>
            <Feather name="map-pin" size={16} color={colors.brand} />
            <Txt>{meetup.venue_name}</Txt>
          </View>
          <View style={styles.row}>
            <Feather name="users" size={16} color={colors.brand} />
            <Txt>{meetup.attendees?.length || 1} going</Txt>
          </View>
        </Card>

        {meetup.description && <Txt style={{ color: colors.onSurface, lineHeight: 22 }}>{meetup.description}</Txt>}

        <Button label="Invite people" onPress={shareInvite} icon={<Feather name="share" size={16} color={colors.onBrandPrimary} />} />
        <Txt style={{ color: colors.muted, fontSize: 11, textAlign: "center" }}>
          Meetups don't invite anyone on their own — share this with whoever you want there.
        </Txt>

        <Button label="Add to Calendar" variant="secondary" onPress={addToCalendar} />
        <Txt style={{ color: colors.muted, fontSize: 11, textAlign: "center" }}>
          Opens a calendar file — on iPhone this adds it straight to Apple Calendar.
        </Txt>

        {!isPast(meetup.date) && (
          iAmGoing ? (
            <Button label="Can't make it anymore" variant="secondary" onPress={cancelRsvp} loading={busy} />
          ) : (
            <Button label="I'm going" onPress={rsvp} loading={busy} />
          )
        )}

        {meetup.attendees?.length > 0 && (
          <View>
            <Txt weight="500" style={{ marginBottom: spacing.sm }}>Who's going</Txt>
            {meetup.attendees.map((a: any, i: number) => (
              <Txt key={i} style={{ color: colors.muted, fontSize: fontSize.sm }}>{a.name}</Txt>
            ))}
          </View>
        )}

        {showReflectionPrompt && (
          <Animated.View entering={FadeIn}>
            <Card style={{ gap: spacing.sm }}>
              <Txt display style={{ fontSize: fontSize.lg }}>How did it go?</Txt>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => { Haptics.selectionAsync(); setReflectMood(n); }}
                    style={[styles.moodDot, reflectMood === n && styles.moodDotActive]}
                  >
                    <Txt style={{ color: reflectMood === n ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{n}</Txt>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={reflectNote}
                onChangeText={setReflectNote}
                placeholder="Anything you want to remember about it? (optional)"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <Button label="Save" onPress={submitReflection} loading={reflectSubmitting} disabled={reflectMood == null} />
            </Card>
          </Animated.View>
        )}

        {aiNote && (
          <Animated.View entering={FadeIn}>
            <Card style={{ gap: spacing.sm, backgroundColor: colors.brandTertiary + "20" }}>
              <Txt style={{ color: colors.onSurface, fontStyle: "italic" }}>{aiNote}</Txt>
            </Card>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  moodDot: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moodDotActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
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
