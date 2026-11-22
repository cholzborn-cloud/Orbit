// Daytona-Computer eines Orbis (routes/daytona.py). SCHNITTSTELLE 2.10 nennt nur desktop-url; Status, Übernahme,
// Rückgabe und Schlafen stehen nur im Dienstcode. Die Adresse aus desktop-url trägt den Zugang: nie anzeigen oder loggen.
import { create } from "zustand";
import { apiRequest } from "../../lib/tauri";
import { fehlerText } from "../../lib/chunks";

export type DesktopStatus = "laden" | "unconfigured" | "sleeping" | "running" | "transitioning" | "taken" | "unknown" | "fehler";

export interface Desktop {
  state: DesktopStatus;
  takeoverId?: string;
  busy?: boolean;
  error?: string;
  statusError?: string;
}

interface DesktopStore {
  desk: Record<string, Desktop>;
  load: (botId: string) => Promise<void>;
  retry: (botId: string) => Promise<boolean>;
  saveKey: (botId: string, key: string) => Promise<boolean>;
  connect: (botId: string, existingOnly: boolean) => Promise<boolean>;
  wake: (botId: string) => Promise<boolean>;
  sleep: (botId: string) => Promise<boolean>;
  takeover: (botId: string) => Promise<boolean>;
  giveBack: (botId: string) => Promise<boolean>;
}

const enc = encodeURIComponent;

/** Sofortiger Status aus dem SSE-Ereignis `desktop` (Orbi hat geschlafen/aufgeweckt). */
export function applyDesktopState(botId: string, state: Exclude<DesktopStatus, "laden" | "fehler">, takeoverId?: string) {
  useDesktop.setState((s) => ({
    desk: {
      ...s.desk,
      [botId]: {
        ...s.desk[botId],
        state,
        takeoverId: state === "taken" ? takeoverId ?? s.desk[botId]?.takeoverId : undefined,
        statusError: undefined,
      },
    },
  }));
}

export const useDesktop = create<DesktopStore>((set, get) => {
  const reads = new Map<string, symbol>();
  const put = (botId: string, d: Partial<Desktop>) =>
    set((s) => ({ desk: { ...s.desk, [botId]: { ...s.desk[botId], ...d, state: d.state ?? s.desk[botId]?.state ?? "laden" } } }));

  const refresh = async (botId: string) => {
    if (reads.has(botId)) return;
    const read = Symbol();
    reads.set(botId, read);
    try {
      const r = await apiRequest<{ state: Exclude<DesktopStatus, "laden" | "fehler">; takeoverId?: string }>(
        "GET", `/v1/daytona/${enc(botId)}/desktop-status`);
      if (reads.get(botId) !== read) return;
      put(botId, { state: r.state ?? "unknown", takeoverId: r.state === "taken" ? r.takeoverId : undefined, statusError: undefined });
    } catch (e) {
      if (reads.get(botId) === read) put(botId, { state: "fehler", statusError: fehlerText(e) });
    } finally {
      if (reads.get(botId) === read) reads.delete(botId);
    }
  };
  const run = async (botId: string, fn: () => Promise<Partial<Desktop> | void>) => {
    if (get().desk[botId]?.busy) return false;
    reads.delete(botId);
    put(botId, { busy: true, error: undefined });
    try {
      const r = await fn();
      put(botId, { busy: false, ...(r ?? {}) });
      return true;
    } catch (e) {
      put(botId, { busy: false, error: fehlerText(e) });
      return false;
    }
  };
  return {
    desk: {},
    load: async (botId) => {
      if (!get().desk[botId]?.busy) await refresh(botId);
    },
    retry: (botId) => run(botId, () => refresh(botId)),
    saveKey: (botId, key) =>
      run(botId, async () => {
        await apiRequest("PUT", `/v1/daytona/${enc(botId)}/key`, { key });
        await refresh(botId);
      }),
    connect: (botId, existingOnly) =>
      run(botId, async () => {
        const aktion = existingOnly ? "reconnect" : "setup";
        const r = await apiRequest<{ sandboxConfigured: boolean }>("POST", `/v1/bots/${enc(botId)}/sandbox/${aktion}`,
          existingOnly ? undefined : { confirmed: true });
        if (!r.sandboxConfigured) throw new Error("No Daytona computer found for this Orbi.");
        await refresh(botId);
      }),
    // Aufwecken: Der Dienst hat keine eigene Route; desktop-url startet den Computer als Nebenwirkung. Die Adresse wird verworfen.
    wake: (botId) =>
      run(botId, async () => {
        put(botId, { state: "transitioning" });
        await apiRequest("GET", `/v1/daytona/${enc(botId)}/desktop-url?viewOnly=1`);
        await refresh(botId);
      }),
    sleep: (botId) =>
      run(botId, async () => {
        await apiRequest("POST", `/v1/daytona/${enc(botId)}/sleep`, {});
        await refresh(botId);
      }),
    takeover: (botId) =>
      run(botId, async () => {
        const r = await apiRequest<{ takeoverId: string }>("POST", `/v1/daytona/${enc(botId)}/takeover`, {});
        return { state: "taken", takeoverId: r.takeoverId };
      }),
    giveBack: (botId) =>
      run(botId, async () => {
        const id = get().desk[botId]?.takeoverId;
        if (!id) throw new Error("This takeover was not found.");
        await apiRequest("POST", `/v1/daytona/${enc(botId)}/return`, { takeoverId: id });
        await refresh(botId);
      }),
  };
});
