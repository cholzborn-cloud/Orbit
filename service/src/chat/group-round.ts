import type { RoundPlan } from "../../../lib/chat/group-round.ts"

// Ablauf einer Gruppenrunde (Phase 2, Punkt 11), ohne Wissen über Modelle oder Chats: Die Mitglieder sprechen
// nacheinander, jeder darf schweigen, @-Markierte müssen antworten (einmaliger Nachlauf), und bei einer
// Nachricht von Consti antwortet mindestens einer (Rückfall). Stopp beendet die Runde vor dem nächsten Mitglied.

export type MemberOutcome = { spoke: boolean; aborted: boolean; failed: boolean }
export type MemberTurn = { marked: boolean; forced: boolean }

export type RoundResult = {
  spoke: string[] // Mitglieder, die geantwortet haben
  silent: string[] // Mitglieder, die geschwiegen haben (am Ende der Runde)
  stopped: boolean
}

export async function continueRound(input: {
  plan: RoundPlan
  // Das erste Mitglied hat schon gesprochen (es hatte die HTTP-Antwort); null = die Runde beginnt bei ihm.
  first: MemberOutcome | null
  runMember: (botId: string, turn: MemberTurn) => Promise<MemberOutcome>
  isAborted: () => boolean
  requireAnswer: boolean // Nachricht von Consti: mindestens ein Mitglied antwortet
}): Promise<RoundResult> {
  const { plan, runMember, isAborted } = input
  const spoke = new Set<string>()
  const silent = new Set<string>()
  const retried = new Set<string>()
  let stopped = false
  const record = (id: string, outcome: MemberOutcome) => {
    if (outcome.aborted) stopped = true
    if (outcome.spoke) {
      spoke.add(id)
      silent.delete(id)
    } else if (!spoke.has(id)) silent.add(id)
  }
  // @-markiert und still: einmal nachfragen, mit Hinweis im Prompt.
  const turn = async (id: string, forced: boolean): Promise<MemberOutcome> => {
    const marked = plan.marked.includes(id)
    if (forced) retried.add(id)
    const outcome = await runMember(id, { marked, forced })
    record(id, outcome)
    if (marked && !forced && !outcome.spoke && !outcome.aborted && !isAborted()) await turn(id, true)
    return outcome
  }
  const [firstId, ...rest] = plan.order
  if (!firstId) return { spoke: [], silent: [], stopped: false }
  if (input.first) {
    record(firstId, input.first)
    const marked = plan.marked.includes(firstId)
    if (marked && !input.first.spoke && !input.first.aborted && !isAborted()) await turn(firstId, true)
  } else await turn(firstId, false)
  for (const id of rest) {
    if (stopped || isAborted()) {
      stopped = true
      break
    }
    await turn(id, false)
  }
  if (!stopped && isAborted()) stopped = true
  if (!stopped && input.requireAnswer && spoke.size === 0) {
    const fallback = [plan.fallback, ...plan.order].find(id => !retried.has(id))
    if (fallback) {
      retried.add(fallback)
      record(fallback, await runMember(fallback, { marked: true, forced: true }))
    }
  }
  return { spoke: [...spoke], silent: [...silent], stopped }
}
