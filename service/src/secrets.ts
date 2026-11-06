import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const defaultDataDir = () =>
  process.env.ORBIT_DATA_DIR ??
  join(homedir(), "Library", "Application Support", "Orbit")

// Schlüssel des installierten Dienstes: `secrets.env` im Datenordner (Zeilen SCHLÜSSEL=Wert, Rechte 0600). Schon gesetzte Umgebungsvariablen
// gewinnen. Werte werden nie ausgegeben, nur die Anzahl und Hinweise; eine Datei mit offenen Rechten wird nicht gelesen.
export function loadSecrets(
  dir = defaultDataDir(),
  env: NodeJS.ProcessEnv = process.env
): { loaded: number; warning?: string } {
  const path = join(dir, "secrets.env")
  let stat
  try {
    stat = statSync(path)
  } catch {
    return { loaded: 0 }
  }
  if (
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    return {
      loaded: 0,
      warning: `${path} hat offene Rechte oder gehört jemand anderem: nicht gelesen (chmod 600).`,
    }
  let loaded = 0
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(
      line
    )
    if (!match) continue
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2")
    if (value === "" || env[match[1]] !== undefined) continue
    env[match[1]] = value
    loaded += 1
  }
  return { loaded }
}
