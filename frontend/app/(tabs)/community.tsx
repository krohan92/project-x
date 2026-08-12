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
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT } from "@/src/lib/i18n";

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
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, deviceId } = useProfile();
  const { t } = useT();

  const [posts, setPosts] = useState<any[]>([]);
  const [space, setSpace] = useState("general");
  const [allSpaces, setAllSpaces] = useState<any[]>([]);
  const [joined, setJoined] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [posting, setPosting] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});

  const loadPosts = useCallback(async (sp: string) => {
    try {
      const p = await api.community();
      const list = sp === "general" ? p.filter((x: any) => (x.space || "general") === "general") : p.filter((x: any) => x.space === sp);
      setPosts(list);
    } catch {}
  }, []);

  const loadSpaces = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await api.spaces(deviceId);
      setAllSpaces(res.spaces || []);
      setJoined(res.joined || []);
    } catch {}
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      loadSpaces();
      loadPosts(space);
    }, [loadSpaces, loadPosts, space])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSpaces(), loadPosts(space)]);
    setRefreshing(false);
  };

  const selectSpace = (sp: string) => {
    Haptics.selectionAsync();
    setSpace(sp);
    loadPosts(sp);
  };

  const toggleJoin = async (key: string) => {
    if (!deviceId) return;
    Haptics.selectionAsync();
    if (joined.includes(key)) {
      setJoined((j) => j.filter((x) => x !== key));
      await api.leaveSpace({ device_id: deviceId, space: key });
      if (space === key) selectSpace("general");
    } else {
      setJoined((j) => [...j, key]);
      await api.joinSpace({ device_id: deviceId, space: key });
    }
  };

  const like = async (id: string) => {
    if (liked[id]) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLiked((l) => ({ ...l, [id]: true }));
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, likes: p.likes + 1 } : p)));
    try { await api.likePost(id); } catch {}
  };

  const submitPost = async () => {
    if (!newText.trim() || !deviceId) return;
    setPosting(true);
    try {
      await api.createPost({
        device_id: deviceId,
        author: profile?.name || "Anonymous mama",
        text: newText.trim(),
        topic: "General",
        space,
      });
      setNewText("");
      setComposeOpen(false);
      await loadPosts(space);
    } catch {}
    setPosting(false);
  };

  const joinedSpaces = allSpaces.filter((s) => joined.includes(s.key));
  const currentLabel =
    space === "general" ? t("circle.general") : allSpaces.find((s) => s.key === space)?.label || space;

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <View>
            <Txt display style={styles.title}>{t("tab.circle")}</Txt>
            <Txt style={{ color: colors.muted }}>Moms in it together</Txt>
          </View>
          <Pressable testID="manage-spaces-button" onPress={() => setManageOpen(true)} style={styles.spacesBtn}>
            <Feather name="globe" size={14} color={colors.onBrandSecondary} />
            <Txt style={{ color: colors.onBrandSecondary, fontSize: fontSize.sm }}>{t("circle.spaces")}</Txt>
          </Pressable>
        </View>
        <Pressable testID="give-share-banner" onPress={() => router.push("/shop")} style={styles.shopBanner}>
          <Feather name="gift" size={18} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Txt weight="500">Give & Share</Txt>
            <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Free & low-cost baby things, mom to mom</Txt>
          </View>
          <Feather name="chevron-right" size={18} color={colors.muted} />
        </Pressable>

        {allSpaces.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Txt weight="500" style={{ marginBottom: spacing.sm, fontSize: fontSize.sm, color: colors.muted }}>
              CULTURAL CIRCLES
            </Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {allSpaces.map((s) => {
                const isJoined = joined.includes(s.key);
                return (
                  <Pressable
                    key={s.key}
                    testID={`circle-preview-${s.key}`}
                    onPress={() => toggleJoin(s.key)}
                    style={[styles.circleCard, isJoined && styles.circleCardActive]}
                  >
                    <Txt weight="500" style={{ fontSize: fontSize.sm }}>{s.label}</Txt>
                    <Txt style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                      {s.member_count > 0 ? `${s.member_count} joined` : "Be first"}
                    </Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Pressable
            testID="space-general"
            onPress={() => selectSpace("general")}
            style={[styles.chip, space === "general" && styles.chipActive]}
          >
            <Txt style={{ color: space === "general" ? colors.onBrandPrimary : colors.onSurfaceSecondary }} weight={space === "general" ? "500" : "400"}>
              {t("circle.general")}
            </Txt>
          </Pressable>
          {joinedSpaces.map((s) => (
            <Pressable
              key={s.key}
              testID={`space-${s.key}`}
              onPress={() => selectSpace(s.key)}
              style={[styles.chip, space === s.key && styles.chipActive]}
            >
              <Txt style={{ color: space === s.key ? colors.onBrandPrimary : colors.onSurfaceSecondary }} weight={space === s.key ? "500" : "400"}>
                {s.label}
              </Txt>
            </Pressable>
          ))}
          <Pressable testID="add-space-chip" onPress={() => setManageOpen(true)} style={[styles.chip, styles.chipGhost]}>
            <Feather name="plus" size={16} color={colors.brand} />
          </Pressable>
        </ScrollView>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="feather" size={40} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.md, textAlign: "center" }}>
              No posts in {currentLabel} yet. Be the first to share.
            </Txt>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable testID={`post-${item.id}`} onPress={() => router.push(`/thread/${item.id}`)} style={styles.postCard}>
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
              <Pressable testID={`like-${item.id}`} onPress={() => like(item.id)} style={styles.action} hitSlop={8}>
                <Feather name="heart" size={18} color={liked[item.id] ? colors.brand : colors.muted} />
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

      <Pressable testID="new-post-button" onPress={() => setComposeOpen(true)} style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}>
        <Feather name="edit-3" size={24} color={colors.onBrandPrimary} />
      </Pressable>

      {/* Compose */}
      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <Txt display style={{ fontSize: fontSize.xl }}>Post in {currentLabel}</Txt>
              <Pressable testID="close-compose" onPress={() => setComposeOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
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

      {/* Manage spaces */}
      <Modal visible={manageOpen} animationType="slide" transparent onRequestClose={() => setManageOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <Txt display style={{ fontSize: fontSize.xl }}>{t("circle.manageSpaces")}</Txt>
              <Pressable testID="close-manage" onPress={() => setManageOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Txt style={{ color: colors.muted, marginBottom: spacing.md, lineHeight: 20 }}>
              {"Opt in to cultural communities. You're never added automatically."}
            </Txt>
            {allSpaces.map((s) => {
              const isJoined = joined.includes(s.key);
              return (
                <View key={s.key} style={styles.spaceRow}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="500" style={{ fontSize: fontSize.lg }}>{s.label}</Txt>
                    <Txt style={{ color: colors.muted, fontSize: fontSize.sm, marginTop: 2 }}>
                      {s.member_count > 0
                        ? `${s.member_count} ${s.member_count === 1 ? "mom has" : "moms have"} joined`
                        : "Be the first to join"}
                    </Txt>
                  </View>
                  <Pressable
                    testID={`join-${s.key}`}
                    onPress={() => toggleJoin(s.key)}
                    style={[styles.joinBtn, isJoined && styles.joinedBtn]}
                  >
                    <Txt style={{ color: isJoined ? colors.onSurfaceTertiary : colors.onBrandPrimary }} weight="500">
                      {isJoined ? t("common.leave") : t("common.join")}
                    </Txt>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
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
  spacesBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  shopBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  circleCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 120,
  },
  circleCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary + "30" },
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
  chipGhost: { borderStyle: "dashed", borderColor: colors.brand, paddingHorizontal: spacing.md },
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
  postText: { fontSize: fontSize.lg, lineHeight: 24, color: colors.onSurfaceSecondary, marginTop: spacing.md },
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
  spaceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  joinBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  joinedBtn: { backgroundColor: colors.surfaceTertiary },
});
