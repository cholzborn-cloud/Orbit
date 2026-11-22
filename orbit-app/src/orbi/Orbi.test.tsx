import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Orbi, AVATAR_NAMES, eyeColor } from "./index";
import { OrbiGallery } from "./OrbiGallery";
import { Behavior } from "./behavior";
import { subscribe, activeCount } from "./ticker";

afterEach(cleanup);
const svgOf = (c: HTMLElement) => c.querySelector("svg[data-orbi]") as SVGElement;

describe("Orbi", () => {
  it("hat 25 Namen und rendert jeden mit Körper und Augen", () => {
    expect(AVATAR_NAMES).toHaveLength(25);
    for (const name of AVATAR_NAMES) {
      const { container, unmount } = render(<Orbi avatar={name} />);
      const svg = svgOf(container);
      const d = Array.from(svg.querySelectorAll("path")).map((p) => p.getAttribute("d") ?? "");
      expect(d.some((x) => x.length > 20), name).toBe(true);
      expect(svg.querySelector('[data-part="eyes"] path'), name).not.toBeNull();
      expect(d.join("")).not.toMatch(/NaN/);
      unmount();
    }
  });

  it("Farbe wirkt, Standard folgt Modus", () => {
    const a = render(<Orbi avatar="strobi" color="#123456" />);
    expect(svgOf(a.container).getAttribute("data-body")).toBe("#123456");
    a.unmount();
    const l = render(<Orbi avatar="strobi" />); const dl = svgOf(l.container).getAttribute("data-body"); l.unmount();
    const d = render(<Orbi avatar="strobi" dark />); const dd = svgOf(d.container).getAttribute("data-body");
    expect(dl).toBe("#3378ec"); expect(dd).toBe("#3e82f4");
    expect(eyeColor("#ffffff", false)).toBe("#0f172a");
  });

  it("Look kann Augen, Zubehör und Wangen nicht ändern", () => {
    const look = { eyes: "triangle", accessory: "glasses", cheeks: true } as never;
    const svg = svgOf(render(<Orbi avatar="nova" look={look} />).container);
    expect(svg.querySelector("[data-eye],[data-part=glasses],[data-part=cheek],[data-part=cap]")).toBeNull();
    expect(svg.querySelector('[data-part="eyes"]')).not.toBeNull();
  });

  it("schlaeft zeigt z und geschlossene Augen, size wirkt", () => {
    const { container } = render(<Orbi avatar="erdi" state="schlaeft" size={96} />);
    const svg = svgOf(container);
    expect(svg.querySelector('[data-part="sleep"]')).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("96");
  });

  it("Verhalten: lebendig bewegt den Blick und blinzelt, normal bleibt still", () => {
    let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const b = new Behavior("lebendig", rnd);
    let maxLx = 0, blinked = false;
    for (let t = 0; t < 20; t += 1 / 30) { const p = b.step(t, null); maxLx = Math.max(maxLx, Math.abs(p.lx)); blinked ||= p.blink > 0.5; }
    expect(maxLx).toBeGreaterThan(0.15); expect(blinked).toBe(true);
    const n = new Behavior("normal", rnd);
    for (let t = 0; t < 5; t += 1 / 30) n.step(t, null);
    expect(n.pose.lx).toBe(0); expect(n.pose.blink).toBe(0);
  });

  it("Zeitgeber ist geteilt und stoppt ohne Figuren", () => {
    const base = activeCount();
    const off = subscribe(() => {});
    expect(activeCount()).toBe(base + 1);
    off();
    expect(activeCount()).toBe(base);
    const { unmount } = render(<Orbi avatar="strobi" state="lebendig" />);
    unmount();
    expect(activeCount()).toBe(base);
  });

  it("Galerie rendert", () => {
    const { container } = render(<OrbiGallery />);
    expect(container.querySelectorAll("svg[data-orbi]").length).toBeGreaterThan(80);
  });
});
