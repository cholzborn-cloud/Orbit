// Eine Form für Nachrichten-Metadata und Client-Daten (Schema: withClientData in trigger/chat.ts).
export const sendMetadata = (
  model: string,
  effort: string | undefined,
  context: boolean,
  botId: string | undefined,
  skill?: { name: string; source: "orbit" | "brain" }
) => ({
  model,
  effort,
  context,
  botId,
  ...(skill && { skill }),
})
