import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Papierkorb-Shim für die lokale Shell: ein Skript, verlinkt als rm, rmdir, unlink, srm, shred. Steht vorn im PATH der Shell,
// damit `rm`, `command rm`, `xargs rm`, `find -exec rm` und Skripte, die `rm` über den PATH starten, im Papierkorb landen.
// Was der Shim nicht sieht (`/bin/rm`, `find -delete`, unlink aus python/node), stoppt die Risikoprüfung (lib/mac/risk.ts).
export const SHIM_SCRIPT = String.raw`#!/bin/sh
# Orbit-Papierkorb-Shim: rm, rmdir und unlink verschieben nach ~/.Trash statt endgültig zu löschen (Consti, 06.11.2026).
cmd=$(basename "$0")
case "$cmd" in
  srm|shred) echo "$cmd: endgültiges Löschen ist in Orbit gesperrt (nur Papierkorb)." >&2; exit 1;;
esac
trash="$HOME/.Trash"
/bin/mkdir -p "$trash" || exit 1
log="${"$"}{ORBIT_TRASH_LOG:-}"
force=0; recursive=0; end=0; status=0
for a in "$@"; do
  if [ $end = 0 ] && [ "$cmd" != unlink ]; then
    case "$a" in
      --) end=1; continue;;
      --force) force=1; continue;;
      --recursive) recursive=1; continue;;
      --*) continue;;
      -?*) case "$a" in *f*) force=1;; esac; case "$a" in *[rR]*) recursive=1;; esac; continue;;
    esac
  fi
  if [ ! -e "$a" ] && [ ! -L "$a" ]; then
    [ $force = 1 ] || { echo "$cmd: $a: No such file or directory" >&2; status=1; }
    continue
  fi
  dir=$(cd "$(/usr/bin/dirname "$a")" 2>/dev/null && pwd -P) || { status=1; continue; }
  name=$(/usr/bin/basename "$a")
  abs="$dir/$name"
  case "$name" in .|..) echo "$cmd: $a: verweigert" >&2; status=1; continue;; esac
  case "$abs" in
    /|"$HOME"|"$trash"|"$trash"/*) echo "$cmd: $a: endgültiges Löschen ist in Orbit gesperrt (nur Papierkorb)." >&2; status=1; continue;;
  esac
  if [ -d "$a" ] && [ ! -L "$a" ]; then
    if [ "$cmd" = rm ] && [ $recursive = 0 ]; then echo "rm: $a: is a directory" >&2; status=1; continue; fi
    if [ "$cmd" = rmdir ] && [ -n "$(/bin/ls -A "$a")" ]; then echo "rmdir: $a: Directory not empty" >&2; status=1; continue; fi
    if [ "$cmd" = unlink ]; then echo "unlink: $a: is a directory" >&2; status=1; continue; fi
  fi
  dest="$trash/$name"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    stamp=$(/bin/date +%H.%M.%S); n=0; dest="$trash/$name $stamp"
    while [ -e "$dest" ] || [ -L "$dest" ]; do n=$((n+1)); dest="$trash/$name $stamp $n"; done
  fi
  if /bin/mv "$a" "$dest"; then
    [ -n "$log" ] && printf '%s\t%s\n' "$abs" "$dest" >> "$log"
  else
    status=1
  fi
done
exit $status
`

export const SHIM_NAMES = ["rm", "rmdir", "unlink", "srm", "shred"] as const

// Legt den Shim-Ordner an (idempotent) und gibt ihn zurück.
export function ensureShim(dir: string) {
  mkdirSync(dir, { recursive: true })
  for (const name of SHIM_NAMES) {
    const path = join(dir, name)
    if (!existsSync(path) || readFileSync(path, "utf8") !== SHIM_SCRIPT) writeFileSync(path, SHIM_SCRIPT)
    chmodSync(path, 0o755)
  }
  return dir
}
