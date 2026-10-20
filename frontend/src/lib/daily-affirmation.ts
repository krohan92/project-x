import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

/**
 * Daily affirmation: a gentle local notification that appears on the lock
 * screen once a day. Fully on-device (no server, no push token), so it works
 * offline and sends nothing about the user anywhere.
 *
 * We schedule the next 14 days at once, each with a different line, and
 * top the schedule up every time the app opens.
 */

const KEY_ENABLED = "affirmation_enabled";
const KEY_HOUR = "affirmation_hour";
const KEY_MINUTE = "affirmation_minute";
const ID_PREFIX = "cuddle-affirmation-";
const DAYS_AHEAD = 14;

export const AFFIRMATIONS = [
  "Right now, in this moment, you are enough.",
  "Take a slow breath. You are safe, and you are doing okay.",
  "You don't have to be perfect today. Just present.",
  "Rest isn't something you earn. It's something you deserve.",
  "The days are long, but the years are short. Be gentle with today.",
  "You are doing a beautiful job, even on the days it doesn't feel like it.",
  "Your baby doesn't need a perfect mother. They need a present one, and you are here.",
  "You can love this life and still find parts of it hard. Both are true.",
  "Asking for help is not giving up. It's how you keep going.",
  "Small moments count. A held gaze, a soft word: you're building something real.",
  "You get to have needs too. Meeting them isn't selfish, it's sustainable.",
  "One gentle moment at a time is enough.",
  "Drink some water. Eat something warm. You matter too.",
  "Whatever today holds, you don't have to carry it alone.",
];

export type AffirmationSettings = { enabled: boolean; hour: number; minute: number };

export const DEFAULT_SETTINGS: AffirmationSettings = { enabled: false, hour: 8, minute: 0 };

export async function loadAffirmationSettings(): Promise<AffirmationSettings> {
  const enabled = await storage.getItem(KEY_ENABLED, false);
  const hour = await storage.getItem(KEY_HOUR, DEFAULT_SETTINGS.hour);
  const minute = await storage.getItem(KEY_MINUTE, DEFAULT_SETTINGS.minute);
  return {
    enabled: !!enabled,
    hour: typeof hour === "number" ? hour : DEFAULT_SETTINGS.hour,
    minute: typeof minute === "number" ? minute : DEFAULT_SETTINGS.minute,
  };
}

async function cancelAffirmations(Notifications: typeof import("expo-notifications")) {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

async function scheduleAffirmations(settings: AffirmationSettings) {
  const Notifications = await import("expo-notifications");
  await cancelAffirmations(Notifications);
  if (!settings.enabled) return;

  const now = new Date();
  // Rotate the starting line by day-of-year so the order is stable per day.
  const dayOfYear = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(now.getFullYear(), 0, 0)) / 86400000,
  );

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, settings.hour, settings.minute, 0);
    if (when.getTime() <= now.getTime() + 30_000) continue; // already passed today
    const text = AFFIRMATIONS[(dayOfYear + i) % AFFIRMATIONS.length];
    await Notifications.scheduleNotificationAsync({
      identifier: `${ID_PREFIX}${i}`,
      content: { title: "A little note from Cuddle", body: text },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
      },
    });
  }
}

/** Save settings and (re)schedule. Returns false if permission was refused. */
export async function saveAffirmationSettings(settings: AffirmationSettings): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    if (settings.enabled) {
      const Notifications = await import("expo-notifications");
      const { status: existing } = await Notifications.getPermissionsAsync();
      let status = existing;
      if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
      if (status !== "granted") return false;
    }
    await storage.setItem(KEY_ENABLED, settings.enabled);
    await storage.setItem(KEY_HOUR, settings.hour);
    await storage.setItem(KEY_MINUTE, settings.minute);
    await scheduleAffirmations(settings);
    return true;
  } catch {
    return false;
  }
}

/** Call on app launch to keep the rolling 14-day window topped up. */
export async function refreshAffirmationSchedule(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const s = await loadAffirmationSettings();
    if (s.enabled) await scheduleAffirmations(s);
  } catch {
    // Quiet failure: the affirmation is a nicety, never worth an error.
  }
}
