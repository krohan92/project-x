import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { api } from "@/src/lib/api";
import { useProfile } from "@/src/lib/profile-context";
import { colors, roleAccent } from "@/src/theme/theme";

type AmbientState = {
  // The gentle background tint to use for the current on-duty caregiver.
  // Falls back to the app's normal warm cream when there's no Tag Team
  // household set up yet, or nobody's on duty.
  tint: string;
  role: string | null;
};

const AmbientContext = createContext<AmbientState>({ tint: colors.surface, role: null });

const POLL_MS = 45000; // gentle refresh, not real-time — this is ambient, not urgent

export function AmbientProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useProfile();
  const [state, setState] = useState<AmbientState>({ tint: colors.surface, role: null });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    try {
      const household = await api.householdForDevice(deviceId);
      if (!household || !household.on_duty_device_id) {
        setState({ tint: colors.surface, role: null });
        return;
      }
      const onDuty = household.members.find((m: any) => m.device_id === household.on_duty_device_id);
      const accent = roleAccent(onDuty?.role);
      setState({ tint: accent ? accent.tint : colors.surface, role: onDuty?.role || null });
    } catch {
      // no household yet, or a transient error — keep the neutral background
      setState({ tint: colors.surface, role: null });
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

  return <AmbientContext.Provider value={state}>{children}</AmbientContext.Provider>;
}

export function useAmbient() {
  return useContext(AmbientContext);
}
