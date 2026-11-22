import { existsSync, lstatSync, mkdirSync, renameSync, cpSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, extname, join, resolve } from "node:path"

// Löschen am Mac läuft immer über den Papierkorb (Consti, 06.11.2026): Dateien werden nach ~/.Trash verschoben, nie entfernt.
// Ein Eintrag merkt sich Herkunft und Ziel; damit kann die Rückgängig-Zeile die Datei zurücklegen.
export type TrashMove = { from: string; to: string }

export const trashDir = (home = homedir()) => join(home, ".Trash")

// Freier Name im Papierkorb wie im Finder: „Name 14.35.12.ext“, notfalls mit Zähler.
function freeName(dir: string, name: string, now: Date) {
  if (!existsSync(join(dir, name))) return join(dir, name)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  const time = now.toTimeString().slice(0, 8).replaceAll(":", ".")
  for (let n = 0; ; n++) {
    const candidate = join(dir, `${stem} ${time}${n ? ` ${n}` : ""}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
}

// Verschiebt über Laufwerksgrenzen hinweg (rename geht dort nicht): kopieren, dann das Original selbst in den Papierkorb
// des Ziels verschieben ist hier nicht möglich, also erst nach erfolgreicher Kopie die Quelle entfernen – nur hier, nur nach Kopie.
function move(from: string, to: string) {
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
    cpSync(from, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    rmSync(from, { recursive: true, force: true })
  }
}

export function moveToTrash(path: string, options: { home?: string; now?: Date } = {}): TrashMove {
  const from = resolve(path)
  lstatSync(from) // wirft ENOENT, wenn es die Datei nicht gibt
  const dir = trashDir(options.home)
  if (from === dir || from.startsWith(`${dir}/`)) throw new Error("Liegt schon im Papierkorb; endgültiges Löschen ist gesperrt.")
  mkdirSync(dir, { recursive: true })
  const to = freeName(dir, basename(from), options.now ?? new Date())
  move(from, to)
  return { from, to }
}

// Zurücklegen (Rückgängig): nur wenn am alten Ort nichts Neues liegt; Elternordner wird bei Bedarf angelegt.
export function restoreFromTrash(entry: TrashMove) {
  if (!existsSync(entry.to)) throw new Error(`Nicht mehr im Papierkorb: ${basename(entry.to)}`)
  if (existsSync(entry.from)) throw new Error(`Am alten Ort liegt schon etwas: ${entry.from}`)
  mkdirSync(dirname(entry.from), { recursive: true })
  move(entry.to, entry.from)
}

// Verschieben/Umbenennen (Dateiwerkzeug), ohne etwas zu überschreiben.
export function moveFile(from: string, to: string): TrashMove {
  const a = resolve(from)
  const b = resolve(to)
  lstatSync(a)
  if (existsSync(b)) throw new Error(`Ziel existiert schon: ${b}`)
  mkdirSync(dirname(b), { recursive: true })
  move(a, b)
  return { from: a, to: b }
}
