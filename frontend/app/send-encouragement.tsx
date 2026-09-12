import React, { useState } from "react";
import { View, StyleSheet, Pressable, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const STARTERS = [
  "Thinking of you today.",
  "You're doing such a good job, even on the hard days.",
  "I see how hard you're working. I've got you.",
  "Take a breath. I love you.",
];

export default function SendEncouragement() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();

  const [partnerDeviceId, setPartnerDeviceId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  React.useEffect(() => {
    if (!deviceId) return;
    api.householdForDevice(deviceId).then((h) => {
      if (!h) return;
      const other = h.members?.find((m: any) => m.device_id !== deviceId);
      if (other) {
        setPartnerDeviceId(other.device_id);
        setPartnerName(other.name || null);
      }
    }).catch(() => {});
  }, [deviceId]);

  const send = async () => {
    if (!deviceId || !partnerDeviceId || !message.trim()) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.sendEncouragement(deviceId, partnerDeviceId, message.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent(true);
    } catch {}
    setSending(false);
  };

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
        <Feather name="heart" size={48} color={colors.brand} />
        <Txt display style={{ fontSize: fontSize.lg, marginTop: spacing.md }}>Sent</Txt>
        <Txt style={{ color: colors.muted, textAlign: "center", marginTop: spacing.xs }}>
          {partnerName || "They"}'ll see it soon. Small words matter more than they seem.
        </Txt>
        <Button label="Done" onPress={() => router.back()} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Txt display style={{ fontSize: fontSize.xl }}>Send a little love</Txt>
      </View>

      <View style={{ padding: spacing.lg }}>
        {!partnerDeviceId ? (
          <Card style={styles.infoCard}>
            <Txt style={{ color: colors.onSurface, fontSize: fontSize.sm }}>
              Set up Tag Team with your partner first, this needs someone to send it to.
            </Txt>
          </Card>
        ) : (
          <>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginBottom: spacing.md }}>
              A short message goes straight to {partnerName || "your partner"}, right now.
            </Txt>

            <View style={styles.starterWrap}>
              {STARTERS.map((s) => (
                <Pressable key={s} testID={`starter-${s.slice(0, 10)}`} onPress={() => { Haptics.selectionAsync(); setMessage(s); }} style={styles.starterChip}>
                  <Txt style={{ color: colors.onSurfaceSecondary, fontSize: fontSize.sm }}>{s}</Txt>
                </Pressable>
              ))}
            </View>

            <TextInput
              testID="encouragement-input"
              value={message}
              onChangeText={setMessage}
              placeholder="Write your own, or tap a starter above"
              placeholderTextColor={colors.muted}
              multiline
              style={styles.input}
            />
            <Button
              testID="send-encouragement-button"
              label={sending ? "Sending..." : "Send"}
              onPress={send}
              loading={sending}
              disabled={!message.trim()}
              style={{ marginTop: spacing.md }}
            />
          </>
        )}
      </View>
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
  infoCard: { backgroundColor: colors.surfaceSecondary },
  starterWrap: { gap: spacing.sm, marginBottom: spacing.md },
  starterChip: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  input: {
    minHeight: 100,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: fontSize.base,
    color: colors.onSurface,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
  },
});
