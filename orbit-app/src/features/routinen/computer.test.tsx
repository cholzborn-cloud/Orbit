import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "../../lib/tauri";
import { ComputerView } from "./ComputerView";
import { useDesktop } from "./computer";

vi.mock("../../lib/tauri", () => ({ apiRequest: vi.fn(), openUrl: vi.fn() }));

afterEach(() => {
  cleanup();
  useDesktop.setState({ desk: {} });
  vi.resetAllMocks();
});

it("prüft und speichert den Schlüssel und verbindet einen bestehenden Computer auf eigenen Klick", async () => {
  let gespeichert = false;
  let verbunden = false;
  vi.mocked(apiRequest).mockImplementation(async (method, path) => {
    if (path === "/v1/keys") return { keys: [{ name: "DAYTONA_API_KEY", set: gespeichert }] };
    if (path === "/v1/daytona/orbi/key" && method === "PUT") {
      gespeichert = true;
      return { ok: true, set: true };
    }
    if (path === "/v1/daytona/orbi/desktop-status") return { state: verbunden ? "sleeping" : "unconfigured" };
    if (path === "/v1/bots/orbi/sandbox/reconnect" && method === "POST") {
      verbunden = true;
      return { ok: true, sandboxConfigured: true };
    }
    throw new Error("Unerwarteter Dienstaufruf");
  });

  render(<ComputerView botId="orbi" />);
  const feld = await screen.findByLabelText("Daytona key");
  expect(screen.getByRole("dialog", { name: "Computer" }).style.width).toBe("460px");
  expect(feld).toHaveProperty("type", "password");
  fireEvent.change(feld, { target: { value: "test-schluessel" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and save" }));
  const verbinden = await screen.findByRole("button", { name: "Connect existing computer" });
  expect(apiRequest).toHaveBeenCalledWith("PUT", "/v1/daytona/orbi/key", { key: "test-schluessel" });
  expect(vi.mocked(apiRequest).mock.calls.some(([m]) => m === "POST")).toBe(false);

  fireEvent.click(verbinden);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/v1/bots/orbi/sandbox/reconnect", undefined));
  expect(await screen.findByRole("heading", { name: "The computer is asleep" })).toBeDefined();
  expect(screen.getByRole("dialog", { name: "Computer" }).style.width).toBe("460px");
});

it("weitet den Dialog nur für die Desktop-Ansicht", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ state: "running" });

  render(<ComputerView botId="orbi" />);

  expect(await screen.findByRole("button", { name: "Take over" })).toBeDefined();
  expect(screen.getByRole("dialog", { name: "Computer" }).style.width).toBe("620px");
});

it("zeigt den echten Bildschirm: zuschauen nur ansehen, nach dem Übernehmen mit Steuerung", async () => {
  const live = "https://6080-sabc.proxy.daytona.work/vnc.html?autoconnect=true";
  const pfade: string[] = [];
  vi.mocked(apiRequest).mockImplementation(async (_m: string, path: string) => {
    pfade.push(path);
    if (path.endsWith("/desktop-status")) return { state: "running" };
    if (path.includes("/desktop-url")) return { ok: true, url: live + (path.includes("viewOnly") ? "&view_only=true" : "") };
    if (path.endsWith("/takeover")) return { takeoverId: "t1" };
    return {};
  });

  render(<ComputerView botId="orbi" />);

  const zuschauen = (await screen.findByTitle("Screen of Orbi")) as HTMLIFrameElement;
  expect(zuschauen.src).toBe(`${live}&view_only=true`);
  expect(pfade).toContain("/v1/daytona/orbi/desktop-url?viewOnly=1");

  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  await waitFor(() => expect(pfade).toContain("/v1/daytona/orbi/desktop-url"));
  await waitFor(() => expect((screen.getByTitle("Screen of Orbi") as HTMLIFrameElement).src).toBe(live));
});

it("meldet ehrlich, wenn der Bildschirm nicht erreichbar ist, und versucht es auf Klick erneut", async () => {
  let ok = false;
  vi.mocked(apiRequest).mockImplementation(async (_m: string, path: string) => {
    if (path.endsWith("/desktop-status")) return { state: "running" };
    if (!ok) throw new Error("Der Desktop ist gerade nicht erreichbar.");
    return { url: "https://6080-sabc.proxy.daytona.work/vnc.html" };
  });

  render(<ComputerView botId="orbi" />);

  const nochmal = await screen.findByRole("button", { name: "Try again" });
  expect(screen.queryByTitle("Screen of Orbi")).toBeNull();
  ok = true;
  fireEvent.click(nochmal);
  expect(await screen.findByTitle("Screen of Orbi")).toBeDefined();
});
