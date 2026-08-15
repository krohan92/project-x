import React from "react";
import {
  Text,
  TextProps,
  View,
  ViewProps,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import { colors, fonts, fontSize, radius, spacing } from "@/src/theme/theme";

export function Txt({
  style,
  display,
  italic,
  weight,
  ...rest
}: TextProps & { display?: boolean; italic?: boolean; weight?: "400" | "500" }) {
  // On native, fontWeight has no effect when paired with a custom fontFamily
  // unless a font file for that exact weight is loaded — iOS silently
  // ignores it (or worse, substitutes the system font) rather than faking
  // bold the way browsers do. So "medium" text needs to select an actually
  // different, separately-loaded font file, not just a style property.
  const isMedium = weight === "500";
  const family = display
    ? italic
      ? fonts.displayItalic
      : isMedium
      ? fonts.displayMedium
      : fonts.display
    : isMedium
    ? fonts.textMedium
    : fonts.text;
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: family, color: colors.onSurface },
        style,
      ]}
    />
  );
}

export function Card({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.card, style]} />;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
  testID,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: any;
  testID?: string;
  icon?: React.ReactNode;
}) {
  const bg =
    variant === "primary"
      ? colors.brandPrimary
      : variant === "secondary"
      ? colors.surfaceTertiary
      : "transparent";
  const fg =
    variant === "primary"
      ? colors.onBrandPrimary
      : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.borderStrong },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {icon}
          <Txt style={{ color: fg, fontSize: fontSize.lg }} weight="500">
            {label}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
});
