import { describe, expect, it } from "vitest";
import { nextLabel, nextOccurrence, nextRunText, routineSubtitle, scheduleLabel, scheduleSentence } from "./format";

const mi = new Date(2026, 10, 18, 12, 0); // Wednesday, 18 Nov 2026

describe("schedules", () => {
  it("labels short form and sentence", () => {
    expect(scheduleLabel({ kind: "weekly", weekday: 1, at: "08:00" })).toBe("Mondays 8:00");
    expect(scheduleLabel({ kind: "daily", at: "18:00" })).toBe("Daily 18:00");
    expect(scheduleLabel({ kind: "monthly", day: 1, at: "09:00" })).toBe("On the 1 at 9:00");
    expect(scheduleSentence({ kind: "weekly", weekday: 1, at: "08:00" })).toBe("every Monday at 8:00");
    expect(scheduleSentence({ kind: "weekly", weekday: 0, at: "10:30" })).toBe("every Sunday at 10:30");
  });
  it("next run", () => {
    expect(nextOccurrence({ kind: "weekly", weekday: 1, at: "08:00" }, mi)?.getDate()).toBe(23);
    expect(nextOccurrence({ kind: "daily", at: "18:00" }, mi)?.getDate()).toBe(18);
    expect(nextOccurrence({ kind: "daily", at: "08:00" }, mi)?.getDate()).toBe(19);
    expect(nextOccurrence({ kind: "weekdays", at: "08:00" }, new Date(2026, 10, 20, 12, 0))?.getDate()).toBe(23);
    expect(nextOccurrence({ kind: "monthly", day: 31, at: "09:00" }, mi)?.getMonth()).toBe(10);
    expect(nextOccurrence({ kind: "once", at: "08:00", date: "2026-11-01" }, mi)).toBeNull();
    expect(nextRunText(nextOccurrence({ kind: "weekly", weekday: 1, at: "08:00" }, mi), mi)).toBe("Monday, November 23");
    expect(nextRunText(nextOccurrence({ kind: "daily", at: "18:00" }, mi), mi)).toBe("today, 18:00");
  });
  it("relative labels", () => {
    expect(nextLabel(new Date(2026, 10, 23, 8).toISOString(), mi)).toBe("next in 5 days");
    expect(nextLabel(new Date(2026, 10, 18, 18).toISOString(), mi)).toBe("next today");
    expect(routineSubtitle({ schedule: { kind: "monthly", day: 1, at: "09:00" }, enabled: false, nextRunAt: null, pausedReason: null }, mi)).toBe("On the 1 at 9:00 · paused");
  });
});
