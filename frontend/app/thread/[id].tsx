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
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Txt } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Thread() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, deviceId } = useProfile();

  const [post, setPost] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [feed, cms] = await Promise.all([api.community(), api.comments(id)]);
      setPost(feed.find((p: any) => p.id === id) || null);
      setComments(cms);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    if (!text.trim() || !id || !deviceId || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const t = text.trim();
    setText("");
    setSending(true);
    const optimistic = {
      author: profile?.name || "You",
      text: t,
      created_at: new Date().toISOString(),
    };
    setComments((c) => [...c, optimistic]);
    try {
      await api.addComment(id, {
        device_id: deviceId,
        author: profile?.name || "Anonymous mama",
        text: t,
      });
    } catch {}
    setSending(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="thread-back" onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Txt display style={{ fontSize: fontSize.xl }}>Conversation</Txt>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {post && (
            <View style={styles.postCard}>
              <View style={styles.postHead}>
                <View style={[styles.avatar, { backgroundColor: post.avatar_color }]}>
                  <Txt style={{ color: "#fff" }} weight="500">
                    {post.author?.[0]?.toUpperCase()}
                  </Txt>
                </View>
                <View>
                  <Txt weight="500">{post.author}</Txt>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                    {post.location} · {timeAgo(post.created_at)}
                  </Txt>
                </View>
              </View>
              <Txt style={styles.postText}>{post.text}</Txt>
            </View>
          )}

          <Txt style={styles.repliesTitle}>
            {comments.length} {comments.length === 1 ? "reply" : "replies"}
          </Txt>

          {comments.length === 0 && (
            <Txt style={{ color: colors.muted, textAlign: "center", marginTop: spacing.xl }}>
              No replies yet. Offer a kind word. 🤍
            </Txt>
          )}

          {comments.map((c, i) => (
            <View key={i} style={styles.comment}>
              <View style={[styles.avatarSm, { backgroundColor: colors.brandTertiary }]}>
                <Txt style={{ color: colors.onBrandTertiary, fontSize: fontSize.sm }} weight="500">
                  {c.author?.[0]?.toUpperCase() || "M"}
                </Txt>
              </View>
              <View style={styles.commentBody}>
                <Txt weight="500" style={{ fontSize: fontSize.sm }}>{c.author}</Txt>
                <Txt style={{ color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 21 }}>
                  {c.text}
                </Txt>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          testID="comment-input"
          value={text}
          onChangeText={setText}
          placeholder="Add a kind reply..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <Pressable
          testID="comment-send"
          onPress={send}
          disabled={!text.trim() || sending}
          style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  postCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  postHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSm: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  postText: { fontSize: fontSize.lg, lineHeight: 25, marginTop: spacing.md, color: colors.onSurfaceSecondary },
  repliesTitle: { color: colors.muted, marginTop: spacing.xl, marginBottom: spacing.md },
  comment: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  commentBody: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
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
