// Daten des Panels, die nicht im zentralen Zustand liegen: Bibliothek (2.2) und Gedächtnis (2.6). Eigener kleiner Speicher,
// damit die Vorschau ihn per setState füllen kann.
import { create } from "zustand";
import * as api from "../../lib/api";
import { apiRequest } from "../../lib/tauri";

export interface BibDatei {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  chatId: string;
  messageId: string;
  createdAt: string;
  kind: "file" | "image";
}

export interface GedaechtnisEintrag {
  name: string;
  description: string;
  body?: string;
  updatedAt?: string;
}

interface DataStore {
  library: Record<string, { files: BibDatei[]; truncated: boolean; loaded: boolean; error?: string }>;
  memory: Record<string, { entries: GedaechtnisEintrag[]; loaded: boolean; error?: boolean }>;
  loadLibrary: (botId: string) => Promise<void>;
  loadMemory: (botId: string) => Promise<void>;
}

export const useOrbisData = create<DataStore>((set) => ({
  library: {},
  memory: {},
  loadLibrary: async (botId) => {
    try {
      const r = await api.getLibrary(botId);
      set((s) => ({ library: { ...s.library, [botId]: { files: (r.files ?? []) as BibDatei[], truncated: !!r.truncated, loaded: true } } }));
    } catch (e) {
      set((s) => ({
        library: { ...s.library, [botId]: { files: [], truncated: false, loaded: true, error: typeof e === "string" ? e : (e as Error)?.message || "Library unavailable." } },
      }));
    }
  },
  loadMemory: async (botId) => {
    try {
      const r = await apiRequest<{ entries: GedaechtnisEintrag[] }>("GET", `/v1/bots/${encodeURIComponent(botId)}/memory`);
      const entries = [...(r.entries ?? [])].sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "") || 0);
      set((s) => ({ memory: { ...s.memory, [botId]: { entries, loaded: true } } }));
    } catch {
      set((s) => ({ memory: { ...s.memory, [botId]: { entries: [], loaded: true, error: true } } }));
    }
  },
}));

/** File caption: size and relative day (page counts are not in the payload). */
export function dateiInfo(f: BibDatei, now = new Date()): string {
  const d = new Date(f.createdAt);
  const kb = f.size >= 1_048_576 ? `${(f.size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`;
  if (Number.isNaN(d.getTime())) return kb;
  const tage = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000,
  );
  const tag = tage <= 0 ? "today" : tage === 1 ? "yesterday" : `${d.getMonth() + 1}/${d.getDate()}`;
  return `${kb} · ${tag}`;
}
