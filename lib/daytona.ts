import "server-only"

import { Daytona, DaytonaNotFoundError } from "@daytona/sdk"

import { MEMORY_PATH } from "@/lib/chat/attachments"

// apiUrl explizit, sonst bricht das SDK ab, wenn .env.local und Prozess-Umgebung beide den Wert setzen.
// Erst beim ersten Gebrauch: ohne Schlüssel startet der Dienst trotzdem, nur Sandbox-Aufrufe schlagen dann mit dem SDK-Fehler fehl.
let daytonaClient: Daytona | undefined
function client() {
  return (daytonaClient ??= new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
  }))
}

// Nur für Tests gegen eine Datenbankkopie: ORBIT_FAKE_SANDBOX=1 legt keine Sandbox an und löscht keine (kein Daytona-Aufruf, keine Kosten).
const FAKE = process.env.ORBIT_FAKE_SANDBOX === "1"
const FAKE_PREFIX = "fake-"

export async function createSandbox(botId: string) {
  if (FAKE) return `${FAKE_PREFIX}${botId}`
  const sandbox = await client().create({ labels: { botId }, autoStopInterval: 15 })
  try {
    await sandbox.fs.uploadFile(Buffer.alloc(0), MEMORY_PATH)
  } catch (e) {
    // Leere Datei ist nur Komfort: der Orbi legt sie beim ersten Schreiben selbst an, Anlegen der Sandbox darf nicht scheitern.
    console.error("MEMORY.md konnte nicht angelegt werden", e)
  }
  return sandbox.id
}

export async function deleteSandbox(sandboxId: string) {
  if (FAKE || sandboxId.startsWith(FAKE_PREFIX)) return
  try {
    const sandbox = await client().get(sandboxId)
    await sandbox.delete()
  } catch (error) {
    if (
      error instanceof DaytonaNotFoundError ||
      (error as { statusCode?: number })?.statusCode === 404
    )
      return
    throw error
  }
}

// noVNC des Desktops als signierte URL (iframe ohne Header). Startet Sandbox und Desktop bei Bedarf.
export async function getDesktopUrl(sandboxId: string) {
  const sandbox = await client().get(sandboxId)
  if (sandbox.state !== "started") await sandbox.start()
  const { status } = await sandbox.computerUse.getStatus()
  if (status !== "active") await sandbox.computerUse.start()
  // shortcut: Link gilt 1 h; ein offenes iframe bleibt verbunden, erst ein Neuladen danach scheitert.
  const { url } = await sandbox.getSignedPreviewUrl(6080, 3600)
  return `${url}/vnc.html?autoconnect=true&resize=scale&reconnect=true`
}
