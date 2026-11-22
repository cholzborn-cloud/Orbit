// Name und Initialen des Menschen: eine Quelle für Erststart, Seitenleiste, Profilmenü und Einstellungen.
// Dauerhaft liegt der Name im Dienst (PUT /v1/settings/profile, Feld name). Der Browserspeicher ist nur ein Zwischenspeicher
// für den ersten Bildaufbau. Das Google-Konto liefert nur die Vorbelegung, solange der Dienst keinen Namen kennt.
import { create } from "zustand";
import { accountStatus, apiRequest } from "./tauri";

const SCHLUESSEL = "orbit.profil.name";

export const AVATAR_FARBEN: Record<string, { label: string; backgroundColor: string }> = {
  blau: { label: "Blue", backgroundColor: "#b4d2f3" },
  gruen: { label: "Green", backgroundColor: "#b7d9c2" },
  rosa: { label: "Pink", backgroundColor: "#edc3da" },
  violett: { label: "Purple", backgroundColor: "#d4c2f2" },
  sand: { label: "Sand", backgroundColor: "#edcfad" },
};

export const AVATAR_SCHRIFTEN: Record<string, { label: string; fontFamily: string }> = {
  schlicht: { label: "Plain", fontFamily: "system-ui, sans-serif" },
  serifen: { label: "Serif", fontFamily: "Georgia, serif" },
  mono: { label: "Monospace", fontFamily: "ui-monospace, monospace" },
};

export function avatarStil(farbe?: string, schrift?: string) {
  const f = farbe && AVATAR_FARBEN[farbe];
  const s = schrift && AVATAR_SCHRIFTEN[schrift];
  return { backgroundColor: f ? f.backgroundColor : undefined, color: f ? "#202124" : undefined, fontFamily: s ? s.fontFamily : undefined };
}

/** Erster Buchstabe eines Wortes (Großbuchstabe), "" wenn das Wort keinen Buchstaben enthält. */
function ersterBuchstabe(wort: string): string {
  for (const z of Array.from(wort)) if (/\p{L}/u.test(z)) return Array.from(z.toLocaleUpperCase("de"))[0] ?? "";
  return "";
}

/**
 * Initialen der ersten beiden Namenswörter. Nur Buchstaben, Großbuchstaben. "Constantin Holzborn" → "CH",
 * "Constantin" → "C", "Anna-Lena" → "A", Emoji und Satzzeichen zählen nicht, ohne Buchstaben → "".
 */
export function initialen(name: string | null | undefined): string {
  const woerter = (name ?? "").split(/\s+/).filter((w) => ersterBuchstabe(w) !== "");
  if (woerter.length === 0) return "";
  const erst = ersterBuchstabe(woerter[0]);
  return woerter.length === 1 ? erst : erst + ersterBuchstabe(woerter[1]);
}

function lesen(): string {
  try { return localStorage.getItem(SCHLUESSEL) ?? ""; } catch { return ""; }
}
function merken(name: string) {
  try { if (name) localStorage.setItem(SCHLUESSEL, name); else localStorage.removeItem(SCHLUESSEL); } catch { /* ohne Speicher */ }
}

interface ProfilNameStand {
  /** Angezeigter Name ("" = noch keiner bekannt). */
  name: string;
  avatarColor?: string;
  avatarFont?: string;
  geladen: boolean;
  /** Name des Dienstes (oder Google-Konto als Vorbelegung) holen. Fehler bleiben still. */
  laden: () => Promise<void>;
  /** Nach erfolgreichem Speichern im Dienst aufrufen. */
  setzen: (name: string, avatar?: { avatarColor?: string; avatarFont?: string }) => void;
}

export const useProfilName = create<ProfilNameStand>((set, get) => ({
  name: lesen(),
  geladen: false,
  setzen: (name, avatar) => { const n = name.trim(); merken(n); set({ ...avatar, name: n, geladen: true }); },
  laden: async () => {
    const vorher = get();
    let dienst = "";
    let ok = false;
    let avatar = {};
    try {
      const r = await apiRequest<{ profile?: { name?: string; avatarColor?: string; avatarFont?: string } }>("GET", "/v1/settings/profile");
      dienst = (r?.profile?.name ?? "").trim();
      avatar = { avatarColor: r.profile?.avatarColor, avatarFont: r.profile?.avatarFont };
      ok = true;
    } catch { /* Dienst nicht erreichbar: Zwischenspeicher bleibt */ }
    let name = dienst;
    if (!name) {
      try {
        const k = await accountStatus();
        if (k.signedIn && k.displayName) name = k.displayName.trim();
      } catch { /* keine Hülle */ }
    }
    if (get() !== vorher) return; // Ein Speichern während der Anfrage hat Vorrang.
    if (!name && !ok) name = vorher.name;
    merken(name);
    set({ ...avatar, name, geladen: true });
  },
}));
