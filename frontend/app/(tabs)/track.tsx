import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";

import { Txt, Card, Button } from "@/src/components/ui";
import { colors, spacing, radius, fontSize } from "@/src/theme/theme";
import { useAmbient } from "@/src/lib/ambient-context";
import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { useT } from "@/src/lib/i18n";
import { isNightTime } from "@/src/lib/night";
import { HandoffCard } from "@/src/components/HandoffCard";
import { FirstTimeHint } from "@/src/components/FirstTimeHint";
import { ExactTimePicker } from "@/src/components/ExactTimePicker";

const KINDS = [
  { key: "feed", labelKey: "track.logFeed", icon: "coffee", color: "#D68C7A" },
  { key: "sleep", labelKey: "track.logSleep", icon: "moon", color: "#98A99B" },
  { key: "diaper", labelKey: "track.logDiaper", icon: "droplet", color: "#DEB068" },
] as const;

const KIND_META: Record<string, { icon: any; color: string; label: string }> = {
  feed: { icon: "coffee", color: "#D68C7A", label: "Feed" },
  sleep: { icon: "moon", color: "#98A99B", label: "Sleep" },
  diaper: { icon: "droplet", color: "#DEB068", label: "Diaper" },
};

const ML_OPTIONS = [30, 60, 90, 120, 150, 180, 210, 240];
const WHEN_OPTIONS = [
  { label: "Now", minsAgo: 0 },
  { label: "15m ago", minsAgo: 15 },
  { label: "30m ago", minsAgo: 30 },
  { label: "1h ago", minsAgo: 60 },
  { label: "2h ago", minsAgo: 120 },
];
const SLEEP_DURATIONS = [20, 45, 60, 90, 120];

function isoMinutesAgo(mins: number) {
  return new Date(Date.now() - mins * 60000).toISOString();
}

function timeStr(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function dayStr(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function relativeFuture(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "any time now";
  if (mins < 60) return `in about ${mins}m`;
  return `around ${new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
function relativePast(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
function _ozLabel(ml: number) {
  const oz = (ml / 29.5735).toFixed(1).replace(/\.0$/, "");
  return `${ml}ml (${oz}oz)`;
}

export default function Track() {
  const { tint: ambientTint } = useAmbient();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useProfile();
  const { t } = useT();

  const [logs, setLogs] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [predictions, setPredictions] = useState<any | null>(null);
  const [balanceMessage, setBalanceMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [justLogged, setJustLogged] = useState<string | null>(null);

  // Inline logging panel state
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [feedMl, setFeedMl] = useState(90);
  const [diaperType, setDiaperType] = useState<"pee" | "poop" | "both">("pee");
  const [sleepMins, setSleepMins] = useState(45);
  const [whenMinsAgo, setWhenMinsAgo] = useState(0);
  const [useExactTime, setUseExactTime] = useState(false);
  const [pickedTime, setPickedTime] = useState(new Date());
  const [customOz, setCustomOz] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const [l, s, p, sessions] = await Promise.all([
        api.babyLogs(deviceId),
        api.babyLogSummary(deviceId),
        api.babyLogPredictions(deviceId),
        api.sleepSessionActive(deviceId),
      ]);
      setLogs(l);
      setSummary(s);
      setPredictions(p);
      setActiveSessions(sessions);
    } catch {}
    try {
      const h = await api.householdForDevice(deviceId);
      if (h) {
        const b = await api.handoffBalance(h.household_code);
        setBalanceMessage(b?.message || null);
      } else {
        setBalanceMessage(null);
      }
    } catch {}
    api.predictiveFeedNudge(deviceId).catch(() => {});
    api.predictiveSleepNudge(deviceId).catch(() => {});
    api.predictivePoopNudge(deviceId).catch(() => {});
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A live timer needs two different refresh rhythms: the displayed "Xm"
  // ticks up every 30s locally without hitting the server, while a real
  // periodic reload every 20s is what actually catches the other
  // caregiver starting or stopping a session on their own phone.
  useEffect(() => {
    const tickId = setInterval(() => setNowTick(Date.now()), 30000);
    const reloadId = setInterval(() => { if (deviceId) api.sleepSessionActive(deviceId).then(setActiveSessions).catch(() => {}); }, 20000);
    return () => { clearInterval(tickId); clearInterval(reloadId); };
  }, [deviceId]);

  const babySession = activeSessions.find((s) => s.subject === "baby");
  const mySelfSession = activeSessions.find((s) => s.subject === "self" && s.is_you);
  const partnerSelfSession = activeSessions.find((s) => s.subject === "self" && !s.is_you);

  const minsSince = (iso: string) => Math.max(0, Math.round((nowTick - new Date(iso).getTime()) / 60000));
  const fmtDuration = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);

  const toggleBabySession = async () => {
    if (!deviceId) return;
    setSessionBusy("baby");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (babySession) {
        await api.sleepSessionStop(deviceId, "baby");
      } else {
        await api.sleepSessionStart(deviceId, "baby");
      }
      await load();
    } catch {}
    setSessionBusy(null);
  };

  const toggleSelfSession = async () => {
    if (!deviceId) return;
    setSessionBusy("self");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (mySelfSession) {
        await api.sleepSessionStop(deviceId, "self");
      } else {
        await api.sleepSessionStart(deviceId, "self");
      }
      await load();
    } catch {}
    setSessionBusy(null);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openKind = (kind: string) => {
    Haptics.selectionAsync();
    setWhenMinsAgo(0);
    setUseExactTime(false);
    setPickedTime(new Date());
    setCustomOz("");
    setActiveKind(activeKind === kind ? null : kind);
  };

  const confirmLog = async () => {
    if (!deviceId || !activeKind) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const effectiveMinsAgo = useExactTime
      ? Math.max(0, Math.round((Date.now() - pickedTime.getTime()) / 60000))
      : whenMinsAgo;
    const at = isoMinutesAgo(effectiveMinsAgo);
    try {
      if (activeKind === "feed") {
        await api.babyLog({ device_id: deviceId, kind: "feed", amount_ml: feedMl, at });
      } else if (activeKind === "diaper") {
        await api.babyLog({ device_id: deviceId, kind: "diaper", diaper_type: diaperType, at });
      } else if (activeKind === "sleep") {
        // Logged after the fact — "at" represents when the nap started.
        await api.babyLog({
          device_id: deviceId, kind: "sleep", duration_minutes: sleepMins,
          at: isoMinutesAgo(effectiveMinsAgo + sleepMins),
        });
      }
      setJustLogged(activeKind);
      setActiveKind(null);
      await load();
    } catch {}
    setSaving(false);
    setTimeout(() => setJustLogged(null), 1500);
  };

  return (
    <View style={{ flex: 1, backgroundColor: ambientTint }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Txt display style={styles.title}>{t("track.title")}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {/* Late-night gentle nudge — right where she'll actually be at 2am */}
        {isNightTime() && (
          <Pressable testID="track-night-light" onPress={() => router.push("/night-light")}>
            <Card style={styles.nightNudge}>
              <Feather name="star" size={16} color="#F3D9A4" />
              <Txt style={{ color: colors.onSurface, flex: 1 }}>
                Up logging again? There's a quiet moment waiting if you need it.
              </Txt>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        )}

        {/* Tag Team hand-off */}
        <HandoffCard />

        {balanceMessage && (
          <Animated.View entering={FadeIn}>
            <Card style={styles.balanceCard}>
              <Feather name="zap" size={18} color={colors.brandTertiary} />
              <Txt style={{ flex: 1, color: colors.onSurface }}>{balanceMessage}</Txt>
            </Card>
          </Animated.View>
        )}

        {/* Right now — live sessions, the most immediate thing to act on */}
        <FirstTimeHint
          hintKey="live_sleep_timer"
          text="New: start a live timer when baby goes down, and stop it the moment they wake, for a more accurate log than guessing after the fact."
        />
        {babySession && (
          <Card style={styles.liveCard}>
            <View style={styles.liveDot} />
            <View style={{ flex: 1 }}>
              <Txt weight="500">Baby is sleeping</Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                Started {fmtDuration(minsSince(babySession.started_at))} ago
                {babySession.owner_name ? ` by ${babySession.is_you ? "you" : babySession.owner_name}` : ""}
              </Txt>
            </View>
            <Pressable
              testID="stop-baby-sleep"
              onPress={toggleBabySession}
              disabled={sessionBusy === "baby"}
              style={styles.stopButton}
            >
              <Txt weight="500" style={{ color: colors.onBrandPrimary, fontSize: fontSize.sm }}>Stop</Txt>
            </Pressable>
          </Card>
        )}

        {mySelfSession && (
          <Card style={[styles.liveCard, { backgroundColor: colors.brandTertiary + "30" }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.brand }]} />
            <View style={{ flex: 1 }}>
              <Txt weight="500">You're resting</Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                For {fmtDuration(minsSince(mySelfSession.started_at))} so far, well deserved
              </Txt>
            </View>
            <Pressable
              testID="stop-self-rest"
              onPress={toggleSelfSession}
              disabled={sessionBusy === "self"}
              style={styles.stopButton}
            >
              <Txt weight="500" style={{ color: colors.onBrandPrimary, fontSize: fontSize.sm }}>I'm up</Txt>
            </Pressable>
          </Card>
        )}

        {partnerSelfSession && (
          <Card style={[styles.liveCard, { backgroundColor: colors.brandSecondary + "25" }]}>
            <Feather name="moon" size={18} color={colors.onBrandSecondary} />
            <Txt style={{ flex: 1, color: colors.onSurface }}>
              {partnerSelfSession.owner_name || "Your partner"} is resting right now, since {fmtDuration(minsSince(partnerSelfSession.started_at))} ago
            </Txt>
          </Card>
        )}

        {!babySession && (
          <Pressable testID="start-baby-sleep" onPress={toggleBabySession} disabled={sessionBusy === "baby"}>
            <Card style={styles.startCard}>
              <Feather name="play-circle" size={20} color={colors.brand} />
              <Txt weight="500" style={{ flex: 1 }}>Start baby's sleep timer</Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>most accurate</Txt>
            </Card>
          </Pressable>
        )}

        {!mySelfSession && (
          <Pressable testID="start-self-rest" onPress={toggleSelfSession} disabled={sessionBusy === "self"}>
            <Card style={[styles.startCard, { marginTop: spacing.sm }]}>
              <Feather name="moon" size={20} color={colors.brand} />
              <Txt weight="500" style={{ flex: 1 }}>I'm going to rest too</Txt>
            </Card>
          </Pressable>
        )}

        {/* Since last... — the very first thing a tired parent wants to know */}
        {summary && (summary.last_feed_at || summary.last_pee_at || summary.last_poop_at || summary.last_sleep_at) && (
          <>
            <Txt display style={[styles.section, { marginTop: spacing.xl }]}>Since last...</Txt>
            <View style={styles.totalsRow}>
              <View style={styles.totalItem}>
                <Txt display style={styles.sinceNum}>{relativePast(summary.last_feed_at) || "—"}</Txt>
                <Txt style={styles.totalLabel}>fed</Txt>
              </View>
              <View style={styles.totalItem}>
                <Txt display style={styles.sinceNum}>{relativePast(summary.last_pee_at) || "—"}</Txt>
                <Txt style={styles.totalLabel}>pee</Txt>
              </View>
              <View style={styles.totalItem}>
                <Txt display style={styles.sinceNum}>{relativePast(summary.last_poop_at) || "—"}</Txt>
                <Txt style={styles.totalLabel}>poop</Txt>
              </View>
              <View style={styles.totalItem}>
                <Txt display style={styles.sinceNum}>{relativePast(summary.last_sleep_at) || "—"}</Txt>
                <Txt style={styles.totalLabel}>sleep</Txt>
              </View>
            </View>
          </>
        )}

        {/* Today's totals */}
        {summary && (summary.feed_count > 0 || summary.pee_count > 0 || summary.poop_count > 0 || summary.sleep_count > 0) && (
          <>
            <Txt display style={[styles.section, { marginTop: spacing.xl }]}>Today so far</Txt>
            <View style={styles.totalsRow}>
              <View style={styles.totalItem}>
                <Txt display style={styles.totalNum}>{summary.feed_total_oz}oz</Txt>
                <Txt style={styles.totalLabel}>{summary.feed_count} feeds</Txt>
              </View>
              <View style={styles.totalItem}>
                <Txt display style={styles.totalNum}>{summary.pee_count}</Txt>
                <Txt style={styles.totalLabel}>pee</Txt>
              </View>
              <View style={styles.totalItem}>
                <Txt display style={styles.totalNum}>{summary.poop_count}</Txt>
                <Txt style={styles.totalLabel}>poop</Txt>
              </View>
              <View style={styles.totalItem}>
                <Txt display style={styles.totalNum}>
                  {summary.sleep_total_minutes >= 60
                    ? `${Math.floor(summary.sleep_total_minutes / 60)}h${summary.sleep_total_minutes % 60 ? ` ${summary.sleep_total_minutes % 60}m` : ""}`
                    : `${summary.sleep_total_minutes}m`}
                </Txt>
                <Txt style={styles.totalLabel}>sleep</Txt>
              </View>
            </View>
          </>
        )}

        {/* Predictions — based on this baby's own recent pattern */}
        {predictions && (predictions.feed || predictions.pee || predictions.sleep) && (
          <Card style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Feather name="trending-up" size={16} color={colors.brand} />
              <Txt weight="500" style={{ fontSize: fontSize.sm, color: colors.muted }}>
                BASED ON RECENT PATTERN
              </Txt>
            </View>
            {predictions.feed && (
              <Txt style={{ color: colors.onSurface }}>
                Next feed likely {relativeFuture(predictions.feed.predicted_at)}
                {predictions.feed.confidence === "early" ? " (still learning)" : ""}
              </Txt>
            )}
            {predictions.pee && (
              <Txt style={{ color: colors.onSurface }}>
                Next diaper change likely {relativeFuture(predictions.pee.predicted_at)}
              </Txt>
            )}
            {predictions.sleep && (
              <>
                <Txt style={{ color: colors.onSurface }}>
                  Next nap likely {relativeFuture(predictions.sleep.predicted_at)}
                  {predictions.sleep.confidence === "early" ? " (still learning)" : ""}
                </Txt>
                {(() => {
                  const minsUntil = Math.round((new Date(predictions.sleep.predicted_at).getTime() - Date.now()) / 60000);
                  return minsUntil <= 30 ? (
                    <Txt style={{ color: colors.brand, fontSize: fontSize.sm }}>
                      That's coming up soon, might be a good window to rest too, not just baby.
                    </Txt>
                  ) : null;
                })()}
              </>
            )}
          </Card>
        )}

        {/* Quick log */}
        <Txt display style={[styles.section, { marginTop: spacing.xl }]}>{t("track.section.baby")}</Txt>
        <View style={styles.quickRow}>
          {KINDS.map((k) => (
            <Pressable
              key={k.key}
              testID={`log-${k.key}`}
              onPress={() => openKind(k.key)}
              style={[styles.quickCard, activeKind === k.key && { borderColor: k.color }]}
            >
              <View style={[styles.quickIcon, { backgroundColor: k.color + "30" }]}>
                <Feather name={k.icon as any} size={26} color={k.color} />
              </View>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>{t(k.labelKey)}</Txt>
              {justLogged === k.key && (
                <Txt style={{ color: colors.success, fontSize: fontSize.sm }}>✓ {t("track.logged")}</Txt>
              )}
            </Pressable>
          ))}
        </View>

        {activeKind && (
          <Animated.View entering={FadeIn}>
            <Card style={{ gap: spacing.md, marginTop: spacing.md }}>
              {activeKind === "feed" && (
                <>
                  <Txt weight="500">How much?</Txt>
                  <View style={styles.chipWrap}>
                    {ML_OPTIONS.map((ml) => (
                      <Pressable
                        key={ml}
                        onPress={() => { Haptics.selectionAsync(); setFeedMl(ml); setCustomOz(""); }}
                        style={[styles.chip, !customOz && feedMl === ml && styles.chipActive]}
                      >
                        <Txt style={{ color: !customOz && feedMl === ml ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                          {_ozLabel(ml)}
                        </Txt>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.customOzRow}>
                    <TextInput
                      testID="custom-oz-input"
                      value={customOz}
                      onChangeText={(txt) => {
                        setCustomOz(txt);
                        const n = parseFloat(txt);
                        if (Number.isFinite(n) && n > 0) setFeedMl(Math.round(n * 29.5735));
                      }}
                      placeholder="Or enter any amount in oz (e.g. 0.5, 3.5)"
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={styles.customOzInput}
                    />
                    {customOz !== "" && (
                      <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>= {feedMl}ml</Txt>
                    )}
                  </View>
                </>
              )}

              {activeKind === "diaper" && (
                <>
                  <Txt weight="500">What kind?</Txt>
                  <View style={styles.chipWrap}>
                    {(["pee", "poop", "both"] as const).map((d) => (
                      <Pressable
                        key={d}
                        onPress={() => { Haptics.selectionAsync(); setDiaperType(d); }}
                        style={[styles.chip, diaperType === d && styles.chipActive]}
                      >
                        <Txt style={{ color: diaperType === d ? colors.onBrandPrimary : colors.onSurfaceSecondary, textTransform: "capitalize" }}>
                          {d}
                        </Txt>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {activeKind === "sleep" && (
                <>
                  <Txt weight="500">How long?</Txt>
                  <View style={styles.chipWrap}>
                    {SLEEP_DURATIONS.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => { Haptics.selectionAsync(); setSleepMins(m); }}
                        style={[styles.chip, sleepMins === m && styles.chipActive]}
                      >
                        <Txt style={{ color: sleepMins === m ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                          {m < 60 ? `${m}m` : `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)}h`}
                        </Txt>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Txt weight="500">When{activeKind === "sleep" ? " did it end" : ""}?</Txt>
              <View style={styles.chipWrap}>
                {WHEN_OPTIONS.map((w) => (
                  <Pressable
                    key={w.label}
                    onPress={() => { Haptics.selectionAsync(); setUseExactTime(false); setWhenMinsAgo(w.minsAgo); }}
                    style={[styles.chip, !useExactTime && whenMinsAgo === w.minsAgo && styles.chipActive]}
                  >
                    <Txt style={{ color: !useExactTime && whenMinsAgo === w.minsAgo ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                      {w.label}
                    </Txt>
                  </Pressable>
                ))}
                <Pressable
                  testID="pick-exact-time"
                  onPress={() => { Haptics.selectionAsync(); setUseExactTime(true); }}
                  style={[styles.chip, useExactTime && styles.chipActive]}
                >
                  <Txt style={{ color: useExactTime ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>
                    Pick exact time
                  </Txt>
                </Pressable>
              </View>
              {useExactTime && (
                <View style={{ marginTop: spacing.xs }}>
                  <ExactTimePicker value={pickedTime} onChange={setPickedTime} />
                </View>
              )}

              <Button label={`Log ${activeKind}`} onPress={confirmLog} loading={saving} />
            </Card>
          </Animated.View>
        )}

        {/* Recent */}
        <Txt display style={styles.section}>{t("track.recent")}</Txt>
        {logs.length === 0 ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Feather name="clock" size={30} color={colors.borderStrong} />
            <Txt style={{ color: colors.muted, marginTop: spacing.sm, textAlign: "center" }}>
              {t("track.noLogs")}
            </Txt>
          </Card>
        ) : (
          <Card style={{ padding: spacing.sm }}>
            {logs.map((l, i) => {
              const m = KIND_META[l.kind] || KIND_META.feed;
              let detail = "";
              if (l.kind === "feed" && l.amount_ml) detail = `${_ozLabel(l.amount_ml)}`;
              if (l.kind === "diaper" && l.diaper_type) detail = l.diaper_type;
              if (l.kind === "sleep" && l.duration_minutes) {
                detail = l.duration_minutes < 60 ? `${l.duration_minutes}m` : `${(l.duration_minutes / 60).toFixed(1)}h`;
              }
              return (
                <View
                  key={i}
                  style={[styles.logRow, i < logs.length - 1 && styles.logBorder]}
                >
                  <View style={[styles.logIcon, { backgroundColor: m.color + "25" }]}>
                    <Feather name={m.icon} size={18} color={m.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt weight="500">{m.label}</Txt>
                    {!!detail && <Txt style={{ color: colors.muted, fontSize: fontSize.sm, textTransform: "capitalize" }}>{detail}</Txt>}
                    {!!l.logged_by_name && (
                      <Txt style={{ color: colors.brand, fontSize: 11, marginTop: 2 }}>
                        {l.logged_by_you ? "You" : l.logged_by_name}
                      </Txt>
                    )}
                  </View>
                  <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>
                    {dayStr(l.at)} · {timeStr(l.at)}
                  </Txt>
                </View>
              );
            })}
          </Card>
        )}

        {/* Newborn basics */}
        <Txt display style={styles.section}>Newborn basics</Txt>
        <Pressable testID="track-newborn-basics" onPress={() => router.push("/newborn-basics")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: "#9FC4C7" + "60" }]}>
              <Feather name="shield" size={20} color="#4C6E8F" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="500" style={{ fontSize: fontSize.lg }}>Safe sleep, swaddling, bathing & diapers</Txt>
              <Txt style={{ color: colors.muted, fontSize: fontSize.sm }}>Clear, current guidance for the everyday basics</Txt>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>

        {/* For you */}
        <Txt display style={styles.section}>{t("track.section.me")}</Txt>
        <Pressable testID="track-mood" onPress={() => router.push("/checkin")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: colors.brandTertiary + "60" }]}>
              <Feather name="smile" size={20} color={colors.brand} />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>{t("track.logMood")}</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="track-recovery" onPress={() => router.push("/recovery")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: "#E3B3B3" + "60" }]}>
              <Feather name="activity" size={20} color="#B23B3B" />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>Body recovery check-in</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="track-trends" onPress={() => router.push("/journey")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: colors.brandSecondary + "40" }]}>
              <Feather name="trending-up" size={20} color={colors.onBrandSecondary} />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>{t("track.moodTrends")}</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
        <Pressable testID="track-epds" onPress={() => router.push("/epds")}>
          <Card style={styles.linkCard}>
            <View style={[styles.linkIcon, { backgroundColor: colors.info + "30" }]}>
              <Feather name="clipboard" size={20} color={colors.info} />
            </View>
            <Txt weight="500" style={{ flex: 1, fontSize: fontSize.lg }}>{t("track.wellbeing")}</Txt>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Card>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize["2xl"] },
  section: { fontSize: fontSize.xl, marginTop: spacing.xl, marginBottom: spacing.md },
  quickRow: { flexDirection: "row", gap: spacing.md },
  quickCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  quickIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  balanceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary + "20",
    borderColor: colors.brandTertiary + "50",
    marginTop: spacing.md,
  },
  nightNudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#2B2438",
    borderColor: "#3D3450",
    marginBottom: spacing.md,
  },
  liveCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#E3D9F0",
    borderColor: "#C9B8E0",
    marginTop: spacing.md,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#7B5C96",
  },
  stopButton: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  startCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary,
  },
  totalsRow: { flexDirection: "row", gap: spacing.md },
  totalItem: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  totalNum: { fontSize: fontSize.xl },
  sinceNum: { fontSize: fontSize.base, textAlign: "center" },
  totalLabel: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  customOzRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  customOzInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  logBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  logIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  linkCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  linkIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
