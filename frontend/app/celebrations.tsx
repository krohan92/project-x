import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  Linking,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const CATEGORY_META: Record<string, { label: string; icon: any; color: string }> = {
  appointment: { label: "Appointment", icon: "clipboard", color: "#93B4D6" },
  birthday: { label: "Birthday Party", icon: "gift", color: "#D68C7A" },
  baby_shower: { label: "Baby Shower", icon: "heart", color: "#E8A9BC" },
  other: { label: "Other", icon: "calendar", color: "#98A99B" },
};

const VENDOR_TABS = [
  { key: "venue", label: "Venues" },
  { key: "cake", label: "Cakes" },
  { key: "photography", label: "Photography" },
];

function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function Celebrations() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [events, setEvents] = useState<any[]>([]);
  const [vendorTab, setVendorTab] = useState("venue");
  const [vendors, setVendors] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const [evs] = await Promise.all([api.listEvents(deviceId)]);
      setEvents(evs);
      api.checkEventReminders(deviceId).catch(() => {});
    } catch {}
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(
    useCallback(() => {
      api.celebrationVendors(vendorTab).then(setVendors).catch(() => setVendors([]));
    }, [vendorTab])
  );

  const removeEvent = async (eventId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.deleteEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.event_id !== eventId));
    } catch {}
  };

  const addToCalendar = (eventId: string) => {
    const url = api.eventIcsUrl(eventId);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = url;
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Celebrations & Events</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Birthdays, showers, appointments — all in one place</Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
        <Button label="+ Add an event or appointment" onPress={() => setAddOpen(true)} />

        {events.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            {events.map((ev) => {
              const meta = CATEGORY_META[ev.category] || CATEGORY_META.other;
              return (
                <Card key={ev.event_id} style={styles.eventCard}>
                  <View style={[styles.catDot, { backgroundColor: meta.color }]} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="500">{ev.title}</Txt>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                      {dayLabel(ev.date)}{ev.time_label ? ` · ${ev.time_label}` : ""}{ev.location ? ` · ${ev.location}` : ""}
                    </Txt>
                  </View>
                  <Pressable onPress={() => addToCalendar(ev.event_id)} hitSlop={8} style={{ padding: 4 }}>
                    <Feather name="calendar" size={18} color={colors.brand} />
                  </Pressable>
                  <Pressable onPress={() => removeEvent(ev.event_id)} hitSlop={8} style={{ padding: 4 }}>
                    <Feather name="x" size={18} color={colors.muted} />
                  </Pressable>
                </Card>
              );
            })}
          </View>
        )}

        <Txt display style={{ fontSize: fontSize.lg, marginTop: spacing.md }}>Local vendors</Txt>
        <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: -spacing.sm }}>
          One tap to reach out — nothing is contacted automatically on your behalf.
        </Txt>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {VENDOR_TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setVendorTab(t.key)}
              style={[styles.vendorTab, vendorTab === t.key && styles.vendorTabActive]}
            >
              <Txt style={{ color: vendorTab === t.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{t.label}</Txt>
            </Pressable>
          ))}
        </ScrollView>

        {vendors.map((v) => (
          <Card key={v.name} style={{ gap: 4 }}>
            <Txt weight="500" style={{ fontSize: fontSize.base }}>{v.name}</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{v.note}</Txt>
            {v.website && (
              <Pressable onPress={() => Linking.openURL(v.website)} style={styles.websiteBtn}>
                <Feather name="external-link" size={13} color={colors.brand} />
                <Txt style={{ color: colors.brand, fontSize: fontSize.sm }}>Visit website</Txt>
              </Pressable>
            )}
          </Card>
        ))}
      </ScrollView>

      <AddEventModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        deviceId={deviceId}
        onSaved={() => { setAddOpen(false); load(); }}
      />
    </View>
  );
}

function AddEventModal({
  visible,
  onClose,
  deviceId,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  deviceId: string | null;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "form">("choose");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("appointment");
  const [date, setDate] = useState("");
  const [timeLabel, setTimeLabel] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<"manual" | "photo">("manual");

  const reset = () => {
    setMode("choose"); setTitle(""); setCategory("appointment");
    setDate(""); setTimeLabel(""); setLocation(""); setNotes(""); setSource("manual");
  };

  const close = () => { reset(); onClose(); };

  const startManual = () => { setSource("manual"); setMode("form"); };

  const scanPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.6,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    setScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const draft = await api.extractEventFromPhoto(result.assets[0].base64, "image/jpeg");
      setTitle(draft.title || "");
      setCategory(draft.category || "other");
      setDate(draft.date || "");
      setTimeLabel(draft.time_label || "");
      setLocation(draft.location || "");
      setNotes(draft.notes || "");
      setSource("photo");
      setMode("form");
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    setScanning(false);
  };

  const save = async () => {
    if (!deviceId || !title.trim() || !date.trim()) return;
    setSaving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await api.createEvent({
        device_id: deviceId,
        title: title.trim(),
        category,
        date: date.trim(),
        time_label: timeLabel.trim() || undefined,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        source,
      });
      reset();
      onSaved();
    } catch {}
    setSaving(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Txt display style={{ fontSize: fontSize.xl }}>
              {mode === "choose" ? "Add an event" : source === "photo" ? "Check what I read" : "Add manually"}
            </Txt>
            <Pressable onPress={close} hitSlop={10}>
              <Feather name="x" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          {mode === "choose" ? (
            <View style={{ gap: spacing.md }}>
              <Pressable testID="scan-photo-button" onPress={scanPhoto} style={styles.choiceCard} disabled={scanning}>
                {scanning ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Feather name="camera" size={22} color={colors.brand} />
                )}
                <View style={{ flex: 1 }}>
                  <Txt weight="500">Scan a photo</Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                    An invite, flyer, or appointment card — I'll read the details for you to check
                  </Txt>
                </View>
              </Pressable>
              <Pressable onPress={startManual} style={styles.choiceCard}>
                <Feather name="edit-3" size={22} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Txt weight="500">Type it in</Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Quick manual entry</Txt>
                </View>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
              {source === "photo" && (
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                  Here's what I could read — please check it over before saving.
                </Txt>
              )}
              <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.muted} style={styles.input} />

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {Object.entries(CATEGORY_META).map(([key, meta]) => (
                  <Pressable
                    key={key}
                    onPress={() => setCategory(key)}
                    style={[styles.formChip, category === key && styles.chipActive]}
                  >
                    <Txt style={{ color: category === key ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontSize: fontSize.sm }}>
                      {meta.label}
                    </Txt>
                  </Pressable>
                ))}
              </View>

              <TextInput value={date} onChangeText={setDate} placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.muted} style={styles.input} />
              <TextInput value={timeLabel} onChangeText={setTimeLabel} placeholder="Time (e.g. 2:30 PM) — optional" placeholderTextColor={colors.muted} style={styles.input} />
              <TextInput value={location} onChangeText={setLocation} placeholder="Location — optional" placeholderTextColor={colors.muted} style={styles.input} />
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Notes — optional"
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
              />

              <Button label="Save" onPress={save} loading={saving} disabled={!title.trim() || !date.trim()} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  vendorTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vendorTabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  websiteBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "88%",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
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
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
});
