import { expect, it, vi } from "vitest";
import { namensVorschlag } from "./namen";

it("schlägt Namen vor und überspringt den aktuellen Namen", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    expect(namensVorschlag()).toBe("Mira");
    expect(namensVorschlag(" mira ")).toBe("Juno");
  } finally {
    random.mockRestore();
  }
});
