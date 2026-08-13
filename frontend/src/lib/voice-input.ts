import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * Voice-to-text for the Talk screen. Uses the browser's built-in Web Speech
 * API — works in Chrome/Edge/Safari on both desktop and mobile web, no
 * extra library needed since this app currently runs as a web build.
 *
 * IMPORTANT LIMITATION: this only works on web. A native build would need
 * a native speech-to-text library (e.g. @react-native-voice/voice), which
 * isn't installed here — this quietly reports "unavailable" on native
 * rather than pretending to work.
 */
export function useVoiceInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const available =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = useCallback(() => {
    if (!available) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript;
      if (text) onResult(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [available, onResult]);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setListening(false);
  }, []);

  return { available, listening, start, stop };
}
