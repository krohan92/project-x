import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useProfile } from "@/src/lib/profile-context";

type Pose = { name: string; seconds: number; cue: string };
type Routine = {
  id: string;
  name: string;
  duration: string;
  blurb: string;
  icon: keyof typeof Feather.glyphMap;
  poses: Pose[];
};

const ROUTINES: Routine[] = [
  {
    id: "wakeup",
    name: "Gentle Wake-Up",
    duration: "~5 min",
    blurb: "Seated and easy — good for a first movement of the day",
    icon: "sunrise",
    poses: [
      { name: "Seated breath check-in", seconds: 60, cue: "Sit comfortably, hands resting on your belly. Just notice your breath." },
      { name: "Neck rolls", seconds: 30, cue: "Slow half-circles, both directions. Stop anywhere that feels tight." },
      { name: "Shoulder rolls", seconds: 30, cue: "Roll shoulders back and down, nice and slow." },
      { name: "Seated side stretch", seconds: 30, cue: "Reach one arm overhead and lean gently to the side. Switch sides." },
      { name: "Gentle seated twist", seconds: 30, cue: "Hand on opposite knee, twist gently. Nothing forceful." },
    ],
  },
  {
    id: "core",
    name: "Pelvic Floor & Core Reconnect",
    duration: "~8 min",
    blurb: "Foundational, slow — the kind of movement most providers approve early",
    icon: "circle",
    poses: [
      { name: "Diaphragmatic breathing", seconds: 90, cue: "Lying or seated, breathe into your belly, exhale slow. Feel your ribs move." },
      { name: "Pelvic tilts", seconds: 60, cue: "Gently rock your pelvis forward and back. Small movements, no strain." },
      { name: "Pelvic floor breaths", seconds: 90, cue: "As you exhale, gently draw up through your pelvic floor. Release fully on the inhale." },
      { name: "Child's pose (or seated fold)", seconds: 60, cue: "Rest here. If child's pose isn't comfortable yet, a seated forward fold works too." },
      { name: "Legs up (wall or couch)", seconds: 120, cue: "Lie back, legs resting up. Let everything soften." },
    ],
  },
  {
    id: "neck",
    name: "Neck, Shoulders & Nursing Relief",
    duration: "~4 min",
    blurb: "For the ache that comes from feeding and holding",
    icon: "wind",
    poses: [
      { name: "Seated neck stretch", seconds: 30, cue: "Ear toward shoulder, gentle hold. Switch sides." },
      { name: "Shoulder blade squeeze", seconds: 45, cue: "Draw shoulder blades together and down. Hold, release." },
      { name: "Seated chest opener", seconds: 45, cue: "Clasp hands behind you, gently lift and open through the chest." },
      { name: "Seated forward fold", seconds: 60, cue: "Let your head and arms hang heavy. Breathe." },
    ],
  },
];

export default function PostpartumYoga() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useProfile();
  const [routine, setRoutine] = useState<Routine | null>(null);

  const isCSection = profile?.delivery_type === "c-section";

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => (routine ? setRoutine(null) : router.back())} hitSlop={12}>
          <Feather name={routine ? "arrow-left" : "x"} size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Postpartum Yoga</Txt>
          <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Gentle movement, on your terms</Txt>
        </View>
      </View>

      {!routine ? (
        <RoutinePicker isCSection={isCSection} onSelect={setRoutine} />
      ) : (
        <YogaSession routine={routine} />
      )}
    </View>
  );
}

function RoutinePicker({ isCSection, onSelect }: { isCSection: boolean; onSelect: (r: Routine) => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["3xl"] }}>
      <View style={styles.safetyCard}>
        <Feather name="info" size={16} color="#8A6D3B" />
        <Txt style={styles.safetyText}>
          {isCSection
            ? "Since your profile mentions a C-section, please wait for your provider's clearance (often 6+ weeks or later) before trying these. Stop immediately if anything pulls, hurts, or feels wrong."
            : "If you haven't been cleared for movement by your provider yet, check with them first. Stop if you feel pain, dizziness, or increased bleeding — this is gentle movement, not a substitute for medical guidance."}
        </Txt>
      </View>

      {ROUTINES.map((r) => (
        <Pressable key={r.id} testID={`yoga-routine-${r.id}`} onPress={() => onSelect(r)} style={styles.routineCard}>
          <View style={styles.routineIcon}>
            <Feather name={r.icon} size={22} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Txt display style={{ fontSize: fontSize.lg }}>{r.name}</Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{r.duration}</Txt>
            </View>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>{r.blurb}</Txt>
          </View>
          <Feather name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function YogaSession({ routine }: { routine: Routine }) {
  const [step, setStep] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(routine.poses[0].seconds);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const pose = routine.poses[step];
  const isLast = step === routine.poses.length - 1;

  useEffect(() => {
    setSecondsLeft(routine.poses[step].seconds);
  }, [step, routine]);

  useEffect(() => {
    if (paused) return;
    timer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (!isLast) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setStep((st) => st + 1);
            return routine.poses[step + 1]?.seconds ?? 0;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, step]);

  return (
    <Animated.View entering={FadeIn} style={styles.session}>
      <LinearGradient colors={["#F4EFE6", "#E9DFD0"]} style={StyleSheet.absoluteFill} />
      <Txt style={styles.stepCount}>POSE {step + 1} OF {routine.poses.length}</Txt>
      <Txt display style={styles.poseName}>{pose.name}</Txt>
      <View style={styles.timerCircle}>
        <Txt display style={styles.timerText}>{secondsLeft}</Txt>
      </View>
      <Txt style={styles.cue}>{pose.cue}</Txt>

      <View style={styles.controls}>
        <Pressable onPress={() => setPaused((p) => !p)} style={styles.controlBtn}>
          <Feather name={paused ? "play" : "pause"} size={20} color={colors.onSurface} />
        </Pressable>
        {!isLast && (
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setStep((s) => s + 1); }}
            style={styles.controlBtn}
          >
            <Feather name="skip-forward" size={20} color={colors.onSurface} />
          </Pressable>
        )}
      </View>

      {isLast && secondsLeft === 0 && (
        <Animated.View entering={FadeIn}>
          <Txt style={styles.doneText}>That's the whole routine. Nicely done. 🤍</Txt>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  safetyCard: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: "#FBF3E0",
    borderWidth: 1,
    borderColor: "#EAD9AE",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  safetyText: { flex: 1, color: "#6B5426", fontSize: fontSize.sm, lineHeight: 19 },
  routineCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  routineIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary + "50",
    alignItems: "center",
    justifyContent: "center",
  },
  session: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  stepCount: { color: colors.muted, fontSize: 11, letterSpacing: 1.5 },
  poseName: { fontSize: fontSize["2xl"], textAlign: "center" },
  timerCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 3,
    borderColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.md,
  },
  timerText: { fontSize: 40 },
  cue: { textAlign: "center", color: colors.onSurfaceTertiary, fontSize: fontSize.base, lineHeight: 22, paddingHorizontal: spacing.lg },
  controls: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.lg },
  controlBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  doneText: { fontSize: fontSize.lg, textAlign: "center", marginTop: spacing.lg },
});
