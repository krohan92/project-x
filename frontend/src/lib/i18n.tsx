import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { storage } from "@/src/utils/storage";
import { useProfile } from "@/src/lib/profile-context";

export type Lang = "en" | "es" | "hi";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "hi", label: "हिन्दी" },
];

type Dict = Record<string, string>;

const en: Dict = {
  "tab.today": "Today",
  "tab.beacon": "Beacon",
  "tab.track": "Track",
  "tab.circle": "Circle",
  "tab.care": "Care",

  "common.settings": "Settings",
  "common.save": "Save",
  "common.saved": "Saved",
  "common.remove": "Remove",
  "common.cancel": "Cancel",
  "common.join": "Join",
  "common.leave": "Leave",
  "common.done": "Done",
  "common.optional": "Optional",

  "beacon.title": "Your Beacon",
  "beacon.subtitle": "Light your beacon when you're awake — find others who are too.",
  "beacon.light": "Light your beacon",
  "beacon.on": "Your beacon is lit",
  "beacon.onDesc": "Other awake moms can see an anonymized glow near you.",
  "beacon.offDesc": "You're invisible on the map right now.",
  "beacon.momsAwake": "moms awake nearby",
  "beacon.findPeer": "Find someone to talk to",
  "beacon.finding": "Finding a gentle match...",
  "beacon.mapPrivacy": "Locations are randomized by up to 10 miles. No one ever sees your exact spot or name.",
  "beacon.prefLabel": "Matching preference",
  "beacon.locNote": "We use your approximate location only to place an anonymized pin.",

  "settings.title": "Beacon Settings",
  "settings.language": "Language",
  "settings.matching": "Peer matching preference",
  "settings.pref.similar": "Prefer similar cultural background",
  "settings.pref.none": "No preference",
  "settings.pref.diverse": "Prefer diverse matches",
  "settings.culturalBg": "Cultural background",
  "settings.culturalBgHint": "Optional and private. Used only for matching if you choose. Never shown to others unless you both opt in.",
  "settings.displayTags": "Show my background to matches",
  "settings.displayTagsHint": "Off by default. Only shown if your match also turns this on.",
  "settings.allowCultural": "Allow others to match with me by background",
  "settings.removeData": "Remove my cultural data",
  "settings.removeDataHint": "Permanently deletes your cultural background and disables cultural matching.",
  "settings.privacy": "Your cultural data is optional, editable, and deletable anytime. It is never sold or shared with third parties.",
  "settings.none": "Not set",

  "track.title": "Baby & Me",
  "track.logFeed": "Feed",
  "track.logSleep": "Sleep",
  "track.logDiaper": "Diaper",
  "track.logged": "Logged",
  "track.recent": "Recent activity",
  "track.noLogs": "No logs yet. Tap above to start tracking.",
  "track.logMood": "Log today's mood",
  "track.moodTrends": "Mood trends",
  "track.wellbeing": "Wellbeing check (EPDS)",
  "track.section.baby": "Quick log",
  "track.section.me": "For you",

  "peer.title": "Peer chat",
  "peer.anon": "You're both anonymous. Be kind — this is a safe, private space.",
  "peer.placeholder": "Write a gentle message...",
  "peer.matchedPref": "Matched on your shared background",
  "peer.matchedDiverse": "Matched for a fresh perspective",
  "peer.matchedFallback": "Matched with an available mom",
  "peer.demo": "Demo peer — real moms reply when online together.",

  "care.guides": "Guides & Resources",
  "care.culturalFirst": "Showing practices relevant to your background first.",

  "circle.spaces": "Spaces",
  "circle.manageSpaces": "Cultural spaces",
  "circle.general": "General",
};

const es: Dict = {
  "tab.today": "Hoy",
  "tab.beacon": "Faro",
  "tab.track": "Registro",
  "tab.circle": "Círculo",
  "tab.care": "Cuidado",

  "common.settings": "Ajustes",
  "common.save": "Guardar",
  "common.saved": "Guardado",
  "common.remove": "Eliminar",
  "common.cancel": "Cancelar",
  "common.join": "Unirse",
  "common.leave": "Salir",
  "common.done": "Listo",
  "common.optional": "Opcional",

  "beacon.title": "Tu Faro",
  "beacon.subtitle": "Enciende tu faro cuando estés despierta y encuentra a otras que también lo están.",
  "beacon.light": "Enciende tu faro",
  "beacon.on": "Tu faro está encendido",
  "beacon.onDesc": "Otras mamás despiertas ven un brillo anónimo cerca de ti.",
  "beacon.offDesc": "Ahora eres invisible en el mapa.",
  "beacon.momsAwake": "mamás despiertas cerca",
  "beacon.findPeer": "Buscar con quién hablar",
  "beacon.finding": "Buscando una conexión...",
  "beacon.mapPrivacy": "Las ubicaciones se aleatorizan hasta 16 km. Nadie ve tu lugar exacto ni tu nombre.",
  "beacon.prefLabel": "Preferencia de conexión",
  "beacon.locNote": "Usamos tu ubicación aproximada solo para colocar un punto anónimo.",

  "settings.title": "Ajustes del Faro",
  "settings.language": "Idioma",
  "settings.matching": "Preferencia de conexión",
  "settings.pref.similar": "Prefiero un origen cultural similar",
  "settings.pref.none": "Sin preferencia",
  "settings.pref.diverse": "Prefiero conexiones diversas",
  "settings.culturalBg": "Origen cultural",
  "settings.culturalBgHint": "Opcional y privado. Solo se usa para conectar si tú eliges. Nunca se muestra a otras salvo que ambas lo permitan.",
  "settings.displayTags": "Mostrar mi origen a mis conexiones",
  "settings.displayTagsHint": "Desactivado por defecto. Solo se muestra si tu conexión también lo activa.",
  "settings.allowCultural": "Permitir que me conecten por origen",
  "settings.removeData": "Eliminar mis datos culturales",
  "settings.removeDataHint": "Elimina permanentemente tu origen cultural y desactiva la conexión cultural.",
  "settings.privacy": "Tus datos culturales son opcionales, editables y eliminables en cualquier momento. Nunca se venden ni se comparten.",
  "settings.none": "Sin definir",

  "track.title": "Bebé y Yo",
  "track.logFeed": "Toma",
  "track.logSleep": "Sueño",
  "track.logDiaper": "Pañal",
  "track.logged": "Registrado",
  "track.recent": "Actividad reciente",
  "track.noLogs": "Sin registros aún. Toca arriba para empezar.",
  "track.logMood": "Registrar mi ánimo de hoy",
  "track.moodTrends": "Tendencias de ánimo",
  "track.wellbeing": "Chequeo de bienestar (EPDS)",
  "track.section.baby": "Registro rápido",
  "track.section.me": "Para ti",

  "peer.title": "Chat entre mamás",
  "peer.anon": "Ambas son anónimas. Sé amable: este es un espacio seguro y privado.",
  "peer.placeholder": "Escribe un mensaje amable...",
  "peer.matchedPref": "Conexión por origen compartido",
  "peer.matchedDiverse": "Conexión para una nueva perspectiva",
  "peer.matchedFallback": "Conexión con una mamá disponible",
  "peer.demo": "Mamá de demostración — las mamás reales responden cuando están en línea juntas.",

  "care.guides": "Guías y Recursos",
  "care.culturalFirst": "Mostrando primero prácticas relevantes para tu origen.",

  "circle.spaces": "Espacios",
  "circle.manageSpaces": "Espacios culturales",
  "circle.general": "General",
};

const hi: Dict = {
  "tab.today": "आज",
  "tab.beacon": "बीकन",
  "tab.track": "ट्रैक",
  "tab.circle": "सर्कल",
  "tab.care": "देखभाल",

  "common.settings": "सेटिंग्स",
  "common.save": "सहेजें",
  "common.saved": "सहेजा गया",
  "common.remove": "हटाएँ",
  "common.cancel": "रद्द करें",
  "common.join": "शामिल हों",
  "common.leave": "छोड़ें",
  "common.done": "पूर्ण",
  "common.optional": "वैकल्पिक",

  "beacon.title": "आपका बीकन",
  "beacon.subtitle": "जब आप जागी हों तो अपना बीकन जलाएँ — दूसरों को खोजें जो जागी हैं।",
  "beacon.light": "अपना बीकन जलाएँ",
  "beacon.on": "आपका बीकन जल रहा है",
  "beacon.onDesc": "अन्य जागी माएँ आपके पास एक गुमनाम रोशनी देख सकती हैं।",
  "beacon.offDesc": "अभी आप मानचित्र पर अदृश्य हैं।",
  "beacon.momsAwake": "माएँ पास में जाग रही हैं",
  "beacon.findPeer": "बात करने के लिए किसी को खोजें",
  "beacon.finding": "एक कोमल साथी खोज रहे हैं...",
  "beacon.mapPrivacy": "स्थान 16 किमी तक अनियमित किए जाते हैं। कोई भी आपका सटीक स्थान या नाम नहीं देखता।",
  "beacon.prefLabel": "मिलान वरीयता",
  "beacon.locNote": "हम केवल एक गुमनाम बिंदु दिखाने के लिए आपके अनुमानित स्थान का उपयोग करते हैं।",

  "settings.title": "बीकन सेटिंग्स",
  "settings.language": "भाषा",
  "settings.matching": "साथी मिलान वरीयता",
  "settings.pref.similar": "समान सांस्कृतिक पृष्ठभूमि पसंद करें",
  "settings.pref.none": "कोई वरीयता नहीं",
  "settings.pref.diverse": "विविध मिलान पसंद करें",
  "settings.culturalBg": "सांस्कृतिक पृष्ठभूमि",
  "settings.culturalBgHint": "वैकल्पिक और निजी। केवल आपके चुनने पर मिलान के लिए उपयोग होता है। दोनों की सहमति के बिना कभी नहीं दिखाया जाता।",
  "settings.displayTags": "मेरी पृष्ठभूमि साथियों को दिखाएँ",
  "settings.displayTagsHint": "डिफ़ॉल्ट रूप से बंद। तभी दिखता है जब आपका साथी भी इसे चालू करे।",
  "settings.allowCultural": "दूसरों को पृष्ठभूमि से मिलान करने दें",
  "settings.removeData": "मेरा सांस्कृतिक डेटा हटाएँ",
  "settings.removeDataHint": "आपकी सांस्कृतिक पृष्ठभूमि स्थायी रूप से हटाता है और सांस्कृतिक मिलान बंद करता है।",
  "settings.privacy": "आपका सांस्कृतिक डेटा वैकल्पिक, संपादन योग्य और कभी भी हटाने योग्य है। इसे कभी बेचा या साझा नहीं किया जाता।",
  "settings.none": "निर्धारित नहीं",

  "track.title": "बच्चा और मैं",
  "track.logFeed": "दूध",
  "track.logSleep": "नींद",
  "track.logDiaper": "डायपर",
  "track.logged": "दर्ज",
  "track.recent": "हाल की गतिविधि",
  "track.noLogs": "अभी कोई लॉग नहीं। ट्रैक करने के लिए ऊपर टैप करें।",
  "track.logMood": "आज का मूड दर्ज करें",
  "track.moodTrends": "मूड रुझान",
  "track.wellbeing": "कल्याण जाँच (EPDS)",
  "track.section.baby": "त्वरित लॉग",
  "track.section.me": "आपके लिए",

  "peer.title": "साथी चैट",
  "peer.anon": "आप दोनों गुमनाम हैं। दयालु रहें — यह एक सुरक्षित, निजी स्थान है।",
  "peer.placeholder": "एक कोमल संदेश लिखें...",
  "peer.matchedPref": "आपकी साझा पृष्ठभूमि पर मिलान",
  "peer.matchedDiverse": "नए दृष्टिकोण के लिए मिलान",
  "peer.matchedFallback": "उपलब्ध माँ के साथ मिलान",
  "peer.demo": "डेमो साथी — असली माएँ तब जवाब देती हैं जब साथ ऑनलाइन हों।",

  "care.guides": "गाइड और संसाधन",
  "care.culturalFirst": "पहले आपकी पृष्ठभूमि से संबंधित प्रथाएँ दिखा रहे हैं।",

  "circle.spaces": "स्पेस",
  "circle.manageSpaces": "सांस्कृतिक स्पेस",
  "circle.general": "सामान्य",
};

const DICTS: Record<Lang, Dict> = { en, es, hi };

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string };

const LanguageContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useProfile();
  const [lang, setLangState] = useState<Lang>("en");
  const initialized = useRef(false);

  useEffect(() => {
    (async () => {
      const s = (await storage.getItem<string>("beacon_lang", "")) as string;
      if (s) {
        setLangState(s as Lang);
        initialized.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!initialized.current && profile?.language) {
      setLangState(profile.language as Lang);
      initialized.current = true;
    }
  }, [profile]);

  const setLang = (l: Lang) => {
    setLangState(l);
    initialized.current = true;
    storage.setItem("beacon_lang", l);
  };

  const t = (key: string, vars?: Record<string, string | number>) => {
    let str = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useT = () => useContext(LanguageContext);
