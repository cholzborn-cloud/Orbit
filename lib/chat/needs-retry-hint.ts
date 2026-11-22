export function needsRetryHint({
  messages,
  status,
  restored,
}: {
  messages: { role: string }[]
  status: string
  restored: boolean
}) {
  return restored && status === "ready" && messages.at(-1)?.role === "user"
}
