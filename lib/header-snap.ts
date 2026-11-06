// Chat-Header: Fortschritt p und Einrasten. Ohne React, damit es direkt testbar ist.

// Scroll-Strecke, auf der der Header von groß (p = 0) nach klein (p = 1) wandert.
export const HEADER_SNAP_D = 96
// Dauer des Einrastens, easeOut.
export const HEADER_SNAP_MS = 300

export const headerProgress = (offset: number, d = HEADER_SNAP_D) =>
  Math.min(1, Math.max(0, offset / d))

// Ziel nach dem Loslassen: 0 oder D, null = nicht eingreifen.
// direction: +1 runter, -1 hoch, 0 keine klare Richtung.
export function snapTarget(
  offset: number,
  direction: number,
  maxScroll: number,
  d = HEADER_SNAP_D
): number | null {
  // Zu wenig Inhalt für D: nie vom Ende wegziehen.
  if (maxScroll < d) return null
  // Ruhezustände und alles ab D bleiben unangetastet.
  if (offset <= 0 || offset >= d) return null
  if (direction > 0) return d
  if (direction < 0) return 0
  return offset / d < 0.5 ? 0 : d
}
