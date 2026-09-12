import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { isNightTime } from "@/src/lib/night";

// A small set of original warm gradients — rotates together with the quote
// so the whole card feels genuinely different each time, not just the text.
// No external hotlinked image, so no licensing risk and no load delay.
const HERO_GRADIENTS: [string, string, string][] = [
  ["#E8B4A0", "#D68C7A", "#B5624E"], // coral sunrise
  ["#C9A8D4", "#A985BD", "#7B5C96"], // dusky lavender
  ["#F0C987", "#D9A05B", "#B5764A"], // golden hour
  ["#9FC4C7", "#6FA3A8", "#4C6E8F"], // soft teal dusk
  ["#E8A9BC", "#C97F8E", "#8F4E5E"], // rose warmth
  ["#B8C99A", "#8FA876", "#5E7A4A"], // sage morning
];

const MOOD_GRADIENTS: [string, string][] = [
  ["#B9C4CE", "#98A6B3"],
  ["#B7C6D6", "#9FB6CC"],
  ["#D9CBB8", "#CBB495"],
  ["#E8B9A0", "#E39A78"],
  ["#EFA98D", "#E8825C"],
];

// The "you checked in today" message now reflects what she actually logged.
function checkinReflection(entry: any): string {
  const mood = entry?.mood as number | undefined;
  const tags: string[] = entry?.tags || [];
  if (tags.includes("Overwhelmed") || mood === 1) {
    return "Today sounded like a lot. Be extra gentle with yourself right now.";
  }
  if (tags.includes("Tired") || (entry?.sleep_hours != null && entry.sleep_hours <= 4)) {
    return "Running on little sleep today — even a short rest counts.";
  }
  if (mood === 2) {
    return "A harder day. Thank you for showing up for yourself anyway.";
  }
  if (mood === 5 || tags.includes("Grateful") || tags.includes("Proud")) {
    return "Sounds like a good one — hold onto this feeling for later.";
  }
  return "Thank you for taking a moment for yourself today.";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useProfile();

  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null);
  const [heroGradient, setHeroGradient] = useState(0);
  const [weeklyInsight, setWeeklyInsight] = useState<string | null>(null);
  const [tips, setTips] = useState<any[]>([]);
  const [todayMood, setTodayMood] = useState<any | null>(null);
  const [checkedToday, setCheckedToday] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [apptDismissed, setApptDismissed] = useState(false);
  const [ateToday, setAteToday] = useState<boolean | null>(null);
  const [mealCheckDone, setMealCheckDone] = useState(true);
  const [encouragement, setEncouragement] = useState<any | null>(null);

  const daysSinceDelivery = profile?.delivery_date
    ? Math.floor((Date.now() - new Date(profile.delivery_date).getTime()) / 86400000)
    : null;
  const showApptReminder =
    !profile?.postpartum_appt_done &&
    !apptDismissed &&
    daysSinceDelivery != null &&
    daysSinceDelivery >= 38 &&
    daysSinceDelivery <= 70;

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [q, t, mt, meal] = await Promise.all([
        api.quote(),
        api.tips(),
        api.moodToday(profile.device_id),
        api.mealCheckinToday(profile.device_id),
      ]);
      setQuote(q);
      setHeroGradient(Math.floor(Math.random() * HERO_GRADIENTS.length));
      setTips(t);
      setCheckedToday(mt.done);
      setTodayMood(mt.entry);
      setMealCheckDone(meal.done);
      setAteToday(meal.entry?.ate_today ?? null);
    } catch {}
    try {
      const insight = await api.weeklyInsights(profile.device_id);
      setWeeklyInsight(insight?.reflection || null);
    } catch {}
    api.latestEncouragement(profile.device_id).then(setEncouragement).catch(() => {});
    api.wellbeingSelfCheck(profile.device_id).catch(() => {});
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const markApptDone = async () => {
    if (!profile?.device_id) return;
    await api.updateAppointment(profile.device_id, true);
    setApptDismissed(true);
  };

  const markAteToday = async (ate: boolean) => {
    if (!profile?.device_id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await api.mealCheckin(profile.device_id, ate);
    setMealCheckDone(true);
    setAteToday(ate);
  };

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View>
          <Txt style={styles.headerDate}>{dateStr}</Txt>
          <Txt display style={styles.headerGreeting}>
            {greeting()}{profile?.name ? `, ${profile.name}` : ""}
          </Txt>
        </View>
        <Pressable
          testID="breathe-button"
          onPress={() => router.push("/breathe")}
          style={styles.breatheBtn}
        >
          <Feather name="wind" size={20} color={colors.onBrandSecondary} />
          <Txt style={{ color: colors.onBrandSecondary, fontSize: fontSize.sm }}>Breathe</Txt>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {/* Hero quote — or, late at night, a quieter invitation instead */}
        {isNightTime() ? (
          <Animated.View entering={FadeInDown.duration(500)}>
            <Pressable testID="night-light-cta" onPress={() => router.push("/night-light")}>
              <View style={styles.nightHero}>
                <LinearGradient
                  colors={["#211E2C", "#2B2438", "#332B47"]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.heroContent}>
                  <Txt style={styles.nightKicker}>IT'S LATE</Txt>
                  <Txt display style={styles.nightTitle}>
                    Awake with the baby? There's a quiet place for that.
                  </Txt>
                  <View style={styles.nightCta}>
                    <Feather name="star" size={14} color="#F3D9A4" />
                    <Txt style={styles.nightCtaText}>Open Night Light</Txt>
                  </View>
                </View>
              </View>
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(500)}>
            <View style={styles.hero} testID="daily-quote-card">
              <LinearGradient
                colors={HERO_GRADIENTS[heroGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={["rgba(44,41,37,0.1)", "rgba(44,41,37,0.55)", "rgba(44,41,37,0.9)"]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.heroContent}>
                <Txt style={styles.heroKicker}>A THOUGHT FOR TODAY</Txt>
                <Txt display style={styles.heroQuote}>
                  {quote ? `"${quote.text}"` : "Loading a gentle thought..."}
                </Txt>
                {quote && <Txt style={styles.heroAuthor}>— {quote.author}</Txt>}
              </View>
            </View>
          </Animated.View>
        )}

        {encouragement && (
          <Animated.View entering={FadeInDown.duration(500)}>
            <Card style={styles.encouragementCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs }}>
                <Feather name="heart" size={16} color={colors.brand} />
                <Txt style={{ color: colors.brand, fontSize: fontSize.sm }} weight="500">SOMEONE'S THINKING OF YOU</Txt>
              </View>
              <Txt style={{ fontSize: fontSize.lg, color: colors.onSurface, fontStyle: "italic" }}>
                "{encouragement.message}"
              </Txt>
              <Pressable
                testID="encouragement-dismiss"
                onPress={async () => {
                  if (!profile) return;
                  await api.markEncouragementSeen(profile.device_id);
                  setEncouragement(null);
                }}
                style={{ alignSelf: "flex-end", marginTop: spacing.sm }}
              >
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Dismiss</Txt>
              </Pressable>
            </Card>
          </Animated.View>
        )}

        {/* Mood check-in */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)}>
          {checkedToday && todayMood ? (
            <Card style={styles.moodDone} testID="mood-done-card">
              <LinearGradient
                colors={MOOD_GRADIENTS[(todayMood.mood || 1) - 1]}
                style={styles.moodDoneBlob}
              />
              <View style={{ flex: 1 }}>
                <Txt display style={{ fontSize: fontSize.xl }}>You checked in today</Txt>
                <Txt style={{ color: colors.onSurfaceTertiary, marginTop: 2 }}>
                  {checkinReflection(todayMood)}
                </Txt>
              </View>
              <Pressable onPress={() => router.push("/checkin")} hitSlop={10} testID="update-mood-button">
                <Feather name="edit-2" size={18} color={colors.brand} />
              </Pressable>
            </Card>
          ) : (
            <Pressable testID="checkin-cta" onPress={() => router.push("/checkin")}>
              <Card style={styles.checkinCta}>
                <View style={{ flex: 1 }}>
                  <Txt display style={{ fontSize: fontSize.xl, color: colors.onBrandSecondary }}>
                    How are you feeling?
                  </Txt>
                  <Txt style={{ color: colors.onBrandSecondary, opacity: 0.8, marginTop: 4 }}>
                    A gentle 30-second daily check-in
                  </Txt>
                </View>
                <View style={styles.checkinArrow}>
                  <Feather name="arrow-right" size={22} color={colors.onBrandSecondary} />
                </View>
              </Card>
            </Pressable>
          )}
        </Animated.View>

        {/* Have you eaten today? */}
        {!mealCheckDone && (
          <Animated.View entering={FadeInDown.delay(120).duration(500)}>
            <Card style={styles.mealCard} testID="meal-checkin-card">
              <Feather name="coffee" size={20} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Txt weight="500">Have you eaten today?</Txt>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                  Easy to forget when you're this busy taking care of everyone else.
                </Txt>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable onPress={() => markAteToday(true)} style={styles.mealYesBtn}>
                  <Txt style={{ color: colors.onBrandPrimary, fontSize: fontSize.sm }} weight="500">Yes</Txt>
                </Pressable>
                <Pressable onPress={() => markAteToday(false)} style={styles.mealNoBtn}>
                  <Txt style={{ color: colors.onSurfaceSecondary, fontSize: fontSize.sm }}>Not yet</Txt>
                </Pressable>
              </View>
            </Card>
          </Animated.View>
        )}

        {/* 6-week postpartum appointment reminder */}
        {showApptReminder && (
          <Animated.View entering={FadeInDown.delay(150).duration(500)}>
            <Card style={styles.apptCard} testID="appt-reminder-card">
              <View style={[styles.linkIcon, { backgroundColor: "#E3B3B3" + "60" }]}>
                <Feather name="calendar" size={20} color="#B23B3B" />
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="500">Your postpartum check-up</Txt>
                <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                  Around 6 weeks out is when providers usually want to see you — worth booking if you haven't.
                </Txt>
                <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm }}>
                  <Pressable onPress={markApptDone}>
                    <Txt style={{ color: colors.brand, fontSize: fontSize.sm }} weight="500">I've done this</Txt>
                  </Pressable>
                  <Pressable onPress={() => setApptDismissed(true)}>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Remind me later</Txt>
                  </Pressable>
                </View>
              </View>
            </Card>
          </Animated.View>
        )}

        {/* Quick actions */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.quickRow}>
          <Pressable style={styles.quickCard} testID="quick-talk" onPress={() => router.push("/talk")}>
            <View style={[styles.quickIcon, { backgroundColor: colors.brandTertiary }]}>
              <Feather name="message-circle" size={22} color={colors.onBrandTertiary} />
            </View>
            <Txt weight="500">Talk to Cuddle</Txt>
            <Txt style={styles.quickSub}>Vent or ask anything, 24/7</Txt>
          </Pressable>
          <Pressable style={styles.quickCard} testID="quick-epds" onPress={() => router.push("/epds")}>
            <View style={[styles.quickIcon, { backgroundColor: colors.brandSecondary + "50" }]}>
              <Feather name="clipboard" size={22} color={colors.onBrandSecondary} />
            </View>
            <Txt weight="500">Wellbeing check</Txt>
            <Txt style={styles.quickSub}>A validated self-check-in</Txt>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(230).duration(500)}>
          <Pressable testID="quick-brain-notes" onPress={() => router.push("/brain-notes")}>
            <Card style={styles.brainBanner}>
              <Feather name="feather" size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Txt weight="500">Baby Brain Capture</Txt>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Jot it down before it's gone</Txt>
              </View>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        </Animated.View>

        {weeklyInsight && (
          <Animated.View entering={FadeInDown.delay(240).duration(500)}>
            <Card style={styles.insightCard} testID="weekly-insight-card">
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Feather name="trending-up" size={16} color={colors.brand} />
                <Txt weight="500" style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  YOUR WEEK, NOTICED
                </Txt>
              </View>
              <Txt style={{ color: colors.onSurface, lineHeight: 21, marginTop: spacing.sm }}>
                {weeklyInsight}
              </Txt>
            </Card>
          </Animated.View>
        )}

        {/* Tips */}
        <Txt display style={styles.sectionTitle}>Gentle care for today</Txt>
        {tips.map((t, i) => (
          <Animated.View key={t.title} entering={FadeInDown.delay(250 + i * 60).duration(500)}>
            <Card style={styles.tipCard} testID={`tip-${i}`}>
              <View style={styles.tipIcon}>
                <Feather name={t.icon} size={20} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt style={styles.tipCategory}>{t.category.toUpperCase()}</Txt>
                <Txt display style={{ fontSize: fontSize.lg, marginBottom: 4 }}>{t.title}</Txt>
                <Txt style={{ color: colors.onSurfaceTertiary, lineHeight: 21 }}>{t.body}</Txt>
              </View>
            </Card>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerDate: { color: colors.muted, fontSize: fontSize.sm },
  headerGreeting: { fontSize: fontSize["2xl"], marginTop: 2 },
  breatheBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  hero: {
    height: 220,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
    marginBottom: spacing.lg,
  },
  heroContent: { padding: spacing.xl },
  heroKicker: {
    color: colors.brandTertiary,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  heroQuote: {
    color: colors.onSurfaceInverse,
    fontSize: fontSize.xl,
    lineHeight: 28,
  },
  heroAuthor: { color: "rgba(253,251,247,0.75)", marginTop: spacing.sm },
  nightHero: {
    height: 190,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
    marginBottom: spacing.lg,
  },
  nightKicker: {
    color: "#F3D9A4",
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  nightTitle: {
    color: "rgba(253,251,247,0.92)",
    fontSize: fontSize.lg,
    lineHeight: 25,
  },
  nightCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  nightCtaText: { color: "#F3D9A4", fontSize: fontSize.sm, fontWeight: "600" as const },
  checkinCta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandSecondary,
    borderColor: colors.brandSecondary,
  },
  checkinArrow: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  encouragementCard: {
    backgroundColor: colors.brandTertiary + "30",
    borderColor: colors.brandTertiary,
    marginBottom: spacing.md,
  },
  moodDone: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  linkIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  apptCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: "#F7E4E4",
    borderColor: "#E3B3B3",
  },
  mealCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  mealYesBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  mealNoBtn: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brainBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  insightCard: {
    marginTop: spacing.md,
    backgroundColor: colors.brandTertiary + "20",
    borderColor: colors.brandTertiary + "50",
  },
  moodDoneBlob: { width: 44, height: 44, borderRadius: radius.pill },
  quickRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  quickCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 6,
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  quickSub: { color: colors.muted, fontSize: fontSize.sm },
  sectionTitle: { fontSize: fontSize["2xl"], marginTop: spacing.xl, marginBottom: spacing.md },
  tipCard: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  tipIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "60",
    alignItems: "center",
    justifyContent: "center",
  },
  tipCategory: { color: colors.muted, fontSize: 10, letterSpacing: 1.5, marginBottom: 2 },
});
