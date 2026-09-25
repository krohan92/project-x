import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import * as Localization from "expo-localization";
import { registerForPushNotifications } from "@/src/lib/push-notifications";
import { useProfile } from "@/src/lib/profile-context";

const BG =
  "https://images.unsplash.com/photo-1772984711142-af64d57dcba4?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHwzfHxzb2Z0JTIwd2F0ZXJjb2xvciUyMGFic3RyYWN0JTIwYmFja2dyb3VuZCUyMHdhcm0lMjBzdW5saWdodHxlbnwwfHx8fDE3ODI4NzI5OTh8MA&ixlib=rb-4.1.0&q=85";

const MOODS = ["😔", "😟", "😐", "🙂", "😊"];
const MOOD_LABELS = ["Struggling", "Low", "Okay", "Good", "Great"];

const FEATURE_CARDS: { title: string; body: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { title: "Tag Team", body: "Link up with your partner or a caregiver so it's not all in your head, whose turn it is or how tired everyone actually is.", icon: "refresh-cw", color: "#D68C7A" },
  { title: "Talk to Cuddle", body: "A warm companion for the 3am \"is this normal?\" moments, day or night. You can even just say things out loud to log them.", icon: "message-circle", color: "#7B5C96" },
  { title: "Meetups", body: "Real local parks and hangouts for a baby date, a mom date, or a walk with your stroller, matched to your actual area.", icon: "map-pin", color: "#4C6E8F" },
  { title: "Recovery", body: "Gentle daily check-ins on your own healing too, not just baby's, with a timeline for exactly where you are right now.", icon: "activity", color: "#B23B3B" },
  { title: "Real local support", body: "A verified directory of nearby lactation consultants, doulas, and postpartum specialists, with real numbers to call.", icon: "phone", color: "#5E7A4A" },
];

function OptionCard({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <Txt style={{ fontSize: fontSize.lg, color: selected ? colors.onSurface : colors.onSurfaceSecondary }} weight={selected ? "500" : "400"}>
        {label}
      </Txt>
      {selected && <Feather name="check" size={20} color={colors.brandPrimary} />}
    </Pressable>
  );
}

// Ounces are genuinely a US-specific convention for baby feeding amounts —
// virtually everywhere else (UK, India, everywhere) uses ml day to day.
// This is a real, defensible default, not a guess dressed up as one; she
// can still override it later if this ever gets a settings toggle.
function detectUnitSystem(): "oz" | "ml" {
  try {
    const regionCode = Localization.getLocales()?.[0]?.regionCode;
    return regionCode === "US" ? "oz" : "ml";
  } catch {
    return "oz";
  }
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const { deviceId, refresh } = useProfile();

  const [step, setStep] = useState(0);
  const [showFeatureIntro, setShowFeatureIntro] = useState(false);
  const [featureCard, setFeatureCard] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [babyName, setBabyName] = useState("");
  const [numChildren, setNumChildren] = useState(1);
  const [deliveryType, setDeliveryType] = useState<string | null>(null);
  const [birthExp, setBirthExp] = useState<string | null>(null);
  const [feeding, setFeeding] = useState<string | null>(null);
  const [support, setSupport] = useState<string | null>(null);
  const [weeksPostpartum, setWeeksPostpartum] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [concerns, setConcerns] = useState<string[]>([]);
  const [unitSystem, setUnitSystem] = useState<"oz" | "ml">(detectUnitSystem());

  const TOTAL = 9;

  const toggleConcern = (c: string) => {
    Haptics.selectionAsync();
    setConcerns((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const canNext = () => {
    switch (step) {
      case 1:
        return name.trim().length > 0;
      case 3:
        return !!deliveryType;
      case 4:
        return !!birthExp;
      case 5:
        return !!feeding;
      case 6:
        return !!support;
      case 7:
        return mood !== null;
      default:
        return true;
    }
  };

  const finish = async () => {
    if (saving) return; // guard against double-taps while a request is in flight
    if (!deviceId) {
      // deviceId should already be loaded by this point in the flow, but if
      // it somehow isn't, tell her instead of silently doing nothing.
      Alert.alert("One moment", "Still getting things ready. Please try again in a second.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const deliveryDate =
      weeksPostpartum != null
        ? new Date(Date.now() - weeksPostpartum * 7 * 86400000)
            .toISOString()
            .slice(0, 10)
        : null;
    try {
      await api.saveProfile({
        device_id: deviceId,
        name: name.trim(),
        baby_name: babyName.trim() || null,
        num_children: numChildren,
        delivery_type: deliveryType,
        delivery_date: deliveryDate,
        feeding_method: feeding,
        birth_experience: birthExp,
        support_level: support,
        initial_mood: mood,
        concerns,
        unit_system: unitSystem,
      });
      if (mood != null) {
        await api.addMood({ device_id: deviceId, mood, note: "First check-in" });
      }
      // Ask for notification permission right here, regardless of whether
      // she sets up Tag Team — this used to only fire for households with
      // a partner added, which meant solo users were never asked at all
      // and silently never received any push (proactive check-ins,
      // reminders, anything) for the entire life of the app.
      registerForPushNotifications(deviceId);
      await refresh();
      router.replace("/(tabs)");
    } catch (e: any) {
      setSaving(false);
      // Temporarily surfaces the real underlying error (network vs auth
      // vs a specific save that failed) instead of one generic message —
      // this is what actually lets us tell what's wrong next time,
      // rather than guessing blind from a screenshot again.
      const realError = e?.message || String(e);
      const msg = `Couldn't save just now. (${realError})`;
      setErrorMsg(msg);
      Alert.alert("Something went wrong", msg);
      console.log("onboarding save failed:", realError);
    }
  };

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 0) {
      setShowFeatureIntro(true);
      return;
    }
    if (step === TOTAL - 1) {
      finish();
    } else {
      setStep((s) => s + 1);
    }
  };

  // Brief feature highlight, shown once between the welcome screen and the
  // real setup questions. Kept to one screen with a skip option, since
  // most people skip long onboarding tours entirely; this is a taste, not
  // a tutorial.
  if (showFeatureIntro) {
    const enterSetup = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setShowFeatureIntro(false);
      setStep(1);
    };
    return (
      <View style={[styles.introScreen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable testID="feature-intro-skip" onPress={enterSetup} style={styles.introSkip}>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Skip</Txt>
        </Pressable>

        <Txt display style={styles.introTitle}>A few things worth knowing</Txt>

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width);
            setFeatureCard(idx);
          }}
          style={{ flexGrow: 0, marginHorizontal: -spacing.lg }}
        >
          {FEATURE_CARDS.map((card) => (
            <View key={card.title} style={[styles.introCardWrap, { width: screenWidth }]}>
              <View style={[styles.introIconBubble, { backgroundColor: card.color + "30" }]}>
                <Feather name={card.icon} size={28} color={card.color} />
              </View>
              <Txt display style={styles.introCardTitle}>{card.title}</Txt>
              <Txt style={styles.introCardBody}>{card.body}</Txt>
            </View>
          ))}
        </ScrollView>

        <View style={styles.introDots}>
          {FEATURE_CARDS.map((_, i) => (
            <View key={i} style={[styles.introDot, i === featureCard && styles.introDotActive]} />
          ))}
        </View>

        <Button testID="feature-intro-continue" label="Let's begin" onPress={enterSetup} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  // Welcome screen (full bleed)
  if (step === 0) {
    return (
      <View style={styles.welcome}>
        <Image source={BG} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(44,41,37,0.15)", "rgba(44,41,37,0.35)", "rgba(44,41,37,0.85)"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.welcomeContent, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Animated.View entering={FadeInDown.duration(700)}>
            <Txt style={styles.welcomeKicker}>CUDDLE · POSTPARTUM COMPANION</Txt>
            <Txt display style={styles.welcomeTitle}>
              Welcome, Mama.
            </Txt>
            <Txt style={styles.welcomeSub}>
              A gentle, private space to be heard, to check in with yourself, and
              to feel less alone, every hour of every day.
            </Txt>
          </Animated.View>
          <Animated.View entering={FadeIn.delay(400)}>
            <Button
              testID="onboarding-begin-button"
              label="Begin gently"
              onPress={next}
              style={{ marginTop: spacing.xl }}
            />
            <Txt style={styles.disclaimer}>
              Cuddle offers support and companionship. It is not medical care and
              does not replace your healthcare provider.
            </Txt>
          </Animated.View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingTop: insets.top + spacing.sm, flex: 1 }}>
        {/* Progress + back */}
        <View style={styles.topBar}>
          <Pressable
            testID="onboarding-back-button"
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(step / (TOTAL - 1)) * 100}%` }]} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.stepScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={step} entering={FadeInDown.duration(400)}>
            {step === 1 && (
              <>
                <Txt display style={styles.stepTitle}>What should we call you?</Txt>
                <Txt style={styles.stepSub}>Your space, your name. Nothing is shared.</Txt>
                <TextInput
                  testID="onboarding-name-input"
                  placeholder="Your name"
                  placeholderTextColor={colors.muted}
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                  returnKeyType="next"
                />
                <TextInput
                  testID="onboarding-baby-input"
                  placeholder="Baby's name (optional)"
                  placeholderTextColor={colors.muted}
                  value={babyName}
                  onChangeText={setBabyName}
                  style={styles.input}
                />
              </>
            )}

            {step === 2 && (
              <>
                <Txt display style={styles.stepTitle}>A little about your journey</Txt>
                <Txt style={styles.stepSub}>How many little ones do you have?</Txt>
                <View style={styles.counterRow}>
                  <Pressable
                    testID="children-minus"
                    onPress={() => setNumChildren((n) => Math.max(1, n - 1))}
                    style={styles.counterBtn}
                  >
                    <Feather name="minus" size={22} color={colors.onSurface} />
                  </Pressable>
                  <Txt display style={styles.counterValue}>{numChildren}</Txt>
                  <Pressable
                    testID="children-plus"
                    onPress={() => setNumChildren((n) => n + 1)}
                    style={styles.counterBtn}
                  >
                    <Feather name="plus" size={22} color={colors.onSurface} />
                  </Pressable>
                </View>
                <Txt style={[styles.stepSub, { marginTop: spacing.xl }]}>
                  How long ago did your youngest arrive?
                </Txt>
                <View style={styles.wrapRow}>
                  {[
                    { l: "This week", v: 1 },
                    { l: "2–4 weeks", v: 3 },
                    { l: "1–3 months", v: 8 },
                    { l: "3–6 months", v: 18 },
                    { l: "6–12 months", v: 36 },
                  ].map((o) => (
                    <Pressable
                      key={o.v}
                      testID={`weeks-${o.v}`}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setWeeksPostpartum(o.v);
                      }}
                      style={[styles.chip, weeksPostpartum === o.v && styles.chipSelected]}
                    >
                      <Txt style={{ color: weeksPostpartum === o.v ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                        {o.l}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {step === 3 && (
              <>
                <Txt display style={styles.stepTitle}>How did your baby arrive?</Txt>
                <Txt style={styles.stepSub}>There is no wrong answer here.</Txt>
                {["Vaginal birth", "C-section", "Vacuum-assisted", "Forceps-assisted", "Prefer not to say"].map((o) => (
                  <OptionCard
                    key={o}
                    testID={`delivery-${o}`}
                    label={o}
                    selected={deliveryType === o}
                    onPress={() => setDeliveryType(o)}
                  />
                ))}
              </>
            )}

            {step === 4 && (
              <>
                <Txt display style={styles.stepTitle}>How did the birth feel for you?</Txt>
                <Txt style={styles.stepSub}>Your experience matters as much as the outcome.</Txt>
                {["Mostly positive", "Mixed feelings", "Difficult", "Traumatic"].map((o) => (
                  <OptionCard
                    key={o}
                    testID={`birthexp-${o}`}
                    label={o}
                    selected={birthExp === o}
                    onPress={() => setBirthExp(o)}
                  />
                ))}
              </>
            )}

            {step === 5 && (
              <>
                <Txt display style={styles.stepTitle}>How are you feeding right now?</Txt>
                <Txt style={styles.stepSub}>Fed is best. However you do it is right.</Txt>
                {["Breastfeeding", "Formula", "Combination", "Pumping"].map((o) => (
                  <OptionCard
                    key={o}
                    testID={`feeding-${o}`}
                    label={o}
                    selected={feeding === o}
                    onPress={() => setFeeding(o)}
                  />
                ))}
              </>
            )}

            {step === 6 && (
              <>
                <Txt display style={styles.stepTitle}>How supported do you feel?</Txt>
                <Txt style={styles.stepSub}>This helps us tune how we care for you.</Txt>
                {["I have strong support", "I have some support", "I feel quite alone"].map((o) => (
                  <OptionCard
                    key={o}
                    testID={`support-${o}`}
                    label={o}
                    selected={support === o}
                    onPress={() => setSupport(o)}
                  />
                ))}
              </>
            )}

            {step === 7 && (
              <>
                <Txt display style={styles.stepTitle}>How are you feeling today?</Txt>
                <Txt style={styles.stepSub}>Just this moment. It can change tomorrow.</Txt>
                <View style={styles.moodRow}>
                  {MOODS.map((m, i) => (
                    <Pressable
                      key={i}
                      testID={`mood-${i + 1}`}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setMood(i + 1);
                      }}
                      style={[styles.moodItem, mood === i + 1 && styles.moodItemSelected]}
                    >
                      <Txt style={{ fontSize: 34 }}>{m}</Txt>
                    </Pressable>
                  ))}
                </View>
                {mood != null && (
                  <Txt style={styles.moodLabel} display>{MOOD_LABELS[mood - 1]}</Txt>
                )}
                <Txt style={[styles.stepSub, { marginTop: spacing.xl }]}>
                  Anything weighing on you? (optional)
                </Txt>
                <View style={styles.wrapRow}>
                  {["Sleep", "Anxiety", "Feeding", "Body recovery", "Loneliness", "Overwhelm", "Mood swings"].map((c) => (
                    <Pressable
                      key={c}
                      testID={`concern-${c}`}
                      onPress={() => toggleConcern(c)}
                      style={[styles.chip, concerns.includes(c) && styles.chipSelected]}
                    >
                      <Txt style={{ color: concerns.includes(c) ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                        {c}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {step === 8 && (
              <>
                <Txt display style={styles.stepTitle}>Quick check — where are you?</Txt>
                <Txt style={styles.stepSub}>
                  We guessed based on your device. This just decides whether amounts show in oz or ml — change it if it's wrong.
                </Txt>
                <View style={styles.wrapRow}>
                  <Pressable
                    testID="unit-system-oz"
                    onPress={() => { Haptics.selectionAsync(); setUnitSystem("oz"); }}
                    style={[styles.chip, unitSystem === "oz" && styles.chipSelected]}
                  >
                    <Txt style={{ color: unitSystem === "oz" ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                      United States (oz)
                    </Txt>
                  </Pressable>
                  <Pressable
                    testID="unit-system-ml"
                    onPress={() => { Haptics.selectionAsync(); setUnitSystem("ml"); }}
                    style={[styles.chip, unitSystem === "ml" && styles.chipSelected]}
                  >
                    <Txt style={{ color: unitSystem === "ml" ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                      Outside the US (ml)
                    </Txt>
                  </Pressable>
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          {errorMsg && (
            <Txt style={{ color: colors.error, fontSize: fontSize.sm, textAlign: "center", marginBottom: spacing.sm }}>
              {errorMsg}
            </Txt>
          )}
          <Button
            testID="onboarding-next-button"
            label={step === TOTAL - 1 ? "Enter Cuddle" : "Continue"}
            onPress={next}
            disabled={!canNext()}
            loading={saving}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  introScreen: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  introSkip: {
    alignSelf: "flex-end",
    padding: spacing.sm,
  },
  introTitle: {
    fontSize: fontSize.xl,
    textAlign: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  introCardWrap: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
  },
  introIconBubble: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  introCardTitle: {
    fontSize: fontSize.xl,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  introCardBody: {
    fontSize: fontSize.base,
    lineHeight: 23,
    textAlign: "center",
    color: colors.onSurfaceSecondary,
  },
  introDots: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  introDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  introDotActive: {
    backgroundColor: colors.brandPrimary,
    width: 20,
  },
  welcome: { flex: 1, backgroundColor: colors.surfaceInverse },
  welcomeContent: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xl,
  },
  welcomeKicker: {
    color: colors.brandTertiary,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    marginBottom: spacing.md,
  },
  welcomeTitle: {
    color: colors.onSurfaceInverse,
    fontSize: fontSize["4xl"],
    lineHeight: 44,
  },
  welcomeSub: {
    color: "rgba(253,251,247,0.85)",
    fontSize: fontSize.lg,
    lineHeight: 26,
    marginTop: spacing.md,
  },
  disclaimer: {
    color: "rgba(253,251,247,0.6)",
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.lg,
    textAlign: "center",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  stepScroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing["2xl"] },
  stepTitle: { fontSize: fontSize["3xl"], lineHeight: 38, marginBottom: spacing.sm },
  stepSub: {
    fontSize: fontSize.lg,
    color: colors.onSurfaceTertiary,
    marginBottom: spacing.lg,
    lineHeight: 24,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.lg,
    fontFamily: fonts.text,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    minHeight: 56,
  },
  optionSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandTertiary + "40",
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  counterBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  counterValue: { fontSize: fontSize["4xl"], minWidth: 50, textAlign: "center" },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  moodRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  moodItem: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    borderColor: "transparent",
  },
  moodItemSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary + "50" },
  moodLabel: { textAlign: "center", fontSize: fontSize.xl, marginTop: spacing.lg, color: colors.brand },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
