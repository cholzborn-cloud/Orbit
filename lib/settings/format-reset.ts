const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// `now` kommt vom Aufrufer (Abrufzeit), damit die Anzeige rein bleibt.
export function formatReset(resetAt: number, now: number): string {
  const diff = resetAt - now
  if (diff <= 0) return "Reset steht an"
  if (diff >= DAY) {
    const when = new Date(resetAt).toLocaleString("de-DE", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    return `Reset ${when}`
  }
  const minutes = Math.ceil(diff / MINUTE)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `Reset in ${[h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ")}`
}
