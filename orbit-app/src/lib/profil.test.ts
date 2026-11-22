import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({ apiRequest: vi.fn(), accountStatus: vi.fn() }));
import { accountStatus, apiRequest } from "./tauri";
import { initialen, useProfilName } from "./profil";

describe("initialen", () => {
  it("zwei Wörter", () => expect(initialen("Constantin Holzborn")).toBe("CH"));
  it("ein Wort", () => expect(initialen("Constantin")).toBe("C"));
  it("leer und Leerzeichen", () => { expect(initialen("")).toBe(""); expect(initialen("   ")).toBe(""); expect(initialen(null)).toBe(""); });
  it("drei Wörter: erste zwei", () => expect(initialen("Anna Maria Schmidt")).toBe("AM"));
  it("Kleinschreibung wird groß", () => expect(initialen("mira kai")).toBe("MK"));
  it("Bindestrich bleibt ein Wort", () => { expect(initialen("Anna-Lena")).toBe("A"); expect(initialen("Jean-Luc Picard")).toBe("JP"); });
  it("Umlaute und ß", () => { expect(initialen("Özlem Ünal")).toBe("ÖÜ"); expect(initialen("ärger")).toBe("Ä"); expect(initialen("ßa")).toBe("S"); });
  it("Emoji und Satzzeichen zählen nicht", () => {
    expect(initialen("🙂")).toBe("");
    expect(initialen("🙂 Mira")).toBe("M");
    expect(initialen("Mira 🙂 Kai")).toBe("MK");
    expect(initialen("(Mira) \"Kai\"")).toBe("MK");
    expect(initialen("👨‍👩‍👧 Anna")).toBe("A");
  });
  it("mehrere Leerzeichen", () => expect(initialen("  Mira    Kai  ")).toBe("MK"));
});

describe("useProfilName", () => {
  beforeEach(() => { localStorage.clear(); useProfilName.setState({ name: "", geladen: false }); vi.mocked(apiRequest).mockReset(); vi.mocked(accountStatus).mockReset(); });

  it("nimmt den Namen des Dienstes und merkt ihn im Browserspeicher", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: true, profile: { name: " Mira Kai " } });
    await useProfilName.getState().laden();
    expect(useProfilName.getState().name).toBe("Mira Kai");
    expect(localStorage.getItem("orbit.profil.name")).toBe("Mira Kai");
  });
  it("ohne Namen im Dienst: Name aus dem Google-Konto, nur wenn angemeldet", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: true, profile: { name: "" } });
    vi.mocked(accountStatus).mockResolvedValue({ signedIn: true, configured: true, email: null, displayName: "Constantin Holzborn", photoUrl: null });
    await useProfilName.getState().laden();
    expect(useProfilName.getState().name).toBe("Constantin Holzborn");
    vi.mocked(accountStatus).mockResolvedValue({ signedIn: false, configured: true, email: null, displayName: "Fremd", photoUrl: null });
    await useProfilName.getState().laden();
    expect(useProfilName.getState().name).toBe("");
  });
  it("Dienst nicht erreichbar: gemerkter Name bleibt", async () => {
    useProfilName.setState({ name: "Mira" });
    vi.mocked(apiRequest).mockRejectedValue(new Error("aus"));
    vi.mocked(accountStatus).mockRejectedValue(new Error("aus"));
    await useProfilName.getState().laden();
    expect(useProfilName.getState().name).toBe("Mira");
  });
  it("setzen speichert gekürzt", () => {
    useProfilName.getState().setzen("  Kai ");
    expect(useProfilName.getState().name).toBe("Kai");
    expect(localStorage.getItem("orbit.profil.name")).toBe("Kai");
  });
});
