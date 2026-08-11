import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
} from "react-native-reanimated";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

type Technique = {
  id: string;
  name: string;
  blurb: string;
  icon: keyof typeof Feather.glyphMap;
  phases: { label: string; dur: number; scale: number }[];
};

const TECHNIQUES: Technique[] = [
  {
    id: "calm",
    name: "Calm Breathing",
    blurb: "Steady and soothing — a gentle default for most moments",
    icon: "feather",
    phases: [
      { label: "Breathe in", dur: 4000, scale: 1 },
      { label: "Hold", dur: 4000, scale: 1 },
      { label: "Breathe out", dur: 6000, scale: 0.55 },
    ],
  },
  {
    id: "box",
    name: "Box Breathing",
    blurb: "Equal counts on every side — grounding when things feel scattered",
    icon: "square",
    phases: [
      { label: "Breathe in", dur: 4000, scale: 1 },
      { label: "Hold", dur: 4000, scale: 1 },
      { label: "Breathe out", dur: 4000, scale: 0.55 },
      { label: "Hold", dur: 4000, scale: 0.55 },
    ],
  },
  {
    id: "478",
    name: "4-7-8 Breath",
    blurb: "A longer exhale to help your body wind down before rest",
    icon: "moon",
    phases: [
      { label: "Breathe in", dur: 4000, scale: 1 },
      { label: "Hold", dur: 7000, scale: 1 },
      { label: "Breathe out", dur: 8000, scale: 0.55 },
    ],
  },
  {
    id: "quick",
    name: "Quick Reset",
    blurb: "Short and simple — for when you only have a minute",
    icon: "zap",
    phases: [
      { label: "Breathe in", dur: 3000, scale: 1 },
      { label: "Hold", dur: 2000, scale: 1 },
      { label: "Breathe out", dur: 3000, scale: 0.55 },
    ],
  },
];

export default function Breathe() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [technique, setTechnique] = useState<Technique | null>(null);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.surfaceInverse, "#3B352E"]}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        testID="breathe-close"
        onPress={() => (technique ? setTechnique(null) : router.back())}
        style={[styles.close, { top: insets.top + spacing.md }]}
        hitSlop={12}
      >
        <Feather name={technique ? "arrow-left" : "x"} size={26} color={colors.onSurfaceInverse} />
      </Pressable>

      {!technique ? (
        <TechniquePicker insets={insets} onSelect={setTechnique} />
      ) : (
        <BreathingSession technique={technique} />
      )}
    </View>
  );
}

function TechniquePicker({
  insets,
  onSelect,
}: {
  insets: { top: number };
  onSelect: (t: Technique) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + spacing["2xl"] + spacing.lg, padding: spacing.lg, gap: spacing.md }}
    >
      <Txt display style={styles.pickerTitle}>Take a breathing moment</Txt>
      <Txt style={styles.pickerSub}>Pick whatever fits how you're feeling right now — there's no wrong choice.</Txt>

      {TECHNIQUES.map((t) => (
        <Pressable
          key={t.id}
          testID={`breathe-technique-${t.id}`}
          onPress={() => {
            Haptics.selectionAsync();
            onSelect(t);
          }}
          style={styles.techCard}
        >
          <View style={styles.techIcon}>
            <Feather name={t.icon} size={20} color={colors.onSurfaceInverse} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt display style={styles.techName}>{t.name}</Txt>
            <Txt style={styles.techBlurb}>{t.blurb}</Txt>
          </View>
          <Feather name="chevron-right" size={20} color="rgba(253,251,247,0.5)" />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function BreathingSession({ technique }: { technique: Technique }) {
  const scale = useSharedValue(technique.phases[technique.phases.length - 1].scale);
  const [phase, setPhase] = useState(0);
  const [cycles, setCycles] = useState(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const phases = technique.phases;
    const run = () => {
      if (!mounted) return;
      const p = phaseRef.current;
      const cur = phases[p];
      setPhase(p);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      scale.value = withTiming(cur.scale, {
        duration: cur.dur,
        easing: Easing.inOut(Easing.ease),
      });
      setTimeout(() => {
        if (!mounted) return;
        const nextP = (p + 1) % phases.length;
        phaseRef.current = nextP;
        if (nextP === 0) setCycles((c) => c + 1);
        run();
      }, cur.dur);
    };
    run();
    return () => {
      mounted = false;
    };
  }, [technique, scale]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View entering={FadeIn} style={styles.center}>
      <Txt style={styles.techniqueLabel}>{technique.name}</Txt>
      <View style={styles.circleZone}>
        <Animated.View style={[styles.circleOuter, circleStyle]}>
          <LinearGradient
            colors={[colors.brandPrimary, colors.brandTertiary]}
            style={styles.circleInner}
          />
        </Animated.View>
        <View style={styles.phaseTextWrap} pointerEvents="none">
          <Txt display style={styles.phaseText}>{technique.phases[phase].label}</Txt>
        </View>
      </View>

      <Txt style={styles.hint}>
        Follow the circle. Let your shoulders soften.
      </Txt>
      <Txt style={styles.cycles}>{cycles} calming {cycles === 1 ? "breath" : "breaths"}</Txt>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  close: { position: "absolute", right: spacing.lg, zIndex: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
  pickerTitle: { color: colors.onSurfaceInverse, fontSize: fontSize.xl, marginTop: spacing.md },
  pickerSub: { color: "rgba(253,251,247,0.7)", fontSize: fontSize.base, marginBottom: spacing.md },
  techCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "rgba(253,251,247,0.08)",
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(253,251,247,0.12)",
  },
  techIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: "rgba(253,251,247,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  techName: { color: colors.onSurfaceInverse, fontSize: fontSize.lg },
  techBlurb: { color: "rgba(253,251,247,0.65)", fontSize: fontSize.sm, marginTop: 2 },
  techniqueLabel: { color: "rgba(253,251,247,0.7)", fontSize: fontSize.sm, letterSpacing: 1, textTransform: "uppercase" },
  circleZone: { width: 300, height: 300, alignItems: "center", justifyContent: "center" },
  circleOuter: {
    width: 300,
    height: 300,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  circleInner: { width: "100%", height: "100%", borderRadius: radius.pill, opacity: 0.85 },
  phaseTextWrap: { position: "absolute", alignItems: "center", justifyContent: "center" },
  phaseText: { color: colors.onSurfaceInverse, fontSize: fontSize["2xl"] },
  hint: {
    color: "rgba(253,251,247,0.8)",
    fontSize: fontSize.lg,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  cycles: { color: colors.brandTertiary, fontSize: fontSize.base },
});
