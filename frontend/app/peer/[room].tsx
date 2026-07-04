import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT } from "@/src/lib/i18n";

const OUTCOME_KEY: Record<string, string> = {
  "matched-on-preference": "peer.matchedPref",
  "matched-on-diversity": "peer.matchedDiverse",
  fallback: "peer.matchedFallback",
};

export default function PeerRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { room, handle, outcome, tag } = useLocalSearchParams<{
    room: string;
    handle: string;
    outcome: string;
    tag: string;
  }>();
  const { deviceId } = useProfile();
  const { t } = useT();

  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!room) return;
    try {
      const res = await api.peerChat(room);
      setMessages(res.messages || []);
    } catch {}
  }, [room]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages]);

  const send = async () => {
    if (!input.trim() || !room || !deviceId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { sender: "me", text, handle: "You" }]);
    try {
      await api.peerSend(room, { device_id: deviceId, text });
      await load();
    } catch {}
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="peer-back" onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Txt display style={{ fontSize: fontSize.lg }}>{handle || t("peer.title")}</Txt>
          {outcome ? (
            <Txt style={{ color: colors.success, fontSize: fontSize.sm }}>
              {t(OUTCOME_KEY[outcome] || "peer.matchedFallback")}
            </Txt>
          ) : null}
        </View>
        <Feather name="shield" size={20} color={colors.brandSecondary} />
      </View>

      {tag ? (
        <View style={styles.tagBanner}>
          <Feather name="globe" size={14} color={colors.onBrandTertiary} />
          <Txt style={{ color: colors.onBrandTertiary, fontSize: fontSize.sm }}>{tag}</Txt>
        </View>
      ) : null}

      <View style={styles.anonNote}>
        <Feather name="lock" size={13} color={colors.muted} />
        <Txt style={{ color: colors.muted, fontSize: fontSize.sm, flex: 1 }}>{t("peer.anon")}</Txt>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m, i) => (
          <View
            key={i}
            style={[styles.row, m.sender === "me" ? styles.rowRight : styles.rowLeft]}
          >
            <View style={[styles.bubble, m.sender === "me" ? styles.mine : styles.theirs]}>
              <Txt
                style={{
                  color: m.sender === "me" ? colors.onSurface : colors.onBrandSecondary,
                  fontSize: fontSize.lg,
                  lineHeight: 23,
                }}
              >
                {m.text}
              </Txt>
            </View>
          </View>
        ))}
        <Txt style={styles.demoNote}>{t("peer.demo")}</Txt>
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          testID="peer-input"
          value={input}
          onChangeText={setInput}
          placeholder={t("peer.placeholder")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <Pressable
          testID="peer-send"
          onPress={send}
          disabled={!input.trim()}
          style={[styles.sendBtn, !input.trim() && { opacity: 0.4 }]}
        >
          <Feather name="arrow-up" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tagBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    paddingVertical: spacing.sm,
  },
  anonNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: "row", marginBottom: spacing.md },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "84%", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  theirs: {
    backgroundColor: colors.brandSecondary + "45",
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  mine: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.sm,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  demoNote: { color: colors.muted, fontSize: fontSize.sm, textAlign: "center", marginTop: spacing.md },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    minHeight: 48,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
