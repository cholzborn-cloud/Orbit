// Legt feste Beispieldaten für „Geplant“ und die Suche in einer Datenkopie an (zweiter Orbi, vier Automationen mit Läufen,
// Papierkorb, durchsuchbare Nachrichten), damit Web und nativ dasselbe zeigen. Aufruf: node seed-4e.mjs <Kopie-Ordner> [Port=4399]
// Nur gegen eine Kopie; der Dienst der Kopie muss laufen (ORBIT_FAKE_SANDBOX=1).
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
const sql = (q) => execFileSync("sqlite3", [`${dir}/orbit.sqlite`, q]).toString().trim()
let bots = await call("GET", "/v1/bots")
const main = bots.main
if (!bots.bots.some((b) => b.name === "Karti")) await call("POST", "/v1/bots", { name: "Karti", job: "Recherche", avatar: "erdi", color: null, instructions: "", isMain: false })
bots = await call("GET", "/v1/bots")
const karti = bots.bots.find((b) => b.name === "Karti")
const base = { target: "same", notify: "app", model: "claude-haiku-5-5", effort: "low", context: true, timezone: "Europe/Berlin" }
const make = async (botId, name, prompt, schedule, extra = {}) => (await call("POST", "/v1/automations", { ...base, botId, name, prompt, schedule, ...extra })).id
const a1 = await make(main.id, "Morgenbriefing", "Fasse die wichtigsten Termine und Aufgaben des Tages kurz zusammen.", { kind: "weekdays", at: "07:30" })
const a2 = await make(karti.id, "Wochenbericht", "Schreibe einen kurzen Bericht über die Fortschritte der Woche.", { kind: "weekly", at: "17:00", weekday: 5 })
const a3 = await make(main.id, "Einmaliger Termin mit sehr langem Namen für die Kartenzeile", "Erinnere mich an die Abgabe.", { kind: "once", at: "09:00", date: "2030-01-15" })
const a4 = await make(karti.id, "Alte Idee", "Prüfe die Idee.", { kind: "monthly", at: "08:00", day: 1 })
await call("PUT", `/v1/automations/${a2}/enabled`, { enabled: false })
await call("PUT", `/v1/automations/${a3}/enabled`, { enabled: false })
await call("POST", `/v1/automations/${a4}/trash`)
const now = Date.now()
const runs = [
  [a1, "ok", null, 26, 3], [a1, "error", "Lauf abgebrochen", 50, 2], [a1, "ok", null, 74, 5],
  [a2, "ok", null, 96, 11],
]
runs.forEach(([a, status, error, hoursAgo, seconds], i) =>
  sql(`insert into automation_runs (id,automation_id,user_id,status,trigger,error,started_at,finished_at) values ('seed-run-${i}','${a}','local','${status}','schedule',${error ? `'${error}'` : "null"},${now - hoursAgo * 3600000},${now - hoursAgo * 3600000 + seconds * 1000})`))
sql(`update automations set last_run_at=${now - 26 * 3600000} where id='${a1}'`)
// Durchsuchbare Nachrichten im Chat des Hauptorbis.
const chatId = main.chatId
const msgs = [["user", "Wie backe ich einen Quarkkuchen mit Zitrone?"], ["assistant", "Für den Quarkkuchen brauchst du 500 g Quark, 3 Eier, Zitronenschale und 150 g Zucker. Bei 180 Grad etwa 50 Minuten backen."], ["user", "Danke, und wie lange hält sich der Quarkkuchen?"]]
msgs.forEach(([role, text], i) => {
  const id = `seed-msg-${i}`
  const pos = Number(sql(`select coalesce(max(position),-1)+1 from chat_messages where chat_id='${chatId}'`))
  sql(`insert into chat_messages (chat_id,id,role,parts,position) values ('${chatId}','${id}','${role}','${JSON.stringify([{ type: "text", text }]).replace(/'/g, "''")}',${pos})`)
  sql(`insert into chat_messages_index (id,user_id,chat_id,role,body,created_at) values ('${chatId}:${id}','local','${chatId}','${role}','${text}',${now - (3 - i) * 60000})`)
})
console.log("Beispieldaten angelegt:", { a1, a2, a3, a4 })
