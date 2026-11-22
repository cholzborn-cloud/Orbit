import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useOrbit } from "../../lib/store";
import { mockDienst } from "../onboarding/mock";
import { Modellwahl } from "./Modellwahl";

let abbau = () => {};
afterEach(() => {
  cleanup();
  abbau();
  useOrbit.setState({ chatModelle: {} });
});

const chip = (name: string) => screen.findByRole("button", { name });
const zeile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

it("wählt Modell und Denktiefe im Picker, merkt sie je Chat und speichert den Profilstandard", async () => {
  const dienst = mockDienst();
  abbau = dienst.abbauen;
  const auswahl = (chatId: string) => <><Modellwahl chatId={chatId} /><Modellwahl /></>;
  const { rerender } = render(auswahl("c1"));

  // Standardmodell: Wahl gilt sofort und landet im Profil.
  fireEvent.click(await chip("Default model"));
  fireEvent.click(zeile("Claude Opus"));
  await waitFor(() => expect(dienst.zustand.profil.defaultModel).toBe("opus"));
  fireEvent.click(screen.getByRole("button", { name: "High" }));
  await waitFor(() => expect(dienst.zustand.profil.defaultEffort).toBe("high"));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  // Chat: Standard, dann ein eigenes Modell mit Denktiefe (nur für Modelle mit Denktiefe sichtbar).
  fireEvent.click(await chip("Model for this chat"));
  expect(screen.queryByRole("group", { name: "Reasoning effort" })).toBeNull();
  fireEvent.click(zeile("GPT-6.1"));
  expect(screen.getAllByRole("button", { name: /^(Low|Medium|High|Extra|Max|Ultra)$/ })).toHaveLength(6); // die echten Stufen dieses Modells
  expect(within(screen.getByRole("group", { name: "Reasoning effort" })).queryByRole("button", { name: "Auto" })).toBeNull();
  expect(useOrbit.getState().chatModelle["c1"]?.effort).toBe("medium");
  fireEvent.click(screen.getByRole("button", { name: "Low" }));
  fireEvent.click(screen.getByRole("switch", { name: "Fast" }));
  expect(useOrbit.getState().chatModelle["c1"]).toEqual({ model: "gpt", effort: "low", fast: true });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  rerender(auswahl("c2"));
  expect(useOrbit.getState().chatModelle["c2"]).toBeUndefined();
  rerender(auswahl("c1"));
  expect(screen.getByRole("button", { name: "Model for this chat" }).textContent).toContain("GPT-6.1 Terra · Low · Fast");

  // Anderes Modell: eigene Stufen, kein Fast; ältere Modelle und Cursor stehen in Ausklappmenüs.
  fireEvent.click(screen.getByRole("button", { name: "Model for this chat" }));
  fireEvent.click(zeile("Claude Opus"));
  expect(screen.getAllByRole("button", { name: /^(Low|Medium|High|Extra|Max|Ultra)$/ })).toHaveLength(5);
  expect(screen.queryByRole("switch", { name: "Fast" })).toBeNull();
  expect(useOrbit.getState().chatModelle["c1"]).toEqual({ model: "opus", effort: "low", fast: false });
  // Anbieter sind durch Überschriften getrennt (Name und Marke), jedes Modell steht unter seinem Anbieter.
  for (const [anbieter, modell] of [["Anthropic", "Claude Opus"], ["OpenAI", "GPT-6.1 Terra"], ["Google", "Gemini 3.8 Flash"]]) {
    const gruppe = screen.getByRole("group", { name: anbieter });
    expect(within(gruppe).getByRole("button", { name: new RegExp(`^${modell}`) })).toBeDefined();
    expect(gruppe.querySelector("svg[data-symbol^='marke:']")).not.toBeNull();
  }
  // Gemini ist EIN Eintrag mit genau drei Stufen; die gewählte Stufe geht als Wunsch ans Backend.
  fireEvent.click(zeile("Gemini 3.8 Flash"));
  expect(screen.getAllByRole("button", { name: /^(Low|Medium|High|Extra|Max|Ultra)$/ }).map((b) => b.textContent)).toEqual(["Low", "Medium", "High"]);
  fireEvent.click(screen.getByRole("button", { name: "Medium" }));
  expect(useOrbit.getState().chatModelle["c1"]).toEqual({ model: "flash", effort: "medium", fast: false });
  fireEvent.click(zeile("Claude Opus"));
  expect(useOrbit.getState().chatModelle["c1"]).toEqual({ model: "opus", effort: "medium", fast: false });
  expect(screen.queryByRole("button", { name: /^GPT-6 Sol/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Older models" }));
  fireEvent.click(zeile("GPT-6 Sol"));
  expect(screen.getAllByRole("button", { name: /^(Low|Medium|High|Extra|Max|Ultra)$/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Cursor" }));
  fireEvent.click(zeile("Cursor Composer Fast"));
  expect(useOrbit.getState().chatModelle["c1"]).toEqual({ model: "cursor:composer-test[fast=true]", effort: null, fast: false });
  expect(screen.queryByRole("dialog")).toBeNull(); // ohne Stufen und Fast schließt die Wahl sofort

  // Auto-Schalter und zurück zum Standard.
  fireEvent.click(screen.getByRole("button", { name: "Model for this chat" }));
  const autoSymbol = screen.getByRole("switch", { name: "Automatic" }).parentElement?.querySelector("svg");
  expect(autoSymbol?.innerHTML).toContain("M11.017 2.814"); // schlichter Einzelfunke statt Mehrfach-Sterne
  expect(autoSymbol?.getAttribute("stroke-width")).toBe("1.75");
  fireEvent.click(screen.getByRole("switch", { name: "Automatic" }));
  expect(useOrbit.getState().chatModelle["c1"]).toEqual({ model: "auto", effort: null, fast: false });
  expect(screen.queryByRole("group", { name: "Reasoning effort" })).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Automatic" }));
  expect(useOrbit.getState().chatModelle["c1"]).toBeUndefined();
});
