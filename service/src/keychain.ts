import { execFile } from "node:child_process"

// Schlüssel im macOS-Schlüsselbund (Phase 5). Dienst `de.consti.orbit2`, Konto = Name der Umgebungsvariablen. Die Mac-App schreibt sie
// (SecItem), orbitd liest sie beim Start und nach „Setzen“ über /v1/keys/reload. `secrets.env` bleibt der Rückfall.
// Gelesen wird über `security find-generic-password -w`: der Wert steht nie in einer Befehlszeile, nur auf der Standardausgabe.
export const KEYCHAIN_SERVICE = "de.consti.orbit2"

export type KeyInfo = {
  name: string
  label: string
  // Gilt der neue Wert sofort?
  liveReload: boolean
}
export const MANAGED_KEYS: KeyInfo[] = [
  { name: "DAYTONA_API_KEY", label: "Daytona", liveReload: true },
  { name: "OPENROUTER_JEV_API_KEY", label: "Jev", liveReload: true },
]

export type SecurityRunner = (args: string[]) => Promise<{ stdout: string }>
const defaultRunner: SecurityRunner = (args) =>
  new Promise((resolve, reject) =>
    execFile("/usr/bin/security", args, { timeout: 5_000, maxBuffer: 16_384 }, (error, stdout) =>
      error ? reject(error) : resolve({ stdout })
    )
  )

// Woher ein Schlüssel kommt, ohne den Wert zu nennen.
const sources = new Map<string, "schluesselbund">()

export async function readKeychainKey(name: string, run: SecurityRunner = defaultRunner, service = KEYCHAIN_SERVICE) {
  try {
    const { stdout } = await run(["find-generic-password", "-s", service, "-a", name, "-w"])
    const value = stdout.replace(/\r?\n$/, "")
    return value.length > 0 && value.length <= 4096 ? value : null
  } catch {
    return null
  }
}

// Setzt die Umgebung aus dem Schlüsselbund. Ohne `override` gewinnt eine schon gesetzte Variable; mit `override` gewinnt der Schlüsselbund
// (nach „Schlüssel setzen“). Gibt nur die Namen zurück, nie Werte.
export async function loadKeychainSecrets({
  names = MANAGED_KEYS.map((key) => key.name),
  env = process.env,
  run = defaultRunner,
  service = KEYCHAIN_SERVICE,
  override = false,
  platform = process.platform,
}: {
  names?: string[]
  env?: NodeJS.ProcessEnv
  run?: SecurityRunner
  service?: string
  override?: boolean
  platform?: string
} = {}): Promise<{ loaded: string[] }> {
  if (platform !== "darwin") return { loaded: [] }
  const loaded: string[] = []
  for (const name of names) {
    if (!override && env[name]) continue
    const value = await readKeychainKey(name, run, service)
    if (!value) continue
    env[name] = value
    sources.set(name, "schluesselbund")
    loaded.push(name)
  }
  return { loaded }
}

export function keyStatus(env: NodeJS.ProcessEnv = process.env) {
  return MANAGED_KEYS.map((key) => ({
    name: key.name,
    label: key.label,
    set: !!env[key.name]?.trim(),
    source: env[key.name]?.trim() ? (sources.get(key.name) ?? "datei") : null,
    liveReload: key.liveReload,
  }))
}
