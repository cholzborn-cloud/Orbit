import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { fehlerText } from "../onboarding/dunkel";

// Zustand der Einstellungen, der Wechsel der Ansicht überlebt: Leseposition je Seite, Suche/Filter/Fokus der Plugins, Entwürfe.

export type Seite = "allgemein" | "darstellung" | "personalisierung" | "plugins" | "nutzung" | "arbeitsumgebung" | "sicherheit";

/** Alte und alternative Namen (D45 „Marktplatz“ heißt jetzt Plugins). */
export function seiteVon(page?: string): Seite {
  const p = (page ?? "").toLowerCase();
  if (["marktplatz", "plugins", "verbindungen", "konnektoren", "marketplace", "connectors"].includes(p)) return "plugins";
  if (["orbis", "personalisierung", "anleitung", "skills", "personalization"].includes(p)) return "personalisierung";
  if (["freigaben", "sicherheit", "mac", "security"].includes(p)) return "sicherheit";
  if (p === "appearance") return "darstellung";
  if (p === "usage") return "nutzung";
  if (p === "workspace") return "arbeitsumgebung";
  if (["darstellung", "nutzung", "arbeitsumgebung", "allgemein"].includes(p)) return p as Seite;
  return "allgemein";
}

export interface Ausstehend { slug: string; accountId: string; seit: number }

/** Geladene Plugin-Liste samt Filter, damit „Zurück“ aus dem Detail dieselbe Liste (auch nach „Mehr laden“) zeigt. */
export interface ListenStand { schluessel: string; eintraege: any[]; kategorien: string[]; weiter: string | null; konfiguriert: boolean }

interface EinstState {
  liste: ListenStand | null;
  scroll: Record<string, number>;
  suche: string;
  tab: "alle" | "verbunden";
  kategorie: string;
  fokus: string | null;
  person: string | null;
  beruf: string | null;
  anleitung: string | null;
  zeitraum: "week" | "month";
  einheit: "tokens" | "euro";
  ausstehend: Ausstehend | null;
  hervor: string | null; // Konto, das gerade aus dem Browser zurückkam
  /** Abschnitt, zu dem ein orbit://-Link springen soll (hat Vorrang vor der gemerkten Leseposition). */
  anker: string | null;
  set: (p: Partial<EinstState>) => void;
}

export const useEinst = create<EinstState>((set) => ({
  liste: null, scroll: {}, suche: "", tab: "alle", kategorie: "alle", fokus: null, person: null, beruf: null, anleitung: null,
  zeitraum: "week", einheit: "tokens", ausstehend: null, hervor: null, anker: null,
  set: (p) => set(p),
}));

/** Lädt Daten einer Seite; `neu()` lädt erneut. Fehler als lesbarer Text. */
export function useDaten<T>(laden: () => Promise<T>, abh: unknown[] = []) {
  const [daten, setDaten] = useState<T | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const lauf = useRef(0);
  const ladenRef = useRef(laden);
  ladenRef.current = laden;
  const neu = useCallback(() => {
    const id = ++lauf.current;
    setLaedt(true);
    return ladenRef.current()
      .then((d) => { if (id === lauf.current) { setDaten(d); setFehler(null); } })
      .catch((e) => { if (id === lauf.current) setFehler(fehlerText(e)); })
      .finally(() => { if (id === lauf.current) setLaedt(false); });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void neu(); }, abh);
  return { daten, setDaten, fehler, setFehler, laedt, neu };
}

/** Zahl und Einheit auf Deutsch. */
export const zahl = (n: number, stellen = 0) => n.toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
export const mio = (n: number) => `${zahl(n / 1_000_000, 1)} M`;
export const euro = (n: number) => `${zahl(n, 2)} €`;
