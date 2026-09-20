import { Platform } from "react-native";
import { getDeviceId, api } from "@/src/lib/api";

/**
 * Bridges Siri/Shortcuts to the exact same backend calls the app's own
 * screens already use — logging a feed reuses the same /baby-log endpoint
 * Track and Talk to Cuddle's chat tools call, sleep start/stop reuses the
 * same session endpoints Track uses, so there's exactly one source of
 * truth for what "logging a feed" means, not a second copy of the logic.
 *
 * Call registerSiriIntentHandlers() once, high up in the app (the root
 * layout), so it's listening for the whole life of the app.
 *
 * IMPORTANT: expo-ios-app-intents has no web or Android implementation at
 * all (verified directly against its source — no .web.ts, no android/
 * folder in the package). A plain top-level `import` of it would still
 * evaluate and throw on those platforms even if the call site is guarded,
 * since ES module imports run immediately when the file loads. Using a
 * lazy require() inside the iOS-only branch avoids that entirely.
 */
export function registerSiriIntentHandlers() {
  if (Platform.OS !== "ios") return;

  // NOTE: Siri integration is paused for now — expo-ios-app-intents is not
  // actually published on npm (confirmed by direct registry check), so it
  // can't be installed via a normal package.json dependency. Re-enable
  // this once either that package is published for real, or Expo's own
  // expo-app-intents graduates past SDK 58 preview/alpha status.
  // See the code below for the intended implementation once unblocked.
  return;

  /*
  const ExpoAppIntents = require("expo-ios-app-intents").default;
  type IntentEventPayload = { name: string; id: string; parameters: any };

  ExpoAppIntents.addListener("onIntent", async (event: IntentEventPayload) => {
    try {
      const deviceId = await getDeviceId();

      switch (event.name) {
        case "LogFeed": {
          const ounces = Number(event.parameters?.ounces);
          if (!ounces || ounces <= 0) {
            ExpoAppIntents.failIntent(event.id, { error: "I didn't catch how many ounces." });
            return;
          }
          const amountMl = Math.round(ounces * 29.5735);
          await api.babyLog({ device_id: deviceId, kind: "feed", amount_ml: amountMl });
          ExpoAppIntents.completeIntent(event.id, {
            value: `Logged a ${ounces} ounce feed in Cuddle.`,
          });
          return;
        }

        case "StartBabySleep": {
          await api.sleepSessionStart(deviceId, "baby");
          ExpoAppIntents.completeIntent(event.id, {
            value: "Started tracking baby's sleep in Cuddle.",
          });
          return;
        }

        case "StopBabySleep": {
          const result = await api.sleepSessionStop(deviceId, "baby");
          const minutes = result?.duration_minutes;
          ExpoAppIntents.completeIntent(event.id, {
            value:
              typeof minutes === "number"
                ? `Baby slept for about ${minutes} minutes, logged in Cuddle.`
                : "Ended baby's sleep session in Cuddle.",
          });
          return;
        }

        case "TagTeamStatus": {
          const household = await api.householdForDevice(deviceId);
          if (!household) {
            ExpoAppIntents.completeIntent(event.id, {
              value: "You're not in a Tag Team household yet.",
            });
            return;
          }
          const score = await api.handoffScore(household.household_code);
          const onDutyMember = household.members?.find(
            (m: any) => m.device_id === score.on_duty_device_id
          );
          const who = onDutyMember?.name || "Someone";
          ExpoAppIntents.completeIntent(event.id, {
            value: `${who} has been on duty for about ${score.hours_on_duty} hours. ${score.message}`,
          });
          return;
        }

        default:
          ExpoAppIntents.failIntent(event.id, { error: `Unknown intent: ${event.name}` });
      }
    } catch (e: any) {
      console.log("Siri intent handling failed:", e);
      ExpoAppIntents.failIntent(event.id, { error: "Something went wrong in Cuddle." });
    }
  });
  */
}
