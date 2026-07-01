import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";

import { Txt, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize, fonts } from "@/src/theme/theme";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";

const TOPICS = ["All", "Sleep", "Feeding", "Mental health", "Recovery", "Support", "General"];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Community() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId } = useProfile();

  const [posts, setPosts] = useState<any[]>([]);
  const [topic, setTopic] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [newTopic, setNewTopic] = useState("General");
  const [posting, setPosting] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const p = await api.community();
      setPosts(p);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const like = async (id: string) => {
    if (liked[id]) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLiked((l) => ({ ...l, [id]: true }));
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, likes: p.likes + 1 } : p)));
    try {
      await api.likePost(id);
    } catch {}
  };

  const submitPost = async () => {
    if (!newText.trim() || !deviceId) return;
    setPosting(true);
    try {
      await api.createPost({
        device_id: deviceId,
        author: profile?.name || "Anonymous mama",
        text: newText.trim(),
        topic: newTopic,
      });
      setNewText("");
      setNewTopic("General");
      setComposeOpen(false);
      await load();
    } catch {}
    setPosting(false);
  };

  const filtered = topic === "All" ? posts : posts.filter((p) => p.topic === topic);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky header + chips */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <View>
            <Txt display style={styles.title}>The Circle</Txt>
            <Txt style={{ color: colors.muted }}>Moms near you, in it together</Txt>
          </View>
          <View style={styles.nearbyPill}>
            <Feather name="map-pin" size={13} color={colors.onBrandSecondary} />
            <Txt style={{ color: colors.onBrandSecondary, fontSize: fontSize.sm }}>Nearby</Txt>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {TOPICS.map((t) => (
            <Pressable
              key={t}
              testID={`topic-${t}`}
              onPress={() => {
                Haptics.selectionAsync();
                setTopic(t);
              }}
              style={[styles.chip, topic === t && styles.chipActive]}
            >
              <Txt
                style={{ color: topic === t ? colors.onBrandPrimary : colors.onSurfaceSecondary }}
                weight={topic === t ? "500" : "400"}
              >
                {t}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="users" size={40} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.md }}>
              No posts here yet. Be the first to share.
            </Txt>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`post-${item.id}`}
            onPress={() => router.push(`/thread/${item.id}`)}
            style={styles.postCard}
          >
            <View style={styles.postHead}>
              <View style={[styles.postAvatar, { backgroundColor: item.avatar_color }]}>
                <Txt style={{ color: "#fff", fontSize: fontSize.lg }} weight="500">
                  {item.author?.[0]?.toUpperCase() || "M"}
                </Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt weight="500">{item.author}</Txt>
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                  {item.location} · {timeAgo(item.created_at)}
                </Txt>
              </View>
              <View style={styles.topicTag}>
                <Txt style={{ color: colors.onSurfaceTertiary, fontSize: 11 }}>{item.topic}</Txt>
              </View>
            </View>
            <Txt style={styles.postText}>{item.text}</Txt>
            <View style={styles.postActions}>
              <Pressable
                testID={`like-${item.id}`}
                onPress={() => like(item.id)}
                style={styles.action}
                hitSlop={8}
              >
                <Feather
                  name="heart"
                  size={18}
                  color={liked[item.id] ? colors.brand : colors.muted}
                />
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>{item.likes}</Txt>
              </Pressable>
              <View style={styles.action}>
                <Feather name="message-circle" size={18} color={colors.muted} />
                <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Reply</Txt>
              </View>
            </View>
          </Pressable>
        )}
      />

      <Pressable
        testID="new-post-button"
        onPress={() => setComposeOpen(true)}
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
      >
        <Feather name="edit-3" size={24} color={colors.onBrandPrimary} />
      </Pressable>

      {/* Compose modal */}
      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <Txt display style={{ fontSize: fontSize.xl }}>Share with the Circle</Txt>
              <Pressable testID="close-compose" onPress={() => setComposeOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
              {TOPICS.filter((t) => t !== "All").map((t) => (
                <Pressable
                  key={t}
                  testID={`newtopic-${t}`}
                  onPress={() => setNewTopic(t)}
                  style={[styles.chip, newTopic === t && styles.chipActive, { flexShrink: 0 }]}
                >
                  <Txt style={{ color: newTopic === t ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{t}</Txt>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              testID="post-input"
              value={newText}
              onChangeText={setNewText}
              placeholder="What's on your heart, mama? This is a kind space."
              placeholderTextColor={colors.muted}
              multiline
              style={styles.composeInput}
            />
            <Button testID="submit-post" label="Share" onPress={submitPost} loading={posting} disabled={!newText.trim()} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  title: { fontSize: fontSize["2xl"] },
  nearbyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  chipsRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  empty: { alignItems: "center", paddingTop: spacing["3xl"] },
  postCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  postHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  postAvatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  topicTag: {
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  postText: {
    fontSize: fontSize.lg,
    lineHeight: 24,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.md,
  },
  postActions: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.md },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.onSurface,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modalOverlay: { flex: 1, backgroundColor: "rgba(44,41,37,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
  modalHandle: {
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  composeInput: {
    minHeight: 120,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    textAlignVertical: "top",
    marginBottom: spacing.lg,
  },
});
