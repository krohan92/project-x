import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const API = `${BASE}/api`;

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

async function req(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
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
  getProfile: (deviceId: string) => req(`/profile/${deviceId}`),
  saveProfile: (p: Profile) =>
    req(`/profile`, { method: "POST", body: JSON.stringify(p) }),

  quote: () => req(`/quote`),
  tips: () => req(`/tips`),
  helplines: () => req(`/helplines`),
  pumpProviders: () => req(`/pump-providers`),

  addMood: (body: any) =>
    req(`/mood`, { method: "POST", body: JSON.stringify(body) }),
  getMoods: (deviceId: string) => req(`/mood/${deviceId}`),
  moodToday: (deviceId: string) => req(`/mood/${deviceId}/today`),

  epdsQuestions: () => req(`/epds/questions`),
  submitEpds: (body: any) =>
    req(`/epds`, { method: "POST", body: JSON.stringify(body) }),
  epdsHistory: (deviceId: string) => req(`/epds/${deviceId}`),
  doctorReport: (deviceId: string, days = 90) => req(`/mood/${deviceId}/doctor-report?days=${days}`),
  exportFullReport: (deviceId: string, days = 30) => req(`/export/full-report/${deviceId}?days=${days}`),
  activityPing: (deviceId: string) =>
    req(`/activity/ping`, { method: "POST", body: JSON.stringify({ device_id: deviceId }) }),
  setChatMoodTracking: (deviceId: string, enabled: boolean) =>
    req(`/profile/${deviceId}/chat-mood-tracking`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  setUnitSystem: (deviceId: string, unitSystem: "oz" | "ml") =>
    req(`/profile/${deviceId}/unit-system`, { method: "PATCH", body: JSON.stringify({ unit_system: unitSystem }) }),

  chatHistory: (sessionId: string) => req(`/chat/${sessionId}`),
  sendChat: (body: any) =>
    req(`/chat`, { method: "POST", body: JSON.stringify(body) }),

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
    req(`/nearby/settings`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEthnicity: (deviceId: string) =>
    req(`/nearby/ethnicity/${deviceId}`, { method: "DELETE" }),

  presenceToggle: (body: any) =>
    req(`/presence/toggle`, { method: "POST", body: JSON.stringify(body) }),
  presenceActive: (deviceId: string) => req(`/presence/active?device_id=${deviceId}`),

  babyLog: (body: any) =>
    req(`/baby-log`, { method: "POST", body: JSON.stringify(body) }),
  babyLogs: (deviceId: string) => req(`/baby-log/${deviceId}`),
  babyLogSummary: (deviceId: string) => req(`/baby-log/${deviceId}/summary`),
  sleepSessionStart: (deviceId: string, subject: "baby" | "self") =>
    req(`/sleep-session/start`, { method: "POST", body: JSON.stringify({ device_id: deviceId, subject }) }),
  sleepSessionStop: (deviceId: string, subject: "baby" | "self") =>
    req(`/sleep-session/stop`, { method: "POST", body: JSON.stringify({ device_id: deviceId, subject }) }),
  sleepSessionActive: (deviceId: string) => req(`/sleep-session/active/${deviceId}`),
  pumpSessionToggle: (deviceId: string, side: "left" | "right") =>
    req(`/pump-session/toggle`, { method: "POST", body: JSON.stringify({ device_id: deviceId, side }) }),
  pumpSessionActive: (deviceId: string) => req(`/pump-session/active/${deviceId}`),
  pumpSessionFinish: (deviceId: string, leftMl?: number, rightMl?: number) =>
    req(`/pump-session/finish/${deviceId}`, {
      method: "POST",
      body: JSON.stringify({ left_ml: leftMl ?? null, right_ml: rightMl ?? null }),
    }),
  pumpSessionInsight: (deviceId: string) => req(`/pump-session/insight/${deviceId}`),
  pumpSessionTrend: (deviceId: string, days = 14) => req(`/pump-session/trend/${deviceId}?days=${days}`),
  pumpSymptomCheck: (deviceId: string, side: string, hasSymptoms: boolean, symptoms: string[] = []) =>
    req(`/pump-session/symptom-check`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId, side, has_symptoms: hasSymptoms, symptoms }),
    }),
  feedNextSide: (deviceId: string) => req(`/feed/next-side/${deviceId}`),
  babyLogPredictions: (deviceId: string) => req(`/baby-log/${deviceId}/predictions`),
  handoffBalance: (householdCode: string) => req(`/handoff/balance/${householdCode}`),

  spaces: (deviceId: string) => req(`/spaces/${deviceId}`),
  joinSpace: (body: any) =>
    req(`/spaces/join`, { method: "POST", body: JSON.stringify(body) }),
  leaveSpace: (body: any) =>
    req(`/spaces/leave`, { method: "POST", body: JSON.stringify(body) }),

  guides: (culture?: string) =>
    req(`/guides${culture ? `?culture=${encodeURIComponent(culture)}` : ""}`),

  // ----- Caregiver hand-off ("Tag Out") -----
  createHousehold: (body: { device_id: string; name: string; role?: string }) =>
    req(`/household`, { method: "POST", body: JSON.stringify(body) }),
  joinHousehold: (body: { device_id: string; household_code: string; name: string; role?: string }) =>
    req(`/household/join`, { method: "POST", body: JSON.stringify(body) }),
  updateRole: (body: { household_code: string; device_id: string; role: string }) =>
    req(`/household/role`, { method: "PATCH", body: JSON.stringify(body) }),
  householdForDevice: (deviceId: string) => req(`/household/by-device/${deviceId}`),
  handoffScore: (householdCode: string) => req(`/handoff/score/${householdCode}`),
  handoffSwitch: (body: { household_code: string; device_id: string; note?: string }) =>
    req(`/handoff/switch`, { method: "POST", body: JSON.stringify(body) }),
  handoffHistory: (householdCode: string) => req(`/handoff/history/${householdCode}`),
  registerPush: (body: { device_id: string; expo_push_token: string }) =>
    req(`/push/register`, { method: "POST", body: JSON.stringify(body) }),

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
  createShopItem: (body: any) => req(`/shop/items`, { method: "POST", body: JSON.stringify(body) }),
  claimShopItem: (itemId: string) => req(`/shop/items/${itemId}/claim`, { method: "PATCH" }),
  deleteShopItem: (itemId: string) => req(`/shop/items/${itemId}`, { method: "DELETE" }),
  expressInterest: (itemId: string, deviceId: string) =>
    req(`/shop/items/${itemId}/interest`, { method: "POST", body: JSON.stringify({ device_id: deviceId }) }),
  myShopThreads: (deviceId: string) => req(`/shop/threads/${deviceId}`),
  shopThreadMessages: (threadId: string) => req(`/shop/thread/${threadId}`),
  sendShopMessage: (threadId: string, body: { device_id: string; text: string }) =>
    req(`/shop/thread/${threadId}`, { method: "POST", body: JSON.stringify(body) }),

  // ----- Postpartum recovery -----
  recoveryWarningSigns: () => req(`/recovery/warning-signs`),
  recoveryCheckin: (body: any) => req(`/recovery/checkin`, { method: "POST", body: JSON.stringify(body) }),
  recoveryCheckins: (deviceId: string) => req(`/recovery/checkins/${deviceId}`),
  recoveryReport: (deviceId: string, days = 14) => req(`/recovery/${deviceId}/report?days=${days}`),
  momWellnessLog: (deviceId: string, kind: "water" | "medication", medicationName?: string) =>
    req(`/mom-wellness`, { method: "POST", body: JSON.stringify({ device_id: deviceId, kind, medication_name: medicationName }) }),
  momWellnessToday: (deviceId: string) => req(`/mom-wellness/${deviceId}/today`),
  momWellnessMedicationNames: (deviceId: string) => req(`/mom-wellness/${deviceId}/medication-names`),
  caregiverRestPredictions: (deviceId: string) => req(`/caregiver-rest/${deviceId}/predictions`),
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
    req(`/encouragement`, { method: "POST", body: JSON.stringify({ from_device_id: fromDeviceId, to_device_id: toDeviceId, message }) }),
  latestEncouragement: (deviceId: string) => req(`/encouragement/${deviceId}/latest`),
  markEncouragementSeen: (deviceId: string) => req(`/encouragement/${deviceId}/mark-seen`, { method: "POST" }),
  recoveryTimeline: (deviceId: string) => req(`/recovery/timeline/${deviceId}`),
  recoveryToday: (deviceId: string) => req(`/recovery/today/${deviceId}`),
  updateAppointment: (deviceId: string, done: boolean) =>
    req(`/profile/appointment`, { method: "PATCH", body: JSON.stringify({ device_id: deviceId, postpartum_appt_done: done }) }),

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
    req(`/brain-notes`, { method: "POST", body: JSON.stringify(body) }),
  brainNotes: (deviceId: string, includeDone = false) =>
    req(`/brain-notes/${deviceId}${includeDone ? "?include_done=true" : ""}`),
  completeBrainNote: (noteId: string) => req(`/brain-notes/${noteId}/done`, { method: "PATCH" }),
  deleteBrainNote: (noteId: string) => req(`/brain-notes/${noteId}`, { method: "DELETE" }),

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
    req(`/handoff/sos`, { method: "POST", body: JSON.stringify(body) }),
  weeklyInsights: (deviceId: string, force = false) =>
    req(`/insights/weekly/${deviceId}${force ? "?force=true" : ""}`),

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
  catchUp: (deviceId: string) => req(`/catchup/${deviceId}`),

  // ----- Wellbeing self-check -----
  wellbeingSelfCheck: (deviceId: string) => req(`/wellbeing/self-check/${deviceId}`),
  predictiveFeedNudge: (deviceId: string) => req(`/baby-log/${deviceId}/predictive-nudge`),
  predictiveSleepNudge: (deviceId: string) => req(`/baby-log/${deviceId}/predictive-sleep-nudge`),
  predictivePoopNudge: (deviceId: string) => req(`/baby-log/${deviceId}/predictive-poop-nudge`),

  // ----- Postpartum Support Directory -----
  supportCategories: () => req(`/support-directory/categories`),
  supportProviders: (category?: string) => req(`/support-directory${category ? `?category=${category}` : ""}`),

  // ----- Account -----
  deleteAccount: (deviceId: string) => req(`/account/${deviceId}`, { method: "DELETE" }),
};
