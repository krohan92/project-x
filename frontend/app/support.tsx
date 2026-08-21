import React from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

const SUPPORT_EMAIL = "rohankhanna1992@gmail.com";

function H2({ children }: { children: string }) {
  return <Txt display style={styles.h2}>{children}</Txt>;
}
function P({ children }: { children: React.ReactNode }) {
  return <Txt style={styles.p}>{children}</Txt>;
}

export default function Support() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Txt display style={{ fontSize: fontSize.xl }}>Support</Txt>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <P>
          Cuddle is built and supported by an individual developer. If something isn't working
          right, you have a question, or there's anything at all you'd like help with, the fastest
          way to reach a real person is directly by email.
        </P>

        <Pressable
          testID="support-email-button"
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Cuddle Support`)}
          style={styles.emailCard}
        >
          <Feather name="mail" size={20} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Txt weight="500" style={{ fontSize: fontSize.lg }}>{SUPPORT_EMAIL}</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Tap to open in your mail app</Txt>
          </View>
          <Feather name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

        <H2>Common Questions</H2>

        <Txt style={styles.h3}>How do I delete my data?</Txt>
        <P>
          Go to the Care tab in the app and tap "Delete My Data" near the bottom. This permanently
          removes your profile, logs, posts, and messages right away. No need to email for this
          one, though you're welcome to if you run into any trouble with it.
        </P>

        <Txt style={styles.h3}>Is Cuddle a medical service?</Txt>
        <P>
          No. Cuddle offers emotional support and general educational information, but it doesn't
          diagnose, treat, or replace your doctor, midwife, or therapist. If something feels
          medically urgent, please contact your healthcare provider or emergency services directly.
        </P>

        <Txt style={styles.h3}>How do I report a bug or suggest a feature?</Txt>
        <P>
          Email the address above with as much detail as you can: what you were doing, what you
          expected to happen, and what happened instead. Screenshots help a lot.
        </P>

        <Txt style={styles.h3}>How do Tag Team invites work?</Txt>
        <P>
          From the Track & Team tab, tap "Start a household" to get a 6-character code, or text the
          invite link directly to your partner or caregiver. They don't need to create an account,
          just enter the code when they open the app.
        </P>

        <H2>Response Time</H2>
        <P>
          This is currently a one-person project, so please allow a few days for a reply,
          especially for non-urgent questions. Thank you for your patience.
        </P>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  h2: { fontSize: fontSize.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  h3: { fontSize: fontSize.base, marginTop: spacing.md, marginBottom: 4, color: colors.onSurface },
  p: { color: colors.onSurface, lineHeight: 21, marginBottom: spacing.sm },
  emailCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
});
