const callsByTurn = new WeakMap<AbortSignal, number>()

export function takeSearchSlot(signal: AbortSignal | undefined) {
  if (!signal) return true
  const count = callsByTurn.get(signal) ?? 0
  if (count >= 3) return false
  callsByTurn.set(signal, count + 1)
  return true
}

export function escapeWebResultClosingTag(text: string) {
  return text.replace(/<\/web_result/gi, (tag) => tag.replace("/", "\\/"))
}
