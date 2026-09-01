import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
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

const TIME_OPTIONS = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM"];

function nextWeekdayDates() {
  const out: { label: string; iso: string }[] = [];
  const d = new Date();
  for (let i = 1; i <= 10; i++) {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    out.push({
      label: day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      iso: day.toISOString().slice(0, 10),
    });
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
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const CATEGORY_COLORS: Record<string, string> = {
  baby_date: "#E8A9BC",
  mom_date: "#D68C7A",
  trail_walk: "#98A99B",
  yoga: "#B08FC7",
  other: "#93B4D6",
};

const VENUE_TYPE_ICONS: Record<string, any> = {
  park: "sun",
  trail: "map",
  winery: "droplet",
  cafe: "coffee",
  clubhouse: "home",
  yoga_studio: "sunrise",
  other: "map-pin",
};
const VENUE_TYPE_COLORS: Record<string, string> = {
  park: "#98A99B",
  trail: "#8FA876",
  winery: "#A8556E",
  cafe: "#D68C7A",
  clubhouse: "#93B4D6",
  yoga_studio: "#B08FC7",
  other: "#B6AFA3",
};

// What each meetup type actually prioritizes — this is what makes picking
// "Baby Date" vs "Mom Date" mean something, instead of just coloring a dot.
// Kid-friendly outdoor spots float to the top for a baby date; a cafe or
// winery floats up for a mom date; venue order stays as-is for everything
// else.
const CATEGORY_VENUE_PREFERENCE: Record<string, string[]> = {
  baby_date: ["park", "trail", "clubhouse"],
  mom_date: ["cafe", "winery", "yoga_studio"],
  trail_walk: ["trail", "park"],
  yoga: ["yoga_studio"],
  other: [],
};

function sortVenuesForCategory(venues: any[], category: string) {
  const preferred = CATEGORY_VENUE_PREFERENCE[category] || [];
  if (preferred.length === 0) return venues;
  return [...venues].sort((a, b) => {
    const ai = preferred.indexOf(a.type);
    const bi = preferred.indexOf(b.type);
    const aRank = ai === -1 ? preferred.length : ai;
    const bRank = bi === -1 ? preferred.length : bi;
    return aRank - bRank;
  });
}

export default function Meetups() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [neighborhoods, setNeighborhoods] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [neighborhood, setNeighborhood] = useState("all");
  const [composeNeighborhood, setComposeNeighborhood] = useState("riverstone");
  const [category, setCategory] = useState("all");
  const [meetups, setMeetups] = useState<any[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);

  // compose form
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("baby_date");
  const [venues, setVenues] = useState<any[]>([]);
  const [venueName, setVenueName] = useState("");
  const [customVenue, setCustomVenue] = useState("");
  const [dateIso, setDateIso] = useState("");
  const [timeLabel, setTimeLabel] = useState("10:00 AM");
  const [description, setDescription] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async (n: string, c: string) => {
    try {
      const [ms, ns, cs] = await Promise.all([
        api.listMeetups({ neighborhood: n === "all" ? undefined : n, category: c === "all" ? undefined : c }),
        neighborhoods.length ? Promise.resolve(neighborhoods) : api.meetupNeighborhoods(),
        categories.length ? Promise.resolve(categories) : api.meetupCategories(),
      ]);
      setMeetups(ms);
      if (!neighborhoods.length) setNeighborhoods(ns);
      if (!categories.length) setCategories(cs);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(useCallback(() => { load(neighborhood, category); }, [neighborhood, category, load]));

  const openCompose = async () => {
    setComposeOpen(true);
    setDateIso(nextWeekdayDates()[0]?.iso || "");
    // A meetup has to belong to one real place — "All areas" is only a
    // browsing filter, never a valid target for creating one.
    const resolved = neighborhood !== "all" ? neighborhood : (neighborhoods[0]?.key || "riverstone");
    setComposeNeighborhood(resolved);
    try {
      const v = await api.meetupVenues(resolved);
      const sorted = sortVenuesForCategory(v, cat);
      setVenues(sorted);
      setVenueName(sorted[0]?.name || "");
    } catch {}
  };

  const chooseCategory = (key: string) => {
    setCat(key);
    setVenues((prev) => {
      const sorted = sortVenuesForCategory(prev, key);
      setVenueName(sorted[0]?.name || "");
      return sorted;
    });
  };

  const submit = async () => {
    if (!deviceId || !title.trim() || !dateIso) return;
    setPosting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const created = await api.createMeetup({
        device_id: deviceId,
        title: title.trim(),
        category: cat,
        neighborhood: composeNeighborhood,
        venue_name: venueName === "__custom__" ? customVenue.trim() : venueName,
        date: dateIso,
        time_label: timeLabel,
        description: description.trim() || undefined,
      });
      setTitle(""); setDescription(""); setCustomVenue("");
      setComposeOpen(false);
      await load(neighborhood, category);
      // Land right on the invite screen — creating a meetup with no one
      // else in it isn't useful until it's actually shared.
      if (created?.meetup_id) router.push(`/meetup/${created.meetup_id}`);
    } catch {}
    setPosting(false);
  };

  const dates = nextWeekdayDates();

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={styles.title}>Meetups</Txt>
        <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
          Baby dates, mom dates, and get-togethers nearby
        </Txt>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setNeighborhood("all"); }}
            style={[styles.chip, neighborhood === "all" && styles.chipActive]}
          >
            <Txt style={{ color: neighborhood === "all" ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
              All areas
            </Txt>
          </Pressable>
          {neighborhoods.map((n) => (
            <Pressable
              key={n.key}
              onPress={() => { Haptics.selectionAsync(); setNeighborhood(n.key); }}
              style={[styles.chip, neighborhood === n.key && styles.chipActive]}
            >
              <Txt style={{ color: neighborhood === n.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                {n.label}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipsRow, { marginTop: spacing.xs }]}>
          <Pressable
            onPress={() => setCategory("all")}
            style={[styles.catChip, category === "all" && styles.catChipActive]}
          >
            <Txt style={{ color: category === "all" ? colors.onSurface : colors.muted, fontSize: fontSize.sm }}>All</Txt>
          </Pressable>
          {categories.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setCategory(c.key)}
              style={[styles.catChip, category === c.key && styles.catChipActive]}
            >
              <Txt style={{ color: category === c.key ? colors.onSurface : colors.muted, fontSize: fontSize.sm }}>{c.label}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={meetups}
        keyExtractor={(m) => m.meetup_id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}
        ListEmptyComponent={
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="users" size={28} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm, textAlign: "center" }}>
              Nothing planned here yet — be the first to start one.
            </Txt>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/meetup/${item.meetup_id}`)}>
            <Card style={styles.meetupCard}>
              <View style={[styles.catDot, { backgroundColor: CATEGORY_COLORS[item.category] || colors.brand }]} />
              <View style={{ flex: 1 }}>
                <Txt weight="500" style={{ fontSize: fontSize.lg }}>{item.title}</Txt>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                  {dayLabel(item.date)} · {item.time_label} · {item.venue_name}
                </Txt>
                <Txt style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                  {item.attendees?.length || 1} going
                </Txt>
              </View>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        )}
      />

      <Pressable testID="meetup-add-button" onPress={openCompose} style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}>
        <Feather name="plus" size={24} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Txt display style={{ fontSize: fontSize.xl }}>Plan a meetup</Txt>
              <Pressable onPress={() => setComposeOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="What's the plan? (e.g. Stroller walk + coffee)"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />

              <Txt weight="500">Type</Txt>
              <View style={styles.chipWrap}>
                {categories.map((c) => (
                  <Pressable key={c.key} onPress={() => chooseCategory(c.key)} style={[styles.formChip, cat === c.key && styles.chipActive]}>
                    <Txt style={{ color: cat === c.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{c.label}</Txt>
                  </Pressable>
                ))}
              </View>

              <Txt weight="500">Where</Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: -spacing.sm }}>
                Sorted for a {(categories.find((c) => c.key === cat)?.label || "").toLowerCase()} — pick any spot below
              </Txt>
              <View style={{ gap: spacing.sm }}>
                {venues.map((v) => (
                  <Pressable
                    key={v.name}
                    onPress={() => setVenueName(v.name)}
                    style={[styles.venueRow, venueName === v.name && styles.venueRowActive, { flexDirection: "row", alignItems: "center", gap: spacing.sm }]}
                  >
                    <View style={[styles.venueIcon, { backgroundColor: (VENUE_TYPE_COLORS[v.type] || colors.brand) + "30" }]}>
                      <Feather name={VENUE_TYPE_ICONS[v.type] || "map-pin"} size={16} color={VENUE_TYPE_COLORS[v.type] || colors.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt weight="500">{v.name}</Txt>
                      <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{v.note}</Txt>
                    </View>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setVenueName("__custom__")}
                  style={[styles.venueRow, venueName === "__custom__" && styles.venueRowActive]}
                >
                  <Txt weight="500">Somewhere else</Txt>
                </Pressable>
                {venueName === "__custom__" && (
                  <TextInput
                    value={customVenue}
                    onChangeText={setCustomVenue}
                    placeholder="Name the spot"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                  />
                )}
              </View>

              <Txt weight="500">When</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {dates.map((d) => (
                    <Pressable
                      key={d.iso}
                      onPress={() => setDateIso(d.iso)}
                      style={[styles.formChip, dateIso === d.iso && styles.chipActive]}
                    >
                      <Txt style={{ color: dateIso === d.iso ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontSize: fontSize.sm }}>
                        {d.label}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.chipWrap}>
                {TIME_OPTIONS.map((t) => (
                  <Pressable key={t} onPress={() => setTimeLabel(t)} style={[styles.formChip, timeLabel === t && styles.chipActive]}>
                    <Txt style={{ color: timeLabel === t ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontSize: fontSize.sm }}>{t}</Txt>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Anything else to know? (optional)"
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
              />

              <Button
                label="Plan it"
                onPress={submit}
                loading={posting}
                disabled={!title.trim() || (!venueName || (venueName === "__custom__" && !customVenue.trim()))}
              />
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
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.xl },
  chipsRow: { gap: spacing.sm, paddingRight: spacing.lg, alignItems: "flex-start" },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  catChipActive: { backgroundColor: colors.surfaceSecondary },
  meetupCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  catDot: { width: 10, height: 10, borderRadius: 5 },
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
    maxHeight: "90%",
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
  venueRow: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  venueRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary + "30" },
  venueIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
