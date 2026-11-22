import { create } from "zustand";
import type { FarbName } from "./dunkel";
import type { Szene } from "./szene";
import { AVATAR_FARBEN, AVATAR_SCHRIFTEN } from "../../lib/profil";

// Alle Eingaben des Erststarts in einem Speicher: Zurückgehen verliert nichts.
// Das Passwort bleibt nur hier im Speicher (nie im Entwurf des Dienstes, nie im Browser-Speicher).

export type Schritt = "willkommen" | "start" | "code" | "name" | "modelle" | "dienste" | "plugins" | "mac" | "orbi" | "fertig";
const REIHE: Schritt[] = ["willkommen", "start", "code", "name", "modelle", "dienste", "plugins", "mac", "orbi", "fertig"];

/** Zurück-Ziele wie im Figma-Prototyp (Name geht zurück zu Start). */
export const ZURUECK: Partial<Record<Schritt, Schritt>> = {
  code: "start", name: "start", modelle: "name", dienste: "modelle", plugins: "dienste", mac: "plugins", orbi: "mac",
};
/** Sechs Punkte: Name bis Orbi (inkl. Daytona/Jev). */
export const PUNKT: Partial<Record<Schritt, number>> = { name: 1, modelle: 2, dienste: 3, plugins: 4, mac: 5, orbi: 6 };

export interface Erststart {
  schritt: Schritt;
  richtung: "vor" | "zurueck";
  szene: Szene;
  tab: "registrieren" | "anmelden";
  email: string;
  passwort: string;
  code: string;
  /** Login-Gate / StartKarte: Code-Schritt statt Konto-Karte. */
  warteAufCode: boolean;
  /** login-wartet = Passwort geprüft, erneuter Code beim Maildienst noch gesperrt. */
  otpArt: "signup" | "login" | "login-wartet";
  mailSperren: Record<string, number>;
  person: string;
  beruf: string;
  avatarFarbe: string;
  avatarSchrift: string;
  /** Die Vorbelegung aus dem Google-Konto lief schon (nur einmal; leert der Mensch das Feld, kommt sie nicht wieder). */
  nameVorbelegt: boolean;
  modelle: Record<string, boolean>;
  modelleVorbelegt: boolean;
  plugins: Record<string, boolean>;
  mitteilungen: boolean;
  form: string;
  farbe: FarbName;
  orbiName: string;
  botId: string | null;
  chatId: string | null;
  set: (p: Partial<Erststart>) => void;
  gehe: (s: Schritt) => void;
  zuruecksetzen: () => void;
}

const START = {
  schritt: "willkommen" as Schritt,
  richtung: "vor" as const,
  szene: "mitte" as Szene,
  tab: "registrieren" as const,
  email: "",
  passwort: "",
  code: "",
  warteAufCode: false,
  otpArt: "signup" as const,
  mailSperren: {} as Record<string, number>,
  person: "",
  beruf: "",
  nameVorbelegt: false,
  modelle: {} as Record<string, boolean>,
  modelleVorbelegt: false,
  plugins: {} as Record<string, boolean>,
  mitteilungen: false,
  form: "strobi",
  farbe: "pink" as FarbName,
  orbiName: "",
  botId: null as string | null,
  chatId: null as string | null,
};

function avatarAuswahl() {
  const farben = Object.keys(AVATAR_FARBEN);
  const schriften = Object.keys(AVATAR_SCHRIFTEN);
  return {
    avatarFarbe: farben[Math.floor(Math.random() * farben.length)],
    avatarSchrift: schriften[Math.floor(Math.random() * schriften.length)],
  };
}

export const useErststart = create<Erststart>((set) => ({
  ...START,
  ...avatarAuswahl(),
  set: (p) => set(p),
  gehe: (schritt) => set((alt) => ({ schritt, richtung: REIHE.indexOf(schritt) < REIHE.indexOf(alt.schritt) ? "zurueck" : "vor" })),
  zuruecksetzen: () => set({ ...START, ...avatarAuswahl(), modelle: {}, plugins: {} }),
}));
