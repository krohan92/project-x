import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useVoiceInput } from "@/src/lib/voice-input";

const CHAT_BG =
  "https://images.unsplash.com/photo-1547148903-55829acc03a5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNDR8MHwxfHNlYXJjaHwxfHxnZW50bGUlMjBuYXR1cmUlMjBzb2Z0JTIwY2xheSUyMHRleHR1cmVzfGVufDB8fHx8MTc4Mjg3Mjk5OHww&ixlib=rb-4.1.0&q=85";

const PROMPTS = [
  "I feel overwhelmed today",
  "I just need to vent",
  "I feel so alone",
  "Is it normal to feel this way?",
  "I'm exhausted and can't sleep",
];

type Msg = { role: "user" | "assistant"; text: string };

export default function Talk() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId } = useProfile();
  const sessionId = deviceId ? `chat_${deviceId}` : null;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const hist = await api.chatHistory(sessionId);
      setMessages(hist.map((m: any) => ({ role: m.role, text: m.text })));
    } catch {}
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, sending]);

  const send = async (text: string) => {
    if (!text.trim() || !sessionId || !deviceId || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: text.trim() }]);
    setSending(true);
    try {
      const res = await api.sendChat({
        device_id: deviceId,
        session_id: sessionId,
        message: text.trim(),
      });
      setMessages((m) => [...m, { role: "assistant", text: res.reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "I'm having a little trouble hearing you right now. Please try again in a moment. 🤍",
        },
      ]);
    }
    setSending(false);
  };

  const empty = messages.length === 0;

  const voice = useVoiceInput((text) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    send(text);
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          testID="chat-back-button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.avatar}>
          <Feather name="feather" size={18} color={colors.onBrandPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt display style={{ fontSize: fontSize.xl }}>Cuddle</Txt>
          <Txt style={{ color: colors.success, fontSize: fontSize.sm }}>Here for you, always</Txt>
        </View>
        <Pressable testID="chat-resources-button" onPress={() => router.push("/care")} hitSlop={10}>
          <Feather name="life-buoy" size={22} color={colors.brand} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {empty && (
            <View style={styles.emptyWrap} testID="chat-empty">
              <View style={styles.emptyImageWrap}>
                <Image source={CHAT_BG} style={StyleSheet.absoluteFill} contentFit="cover" />
              </View>
              <Txt display style={styles.emptyTitle}>
                This is your safe space, {profile?.name || "mama"}.
              </Txt>
              <Txt style={styles.emptySub}>
                No judgment, no rush. Share whatever is on your heart, or start with a
                gentle prompt below.
              </Txt>
            </View>
          )}

          {messages.map((m, i) => (
            <Animated.View
              key={i}
              entering={FadeIn.duration(300)}
              style={[styles.bubbleRow, m.role === "user" ? styles.rowRight : styles.rowLeft]}
            >
              <View style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.aiBubble]}>
                <Txt
                  style={{
                    color: m.role === "user" ? colors.onSurface : colors.onBrandSecondary,
                    fontSize: fontSize.lg,
                    lineHeight: 24,
                  }}
                >
                  {m.text}
                </Txt>
              </View>
            </Animated.View>
          ))}

          {sending && (
            <View style={[styles.bubbleRow, styles.rowLeft]}>
              <View style={[styles.bubble, styles.aiBubble, styles.typing]}>
                <ActivityIndicator size="small" color={colors.onBrandSecondary} />
                <Txt style={{ color: colors.onBrandSecondary }}>Cuddle is here...</Txt>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Prompt chips */}
      {empty && !loading && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {PROMPTS.map((p) => (
            <Pressable
              key={p}
              testID={`prompt-${p}`}
              style={styles.promptChip}
              onPress={() => send(p)}
            >
              <Txt style={{ color: colors.onSurfaceSecondary }}>{p}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Input */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        {voice.available && (
          <Pressable
            testID="chat-mic-button"
            onPress={() => (voice.listening ? voice.stop() : voice.start())}
            style={[styles.micBtn, voice.listening && styles.micBtnActive]}
          >
            <Feather name="mic" size={18} color={voice.listening ? "#fff" : colors.brand} />
          </Pressable>
        )}
        <TextInput
          testID="chat-input"
          value={input}
          onChangeText={setInput}
          placeholder={voice.listening ? "Listening..." : "Type from the heart, or say it — try 'log a 4oz feed'"}
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <Pressable
          testID="chat-send-button"
          onPress={() => send(input)}
          disabled={!input.trim() || sending}
          style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { alignItems: "center", paddingVertical: spacing.xl },
  emptyImageWrap: {
    width: 140,
    height: 140,
    borderRadius: radius.pill,
    overflow: "hidden",
    marginBottom: spacing.lg,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  emptyTitle: { fontSize: fontSize["2xl"], textAlign: "center", marginBottom: spacing.sm },
  emptySub: {
    fontSize: fontSize.lg,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  bubbleRow: { marginBottom: spacing.md, flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  aiBubble: {
    backgroundColor: colors.brandSecondary + "45",
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  userBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.sm,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  typing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chipsRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: "flex-start" },
  promptChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexShrink: 0,
  },
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
    maxHeight: 120,
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
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnActive: { backgroundColor: colors.error, borderColor: colors.error },
});
