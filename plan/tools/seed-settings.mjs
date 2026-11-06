// Legt feste Beispieldaten für die Einstellungen in einer Datenkopie an (Skills, Konnektoren, Freigaben, Jev-Protokoll),
// damit Web und nativ dieselben Reiter zeigen. Aufruf: node seed-settings.mjs <Kopie-Ordner> [Port=4399]
// Nur gegen eine Kopie; der Dienst der Kopie muss laufen.
import fs from "fs"
import { execFileSync } from "child_process"
const [dir, port = "4399"] = process.argv.slice(2)
const token = fs.readFileSync(`${dir}/service.token`, "utf8").trim()
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(`${method} ${path}: ${j.error ?? r.status}`)
  return j
}
const skills = [
  ["wochenplan", "Plant aus Aufgaben einen Wochenplan mit festen Zeiten."],
  ["kurze-zusammenfassung", "Fasst einen Text knapp und verständlich zusammen."],
  ["mail-entwurf", "Formt Stichpunkte zu einem E-Mail-Entwurf."],
]
for (const [name, description] of skills)
  await call("POST", "/v1/skills", { name, description, body: "## Wann nutzen\nBei passender Aufgabe.\n\n## Ablauf\n1. Prüfen\n2. Antworten" })
await call("POST", "/v1/connectors", { name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp" })
await call("POST", "/v1/connectors", { name: "Beispiel-Server", url: "https://example.com/mcp", token: "geheim" })
const bots = await call("GET", "/v1/bots")
const bot = (bots.bots ?? [])[0]
await call("POST", "/v1/settings/rules", { tool: "web_search", mode: "allow" })
if (bot) await call("POST", "/v1/settings/rules", { tool: "connector:deepwiki:read_wiki_structure", botId: bot.id, mode: "allow" })
const now = Date.now()
const rows = [
  ["route", "claude-haiku-5-5", "Kurze Frage, kleine Stufe reicht.", 412, 5],
  ["route", "gpt-6.1", "Datenbank-Migration, große Stufe.", 530, 40],
  ["memory", null, "Nutzer erwähnt neuen Wohnort.", 880, 180],
  ["suggest", "claude-sonnet-5-5", "Übergabe an einen Programmier-Orbi vorgeschlagen.", 1210, 1500],
]
for (const [i, [kind, model, reason, ms, minutes]] of rows.entries())
  execFileSync("sqlite3", [`${dir}/orbit.sqlite`, `insert into jev_log (id,user_id,kind,model,reason,duration_ms,created_at) values ('seed${i}','local','${kind}',${model ? `'${model}'` : "null"},'${reason}',${ms},${now - minutes * 60000})`])
console.log("Beispieldaten angelegt")
