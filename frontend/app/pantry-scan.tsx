import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Share, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import Animated, { FadeIn, Layout } from "react-native-reanimated";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";

type ScanResult = {
  identified_items: string[];
  suggested_recipe_id: string | null;
  suggested_recipe?: { id: string; title: string };
  have_ingredients: string[];
  missing_ingredients: string[];
};

export default function PantryScan() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [scanning, setScanning] = useState(false);
  const [matching, setMatching] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [seenRecipeIds, setSeenRecipeIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reset = () => {
    setResult(null);
    setSeenRecipeIds([]);
    setErrorMsg(null);
  };

  const scan = async (fromCamera: boolean) => {
    setErrorMsg(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg("Cuddle needs access to your camera or photos to scan your pantry.");
      return;
    }

    const launch = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const picked = await launch({ base64: true, quality: 0.6, allowsEditing: false });
    if (picked.canceled || !picked.assets?.[0]?.base64) return;

    setScanning(true);
    setResult(null);
    setSeenRecipeIds([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const draft = await api.homelyScanGroceries(picked.assets[0].base64, "image/jpeg");
      setResult(draft);
      if (draft.suggested_recipe?.id) setSeenRecipeIds([draft.suggested_recipe.id]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg("Couldn't read that photo clearly — try a brighter, closer shot of your shelves.");
    }
    setScanning(false);
  };

  const tryAnotherRecipe = async () => {
    if (!result) return;
    setMatching(true);
    setErrorMsg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const next = await api.homelyMatchRecipe(result.identified_items, seenRecipeIds);
      setResult((prev) => (prev ? { ...prev, ...next } : next));
      if (next.suggested_recipe?.id) {
        setSeenRecipeIds((prev) =>
          prev.includes(next.suggested_recipe.id) ? [next.suggested_recipe.id] : [...prev, next.suggested_recipe.id]
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg("Couldn't find another match just now, try again in a moment.");
    }
    setMatching(false);
  };

  const shareList = async () => {
    if (!result?.missing_ingredients?.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const title = result.suggested_recipe?.title ? ` for ${result.suggested_recipe.title}` : "";
    const listText = result.missing_ingredients.map((item) => `• ${item}`).join("\n");
    try {
      await Share.share({
        message: `Cuddle Cart${title}:\n\n${listText}`,
      });
    } catch (e) {
      // user dismissed the share sheet, nothing to do
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Txt display style={{ fontSize: fontSize.lg }}>
          Pantry Snap
        </Txt>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}
      >
        {!result && (
          <Animated.View entering={FadeIn}>
            <Card style={styles.introCard}>
              <View style={styles.introIcon}>
                <Feather name="camera" size={22} color={colors.brand} />
              </View>
              <Txt display style={{ fontSize: fontSize.lg, marginTop: spacing.sm }}>
                What's already in your kitchen?
              </Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs }}>
                Snap a photo of your pantry shelf or open fridge. Cuddle will match it to a real recipe
                and figure out exactly what you'd still need.
              </Txt>
            </Card>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable
                testID="pantry-scan-camera-button"
                onPress={() => scan(true)}
                style={styles.choiceCard}
                disabled={scanning}
              >
                {scanning ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Feather name="camera" size={20} color={colors.brand} />
                )}
                <View style={{ flex: 1 }}>
                  <Txt weight="500">Take a photo</Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Open the camera now</Txt>
                </View>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>

              <Pressable
                testID="pantry-scan-library-button"
                onPress={() => scan(false)}
                style={styles.choiceCard}
                disabled={scanning}
              >
                <Feather name="image" size={20} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Txt weight="500">Choose from photos</Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Already have a shot? Use that</Txt>
                </View>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {errorMsg && (
              <View style={styles.errorCard}>
                <Feather name="alert-circle" size={16} color={colors.error} />
                <Txt style={{ color: colors.onSurface, fontSize: fontSize.sm, flex: 1 }}>{errorMsg}</Txt>
              </View>
            )}
          </Animated.View>
        )}

        {result && (
          <Animated.View entering={FadeIn} style={{ gap: spacing.md }}>
            <Card>
              <Txt style={{ color: colors.muted, fontSize: fontSize.xs, letterSpacing: 0.5 }}>
                WHAT I SAW
              </Txt>
              <View style={styles.chipRow}>
                {result.identified_items.length === 0 ? (
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs }}>
                    Nothing food-related jumped out — want to try a clearer shot?
                  </Txt>
                ) : (
                  result.identified_items.map((item, i) => (
                    <View key={i} style={styles.chip}>
                      <Txt style={{ fontSize: fontSize.sm, color: colors.onSurfaceSecondary }}>{item}</Txt>
                    </View>
                  ))
                )}
              </View>
            </Card>

            {result.suggested_recipe ? (
              <>
                <Animated.View layout={Layout} key={result.suggested_recipe.id}>
                  <Card style={styles.recipeCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Txt style={{ color: colors.brand, fontSize: fontSize.xs, fontWeight: "700", letterSpacing: 0.5 }}>
                          RECIPE MATCHED
                        </Txt>
                        <Txt display style={{ fontSize: fontSize.lg, marginTop: spacing.xs }}>
                          {result.suggested_recipe.title}
                        </Txt>
                      </View>
                      <Pressable
                        testID="pantry-scan-try-another"
                        onPress={tryAnotherRecipe}
                        disabled={matching}
                        style={styles.refreshButton}
                        hitSlop={8}
                      >
                        {matching ? (
                          <ActivityIndicator size="small" color={colors.brand} />
                        ) : (
                          <Feather name="refresh-cw" size={16} color={colors.brand} />
                        )}
                      </Pressable>
                    </View>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.xs }}>
                      Tap the refresh icon for a different recipe from what you have
                    </Txt>
                  </Card>
                </Animated.View>

                <Card>
                  <Txt style={{ color: colors.success, fontSize: fontSize.xs, fontWeight: "700", letterSpacing: 0.5 }}>
                    YOU ALREADY HAVE
                  </Txt>
                  <View style={styles.chipRow}>
                    {result.have_ingredients.map((item, i) => (
                      <View key={i} style={[styles.chip, styles.chipHave]}>
                        <Feather name="check" size={12} color={colors.success} />
                        <Txt style={{ fontSize: fontSize.sm, color: colors.onSurfaceSecondary }}>{item}</Txt>
                      </View>
                    ))}
                  </View>
                </Card>

                <Card style={styles.cartCard}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                    <Feather name="shopping-bag" size={16} color={colors.warning} />
                    <Txt style={{ color: colors.warning, fontSize: fontSize.xs, fontWeight: "700", letterSpacing: 0.5 }}>
                      CUDDLE CART
                    </Txt>
                  </View>

                  {result.missing_ingredients.length === 0 ? (
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.sm }}>
                      Nothing to add — you've got everything for this one.
                    </Txt>
                  ) : (
                    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                      {result.missing_ingredients.map((item, i) => (
                        <View key={i} style={styles.cartRow}>
                          <View style={styles.cartDot} />
                          <Txt style={{ fontSize: fontSize.md, flex: 1 }}>{item}</Txt>
                        </View>
                      ))}
                    </View>
                  )}

                  {result.missing_ingredients.length > 0 && (
                    <Button
                      testID="pantry-scan-share-list"
                      label="Share your list"
                      onPress={shareList}
                      variant="secondary"
                      icon={<Feather name="share" size={18} color={colors.brand} />}
                      style={{ marginTop: spacing.md }}
                    />
                  )}
                </Card>
              </>
            ) : (
              <View style={styles.errorCard}>
                <Feather name="alert-circle" size={16} color={colors.error} />
                <Txt style={{ color: colors.onSurface, fontSize: fontSize.sm, flex: 1 }}>
                  Couldn't match this to one of our recipes yet — try another photo or angle.
                </Txt>
              </View>
            )}

            {errorMsg && (
              <View style={styles.errorCard}>
                <Feather name="alert-circle" size={16} color={colors.error} />
                <Txt style={{ color: colors.onSurface, fontSize: fontSize.sm, flex: 1 }}>{errorMsg}</Txt>
              </View>
            )}

            <Pressable onPress={reset} style={styles.rescanRow}>
              <Feather name="camera" size={16} color={colors.brand} />
              <Txt style={{ color: colors.brand, fontSize: fontSize.sm }}>Scan a different shelf</Txt>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  introCard: {
    alignItems: "flex-start",
  },
  introIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary + "40",
    alignItems: "center",
    justifyContent: "center",
  },
  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  chipHave: {
    backgroundColor: colors.success + "18",
    borderColor: colors.success,
  },
  recipeCard: {
    backgroundColor: colors.brandTertiary + "25",
    borderColor: colors.brandTertiary,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
  cartCard: {
    backgroundColor: colors.warning + "10",
    borderColor: colors.warning,
  },
  cartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cartDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warning,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: "#F7E4E4",
    borderWidth: 1,
    borderColor: "#E3B3B3",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rescanRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
});
