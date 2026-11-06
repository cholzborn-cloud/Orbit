// Eine offene Freigabe wartet bis zu 24 Stunden auf Consti (vorher 10 Minuten).
export const APPROVAL_LIFETIME_MS = 24 * 60 * 60_000

export function isExpired(
  requestedAt: number | Date,
  now: number | Date = Date.now()
) {
  return (
    new Date(now).getTime() - new Date(requestedAt).getTime() >=
    APPROVAL_LIFETIME_MS
  )
}
