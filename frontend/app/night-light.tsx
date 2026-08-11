import React, { useState, useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  Dimensions,
  GestureResponderEvent,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

type Star = { id: string; x: number; y: number; size: number };

// A quiet, wordless place to put something down for a moment — tap anywhere
// to release a small point of light, or type a thought and watch it drift
// up and fade. Nothing is saved; that's the point — it's for letting go,
// not logging.
export default function NightLight() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [stars, setStars] = useState<Star[]>([]);
  const [thought, setThought] = useState("");
  const [releasedMsg, setReleasedMsg] = useState(false);
  const idRef = useRef(0);

  const addStar = (x: number, y: number) => {
    const id = String(idRef.current++);
    const size = 4 + Math.random() * 6;
    setStars((s) => [...s, { id, x, y, size }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => {
      setStars((s) => s.filter((st) => st.id !== id));
    }, 5000);
  };

  const onTap = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    addStar(locationX, locationY);
  };

  const releaseThought = () => {
    if (!thought.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addStar(SCREEN_W / 2, SCREEN_H * 0.62);
    setThought("");
    setReleasedMsg(true);
    setTimeout(() => setReleasedMsg(false), 3000);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LinearGradient
        colors={["#14131A", "#211E2C", "#2B2438"]}
        style={StyleSheet.absoluteFill}
      />

      <Pressable
        testID="night-light-close"
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + spacing.md }]}
        hitSlop={12}
      >
        <Feather name="x" size={26} color="rgba(253,251,247,0.85)" />
      </Pressable>

      <Pressable style={styles.tapZone} onPress={onTap}>
        {stars.map((s) => (
          <FloatingStar key={s.id} x={s.x} y={s.y} size={s.size} />
        ))}

        <View style={styles.centerText} pointerEvents="none">
          <Txt display style={styles.title}>Night Light</Txt>
          <Txt style={styles.hint}>
            Tap anywhere to let a little light go.{"\n"}No log, no record — just a moment.
          </Txt>
        </View>
      </Pressable>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {releasedMsg && (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <Txt style={styles.releasedText}>Let it drift for a while. ✨</Txt>
          </Animated.View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            testID="night-light-input"
            value={thought}
            onChangeText={setThought}
            placeholder="Or type what's on your mind, and let it go..."
            placeholderTextColor="rgba(253,251,247,0.4)"
            style={styles.input}
            multiline
            onSubmitEditing={releaseThought}
          />
          <Pressable
            testID="night-light-release"
            onPress={releaseThought}
            style={[styles.sendBtn, !thought.trim() && { opacity: 0.4 }]}
            disabled={!thought.trim()}
          >
            <Feather name="arrow-up" size={18} color="#211E2C" />
          </Pressable>
        </View>

        <View style={styles.quickLinks}>
          <Pressable onPress={() => router.replace("/breathe")} style={styles.quickLink}>
            <Feather name="wind" size={14} color="rgba(253,251,247,0.6)" />
            <Txt style={styles.quickLinkText}>Breathe instead</Txt>
          </Pressable>
          <Pressable onPress={() => router.replace("/talk")} style={styles.quickLink}>
            <Feather name="message-circle" size={14} color="rgba(253,251,247,0.6)" />
            <Txt style={styles.quickLinkText}>Talk instead</Txt>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function FloatingStar({ x, y, size }: { x: number; y: number; size: number }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withTiming(1, { duration: 400 });
    scale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.back(1.5)) });
    translateY.value = withDelay(300, withTiming(-140, { duration: 4200, easing: Easing.out(Easing.quad) }));
    opacity.value = withDelay(3200, withTiming(0, { duration: 1200 }));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.star,
        { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  close: { position: "absolute", right: spacing.lg, zIndex: 10 },
  tapZone: { flex: 1 },
  centerText: {
    position: "absolute",
    top: "38%",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  title: { color: "rgba(253,251,247,0.9)", fontSize: fontSize["2xl"], marginBottom: spacing.sm },
  hint: { color: "rgba(253,251,247,0.55)", fontSize: fontSize.base, textAlign: "center", lineHeight: 22 },
  star: {
    position: "absolute",
    backgroundColor: "#F3D9A4",
    shadowColor: "#F3D9A4",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  releasedText: { color: "rgba(253,251,247,0.7)", fontSize: fontSize.sm, textAlign: "center" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    backgroundColor: "rgba(253,251,247,0.08)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(253,251,247,0.15)",
    padding: spacing.sm,
  },
  input: {
    flex: 1,
    color: "rgba(253,251,247,0.9)",
    fontSize: fontSize.base,
    maxHeight: 80,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: "#F3D9A4",
    alignItems: "center",
    justifyContent: "center",
  },
  quickLinks: { flexDirection: "row", justifyContent: "center", gap: spacing.xl, marginTop: spacing.xs },
  quickLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  quickLinkText: { color: "rgba(253,251,247,0.6)", fontSize: fontSize.sm },
});
