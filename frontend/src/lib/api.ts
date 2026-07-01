import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const API = `${BASE}/api`;

const DEVICE_KEY = "aura_device_id";

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
  created_at?: string;
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
};
