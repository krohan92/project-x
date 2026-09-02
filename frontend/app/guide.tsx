import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

type Item = { title: string; body: string; icon: keyof typeof Feather.glyphMap };
type Section = { tab: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    tab: "Today",
    items: [
      { title: "Daily thought", body: "A different gentle quote each time you open the app, meant to meet you wherever today actually is.", icon: "sun" },
      { title: "Daily check-in", body: "How you're feeling, energy, sleep, and what's present for you, in under a minute.", icon: "smile" },
      { title: "Talk to Cuddle & Wellbeing check", body: "Quick links into the AI companion and a validated self-check-in.", icon: "grid" },
    ],
  },
  {
    tab: "Nearby",
    items: [
      { title: "Wave", body: "Tap to let other moms nearby know you're up too. Your location is deliberately blurred, never exact or real-time.", icon: "radio" },
      { title: "Matching preference", body: "Optionally share your cultural background to shape what shows up for you elsewhere in the app, like Cultural Circles.", icon: "sliders" },
    ],
  },
  {
    tab: "Track",
    items: [
      { title: "Live sleep timers", body: "Start baby's nap with one tap, stop it when they wake. More accurate than guessing a duration after the fact, and it teaches the nap predictions below.", icon: "play-circle" },
      { title: "\"I'm going to rest too\"", body: "A timer for your own rest, not just baby's. Your partner sees it happening live, if you're on Tag Team together.", icon: "moon" },
      { title: "Since last...", body: "At a glance: how long since baby last fed, had a wet or dirty diaper, or slept.", icon: "clock" },
      { title: "Predictions", body: "Once there's enough of baby's own pattern logged, you'll see roughly when the next feed, nap, or diaper change is likely.", icon: "trending-up" },
      { title: "Tag Team", body: "Link up with your partner or a caregiver so Cuddle can gently nudge when it's a good time to switch off, based on real hours on duty and how things are going, not just a guess.", icon: "refresh-cw" },
      { title: "SOS", body: "One tap, no calling, notifies your partner right now. Shows once you're on duty in a set-up Tag Team household.", icon: "alert-circle" },
      { title: "Voice logging", body: "In Talk to Cuddle, just say it: \"log a 4oz feed,\" \"baby's going to sleep,\" \"I'm going to bed,\" \"I'm up.\"", icon: "mic" },
      { title: "Newborn basics", body: "Clear, current guidance on safe sleep, swaddling, bathing, and diapers.", icon: "shield" },
      { title: "Body recovery check-in", body: "Your own physical healing, not just baby's, including a report you can share with your provider.", icon: "activity" },
    ],
  },
  {
    tab: "Circle",
    items: [
      { title: "Community feed", body: "Share, vent, or read what other moms are going through.", icon: "message-circle" },
      { title: "Cultural Circles", body: "Opt-in spaces to connect with moms who share your background, based on the preference you set in Nearby.", icon: "users" },
    ],
  },
  {
    tab: "Meetups",
    items: [
      { title: "Real local spots", body: "Baby dates, mom dates, trail walks, matched to real parks and venues in your area.", icon: "map-pin" },
      { title: "Add your own area", body: "Don't see your city listed? Tap \"My area isn't listed\" when creating a meetup and add it, it'll be there for other moms nearby too.", icon: "plus-circle" },
    ],
  },
  {
    tab: "Care",
    items: [
      { title: "Postpartum Support", body: "A real, verified directory of local lactation consultants, doulas, pelvic floor PT, and mental health support, with actual numbers to call.", icon: "phone" },
      { title: "Dinner Bell", body: "Set up a meal train and share one link, no one needs the app to sign up and bring you dinner.", icon: "coffee" },
      { title: "Give & Share", body: "A free/low-cost marketplace to pass along or find baby items nearby.", icon: "gift" },
      { title: "Dad's Corner", body: "A screener and space made for the partner's side of this too, not just mom's.", icon: "heart" },
      { title: "Mama's Calendar", body: "Scan an invitation or appointment card and Cuddle pulls out the date, time, and location automatically.", icon: "calendar" },
      { title: "Delete My Data", body: "Permanently removes your profile, logs, posts, and messages, right away, any time you want.", icon: "trash-2" },
    ],
  },
];

export default function Guide() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [openTab, setOpenTab] = useState<string | null>("Today");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>What's in Cuddle</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>A quick guide to every tab, tap a section to open it</Txt>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {SECTIONS.map((section) => {
          const open = openTab === section.tab;
          return (
            <View key={section.tab} style={{ marginBottom: spacing.md }}>
              <Pressable
                testID={`guide-tab-${section.tab.toLowerCase()}`}
                onPress={() => setOpenTab(open ? null : section.tab)}
                style={styles.tabHeader}
              >
                <Txt display style={{ fontSize: fontSize.lg }}>{section.tab}</Txt>
                <Feather name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
              </Pressable>
              {open && section.items.map((item) => (
                <Card key={item.title} style={styles.itemCard}>
                  <View style={styles.itemIcon}>
                    <Feather name={item.icon} size={16} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt weight="500" style={{ fontSize: fontSize.base }}>{item.title}</Txt>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm, lineHeight: 19, marginTop: 2 }}>
                      {item.body}
                    </Txt>
                  </View>
                </Card>
              ))}
            </View>
          );
        })}
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
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "40",
    alignItems: "center",
    justifyContent: "center",
  },
});
