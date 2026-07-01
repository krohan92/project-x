import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useProfile } from "@/src/lib/profile-context";
import { colors } from "@/src/theme/theme";

export default function Index() {
  const { loading, profile } = useProfile();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (profile) {
      router.replace("/(tabs)");
    } else {
      router.replace("/onboarding");
    }
  }, [loading, profile, router]);

  return (
    <View style={styles.container} testID="splash-loader">
      <ActivityIndicator color={colors.brandPrimary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
