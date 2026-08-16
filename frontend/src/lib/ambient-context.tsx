import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { colors, roleAccent } from "@/src/theme/theme";
import { storage } from "@/src/utils/storage";

const TINT_CACHE_KEY = "last_ambient_tint";

type AmbientState = {
  // The gentle background tint to use for the current on-duty caregiver.
  // Falls back to the app's normal warm cream when there's no Tag Team
  // household set up yet, or nobody's on duty.
  tint: string;
  role: string | null;
  refresh: () => void;
};

const AmbientContext = createContext<AmbientState>({ tint: colors.surface, role: null, refresh: () => {} });

const POLL_MS = 45000; // gentle background refresh — actions that change duty call refresh() directly instead of waiting

export function AmbientProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useProfile();
  const [state, setState] = useState<{ tint: string; role: string | null }>({ tint: colors.surface, role: null });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore whatever tint was showing last time, immediately, before any
  // network call resolves — this is what removes the visible "pop" from a
  // plain background to the real color on every app open. If it turns out
  // to be wrong (duty changed while the app was closed), refresh() below
  // still corrects it moments later, just without the jarring blank start.
  useEffect(() => {
    storage.getItem<string>(TINT_CACHE_KEY, "").then((cached) => {
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.tint) setState(parsed);
        } catch {}
      }
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    try {
      const household = await api.householdForDevice(deviceId);
      let next: { tint: string; role: string | null };
      if (!household || !household.on_duty_device_id) {
        next = { tint: colors.surface, role: null };
      } else {
        const onDuty = household.members.find((m: any) => m.device_id === household.on_duty_device_id);
        const accent = roleAccent(onDuty?.role);
        next = { tint: accent ? accent.tint : colors.surface, role: onDuty?.role || null };
      }
      setState(next);
      storage.setItem(TINT_CACHE_KEY, JSON.stringify(next));
    } catch {
      // no household yet, or a transient error — keep whatever was showing
      // (the cached/current tint) rather than resetting to neutral, since a
      // network hiccup isn't evidence the real tint actually changed.
    }
  }, [deviceId]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
      sub.remove();
    };
  }, [refresh]);

  return <AmbientContext.Provider value={{ ...state, refresh }}>{children}</AmbientContext.Provider>;
}

export function useAmbient() {
  return useContext(AmbientContext);
}
