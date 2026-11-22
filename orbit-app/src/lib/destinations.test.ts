import { describe, expect, it } from "vitest";
import {
  DESTINATIONS, destinationKeys, destinationLink, getDestinationRegistry, openResolved, resolveOrbitLink,
  type DestinationEffects, type DestinationState,
} from "./destinations";
import { seiteVon } from "../features/einstellungen/store";

const state: DestinationState = {
  main: { id: "orbit", chatId: "c-main", name: "Orbit" },
  bots: [{ id: "mira", chatId: "c-mira", name: "Mira" }],
  groups: [{ id: "g1", name: "Team" }],
};

function effects() {
  const log: string[] = [];
  const fx: DestinationEffects = {
    goChat: () => log.push("chat"),
    goSettings: (page, anchor) => log.push(`settings:${page}${anchor ? `#${anchor}` : ""}`),
    goRoutines: () => log.push("routines"),
    goComputer: (id) => log.push(`computer:${id}`),
    selectChat: async (id) => { log.push(`select:${id}`); },
    setPanel: (tab) => log.push(`panel:${tab}`),
    openOrbiEditor: (id) => log.push(`editor:${id}`),
    openGroupEditor: (id) => log.push(`group:${id}`),
  };
  return { log, fx };
}

describe("destination registry", () => {
  it("has unique keys and paths, English labels and is plain JSON", () => {
    const keys = DESTINATIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(DESTINATIONS.map((d) => d.path)).size).toBe(DESTINATIONS.length);
    expect(getDestinationRegistry()).toEqual(DESTINATIONS);
    for (const d of DESTINATIONS) {
      expect(d.label).not.toMatch(/[äöüß]/i);
      if (d.status === "unavailable") expect(d.reason).toBeTruthy();
      else expect(d.target.view).not.toBe("none");
    }
  });

  it("maps every settings destination to a real settings page", () => {
    for (const d of DESTINATIONS) {
      if (d.target.view === "settings") expect(seiteVon(d.target.page)).toBe(d.target.page);
    }
  });

  it("lists only available keys for the service unless asked", () => {
    expect(destinationKeys()).toContain("settings.notifications");
    expect(destinationKeys()).not.toContain("settings.microphone");
    expect(destinationKeys({ includeUnavailable: true })).toContain("settings.microphone");
  });

  it("builds links", () => {
    expect(destinationLink("settings.notifications")).toBe("orbit://settings/notifications");
    expect(destinationLink("orbi.routines", "mira")).toBe("orbit://orbi/mira/routines");
    expect(destinationLink("orbi.routines")).toBeNull();
    expect(destinationLink("nope")).toBeNull();
  });
});

describe("orbit:// link resolution", () => {
  it("resolves settings links with anchors", async () => {
    const r = resolveOrbitLink("orbit://settings/notifications", state);
    expect(r.kind).toBe("ok");
    const { log, fx } = effects();
    expect(await openResolved(r, fx)).toBe(true);
    expect(log).toEqual(["settings:allgemein#notifications"]);
  });

  it("opens an owned Orbi's tab in order: chat, select, panel", async () => {
    const { log, fx } = effects();
    await openResolved(resolveOrbitLink("orbit://orbi/mira/routines", state), fx);
    expect(log).toEqual(["chat", "select:c-mira", "panel:uebersicht"]);
    log.length = 0;
    await openResolved(resolveOrbitLink("orbit://orbi/mira/media", state), fx);
    expect(log).toEqual(["chat", "select:c-mira", "panel:bibliothek"]);
    log.length = 0;
    await openResolved(resolveOrbitLink("orbit://orbi/orbit/computer", state), fx);
    expect(log).toEqual(["select:c-main", "computer:orbit"]);
    log.length = 0;
    await openResolved(resolveOrbitLink("orbit://orbi/mira/profile", state), fx);
    expect(log).toEqual(["chat", "select:c-mira", "editor:mira"]);
    log.length = 0;
    await openResolved(resolveOrbitLink("orbit://group/g1/members", state), fx);
    expect(log).toEqual(["chat", "select:g1", "group:g1"]);
    log.length = 0;
    await openResolved(resolveOrbitLink("orbit://routines", state), fx);
    expect(log).toEqual(["routines"]);
  });

  it("refuses Orbis and groups that do not belong to this profile", async () => {
    const r = resolveOrbitLink("orbit://orbi/fremd/routines", state);
    expect(r.kind).toBe("unavailable");
    if (r.kind === "unavailable") expect(r.message).toMatch(/not found/);
    expect(resolveOrbitLink("orbit://group/g9/members", state).kind).toBe("unavailable");
    const fx = effects();
    expect(await openResolved(r, fx.fx)).toBe(false);
    expect(fx.log).toEqual([]);
  });

  it("marks unavailable and unknown destinations", () => {
    const mic = resolveOrbitLink("orbit://settings/microphone", state);
    expect(mic.kind).toBe("unavailable");
    if (mic.kind === "unavailable") expect(mic.message).toMatch(/Microphone/);
    expect(resolveOrbitLink("orbit://settings/does-not-exist", state).kind).toBe("unknown");
    expect(resolveOrbitLink("orbit://", state).kind).toBe("unknown");
    expect(resolveOrbitLink("https://example.com", state).kind).toBe("unknown");
    expect(resolveOrbitLink("orbit://orbi/%E0%A4%A/x", state).kind).toBe("unknown");
  });

  it("is case-insensitive for fixed segments and ignores query and fragment", () => {
    expect(resolveOrbitLink("orbit://Settings/Notifications?x=1#y", state).kind).toBe("ok");
  });

  it("never touches the OAuth callback scheme", () => {
    expect(resolveOrbitLink("orbit-rust://auth/callback?rotating_token_nonce=abc", state).kind).toBe("unknown");
  });
});
