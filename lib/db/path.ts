import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function databasePath() {
  return join(
    process.env.ORBIT_DATA_DIR
      ? resolve(process.env.ORBIT_DATA_DIR)
      : join(homedir(), "Library", "Application Support", "Orbit"),
    "orbit.sqlite"
  )
}
