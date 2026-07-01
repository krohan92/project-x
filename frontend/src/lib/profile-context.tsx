import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { api, getDeviceId, Profile } from "@/src/lib/api";

type Ctx = {
  loading: boolean;
  deviceId: string | null;
  profile: Profile | null;
  refresh: () => Promise<void>;
  setProfile: (p: Profile | null) => void;
};

const ProfileContext = createContext<Ctx>({
  loading: true,
  deviceId: null,
  profile: null,
  refresh: async () => {},
  setProfile: () => {},
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const refresh = useCallback(async () => {
    try {
      const id = await getDeviceId();
      setDeviceId(id);
      try {
        const p = await api.getProfile(id);
        setProfile(p);
      } catch {
        setProfile(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ProfileContext.Provider
      value={{ loading, deviceId, profile, refresh, setProfile }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
