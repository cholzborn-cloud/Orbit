import type { UIMessage } from "ai"

// Bausteine der Gruppenrunde (Phase 2, Lauf A2). Läuft unter `node --test`: nur Typen aus fremden Modulen.

export type RoundMember = { id: string; name: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Erwähnungen in der Reihenfolge ihres Auftretens als Orbi-Ids: `@[Name](orbi:<id>)` (Id zählt, Name egal) und
// Klartext `@Name` (Groß/Klein egal, längster Name zuerst). Mehrdeutige Namen (zwei Mitglieder heißen gleich)
// und Unbekannte werden ignoriert. Eine Markierung allein startet nichts, sie ordnet nur die Runde.
export function parseMentions(text: string, members: RoundMember[]): string[] {
  const hits: { at: number; id: string }[] = []
  const ids = new Set(members.map((m) => m.id))
  let rest = text.replace(/@\[([^\]\n]*)\]\(orbi:([^)\s]+)\)/g, (m, _n, id, at) => {
    if (ids.has(id)) hits.push({ at, id })
    return " ".repeat(m.length)
  })
  const count = new Map<string, number>()
  for (const m of members) {
    const k = m.name.trim().toLowerCase()
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const unique = members
    .filter((m) => m.name.trim() && count.get(m.name.trim().toLowerCase()) === 1)
    .sort((a, b) => b.name.length - a.name.length)
  for (const m of unique) {
    const re = new RegExp(`@${escapeRe(m.name.trim())}(?![\\p{L}\\p{N}_])`, "giu")
    rest = rest.replace(re, (hit, at: number) => {
      hits.push({ at, id: m.id })
      return " ".repeat(hit.length)
    })
  }
  const out: string[] = []
  for (const hit of hits.sort((a, b) => a.at - b.at))
    if (!out.includes(hit.id)) out.push(hit.id)
  return out
}

export type RoundPlan = {
  order: string[] // Mitglieder in Sprechreihenfolge: @-Markierte zuerst, dann Mitgliederreihenfolge
  marked: string[] // müssen antworten
  fallback: string // antwortet, wenn alle schweigen
}

// `members` in Mitgliederreihenfolge; `exclude` = Absender einer Orbi-Nachricht (spricht in dieser Runde nicht);
// `selected` = zuletzt in der App gewählter Orbi (Rückfall, sonst der erste).
export function planRound(input: {
  members: RoundMember[]
  text: string
  selected?: string
  exclude?: string
}): RoundPlan | null {
  const pool = input.members.filter((m) => m.id !== input.exclude)
  if (!pool.length) return null
  const marked = parseMentions(input.text, pool)
  const rest = pool.map((m) => m.id).filter((id) => !marked.includes(id))
  return {
    order: [...marked, ...rest],
    marked,
    fallback: pool.some((m) => m.id === input.selected)
      ? input.selected!
      : pool[0]!.id,
  }
}

// Eine Antwort zählt, wenn sie etwas Sichtbares enthält: Text, Datei oder Werkzeug. Nur Denken oder leerer Text = Schweigen.
export function isSilent(message: Pick<UIMessage, "parts"> | undefined) {
  if (!message) return true
  return !message.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0
    return !(part.type === "step-start" || part.type === "reasoning")
  })
}

// Prompt-Zusatz für Gruppenturns (ersetzt den alten Satz „The user picked YOU“).
export function groupRoundPrompt(
  name: string,
  turn: { marked: boolean; forced?: boolean }
) {
  return [
    `Group round: a message went to all members; you are ${name}, earlier replies are above.`,
    turn.marked || turn.forced
      ? "Reply briefly (max 3 short messages, no thanks, no repeats)."
      : "Reply only if you add something new (max 3 short messages, no thanks, no repeats); otherwise write nothing at all.",
    turn.forced
      ? "You must answer now."
      : turn.marked
        ? "You were tagged: you MUST answer."
        : "",
  ]
    .filter(Boolean)
    .join(" ")
}

// Kennzeichnung der Nachricht von Consti im Modellverlauf.
export const groupTag = (group: string) => `[Gruppe: ${group}]`
