import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

type TopicKey = "sleep" | "swaddle" | "bath" | "diaper";

const TOPICS: { key: TopicKey; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "sleep", label: "Safe sleep", icon: "moon" },
  { key: "swaddle", label: "Swaddling", icon: "gift" },
  { key: "bath", label: "Bathing", icon: "droplet" },
  { key: "diaper", label: "Diapers", icon: "package" },
];

function Point({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.point}>
      <View style={styles.dot} />
      <Txt style={styles.pointText}>{children}</Txt>
    </View>
  );
}

export default function NewbornBasics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [topic, setTopic] = useState<TopicKey>("sleep");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Newborn basics</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
            General guidance, not a substitute for your pediatrician
          </Txt>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {TOPICS.map((t) => (
          <Pressable
            key={t.key}
            testID={`newborn-topic-${t.key}`}
            onPress={() => setTopic(t.key)}
            style={[styles.tab, topic === t.key && styles.tabActive]}
          >
            <Feather name={t.icon} size={15} color={topic === t.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            <Txt style={{ color: topic === t.key ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontSize: fontSize.sm }}>
              {t.label}
            </Txt>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {topic === "sleep" && (
          <>
            <Card style={styles.urgentCard}>
              <Feather name="alert-circle" size={18} color="#B23B3B" />
              <Txt style={{ flex: 1, fontSize: fontSize.sm, color: "#7A2A2A" }}>
                Safe sleep habits are one of the most effective ways to reduce SIDS risk. These come directly
                from current AAP guidance.
              </Txt>
            </Card>
            <Point>Back sleep, every single sleep, naps included, until your baby turns 1. Side and stomach are not safe positions, even for naps.</Point>
            <Point>A firm, flat surface in their own crib or bassinet. Nothing at an incline over 10 degrees.</Point>
            <Point>No bed-sharing, under any circumstances. Room-sharing (their crib in your room) for at least 6 months, ideally 12, does reduce risk and makes night feeds easier too.</Point>
            <Point>Keep the sleep space bare: no pillows, loose blankets, bumpers, stuffed animals, or weighted products of any kind.</Point>
            <Point>A sleep sack (a wearable blanket) is the safe way to keep them warm, instead of a loose blanket.</Point>
            <Point>Car seats, swings, strollers, and carriers are fine for supervised awake time, but aren't safe for routine sleep.</Point>
          </>
        )}

        {topic === "swaddle" && (
          <>
            <Card style={styles.urgentCard}>
              <Feather name="alert-circle" size={18} color="#B23B3B" />
              <Txt style={{ flex: 1, fontSize: fontSize.sm, color: "#7A2A2A" }}>
                Stop swaddling for sleep the moment your baby shows any sign of rolling, usually around 2
                months. A swaddled baby who rolls onto their stomach can't push back up, which is genuinely
                dangerous.
              </Txt>
            </Card>
            <Point>Snug around the chest and arms is fine, but you should be able to fit 2-3 fingers between the swaddle and their chest.</Point>
            <Point>Leave plenty of room at the hips and legs so they can bend up and out, like a natural frog position. Swaddling the legs too straight and tight raises the risk of hip dysplasia.</Point>
            <Point>Once rolling starts, either stop swaddling for sleep entirely, or switch to a sleep sack that leaves arms free, so they can push themselves up if they roll.</Point>
            <Point>A swaddled baby still goes on their back to sleep, every time, same as an unswaddled one.</Point>
          </>
        )}

        {topic === "bath" && (
          <>
            <Point>Sponge baths only until the umbilical cord stump falls off on its own, usually within 1-3 weeks, and until any circumcision has healed.</Point>
            <Point>Newborns don't need a daily bath. 2-3 times a week is genuinely enough, more than that can dry out their skin.</Point>
            <Point>Water should feel warm, not hot, on the inside of your wrist, roughly body temperature.</Point>
            <Point>Never leave your baby alone in or near water, even for a few seconds to grab a towel. If you have to answer the door, take them with you.</Point>
            <Point>Support their head and neck the entire time, they can't hold it up on their own yet.</Point>
            <Point>A soft washcloth over their body helps them feel secure and stay a bit warmer during the bath.</Point>
          </>
        )}

        {topic === "diaper" && (
          <>
            <Point>Wipe front to back, every time. This matters most for girls, to help avoid urinary tract infections.</Point>
            <Point>A thin layer of barrier cream (zinc oxide based) can help if skin looks irritated, or as a routine preventive step.</Point>
            <Point>Until the umbilical cord stump falls off, fold the front of the diaper down below it so it stays dry and exposed to air.</Point>
            <Point>Newborns can go through 8-12 diapers a day in the first weeks, that's normal, not a sign anything's wrong.</Point>
            <Point>Worth a call to your pediatrician: a rash that doesn't improve after a couple days of barrier cream, blistering, or a fever alongside a rash.</Point>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  urgentCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: "#F7E4E4",
    borderColor: "#E3B3B3",
    marginBottom: spacing.md,
  },
  point: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand,
    marginTop: 8,
  },
  pointText: {
    flex: 1,
    fontSize: fontSize.base,
    lineHeight: 22,
    color: colors.onSurface,
  },
});
