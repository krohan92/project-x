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
  "tab.nearby": "Nearby",
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

  "nearby.title": "Who's Nearby",
  "nearby.subtitle": "Let others know you're awake — find who else is up nearby.",
  "nearby.light": "Wave hello",
  "nearby.on": "You waved!",
  "nearby.onDesc": "Other waving moms can see an anonymized marker near you.",
  "nearby.offDesc": "Tap to wave and let nearby moms know you're up.",
  "nearby.momsAwake": "moms waving nearby",
  "nearby.mapPrivacy": "Locations are randomized by up to 10 miles. No one ever sees your exact spot or name.",
  "nearby.prefLabel": "Matching preference",
  "nearby.locNote": "We use your approximate location only to place an anonymized pin.",

  "settings.title": "Nearby Settings",
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

  "track.title": "Track & Team",
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


  "care.guides": "Guides & Resources",
  "care.culturalFirst": "Showing practices relevant to your background first.",

  "circle.spaces": "Spaces",
  "circle.manageSpaces": "Cultural spaces",
  "circle.general": "General",
};

const es: Dict = {
  "tab.today": "Hoy",
  "tab.nearby": "Cerca de ti",
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

  "nearby.title": "Quién está cerca",
  "nearby.subtitle": "Muestra que estás despierta y encuentra a otras que también lo están.",
  "nearby.light": "Saludar con la mano",
  "nearby.on": "¡Saludaste!",
  "nearby.onDesc": "Otras mamás que saludan ven una marca anónima cerca de ti.",
  "nearby.offDesc": "Toca para saludar y avisar a otras mamás cercanas que estás despierta.",
  "nearby.momsAwake": "mamás saludando cerca",
  "nearby.mapPrivacy": "Las ubicaciones se aleatorizan hasta 16 km. Nadie ve tu lugar exacto ni tu nombre.",
  "nearby.prefLabel": "Preferencia de conexión",
  "nearby.locNote": "Usamos tu ubicación aproximada solo para colocar un punto anónimo.",

  "settings.title": "Ajustes de Cerca de ti",
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

  "track.title": "Registro y Equipo",
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


  "care.guides": "Guías y Recursos",
  "care.culturalFirst": "Mostrando primero prácticas relevantes para tu origen.",

  "circle.spaces": "Espacios",
  "circle.manageSpaces": "Espacios culturales",
  "circle.general": "General",
};

const hi: Dict = {
  "tab.today": "आज",
  "tab.nearby": "आस-पास",
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

  "nearby.title": "आस-पास कौन है",
  "nearby.subtitle": "बताएं कि आप जाग रही हैं — पास में किसे और जागती हुई पाएं।",
  "nearby.light": "हाथ हिलाएं",
  "nearby.on": "आपने हाथ हिलाया!",
  "nearby.onDesc": "हाथ हिलाने वाली अन्य माएँ आपके पास एक गुमनाम चिह्न देख सकती हैं।",
  "nearby.offDesc": "हाथ हिलाने के लिए टैप करें और पास की माओं को बताएं कि आप जाग रही हैं।",
  "nearby.momsAwake": "माएँ पास में हाथ हिला रही हैं",
  "nearby.mapPrivacy": "स्थान 16 किमी तक अनियमित किए जाते हैं। कोई भी आपका सटीक स्थान या नाम नहीं देखता।",
  "nearby.prefLabel": "मिलान वरीयता",
  "nearby.locNote": "हम केवल एक गुमनाम बिंदु दिखाने के लिए आपके अनुमानित स्थान का उपयोग करते हैं।",

  "settings.title": "आस-पास सेटिंग्स",
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

  "track.title": "ट्रैक और टीम",
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
      const s = (await storage.getItem<string>("app_lang", "")) as string;
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
    storage.setItem("app_lang", l);
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
