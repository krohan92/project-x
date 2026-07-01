import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
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
} from "react-native-reanimated";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

const PHASES = [
  { label: "Breathe in", dur: 4000, scale: 1 },
  { label: "Hold", dur: 4000, scale: 1 },
  { label: "Breathe out", dur: 6000, scale: 0.55 },
];

export default function Breathe() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scale = useSharedValue(0.55);
  const [phase, setPhase] = useState(0);
  const [cycles, setCycles] = useState(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const run = () => {
      if (!mounted) return;
      const p = phaseRef.current;
      const cur = PHASES[p];
      setPhase(p);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      scale.value = withTiming(cur.scale, {
        duration: cur.dur,
        easing: Easing.inOut(Easing.ease),
      });
      setTimeout(() => {
        if (!mounted) return;
        const nextP = (p + 1) % PHASES.length;
        phaseRef.current = nextP;
        if (nextP === 0) setCycles((c) => c + 1);
        run();
      }, cur.dur);
    };
    run();
    return () => {
      mounted = false;
    };
  }, [scale]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.surfaceInverse, "#3B352E"]}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        testID="breathe-close"
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + spacing.md }]}
        hitSlop={12}
      >
        <Feather name="x" size={26} color={colors.onSurfaceInverse} />
      </Pressable>

      <View style={styles.center}>
        <View style={styles.circleZone}>
          <Animated.View style={[styles.circleOuter, circleStyle]}>
            <LinearGradient
              colors={[colors.brandPrimary, colors.brandTertiary]}
              style={styles.circleInner}
            />
          </Animated.View>
          <View style={styles.phaseTextWrap} pointerEvents="none">
            <Txt display style={styles.phaseText}>{PHASES[phase].label}</Txt>
          </View>
        </View>

        <Txt style={styles.hint}>
          Follow the circle. Let your shoulders soften.
        </Txt>
        <Txt style={styles.cycles}>{cycles} calming {cycles === 1 ? "breath" : "breaths"}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  close: { position: "absolute", right: spacing.lg, zIndex: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
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
