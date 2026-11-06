import { execFile, spawn } from "node:child_process"

// Tresor für Anbieter-Tokens im macOS-Schlüsselbund (E49, E07): Dienst `de.consti.orbit2`, nur schreiben, die Oberfläche zeigt „gesetzt ✓“.
// Geschrieben wird über `security -i` (der Wert steht nie in einer Befehlszeile). Eine Zeile fasst dort nur rund 4 KB, deshalb liegt
// ein Wert in Stücken von 2000 Zeichen (Base64-URL) unter `<konto>#0`, `<konto>#1` …; `<konto>` selbst hält die Anzahl.
export const VAULT_SERVICE = "de.consti.orbit2"
const CHUNK = 2000
const MAX_CHUNKS = 16
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,95}$/

export type VaultRunner = {
  // Eine oder mehrere Zeilen für `security -i` (Schreiben/Löschen).
  write(lines: string[]): Promise<void>
  // `find-generic-password -w` für ein Konto; null, wenn es keinen Eintrag gibt.
  read(account: string): Promise<string | null>
}

export const securityRunner: VaultRunner = {
  write: (lines) =>
    new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/security", ["-i"], { stdio: ["pipe", "ignore", "ignore"] })
      const timer = setTimeout(() => child.kill(), 10_000)
      child.on("error", (error) => { clearTimeout(timer); reject(error) })
      child.on("close", () => { clearTimeout(timer); resolve() })
      child.stdin.end(`${lines.join("\n")}\n`)
    }),
  read: (account) =>
    new Promise((resolve) =>
      execFile(
        "/usr/bin/security",
        ["find-generic-password", "-s", VAULT_SERVICE, "-a", account, "-w"],
        { timeout: 5_000, maxBuffer: 16_384 },
        (error, stdout) => resolve(error ? null : stdout.replace(/\r?\n$/, ""))
      )
    ),
}

const add = (account: string, value: string) =>
  `add-generic-password -U -s ${VAULT_SERVICE} -a ${account} -w ${value}`
const del = (account: string) =>
  `delete-generic-password -s ${VAULT_SERVICE} -a ${account}`

export class Vault {
  private readonly runner: VaultRunner
  constructor(runner: VaultRunner = securityRunner) {
    this.runner = runner
  }

  private check(account: string) {
    if (!ACCOUNT.test(account)) throw new Error("Ungültiger Schlüsselbund-Name.")
  }

  async has(account: string): Promise<boolean> {
    this.check(account)
    return (await this.runner.read(account)) !== null
  }

  async get(account: string): Promise<string | null> {
    this.check(account)
    const head = await this.runner.read(account)
    if (head === null) return null
    const count = Number(head)
    if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return null
    let encoded = ""
    for (let i = 0; i < count; i++) {
      const part = await this.runner.read(`${account}#${i}`)
      if (part === null) return null
      encoded += part
    }
    return Buffer.from(encoded, "base64url").toString("utf8")
  }

  async set(account: string, value: string): Promise<void> {
    this.check(account)
    const encoded = Buffer.from(value, "utf8").toString("base64url")
    const parts = encoded.match(new RegExp(`.{1,${CHUNK}}`, "g")) ?? [""]
    if (parts.length > MAX_CHUNKS) throw new Error("Wert zu groß für den Schlüsselbund.")
    const oldHead = Number(await this.runner.read(account))
    // Erst die Stücke, zuletzt der Zähler: ein Abbruch lässt den alten Wert gültig.
    const lines = parts.map((part, i) => add(`${account}#${i}`, part))
    lines.push(add(account, String(parts.length)))
    if (Number.isInteger(oldHead))
      for (let i = parts.length; i < oldHead; i++) lines.push(del(`${account}#${i}`))
    await this.runner.write(lines)
  }

  async remove(account: string): Promise<void> {
    this.check(account)
    const head = Number(await this.runner.read(account))
    const lines = [del(account)]
    if (Number.isInteger(head))
      for (let i = 0; i < Math.min(head, MAX_CHUNKS); i++) lines.push(del(`${account}#${i}`))
    await this.runner.write(lines)
  }
}

export const vault = new Vault()

// Speicher-Attrappe für Tests: kein Zugriff auf den echten Schlüsselbund.
export function memoryRunner(): VaultRunner & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    async read(account) { return entries.get(account) ?? null },
    async write(lines) {
      for (const line of lines) {
        const p = line.split(" ")
        if (p[0] === "add-generic-password") entries.set(p[5], p[7])
        else if (p[0] === "delete-generic-password") entries.delete(p[4])
      }
    },
  }
}
