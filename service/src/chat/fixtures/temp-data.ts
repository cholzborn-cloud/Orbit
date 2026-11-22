import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Als ERSTER Import einer Testdatei: setzt einen Temp-Datenordner, bevor ein Modul (z. B. lib/db.ts) die Datenbank öffnet.
// Ohne das öffnet und migriert ein Import die echte App-Datenbank.
process.env.ORBIT_DATA_DIR ??= mkdtempSync(join(tmpdir(), "orbitd-test-data-"))
