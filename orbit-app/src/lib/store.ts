import type { AntwortBezug } from "./types";
// Zentraler Zustand (zustand). Verbindet einmal, hält den Dienst-Stand und baut Antworten live aus dem Strom auf.
import { create } from "zustand";
import { createStore } from "zustand/vanilla";
import * as api from "./api";
import { applyChunk, fehlerText } from "./chunks";
import { serviceConnect } from "./tauri";
import { applyDesktopState } from "../features/routinen/computer";
import type {
  Automation, Bot, Chat, ChatStatus, Datei, Ereignis, Entscheidung, Group, Interrupted, Karte, LiveStep, Nachricht,
  Reaktion, Routine, RoutineInput, Antwort, TurnChunk, Verbindung, Modellwunsch,
} from "./types";

export const SEITE = 50;
const BACKOFF_START = 500;
const BACKOFF_MAX = 10_000;

export interface TaskInfo {
  taskId: string;
  action: "start" | "progress" | "done" | "stopped" | "failed";
  chatId: string;
  botId: string;
  title: string;
  brief: string;
  progress: string | null;
}

export interface CliSetupInfo {
  phase: string;
  message: string;
  at: string | number;
}

export interface OrbitState {
  verbindung: Verbindung;
  verbindungsfehler: string | null;
  /** Wie oft der Ereignis-Strom neu verbunden wurde (nach dem ersten Mal). */
  neuverbunden: number;
  bereit: boolean; // erster Snapshot ist da

  bots: Bot[];
  main: Bot | null;
  groups: Group[];
  chats: Chat[];

  selectedChatId: string | null;
  messages: Record<string, Nachricht[]>;
  hasMore: Record<string, boolean>;
  interrupted: Record<string, Interrupted | null>;
  reactions: Record<string, Reaktion[]>;
  laden: Record<string, boolean>;
  /** Chats, in denen gerade eine Antwort aus dem Strom aufgebaut wird. */
  streaming: Record<string, boolean>;

  /** Arbeitsstatus je Chat und Orbi (Schlüssel `${chatId}:${botId}`). */
  working: Record<string, { chatId: string; botId: string; status: ChatStatus }>;
  steps: LiveStep[];
  cards: Karte[];
  routines: Routine[];
  routineTrash: Routine[];
  runs: Record<string, AutomationRun>;
  tasks: Record<string, TaskInfo>;
  /** Letztes `cli-setup`-Ereignis je Programm (install | login | done | error). */
  cliSetup: Record<string, CliSetupInfo>;
  unread: Record<string, number>;
  /** Fehlerhinweise je Chat (Ereignis `notice` oder fehlgeschlagenes Senden). */
  notices: Record<string, string>;

  // Verbindung
  connect: () => Promise<void>;
  disconnect: () => void;
  // Auswahl und Laden
  selectChat: (chatId: string | null) => Promise<void>;
  loadBots: () => Promise<void>;
  loadChats: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  loadOlder: (chatId: string) => Promise<void>;
  loadRoutines: () => Promise<void>;
  // Chat
  chatModelle: Partial<Record<string, Modellwunsch>>;
  setChatModell: (chatId: string, modell: Modellwunsch | null) => void;
  send: (chatId: string, text: string, files?: Datei[], botId?: string, antwort?: AntwortBezug) => Promise<void>;
  stop: (chatId: string) => Promise<void>;
  resume: (chatId: string, dismiss?: boolean) => Promise<void>;
  react: (chatId: string, messageId: string, emoji: string | null) => Promise<void>;
  dismissNotice: (chatId: string) => void;
  // Karten
  decide: (id: string, decision: Entscheidung) => Promise<void>;
  answer: (id: string, answers: Antwort[] | null) => Promise<void>;
  // Routinen
  setRoutineEnabled: (id: string, enabled: boolean) => Promise<void>;
  runRoutine: (id: string) => Promise<void>;
  trashRoutine: (id: string) => Promise<void>;
  restoreRoutine: (id: string) => Promise<void>;
  deleteRoutine: (id: string) => Promise<void>;
  updateRoutine: (id: string, input: Partial<RoutineInput>) => Promise<void>;
}

type AutomationRun = { automationId: string; runId: string; status: string; chatId: string; trigger: string; error?: string };

export interface OrbitOptions {
  /** Für Tests: Wartefunktion für das Neuverbinden. */
  sleep?: (ms: number) => Promise<void>;
}

const wkey = (chatId: string, botId: string) => `${chatId}:${botId}`;

/** Fügt eine Nachricht ein oder ersetzt die mit gleicher ID. */
export function upsertMessage(list: Nachricht[] | undefined, m: Nachricht): Nachricht[] {
  const l = list ?? [];
  const i = l.findIndex((x) => x.id === m.id);
  if (i < 0) return [...l, m];
  const copy = l.slice();
  copy[i] = m;
  return copy;
}

let lokaleId = 0;
const neueId = () =>
  `local-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${++lokaleId}`}`;

export function initializer(opts: OrbitOptions = {}) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return (set: (p: Partial<OrbitState> | ((s: OrbitState) => Partial<OrbitState>)) => void, get: () => OrbitState): OrbitState => {
    // ---- interner Laufzeitzustand (nicht reaktiv) ----
    let stopped = true;
    let loopId = 0;
    let eventHandle: { cancel: () => Promise<void> } | null = null;
    let serviceUp = false;
    // Chats mit laufendem Strom (eigener Turn oder angehängt): Chat -> Token des Stroms, der den Eintrag besitzt.
    const streams = new Map<string, number>();
    const attached = { has: (chatId: string) => streams.has(chatId) };
    let streamToken = 0;
    const liveIds = new Map<string, string>(); // Chat -> ID der gerade aufgebauten Strom-Nachricht
    const cancels = new Map<string, () => Promise<void>>();
    // Laufende Nummer je Abruf-Schlüssel: nur die zuletzt gestartete Antwort darf den Zustand setzen.
    const seq = new Map<string, number>();
    const naechste = (key: string) => {
      const n = (seq.get(key) ?? 0) + 1;
      seq.set(key, n);
      return n;
    };
    const aktuell = (key: string, n: number) => seq.get(key) === n;

    const setStreaming = (chatId: string, on: boolean) =>
      set((s) => {
        const streaming = { ...s.streaming };
        if (on) streaming[chatId] = true;
        else delete streaming[chatId];
        return { streaming };
      });

    const putMessage = (chatId: string, m: Nachricht) =>
      set((s) => ({ messages: { ...s.messages, [chatId]: upsertMessage(s.messages[chatId], m) } }));

    /** Strom eines Chats lesen (eigener Turn oder angehängt) und die Antwort live aufbauen. */
    const consume = (
      chatId: string,
      make: (onChunk: (c: TurnChunk) => void) => { done: Promise<void>; cancel: () => Promise<void> },
      /** Läuft schon ein Strom für den Chat, bleibt dessen Zustand unberührt (kein zweiter Aufbau). */
      passiv = false,
    ) => {
      let cur: Nachricht | null = null;
      const token = ++streamToken;
      const eigen = !passiv && !streams.has(chatId);
      if (eigen) {
        streams.set(chatId, token);
        setStreaming(chatId, true);
      }
      const onChunk = (c: TurnChunk) => {
        if (!eigen) return;
        cur = applyChunk(cur, c);
        if (cur) {
          liveIds.set(chatId, cur.id);
          putMessage(chatId, cur);
        }
        if (c.type === "error") {
          set((s) => ({ notices: { ...s.notices, [chatId]: c.errorText || fehlerText(null) } }));
        }
      };
      const h = make(onChunk);
      if (eigen) cancels.set(chatId, h.cancel);
      const fertig = () => {
        if (!eigen || streams.get(chatId) !== token) return; // nur den eigenen Eintrag räumen
        streams.delete(chatId);
        liveIds.delete(chatId);
        cancels.delete(chatId);
        setStreaming(chatId, false);
      };
      return h.done.then(
        () => { fertig(); return true; },
        (e) => {
          fertig();
          set((s) => ({ notices: { ...s.notices, [chatId]: fehlerText(e) } }));
          return false;
        },
      );
    };

    const attach = (chatId: string) => {
      if (attached.has(chatId)) return;
      void consume(chatId, (on) => api.attachStream(chatId, on));
    };

    const reloadAll = async () => {
      const st = get();
      await Promise.allSettled([
        st.loadBots(),
        st.loadChats(),
        st.loadRoutines(),
        st.selectedChatId && !attached.has(st.selectedChatId) ? st.loadMessages(st.selectedChatId) : Promise.resolve(),
      ]);
    };

    const handleEvent = (e: Ereignis) => {
      switch (e.type) {
        case "snapshot": {
          const first = !get().bereit;
          const working: OrbitState["working"] = {};
          for (const w of e.working ?? []) working[wkey(w.chatId, w.botId)] = w;
          const cards = [...(e.approvals ?? []), ...(e.questions ?? [])].filter((k) => !k.status || k.status === "pending");
          const runs: Record<string, AutomationRun> = {};
          for (const a of e.automations ?? []) runs[a.automationId] = a;
          set({ working, cards, steps: e.steps ?? [], runs, bereit: true, verbindung: "verbunden", verbindungsfehler: null });
          if (first) {
            void get().loadBots();
            void get().loadChats();
            void get().loadRoutines();
          } else {
            void reloadAll(); // nach Neuverbinden Verpasstes nachholen
          }
          const sel = get().selectedChatId;
          if (sel && (e.working ?? []).some((w) => w.chatId === sel && w.status === "arbeitet")) attach(sel);
          return;
        }
        case "status": {
          set((s) => {
            const working = { ...s.working };
            const k = wkey(e.chatId, e.botId);
            if (e.status === "arbeitet" || e.status === "wartet") working[k] = { chatId: e.chatId, botId: e.botId, status: e.status };
            else delete working[k];
            const steps = e.status === "arbeitet" || e.status === "wartet" ? s.steps : s.steps.filter((x) => !(x.chatId === e.chatId && x.botId === e.botId));
            return { working, steps };
          });
          if (e.status === "arbeitet" && get().selectedChatId === e.chatId) attach(e.chatId);
          return;
        }
        case "status-step": {
          set((s) => {
            const rest = s.steps.filter((x) => x.toolCallId !== e.toolCallId);
            if (e.state === "end") return { steps: rest };
            const { type: _t, state: _s, ...step } = e;
            return { steps: [...rest, step as LiveStep] };
          });
          return;
        }
        case "notice":
          set((s) => ({ notices: { ...s.notices, [e.chatId]: e.text } }));
          return;
        case "orbi-message": {
          const sel = get().selectedChatId;
          if (e.chatId === sel) {
            if (!attached.has(e.chatId)) void get().loadMessages(e.chatId);
            void api.markSeen(e.chatId).catch(() => {});
          } else {
            set((s) => ({ unread: { ...s.unread, [e.chatId]: (s.unread[e.chatId] ?? 0) + 1 } }));
          }
          void get().loadChats();
          return;
        }
        case "group-turn":
          if (e.phase === "reply" && e.chatId === get().selectedChatId && !attached.has(e.chatId)) void get().loadMessages(e.chatId);
          return;
        case "approval":
        case "question": {
          const { type: _t, ...karte } = e;
          set((s) => {
            const rest = s.cards.filter((k) => k.id !== karte.id);
            if (karte.status && karte.status !== "pending") return { cards: rest };
            return { cards: [...rest, karte as Karte] };
          });
          return;
        }
        case "reaction":
          set((s) => {
            const list = (s.reactions[e.chatId] ?? []).filter((r) => !(r.messageId === e.messageId && r.actor === e.actor));
            if (e.emoji) list.push({ messageId: e.messageId, actor: e.actor, emoji: e.emoji });
            return { reactions: { ...s.reactions, [e.chatId]: list } };
          });
          return;
        case "onboarding":
        case "orbis-created":
          void get().loadBots();
          void get().loadChats();
          return;
        case "desktop":
          applyDesktopState(e.botId, e.state, e.takeoverId);
          return;
        case "automation": {
          const { type: _t, ...lauf } = e;
          set((s) => ({ runs: { ...s.runs, [e.automationId]: lauf } }));
          void get().loadRoutines();
          return;
        }
        case "task": {
          const { type: _t, ...task } = e;
          set((s) => ({ tasks: { ...s.tasks, [e.taskId]: task } }));
          return;
        }
        case "cli-setup":
          set((s) => ({ cliSetup: { ...s.cliSetup, [e.id]: { phase: e.phase, message: e.message, at: e.at } } }));
          return;
        default:
          return; // reminders-*: gehören anderen Bildschirmen
      }
    };

    /** Eine Verbindungsschleife: Dienst verbinden, Strom lesen, bei Ende oder Fehler mit Backoff neu. */
    const loop = async (id: number) => {
      let delay = BACKOFF_START;
      let erstes = true;
      while (!stopped && id === loopId) {
        try {
          if (!serviceUp) {
            set({ verbindung: "verbindet" });
            await serviceConnect();
            serviceUp = true;
          }
          let gotSnapshot = false;
          const h = api.openEvents((ev: Ereignis) => {
            if (id !== loopId) return;
            if (ev.type === "snapshot") {
              gotSnapshot = true;
              delay = BACKOFF_START;
              if (!erstes) set((s) => ({ neuverbunden: s.neuverbunden + 1 }));
              erstes = false;
            } else if (!gotSnapshot) {
              return; // vor dem Snapshot nichts auswerten
            }
            handleEvent(ev);
          });
          eventHandle = h;
          await h.done;
          if (!gotSnapshot) throw new Error("Der Dienst hat keinen Stand geschickt.");
        } catch (e) {
          if (stopped || id !== loopId) break;
          serviceUp = false; // beim nächsten Versuch neu verbinden (Dienst könnte neu gestartet sein)
          set({ verbindung: "verbindet", verbindungsfehler: fehlerText(e) });
        }
        if (stopped || id !== loopId) break;
        set((s) => (s.verbindung === "verbunden" ? { verbindung: "verbindet" } : {}));
        await sleep(delay);
        delay = Math.min(delay * 2, BACKOFF_MAX);
      }
    };

    const reloadRoutines = () => get().loadRoutines();
    const meldeFehler = (chatId: string | null, e: unknown) => {
      const text = fehlerText(e);
      if (chatId) set((s) => ({ notices: { ...s.notices, [chatId]: text } }));
      else set({ verbindungsfehler: text });
    };

    return {
      verbindung: "getrennt",
      verbindungsfehler: null,
      neuverbunden: 0,
      bereit: false,
      bots: [],
      main: null,
      groups: [],
      chats: [],
      selectedChatId: null,
      messages: {},
      hasMore: {},
      interrupted: {},
      reactions: {},
      laden: {},
      streaming: {},
      working: {},
      steps: [],
      cards: [],
      routines: [],
      routineTrash: [],
      runs: {},
      tasks: {},
      cliSetup: {},
      unread: {},
      notices: {},
      chatModelle: {},

      connect: async () => {
        if (!stopped) return; // nur einmal verbinden
        stopped = false;
        const id = ++loopId;
        set({ verbindung: "verbindet", verbindungsfehler: null });
        void loop(id);
      },

      disconnect: () => {
        stopped = true;
        loopId++;
        serviceUp = false;
        void eventHandle?.cancel().catch(() => {});
        eventHandle = null;
        for (const c of cancels.values()) void c().catch(() => {});
        set({ verbindung: "getrennt", bereit: false });
      },

      selectChat: async (chatId) => {
        set({ selectedChatId: chatId });
        if (!chatId) return;
        set((s) => {
          const unread = { ...s.unread };
          delete unread[chatId];
          return { unread };
        });
        void api.markSeen(chatId).catch(() => {});
        await get().loadMessages(chatId);
        const arbeitet = Object.values(get().working).some((w) => w.chatId === chatId && w.status === "arbeitet");
        if (arbeitet && get().selectedChatId === chatId) attach(chatId);
      },

      loadBots: async () => {
        try {
          const r = await api.getBots();
          // Der Dienst liefert den Hauptorbi getrennt in `main`; `bots` enthält ihn dann nicht. Alle Bildschirme erwarten ihn in `bots`.
          const andere = (r.bots ?? []).filter((b) => !r.main || b.id !== r.main.id);
          set({ bots: r.main ? [r.main, ...andere] : andere, main: r.main ?? null, groups: r.groups ?? [] });
        } catch (e) {
          meldeFehler(null, e);
        }
      },

      loadChats: async () => {
        const n = naechste("chats");
        try {
          const r = await api.getChats();
          if (aktuell("chats", n)) set({ chats: r.chats ?? [] });
        } catch (e) {
          if (aktuell("chats", n)) meldeFehler(null, e);
        }
      },

      loadMessages: async (chatId) => {
        const key = `m:${chatId}`;
        const n = naechste(key);
        set((s) => ({ laden: { ...s.laden, [chatId]: true } }));
        try {
          const r = await api.getMessages(chatId, { limit: SEITE });
          if (!aktuell(key, n)) return; // eine neuere Abfrage ist unterwegs oder schon fertig
          set((s) => {
            // Läuft gerade ein Aufbau aus dem Strom, dessen Nachricht (auch mit echter ID) erhalten.
            const liveId = liveIds.get(chatId);
            const live = attached.has(chatId)
              ? (s.messages[chatId] ?? []).filter((m) => m.id.startsWith("local-") || m.id.startsWith("stream-") || m.id === liveId)
              : [];
            const ids = new Set((r.messages ?? []).map((m) => m.id));
            const liveNachricht = live.find((m) => m.id === liveId);
            return {
              messages: { ...s.messages, [chatId]: [...(r.messages ?? []).map((m) => m.id === liveId && liveNachricht ? liveNachricht : m), ...live.filter((m) => !ids.has(m.id))] },
              hasMore: { ...s.hasMore, [chatId]: !!r.hasMore },
              interrupted: { ...s.interrupted, [chatId]: r.interrupted ?? null },
              reactions: { ...s.reactions, [chatId]: r.reactions ?? [] },
            };
          });
        } catch (e) {
          if (aktuell(key, n)) meldeFehler(chatId, e);
        } finally {
          if (aktuell(key, n)) set((s) => ({ laden: { ...s.laden, [chatId]: false } }));
        }
      },

      loadOlder: async (chatId) => {
        const list = get().messages[chatId] ?? [];
        const first = list.find((m) => !m.id.startsWith("local-"));
        if (!first || !get().hasMore[chatId] || get().laden[chatId]) return;
        set((s) => ({ laden: { ...s.laden, [chatId]: true } }));
        try {
          const r = await api.getMessages(chatId, { limit: SEITE, before: first.id });
          set((s) => {
            const have = new Set((s.messages[chatId] ?? []).map((m) => m.id));
            const older = (r.messages ?? []).filter((m) => !have.has(m.id));
            return {
              messages: { ...s.messages, [chatId]: [...older, ...(s.messages[chatId] ?? [])] },
              hasMore: { ...s.hasMore, [chatId]: !!r.hasMore },
            };
          });
        } catch (e) {
          meldeFehler(chatId, e);
        } finally {
          set((s) => ({ laden: { ...s.laden, [chatId]: false } }));
        }
      },

      loadRoutines: async () => {
        try {
          const r = await api.getAutomations();
          set({ routines: r.automations ?? [], routineTrash: r.trash ?? [] });
        } catch (e) {
          meldeFehler(null, e);
        }
      },

      setChatModell: (chatId, modell) => set((s) => {
        const chatModelle = { ...s.chatModelle };
        if (modell) chatModelle[chatId] = modell;
        else delete chatModelle[chatId];
        return { chatModelle };
      }),

      send: async (chatId, text, files = [], botId, antwort) => {
        const t = text.trim();
        if (!t && files.length === 0) return;
        const modell = get().chatModelle[chatId];
        const id = neueId();
        const parts: Nachricht["parts"] = [];
        if (t) parts.push({ type: "text", text: t });
        for (const f of files) parts.push({ type: "file", url: f.url, mediaType: f.mediaType, filename: f.filename });
        putMessage(chatId, { id, role: "user", parts, metadata: { pending: true, createdAt: Date.now(), replyTo: antwort } });
        set((s) => {
          const notices = { ...s.notices };
          delete notices[chatId];
          return { notices };
        });
        let gotStart = false;
        const bereitsStrom = streams.has(chatId); // Chat belegt: Nachricht wird nur eingereiht, kein zweiter Aufbau
        const ok = await consume(chatId, (onChunk) =>
          api.sendTurn(chatId, t, files, botId, (c) => {
            if (c.type === "start" && !gotStart) {
              gotStart = true;
              markiere(id, { pending: false });
            }
            onChunk(c);
          }, { id, clientData: {
            ...(modell ? { model: modell.model, effort: modell.effort, fast: modell.fast === true } : {}),
            ...(antwort ? { replyTo: { ...antwort } } : {}),
          } }),
          bereitsStrom,
        );
        if (!ok) markiere(id, { pending: false, failed: true });
        else if (!gotStart) {
          markiere(id, { pending: false }); // Chat war belegt: läuft als Folgelauf
          const arbeitet = Object.values(get().working).some((w) => w.chatId === chatId && w.status === "arbeitet");
          if (arbeitet && get().selectedChatId === chatId) attach(chatId);
        }
        function markiere(mid: string, meta: Record<string, boolean>) {
          set((s) => ({
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] ?? []).map((m) => (m.id === mid ? { ...m, metadata: { ...m.metadata, ...meta } } : m)),
            },
          }));
        }
      },

      stop: async (chatId) => {
        try {
          await api.stopChat(chatId);
        } catch (e) {
          meldeFehler(chatId, e);
        }
      },

      resume: async (chatId, dismiss) => {
        const it = get().interrupted[chatId];
        if (!it) return;
        try {
          await api.resumeChat(chatId, it.runId, dismiss);
          set((s) => ({ interrupted: { ...s.interrupted, [chatId]: null } }));
          if (!dismiss) attach(chatId);
        } catch (e) {
          meldeFehler(chatId, e);
        }
      },

      react: async (chatId, messageId, emoji) => {
        try {
          if (emoji) await api.setReaction(chatId, messageId, emoji);
          else await api.removeReaction(chatId, messageId);
          set((s) => {
            const list = (s.reactions[chatId] ?? []).filter((r) => !(r.messageId === messageId && r.actor === "user"));
            if (emoji) list.push({ messageId, actor: "user", emoji });
            return { reactions: { ...s.reactions, [chatId]: list } };
          });
        } catch (e) {
          meldeFehler(chatId, e);
        }
      },

      dismissNotice: (chatId) =>
        set((s) => {
          const notices = { ...s.notices };
          delete notices[chatId];
          return { notices };
        }),

      decide: async (id, decision) => {
        const before = get().cards;
        const karte = before.find((k) => k.id === id);
        set({ cards: before.filter((k) => k.id !== id) });
        try {
          await api.decideApproval(id, decision);
        } catch (e) {
          const text = fehlerText(e);
          if (!/nicht mehr offen|abgelaufen/.test(text) && karte) set((s) => ({ cards: [...s.cards, karte] }));
          meldeFehler(karte?.chatId ?? null, text);
        }
      },

      answer: async (id, answers) => {
        const before = get().cards;
        const karte = before.find((k) => k.id === id);
        set({ cards: before.filter((k) => k.id !== id) });
        try {
          if (answers) await api.answerQuestion(id, answers);
          else await api.skipQuestion(id);
        } catch (e) {
          const text = fehlerText(e);
          if (!/nicht mehr offen/.test(text) && karte) set((s) => ({ cards: [...s.cards, karte] }));
          meldeFehler(karte?.chatId ?? null, text);
        }
      },

      setRoutineEnabled: async (id, enabled) => {
        try { await api.setAutomationEnabled(id, enabled); } catch (e) { meldeFehler(null, e); }
        await reloadRoutines();
      },
      runRoutine: async (id) => {
        try { await api.runAutomation(id); } catch (e) { meldeFehler(null, e); }
        await reloadRoutines();
      },
      trashRoutine: async (id) => {
        try { await api.trashAutomation(id); } catch (e) { meldeFehler(null, e); }
        await reloadRoutines();
      },
      restoreRoutine: async (id) => {
        try { await api.restoreAutomation(id); } catch (e) { meldeFehler(null, e); }
        await reloadRoutines();
      },
      deleteRoutine: async (id) => {
        try { await api.deleteAutomation(id); } catch (e) { meldeFehler(null, e); }
        await reloadRoutines();
      },
      updateRoutine: async (id, input) => {
        try { await api.updateAutomation(id, input); } catch (e) { meldeFehler(null, e); }
        await reloadRoutines();
      },
    };
  };
}

/** Eigener Speicher (für Tests und mehrere Fenster). */
export const createOrbitStore = (opts?: OrbitOptions) => createStore<OrbitState>(initializer(opts));

/** Der App-weite Speicher als React-Hook: `useOrbit((s) => s.bots)`. */
export const useOrbit = create<OrbitState>(initializer());

export type { Automation };
