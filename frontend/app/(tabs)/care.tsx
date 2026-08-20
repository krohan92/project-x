import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { Txt, Card } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT } from "@/src/lib/i18n";
import { storage } from "@/src/utils/storage";

export default function Care() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId } = useProfile();
  const { t } = useT();
  const [deleting, setDeleting] = useState(false);

  const [helplines, setHelplines] = useState<any[]>([]);
  const [pumps, setPumps] = useState<any[]>([]);
  const [guides, setGuides] = useState<any[]>([]);

  // Cultural variants surface first ONLY if the user opted into cultural matching
  // and has a saved background.
  const culture =
    profile?.matching_preference === "similar" && profile?.ethnicity
      ? profile.ethnicity
      : undefined;

  const confirmDelete = () => {
    Alert.alert(
      "Delete all your data?",
      "This permanently removes your profile, baby logs, mood history, posts, and messages from Cuddle. Your Tag Team partner will keep their own data, but you'll be removed from the household. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", style: "destructive", onPress: finalConfirmDelete },
      ]
    );
  };

  const finalConfirmDelete = () => {
    if (Alert.prompt) {
      Alert.prompt(
        "Type DELETE to confirm",
        "This is the last step — it cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete everything", style: "destructive", onPress: (text?: string) => text === "DELETE" && doDelete() },
        ],
        "plain-text"
      );
    } else {
      doDelete(); // Android has no Alert.prompt — the first confirm above is the safeguard there.
    }
  };

  const doDelete = async () => {
    if (!deviceId) return;
    setDeleting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await api.deleteAccount(deviceId);
      await storage.removeItem("cuddle_device_id");
      await storage.removeItem("app_lang");
      await storage.removeItem("last_ambient_tint");
      await storage.removeItem("meal_slot_tokens");
      router.replace("/onboarding");
    } catch {
      Alert.alert("Something went wrong", "Couldn't delete your data just now — check your connection and try again.");
    }
    setDeleting(false);
  };

  useEffect(() => {
    api.helplines().then(setHelplines).catch(() => {});
    api.pumpProviders().then(setPumps).catch(() => {});
    api.guides(culture).then(setGuides).catch(() => {});
  }, [culture]);

  const call = (detail: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const num = detail.replace(/[^0-9]/g, "");
    if (num) Linking.openURL(`tel:${num}`);
  };

  const openUrl = (url: string) => {
    Haptics.selectionAsync();
    Linking.openURL(url);
  };

  const crisis = helplines.filter((h) => h.type === "crisis");
  const support = helplines.filter((h) => h.type !== "crisis");

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={styles.title}>Care & Support</Txt>
        <Txt style={{ color: colors.muted }}>You are never alone in this</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
      >
        {/* Practical support */}
        <Txt display style={styles.sectionTitle}>Practical support</Txt>
        <Pressable testID="care-meal-train" onPress={() => router.push("/meals")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: colors.brandTertiary + "50" }]}>
              <Feather name="coffee" size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Dinner Bell</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Let people bring you food — share a link, no app needed on their end
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-recovery" onPress={() => router.push("/recovery")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: "#E3B3B3" + "60" }]}>
              <Feather name="activity" size={20} color="#B23B3B" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Body recovery check-in</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                How you're healing — not just the baby
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-support-directory" onPress={() => router.push("/support-directory")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: "#93B4D6" + "40" }]}>
              <Feather name="heart" size={20} color="#4C6E8F" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Postpartum Support</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Real lactation, doula, PT, and therapy contacts nearby
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-yoga" onPress={() => router.push("/yoga")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: "#B08FC7" + "40" }]}>
              <Feather name="sunrise" size={20} color="#7B5C96" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Postpartum Yoga</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Gentle guided routines, a few minutes at a time
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-celebrations" onPress={() => router.push("/celebrations")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: "#D68C7A" + "40" }]}>
              <Feather name="gift" size={20} color="#B5624E" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Mama's Calendar</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Birthdays, showers, appointments — scan a flyer or add manually
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-full-agenda" onPress={() => router.push("/cuddle-calendar")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: "#93B4D6" + "40" }]}>
              <Feather name="calendar" size={20} color="#4C6E8F" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Full Agenda</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Mama's Calendar and Meetups, together in one timeline
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-give-share" onPress={() => router.push("/shop")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: colors.brandSecondary + "40" }]}>
              <Feather name="gift" size={20} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Give & Share</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Free & low-cost baby things, mom to mom
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="care-dad-corner" onPress={() => router.push("/dad-corner")}>
          <Card style={styles.rowCard}>
            <View style={[styles.iconBubble, { backgroundColor: "#93B4D6" + "50" }]}>
              <Feather name="user" size={20} color="#4C6E8F" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Dad's Corner</Txt>
              <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>
                Postpartum support isn't just for moms
              </Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>

        {/* Crisis */}
        <Txt display style={styles.sectionTitle}>If you need help right now</Txt>
        {crisis.map((h) => (
          <Pressable key={h.name} testID={`crisis-${h.name}`} onPress={() => call(h.detail)}>
            <Card style={styles.crisisCard}>
              <View style={styles.crisisIcon}>
                <Feather name="phone-call" size={22} color={colors.onError} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="500" style={{ color: colors.onSurface, fontSize: fontSize.lg }}>{h.name}</Txt>
                <Txt style={{ color: colors.error }} weight="500">{h.detail}</Txt>
                <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>{h.note}</Txt>
              </View>
            </Card>
          </Pressable>
        ))}

        {/* Support lines */}
        <Txt display style={styles.sectionTitle}>Maternal mental health support</Txt>
        {support.map((h) => (
          <Pressable key={h.name} testID={`support-${h.name}`} onPress={() => call(h.detail)}>
            <Card style={styles.rowCard}>
              <View style={[styles.iconBubble, { backgroundColor: colors.brandSecondary + "40" }]}>
                <Feather name="phone" size={20} color={colors.onBrandSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="500" style={{ fontSize: fontSize.lg }}>{h.name}</Txt>
                <Txt style={{ color: colors.brand }}>{h.detail}</Txt>
                <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm, marginTop: 2 }}>{h.note}</Txt>
              </View>
            </Card>
          </Pressable>
        ))}

        {/* Guides & Resources (culturally-aware) */}
        <Txt display style={styles.sectionTitle}>{t("care.guides")}</Txt>
        {culture && (
          <View style={styles.culturalNote}>
            <Feather name="globe" size={14} color={colors.onBrandTertiary} />
            <Txt style={{ color: colors.onBrandTertiary, fontSize: fontSize.sm, flex: 1 }}>
              {t("care.culturalFirst")}
            </Txt>
          </View>
        )}
        {guides.map((g) => (
          <Card key={g.id} style={styles.guideCard} testID={`guide-${g.id}`}>
            <Txt style={styles.guideTopic}>{g.topic.toUpperCase()}</Txt>
            {g.featured_variant ? (
              <>
                <View style={styles.variantTag}>
                  <Feather name="star" size={12} color={colors.onBrandTertiary} />
                  <Txt style={{ color: colors.onBrandTertiary, fontSize: 11 }}>{g.featured_variant.culture}</Txt>
                </View>
                <Txt display style={styles.guideTitle}>{g.featured_variant.title}</Txt>
                <Txt style={styles.guideBody}>{g.featured_variant.body}</Txt>
                <Txt style={styles.guideMore}>{g.title}</Txt>
                <Txt style={styles.guideBodyMuted}>{g.body}</Txt>
              </>
            ) : (
              <>
                <Txt display style={styles.guideTitle}>{g.title}</Txt>
                <Txt style={styles.guideBody}>{g.body}</Txt>
              </>
            )}
          </Card>
        ))}

        {/* Breast pumps */}
        <Txt display style={styles.sectionTitle}>Breast pumps through insurance</Txt>
        <Txt style={styles.sectionSub}>
          Under the ACA, most U.S. insurance plans cover a breast pump at no cost. These
          providers handle the insurance paperwork for you.
        </Txt>
        {pumps.map((p) => (
          <Pressable key={p.name} testID={`pump-${p.name}`} onPress={() => openUrl(p.url)}>
            <Card style={styles.pumpCard}>
              <View style={styles.pumpHead}>
                <Txt weight="500" style={{ fontSize: fontSize.lg, flex: 1 }}>{p.name}</Txt>
                <View style={styles.tag}>
                  <Txt style={{ color: colors.onBrandTertiary, fontSize: 11 }}>{p.tag}</Txt>
                </View>
              </View>
              <Txt style={{ color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 21 }}>{p.detail}</Txt>
              <View style={styles.coverageRow}>
                <Feather name="shield" size={14} color={colors.success} />
                <Txt style={{ color: colors.onSurfaceTertiary, fontSize: fontSize.sm }}>{p.coverage}</Txt>
                <View style={{ flex: 1 }} />
                <Feather name="external-link" size={16} color={colors.brand} />
              </View>
            </Card>
          </Pressable>
        ))}

        {/* Your info */}
        {profile && (
          <>
            <Txt display style={styles.sectionTitle}>Your profile</Txt>
            <Card>
              <Row label="Name" value={profile.name} />
              {profile.baby_name ? <Row label="Baby" value={profile.baby_name} /> : null}
              <Row label="Children" value={String(profile.num_children)} />
              {profile.delivery_type ? <Row label="Delivery" value={profile.delivery_type} /> : null}
              {profile.feeding_method ? <Row label="Feeding" value={profile.feeding_method} /> : null}
              {profile.support_level ? <Row label="Support" value={profile.support_level} /> : null}
            </Card>
          </>
        )}

        <View style={styles.disclaimer}>
          <Feather name="info" size={16} color={colors.muted} />
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm, flex: 1, lineHeight: 19 }}>
            Cuddle provides emotional support and educational information only. It is not a
            medical service and does not diagnose or treat any condition. Always consult your
            healthcare provider for medical concerns.
          </Txt>
        </View>

        <Pressable testID="care-privacy-link" onPress={() => router.push("/privacy")} style={{ alignItems: "center", marginTop: spacing.md }}>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm, textDecorationLine: "underline" }}>
            Privacy Policy
          </Txt>
        </Pressable>

        <Pressable
          testID="care-delete-account"
          onPress={confirmDelete}
          disabled={deleting}
          style={{ alignItems: "center", marginTop: spacing.lg, paddingVertical: spacing.sm }}
        >
          <Txt style={{ color: colors.error, fontSize: fontSize.sm }}>
            {deleting ? "Deleting..." : "Delete My Data"}
          </Txt>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Txt style={{ color: colors.muted }}>{label}</Txt>
      <Txt weight="500">{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize["2xl"] },
  sectionTitle: { fontSize: fontSize.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionSub: { color: colors.onSurfaceTertiary, lineHeight: 22, marginBottom: spacing.md },
  crisisCard: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    backgroundColor: colors.error + "18",
    borderColor: colors.error + "50",
    marginBottom: spacing.md,
  },
  crisisIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCard: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginBottom: spacing.md },
  iconBubble: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  pumpCard: { marginBottom: spacing.md },
  pumpHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tag: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  coverageRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  disclaimer: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
  },
  culturalNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary + "50",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  guideCard: { marginBottom: spacing.md },
  guideTopic: { color: colors.muted, fontSize: 10, letterSpacing: 1.5, marginBottom: spacing.sm },
  variantTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  guideTitle: { fontSize: fontSize.lg, marginBottom: 4 },
  guideBody: { color: colors.onSurfaceTertiary, lineHeight: 22 },
  guideMore: { fontSize: fontSize.base, marginTop: spacing.md, color: colors.onSurfaceSecondary },
  guideBodyMuted: { color: colors.muted, lineHeight: 20, marginTop: 2, fontSize: fontSize.sm },
});
