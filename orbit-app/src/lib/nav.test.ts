import { beforeEach, describe, expect, it } from "vitest";
import { LEISTE, maxBreite, useNav } from "./nav";

describe("Leistenbreiten", () => {
  beforeEach(() => {
    localStorage.clear();
    useNav.setState({ sidebarWidth: LEISTE.links.std, panelWidth: LEISTE.rechts.std, sidebarCollapsed: false });
  });

  it("hält die Breiten in den Grenzen", () => {
    useNav.getState().setSidebarWidth(10);
    expect(useNav.getState().sidebarWidth).toBe(LEISTE.links.min);
    useNav.getState().setSidebarWidth(9999);
    expect(useNav.getState().sidebarWidth).toBe(LEISTE.links.max);
    useNav.getState().setPanelWidth(400.4);
    expect(useNav.getState().panelWidth).toBe(400);
    useNav.getState().setPanelWidth(NaN);
    expect(useNav.getState().panelWidth).toBe(LEISTE.rechts.std);
  });

  it("merkt Breite und Eingeklappt-Zustand", () => {
    useNav.getState().setSidebarWidth(300);
    useNav.getState().setPanelWidth(420);
    useNav.getState().toggleSidebar();
    expect(JSON.parse(localStorage.getItem("orbit.leisten.v1")!)).toEqual({ links: 300, rechts: 420, klein: true });
  });

  it("lässt dem Chat Platz, aber nie weniger als die Mindestbreite", () => {
    window.innerWidth = 1440;
    expect(maxBreite("links", 340)).toBe(LEISTE.links.max);
    window.innerWidth = 960;
    expect(maxBreite("links", 340)).toBe(LEISTE.links.min);
    expect(maxBreite("rechts", 0)).toBe(LEISTE.rechts.max);
  });
});
