import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const API = `${BASE}/api`;

/**
 * React Native's fetch has NO default timeout — a stalled connection
 * hangs forever with no error, ever. This is the real fix for the app
 * getting stuck on the loading screen: without this, one slow response
 * from the server freezes the entire app, since profile-context's
 * loading state only clears once its fetch actually settles one way or
 * the other. 12 seconds is generous for a real request, short enough
 * that a genuine stall fails fast instead of hanging indefinitely.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("TIMEOUT: the server took too long to respond");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const DEVICE_KEY = "cuddle_device_id";

function makeId(): string {
  return (
    "dev_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await storage.getItem<string>(DEVICE_KEY, "");
  if (!id) {
    id = makeId();
    await storage.setItem(DEVICE_KEY, id);
  }
  cachedDeviceId = id;
  return id;
}

const DEVICE_TOKEN_KEY = "cuddle_device_token";
let cachedDeviceToken: string | null = null;
// Dedupes concurrent callers during the exact first-launch race the audit
// asked about: several screens can each try to fetch a token before the
// first request finishes. Without this, each would fire its own
// redundant /auth/device-token call. With it, everyone after the first
// caller just awaits the same in-flight request instead.
let inFlightTokenFetch: Promise<string> | null = null;

async function fetchFreshDeviceToken(): Promise<string> {
  const deviceId = await getDeviceId();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API}/auth/device-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    });
  } catch {
    throw new Error("NETWORK_ERROR: couldn't reach the server to authenticate this device");
  }
  if (!res.ok) {
    throw new Error(`AUTH_FAILED: device token request returned ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.token) {
    throw new Error("AUTH_FAILED: server didn't return a usable token");
  }
  cachedDeviceToken = data.token;
  await storage.setItem(DEVICE_TOKEN_KEY, data.token);
  return data.token;
}

/**
 * Real proof-of-device, not just the device_id string on its own — the
 * fix for the "anyone can pass in any device_id" gap. Cached in memory
 * and on disk so it's fetched once per install, not on every call.
 * force=true skips the cache — used only by authedReq's one-time retry
 * after a 401, never called speculatively or in a loop.
 */
export async function getDeviceToken(force = false): Promise<string> {
  if (!force && cachedDeviceToken) return cachedDeviceToken;
  if (!force && inFlightTokenFetch) return inFlightTokenFetch;

  if (!force) {
    const stored = await storage.getItem<string>(DEVICE_TOKEN_KEY, "");
    if (stored) {
      cachedDeviceToken = stored;
      return stored;
    }
  }

  inFlightTokenFetch = fetchFreshDeviceToken().finally(() => {
    inFlightTokenFetch = null;
  });
  return inFlightTokenFetch;
}

async function authedReq(path: string, options?: RequestInit) {
  const doFetch = async (token: string) =>
    fetchWithTimeout(`${API}${path}`, {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options?.headers || {}),
      },
    });

  let token = await getDeviceToken();
  let res: Response;
  try {
    res = await doFetch(token);
  } catch {
    throw new Error("NETWORK_ERROR: couldn't reach the server");
  }

  // A 401 specifically means the token itself is the problem (expired,
  // corrupted, whatever) — fetch a genuinely fresh one and retry exactly
  // once. A second 401 after a fresh token means something's really
  // wrong server-side, not a lifecycle issue, so it's a real failure at
  // that point, not something to keep retrying.
  if (res.status === 401) {
    token = await getDeviceToken(true);
    try {
      res = await doFetch(token);
    } catch {
      throw new Error("NETWORK_ERROR: couldn't reach the server");
    }
  }

  if (!res.ok) {
    const txt = await res.text();
    // Prefixed so callers (and the UI layer) can tell auth/permission
    // failures apart from an ordinary network or server error, instead
    // of every failure collapsing into the same generic message.
    const prefix = res.status === 401 ? "AUTH_FAILED" : res.status === 403 ? "PERMISSION_DENIED" : "REQUEST_FAILED";
    throw new Error(`${prefix}: ${res.status}: ${txt}`);
  }
  return res.json();
}

async function req(path: string, options?: RequestInit) {
  const res = await fetchWithTimeout(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    // Every request in this app is either personal/live data or meant to
    // feel fresh each time (like the daily quote) — never let the browser
    // or OS silently serve a stale cached GET response instead of hitting
    // the backend for real.
    cache: "no-store",
    ...options,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

export type Profile = {
  device_id: string;
  name: string;
  baby_name?: string | null;
  num_children: number;
  delivery_type?: string | null;
  delivery_date?: string | null;
  feeding_method?: string | null;
  birth_experience?: string | null;
  support_level?: string | null;
  initial_mood?: number | null;
  concerns: string[];
  postpartum_appt_done?: boolean;
  mood_from_chat_opt_in?: boolean;
  unit_system?: "oz" | "ml";
  created_at?: string;
  // Set via /nearby/settings — optional, opt-in nearby/cultural-matching fields
  email?: string | null;
  phone?: string | null;
  baby_age_weeks?: number | null;
  due_date?: string | null;
  timezone?: string | null;
  language?: string | null;
  ethnicity?: string | null;
  matching_preference?: string | null;
  display_tags?: boolean | null;
  allow_cultural_match?: boolean | null;
};

export const api = {
  getProfile: (deviceId: string) => authedReq(`/profile/${deviceId}`),
  saveProfile: (p: Profile) =>
    authedReq(`/profile`, { method: "POST", body: JSON.stringify(p) }),

  quote: () => req(`/quote`),
  tips: () => req(`/tips`),
  helplines: () => req(`/helplines`),
  pumpProviders: () => req(`/pump-providers`),

  addMood: (body: any) =>
    authedReq(`/mood`, { method: "POST", body: JSON.stringify(body) }),
  getMoods: (deviceId: string) => authedReq(`/mood/${deviceId}`),
  moodToday: (deviceId: string) => authedReq(`/mood/${deviceId}/today`),

  epdsQuestions: () => req(`/epds/questions`),
  submitEpds: (body: any) =>
    authedReq(`/epds`, { method: "POST", body: JSON.stringify(body) }),
  epdsHistory: (deviceId: string) => authedReq(`/epds/${deviceId}`),
  doctorReport: (deviceId: string, days = 90) => authedReq(`/mood/${deviceId}/doctor-report?days=${days}`),
  exportFullReport: (deviceId: string, days = 30) => authedReq(`/export/full-report/${deviceId}?days=${days}`),
  momMilestonePending: (deviceId: string) => authedReq(`/mom-milestone/pending/${deviceId}`),
  momMilestoneMarkSeen: (deviceId: string, week: number) =>
    authedReq(`/mom-milestone/seen/${deviceId}/${week}`, { method: "POST" }),
  activityPing: (deviceId: string) =>
    authedReq(`/activity/ping`, { method: "POST", body: JSON.stringify({ device_id: deviceId }) }),
  setChatMoodTracking: (deviceId: string, enabled: boolean) =>
    authedReq(`/profile/${deviceId}/chat-mood-tracking`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  setUnitSystem: (deviceId: string, unitSystem: "oz" | "ml") =>
    authedReq(`/profile/${deviceId}/unit-system`, { method: "PATCH", body: JSON.stringify({ unit_system: unitSystem }) }),

  chatHistory: (sessionId: string) => authedReq(`/chat/${sessionId}`),
  sendChat: (body: any) =>
    authedReq(`/chat`, { method: "POST", body: JSON.stringify(body) }),

  community: () => req(`/community`),
  createPost: (body: any) =>
    req(`/community`, { method: "POST", body: JSON.stringify(body) }),
  likePost: (id: string) => req(`/community/${id}/like`, { method: "POST" }),
  comments: (id: string) => req(`/community/${id}/comments`),
  addComment: (id: string, body: any) =>
    req(`/community/${id}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ----- Nearby -----
  nearbyMeta: () => req(`/nearby/meta`),
  updateNearbySettings: (body: any) =>
    authedReq(`/nearby/settings`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEthnicity: (deviceId: string) =>
    authedReq(`/nearby/ethnicity/${deviceId}`, { method: "DELETE" }),

  presenceToggle: (body: any) =>
    authedReq(`/presence/toggle`, { method: "POST", body: JSON.stringify(body) }),
  presenceActive: (deviceId: string) => authedReq(`/presence/active?device_id=${deviceId}`),

  babyLog: (body: any) =>
    authedReq(`/baby-log`, { method: "POST", body: JSON.stringify(body) }),
  babyLogs: (deviceId: string) => authedReq(`/baby-log/${deviceId}`),
  babyLogSummary: (deviceId: string) => authedReq(`/baby-log/${deviceId}/summary`),
  sleepSessionStart: (deviceId: string, subject: "baby" | "self") =>
    authedReq(`/sleep-session/start`, { method: "POST", body: JSON.stringify({ device_id: deviceId, subject }) }),
  sleepSessionStop: (deviceId: string, subject: "baby" | "self") =>
    authedReq(`/sleep-session/stop`, { method: "POST", body: JSON.stringify({ device_id: deviceId, subject }) }),
  sleepSessionActive: (deviceId: string) => authedReq(`/sleep-session/active/${deviceId}`),
  pumpSessionToggle: (deviceId: string, side: "left" | "right") =>
    authedReq(`/pump-session/toggle`, { method: "POST", body: JSON.stringify({ device_id: deviceId, side }) }),
  pumpSessionActive: (deviceId: string) => authedReq(`/pump-session/active/${deviceId}`),
  pumpSessionFinish: (deviceId: string, leftMl?: number, rightMl?: number) =>
    authedReq(`/pump-session/finish/${deviceId}`, {
      method: "POST",
      body: JSON.stringify({ left_ml: leftMl ?? null, right_ml: rightMl ?? null }),
    }),
  pumpSessionInsight: (deviceId: string) => authedReq(`/pump-session/insight/${deviceId}`),
  pumpSessionTrend: (deviceId: string, days = 14) => authedReq(`/pump-session/trend/${deviceId}?days=${days}`),
  pumpSymptomCheck: (deviceId: string, side: string, hasSymptoms: boolean, symptoms: string[] = []) =>
    authedReq(`/pump-session/symptom-check`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId, side, has_symptoms: hasSymptoms, symptoms }),
    }),
  feedNextSide: (deviceId: string) => authedReq(`/feed/next-side/${deviceId}`),
  babyLogPredictions: (deviceId: string) => authedReq(`/baby-log/${deviceId}/predictions`),
  handoffBalance: (householdCode: string) => authedReq(`/handoff/balance/${householdCode}`),

  spaces: (deviceId: string) => authedReq(`/spaces/${deviceId}`),
  joinSpace: (body: any) =>
    authedReq(`/spaces/join`, { method: "POST", body: JSON.stringify(body) }),
  leaveSpace: (body: any) =>
    authedReq(`/spaces/leave`, { method: "POST", body: JSON.stringify(body) }),

  guides: (culture?: string) =>
    req(`/guides${culture ? `?culture=${encodeURIComponent(culture)}` : ""}`),

  // ----- Caregiver hand-off ("Tag Out") -----
  createHousehold: (body: { device_id: string; name: string; role?: string }) =>
    authedReq(`/household`, { method: "POST", body: JSON.stringify(body) }),
  joinHousehold: (body: { device_id: string; household_code: string; name: string; role?: string }) =>
    authedReq(`/household/join`, { method: "POST", body: JSON.stringify(body) }),
  createInvite: (body: { household_code: string; requesting_device_id: string; role?: string; custom_role?: string; permissions?: Record<string, boolean> }) =>
    authedReq(`/household/invite`, { method: "POST", body: JSON.stringify(body) }),
  acceptInvite: (body: { token: string; device_id: string; name: string }) =>
    authedReq(`/household/invite/accept`, { method: "POST", body: JSON.stringify(body) }),
  revokeInvite: (invitationId: string, requestingDeviceId: string) =>
    authedReq(`/household/invite/${invitationId}?requesting_device_id=${requestingDeviceId}`, { method: "DELETE" }),
  pendingInvites: (householdCode: string, requestingDeviceId: string) =>
    authedReq(`/household/invite/pending/${householdCode}?requesting_device_id=${requestingDeviceId}`),
  updateRole: (body: { household_code: string; device_id: string; role: string }) =>
    authedReq(`/household/role`, { method: "PATCH", body: JSON.stringify(body) }),
  householdForDevice: (deviceId: string) => authedReq(`/household/by-device/${deviceId}`),
  careCircleMomStatus: (householdCode: string, viewerDeviceId: string) =>
    authedReq(`/household/${householdCode}/mom-status?viewer_device_id=${viewerDeviceId}`),
  updateCareCirclePermissions: (householdCode: string, requestingDeviceId: string, targetDeviceId: string, permissions: Record<string, boolean>) =>
    authedReq(`/household/care-circle/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ household_code: householdCode, requesting_device_id: requestingDeviceId, target_device_id: targetDeviceId, permissions }),
    }),
  handoffScore: (householdCode: string) => authedReq(`/handoff/score/${householdCode}`),
  handoffSwitch: (body: { household_code: string; device_id: string; note?: string }) =>
    authedReq(`/handoff/switch`, { method: "POST", body: JSON.stringify(body) }),
  handoffHistory: (householdCode: string) => authedReq(`/handoff/history/${householdCode}`),
  registerPush: (body: { device_id: string; expo_push_token: string }) =>
    authedReq(`/push/register`, { method: "POST", body: JSON.stringify(body) }),

  // ----- Give & Share -----
  shopCategories: () => req(`/shop/categories`),
  shopItems: (params?: { category?: string; device_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.device_id) qs.set("device_id", params.device_id);
    const q = qs.toString();
    return req(`/shop/items${q ? `?${q}` : ""}`);
  },
  shopItem: (itemId: string) => req(`/shop/items/${itemId}`),
  createShopItem: (body: any) => authedReq(`/shop/items`, { method: "POST", body: JSON.stringify(body) }),
  claimShopItem: (itemId: string, deviceId: string) =>
    authedReq(`/shop/items/${itemId}/claim?requesting_device_id=${deviceId}`, { method: "PATCH" }),
  deleteShopItem: (itemId: string, deviceId: string) =>
    authedReq(`/shop/items/${itemId}?requesting_device_id=${deviceId}`, { method: "DELETE" }),
  expressInterest: (itemId: string, deviceId: string) =>
    authedReq(`/shop/items/${itemId}/interest`, { method: "POST", body: JSON.stringify({ device_id: deviceId }) }),
  myShopThreads: (deviceId: string) => authedReq(`/shop/threads/${deviceId}`),
  shopThreadMessages: (threadId: string, deviceId: string) =>
    authedReq(`/shop/thread/${threadId}?requesting_device_id=${deviceId}`),
  sendShopMessage: (threadId: string, body: { device_id: string; text: string }) =>
    authedReq(`/shop/thread/${threadId}`, { method: "POST", body: JSON.stringify(body) }),

  // ----- Postpartum recovery -----
  recoveryWarningSigns: () => req(`/recovery/warning-signs`),
  recoveryCheckin: (body: any) => authedReq(`/recovery/checkin`, { method: "POST", body: JSON.stringify(body) }),
  recoveryCheckins: (deviceId: string) => authedReq(`/recovery/checkins/${deviceId}`),
  recoveryReport: (deviceId: string, days = 14) => authedReq(`/recovery/${deviceId}/report?days=${days}`),
  momWellnessLog: (deviceId: string, kind: "water" | "medication", medicationName?: string) =>
    authedReq(`/mom-wellness`, { method: "POST", body: JSON.stringify({ device_id: deviceId, kind, medication_name: medicationName }) }),
  momWellnessToday: (deviceId: string) => authedReq(`/mom-wellness/${deviceId}/today`),
  momWellnessMedicationNames: (deviceId: string) => authedReq(`/mom-wellness/${deviceId}/medication-names`),
  caregiverRestPredictions: (deviceId: string) => authedReq(`/caregiver-rest/${deviceId}/predictions`),
  homelyRecipes: () => req(`/homely/recipes`),
  homelyRecipeDetail: (recipeId: string) => req(`/homely/recipes/${recipeId}`),
  homelyRecipeShop: (recipeId: string) => req(`/homely/recipes/${recipeId}/shop`, { method: "POST" }),
  homelyScanGroceries: (imageBase64: string, mediaType = "image/jpeg") =>
    req(`/homely/scan-groceries`, { method: "POST", body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }) }),
  homelyShopMissing: (recipeId: string, missingIngredients: string[]) =>
    req(`/homely/recipes/${recipeId}/shop-missing`, { method: "POST", body: JSON.stringify({ missing_ingredients: missingIngredients }) }),
  homelyMatchRecipe: (identifiedItems: string[], excludeRecipeIds: string[] = []) =>
    req(`/homely/match-recipe`, { method: "POST", body: JSON.stringify({ identified_items: identifiedItems, exclude_recipe_ids: excludeRecipeIds }) }),
  sendEncouragement: (fromDeviceId: string, toDeviceId: string, message: string) =>
    authedReq(`/encouragement`, { method: "POST", body: JSON.stringify({ from_device_id: fromDeviceId, to_device_id: toDeviceId, message }) }),
  latestEncouragement: (deviceId: string) => authedReq(`/encouragement/${deviceId}/latest`),
  markEncouragementSeen: (deviceId: string) => authedReq(`/encouragement/${deviceId}/mark-seen`, { method: "POST" }),
  recoveryTimeline: (deviceId: string) => authedReq(`/recovery/timeline/${deviceId}`),
  recoveryToday: (deviceId: string) => authedReq(`/recovery/today/${deviceId}`),
  updateAppointment: (deviceId: string, done: boolean) =>
    authedReq(`/profile/appointment`, { method: "PATCH", body: JSON.stringify({ device_id: deviceId, postpartum_appt_done: done }) }),

  // ----- Meal support -----
  createMealTrain: (body: { device_id: string; title: string; notes?: string }) =>
    req(`/mealtrain`, { method: "POST", body: JSON.stringify(body) }),
  mealTrainForDevice: (deviceId: string) => req(`/mealtrain/by-device/${deviceId}`),
  getMealTrain: (code: string) => req(`/mealtrain/${code}`),
  signUpMealSlot: (code: string, body: { date: string; giver_name: string; giver_contact?: string; meal_description?: string }) =>
    req(`/mealtrain/${code}/slots`, { method: "POST", body: JSON.stringify(body) }),
  cancelMealSlot: (code: string, slotId: string, slotToken: string) =>
    req(`/mealtrain/${code}/slots/${slotId}?slot_token=${encodeURIComponent(slotToken)}`, { method: "DELETE" }),
  mealCheckin: (deviceId: string, ateToday: boolean) =>
    req(`/meal-checkin`, { method: "POST", body: JSON.stringify({ device_id: deviceId, ate_today: ateToday }) }),
  mealCheckinToday: (deviceId: string) => req(`/meal-checkin/${deviceId}/today`),

  // ----- Dad's Corner -----
  dadCheckinQuestions: () => req(`/dad-checkin/questions`),
  dadTips: () => req(`/dad-tips`),
  submitDadCheckin: (body: { device_id: string; answers: number[] }) =>
    req(`/dad-checkin`, { method: "POST", body: JSON.stringify(body) }),
  dadCheckinHistory: (deviceId: string) => req(`/dad-checkin/${deviceId}`),

  // ----- Baby Brain Capture -----
  createBrainNote: (body: { device_id: string; text: string; category?: string }) =>
    authedReq(`/brain-notes`, { method: "POST", body: JSON.stringify(body) }),
  brainNotes: (deviceId: string, includeDone = false) =>
    authedReq(`/brain-notes/${deviceId}${includeDone ? "?include_done=true" : ""}`),
  completeBrainNote: (noteId: string, deviceId: string) =>
    authedReq(`/brain-notes/${noteId}/done?requesting_device_id=${deviceId}`, { method: "PATCH" }),
  deleteBrainNote: (noteId: string, deviceId: string) =>
    authedReq(`/brain-notes/${noteId}?requesting_device_id=${deviceId}`, { method: "DELETE" }),

  // ----- Neighborhood Meetups -----
  meetupNeighborhoods: () => req(`/meetups/neighborhoods`),
  meetupCategories: () => req(`/meetups/categories`),
  meetupVenues: (neighborhood: string) => req(`/meetups/venues/${neighborhood}`),
  meetupVenuesNear: (lat: number, lng: number) => req(`/meetups/venues-near?lat=${lat}&lng=${lng}`),
  recommendedVenues: (neighborhood: string) => req(`/meetups/venues/${neighborhood}/recommended`),
  createMeetup: (body: any) => req(`/meetups`, { method: "POST", body: JSON.stringify(body) }),
  listMeetups: (params?: { neighborhood?: string; category?: string; cultural_tag?: string; lat?: number; lng?: number; radius_km?: number }) => {
    const qs = new URLSearchParams();
    if (params?.neighborhood) qs.set("neighborhood", params.neighborhood);
    if (params?.category) qs.set("category", params.category);
    if (params?.cultural_tag) qs.set("cultural_tag", params.cultural_tag);
    if (params?.lat != null) qs.set("lat", String(params.lat));
    if (params?.lng != null) qs.set("lng", String(params.lng));
    if (params?.radius_km != null) qs.set("radius_km", String(params.radius_km));
    const q = qs.toString();
    return req(`/meetups${q ? `?${q}` : ""}`);
  },
  myMeetups: (deviceId: string) => req(`/meetups/mine/${deviceId}`),
  getMeetup: (meetupId: string) => req(`/meetups/${meetupId}`),
  rsvpMeetup: (meetupId: string, body: { device_id: string; name: string }) =>
    req(`/meetups/${meetupId}/rsvp`, { method: "POST", body: JSON.stringify(body) }),
  cancelRsvp: (meetupId: string, deviceId: string) =>
    req(`/meetups/${meetupId}/rsvp/${deviceId}`, { method: "DELETE" }),
  meetupIcsUrl: (meetupId: string) => `${API}/meetups/${meetupId}/calendar.ics`,
  submitMeetupReflection: (meetupId: string, body: { device_id: string; mood_after: number; note?: string }) =>
    req(`/meetups/${meetupId}/reflection`, { method: "POST", body: JSON.stringify(body) }),

  // ----- Agentic features -----
  sos: (body: { household_code: string; device_id: string; note?: string }) =>
    authedReq(`/handoff/sos`, { method: "POST", body: JSON.stringify(body) }),
  weeklyInsights: (deviceId: string, force = false) =>
    authedReq(`/insights/weekly/${deviceId}${force ? "?force=true" : ""}`),

  // ----- Celebrations -----
  celebrationVendors: (category?: string) =>
    req(`/celebrations/vendors${category ? `?category=${category}` : ""}`),

  // ----- Personal Events (appointments + celebrations) -----
  eventCategories: () => req(`/events/categories`),
  extractEventFromPhoto: (imageBase64: string, mediaType = "image/jpeg") =>
    req(`/events/extract`, { method: "POST", body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }) }),
  createEvent: (body: any) => req(`/events`, { method: "POST", body: JSON.stringify(body) }),
  listEvents: (deviceId: string) => req(`/events/${deviceId}`),
  deleteEvent: (eventId: string) => req(`/events/${eventId}`, { method: "DELETE" }),
  eventIcsUrl: (eventId: string) => `${API}/events/${eventId}/calendar.ics`,
  checkEventReminders: (deviceId: string) => req(`/events/${deviceId}/check-reminders`),

  // ----- Catch Me Up -----
  catchUp: (deviceId: string) => authedReq(`/catchup/${deviceId}`),

  // ----- Wellbeing self-check -----
  wellbeingSelfCheck: (deviceId: string) => authedReq(`/wellbeing/self-check/${deviceId}`),
  predictiveFeedNudge: (deviceId: string) => authedReq(`/baby-log/${deviceId}/predictive-nudge`),
  predictiveSleepNudge: (deviceId: string) => authedReq(`/baby-log/${deviceId}/predictive-sleep-nudge`),
  predictivePoopNudge: (deviceId: string) => authedReq(`/baby-log/${deviceId}/predictive-poop-nudge`),

  // ----- Postpartum Support Directory -----
  supportCategories: () => req(`/support-directory/categories`),
  supportProviders: (category?: string) => req(`/support-directory${category ? `?category=${category}` : ""}`),

  // ----- Account -----
  deleteAccount: (deviceId: string) => authedReq(`/account/${deviceId}`, { method: "DELETE" }),
};
