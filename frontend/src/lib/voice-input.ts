import { useCallback, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

/**
 * Voice-to-text for the Talk screen.
 *
 * Uses expo-speech-recognition, which wraps the real native speech engines
 * on each platform — SFSpeechRecognizer on iOS, SpeechRecognizer on
 * Android — and falls back to the browser's Web Speech API automatically
 * when running on web. This replaces the old implementation, which only
 * ever worked in a browser and silently did nothing on a real iPhone.
 *
 * Requires a development/production build (EAS build), not Expo Go —
 * this project already builds with EAS, so no extra step is needed there.
 */
export function useVoiceInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  // Accumulates across pauses in continuous mode — without this, switching
  // continuous on would send each natural pause as its own separate
  // message instead of waiting for the whole thought.
  const accumulatedRef = useRef("");

  useSpeechRecognitionEvent("start", () => {
    accumulatedRef.current = "";
    setListening(true);
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    const finalText = accumulatedRef.current.trim();
    accumulatedRef.current = "";
    if (finalText) {
      onResultRef.current(finalText);
    }
  });
  useSpeechRecognitionEvent("error", (event: any) => {
    console.log("voice input error:", event?.error, event?.message);
    setListening(false);
  });
  useSpeechRecognitionEvent("result", (event: any) => {
    const text = event?.results?.[0]?.transcript;
    if (text && event?.isFinal) {
      // Continuous mode can emit several final segments as she pauses
      // between thoughts — append instead of overwriting, and don't
      // fire onResult until listening actually ends (see "end" above),
      // so a full multi-sentence message goes through as one message.
      accumulatedRef.current = accumulatedRef.current ? `${accumulatedRef.current} ${text}` : text;
    }
  });

  const start = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: false,
        maxAlternatives: 1,
        // Was false — on iOS that means the recognizer gives up after
        // just 3 seconds of silence, which cuts off completely normal
        // speech any time she pauses mid-thought (exactly what was
        // reported). true lets her speak in full, natural sentences with
        // real pauses, and keeps listening until she actually stops it.
        continuous: true,
      });
    } catch (e) {
      console.log("voice input failed to start:", e);
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {}
    setListening(false);
  }, []);

  // Always show the mic button — permission is requested the first time
  // she taps it, same as the camera flow in Pantry Snap and Mama's
  // Calendar, rather than trying to pre-detect availability.
  return { available: !permissionDenied, listening, start, stop };
}
