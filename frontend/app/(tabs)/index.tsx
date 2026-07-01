import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const HERO_BG =
  "https://images.unsplash.com/photo-1772984711070-5c7e0d54026b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHwyfHxzb2Z0JTIwd2F0ZXJjb2xvciUyMGFic3RyYWN0JTIwYmFja2dyb3VuZCUyMHdhcm0lMjBzdW5saWdodHxlbnwwfHx8fDE3ODI4NzI5OTh8MA&ixlib=rb-4.1.0&q=85";

const MOOD_EMOJI = ["😔", "😟", "😐", "🙂", "😊"];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useProfile();

  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null);
  const [tips, setTips] = useState<any[]>([]);
  const [todayMood, setTodayMood] = useState<any | null>(null);
  const [checkedToday, setCheckedToday] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [q, t, mt] = await Promise.all([
        api.quote(),
        api.tips(),
        api.moodToday(profile.device_id),
      ]);
      setQuote(q);
      setTips(t);
      setCheckedToday(mt.done);
      setTodayMood(mt.entry);
    } catch {}
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

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
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
        {/* Hero quote */}
        <Animated.View entering={FadeInDown.duration(500)}>
          <View style={styles.hero} testID="daily-quote-card">
            <Image source={HERO_BG} style={StyleSheet.absoluteFill} contentFit="cover" />
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

        {/* Mood check-in */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)}>
          {checkedToday && todayMood ? (
            <Card style={styles.moodDone} testID="mood-done-card">
              <Txt style={{ fontSize: 40 }}>{MOOD_EMOJI[(todayMood.mood || 1) - 1]}</Txt>
              <View style={{ flex: 1 }}>
                <Txt display style={{ fontSize: fontSize.xl }}>You checked in today</Txt>
                <Txt style={{ color: colors.onSurfaceTertiary, marginTop: 2 }}>
                  Thank you for taking a moment for yourself. 🤍
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

        {/* Quick actions */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.quickRow}>
          <Pressable style={styles.quickCard} testID="quick-talk" onPress={() => router.push("/talk")}>
            <View style={[styles.quickIcon, { backgroundColor: colors.brandTertiary }]}>
              <Feather name="message-circle" size={22} color={colors.onBrandTertiary} />
            </View>
            <Txt weight="500">Talk to Aura</Txt>
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
  moodDone: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
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
