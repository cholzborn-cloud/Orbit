import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { openUrl } from "../../lib/tauri";
import { Markdown } from "./markdown";

vi.mock("../../lib/tauri", async (load) => ({
  ...await load<typeof import("../../lib/tauri")>(),
  openUrl: vi.fn(async () => {}),
}));

it("renders an existing Cursor agent link and opens it only on click", () => {
  const url = "https://cursor.com/agents/bc-orbit-demo";
  const view = render(<Markdown text={`[Cursor cloud agent · bc-orbit-demo](${url})`} />);
  const card = screen.getByRole("link", { name: /Cursor cloud agent.*bc-orbit-demo/ });
  expect(card.getAttribute("data-cursor-agent")).toBe("bc-orbit-demo");
  expect(openUrl).not.toHaveBeenCalled();
  fireEvent.click(card);
  expect(openUrl).toHaveBeenCalledWith(url);
  view.rerender(<Markdown text={`[Cursor cloud agent · bc-orbit-demo](${url}?redirect=1)`} />);
  expect(screen.getByRole("link").hasAttribute("data-cursor-agent")).toBe(false);
});
