import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// Temp-Datenordner vor allem anderen (kein Zugriff auf echte Daten); kein echter Modellaufruf in diesem Test.
const data = mkdtempSync(join(tmpdir(), "orbit-web-test-"))
process.env.ORBIT_DATA_DIR = data
process.env.ORBIT_CLAUDE_BIN = process.execPath

const { webSearch, webDeps, SEARCH_MODEL } = await import("./web.ts")
const { buildSearchSpawn, createSearchParser, linksFromToolResult } = await import("../cli/search.ts")
const { CliError } = await import("../cli/types.ts")

const lines = readFileSync(new URL("./fixtures/claude-search.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean)
const original = { ...webDeps }
const withRunner = (t: test.TestContext, runner: typeof webDeps.runner, timeoutMs = original.timeoutMs) => {
  webDeps.runner = runner
  webDeps.timeoutMs = timeoutMs
  t.after(() => Object.assign(webDeps, original))
}
const feed = (items: string[]): typeof webDeps.runner =>
  async function* () {
    yield* items
  }
const failing = (error: Error): typeof webDeps.runner =>
  // eslint-disable-next-line require-yield
  async function* () {
    throw error
  }

test("Aufruf erlaubt nur WebSearch und sperrt alles andere", () => {
  const spawn = buildSearchSpawn("Frage", SEARCH_MODEL)
  const { args } = spawn
  const after = (flag: string) => args[args.indexOf(flag) + 1]
  assert.equal(after("--tools"), "WebSearch")
  assert.equal(after("--allowedTools"), "WebSearch")
  assert.equal(after("--model"), "claude-haiku-5-5")
  assert.equal(after("--setting-sources"), "")
  assert.equal(after("--mcp-config"), '{"mcpServers":{}}')
  for (const flag of ["--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) assert.ok(args.includes(flag), flag)
  assert.ok(!args.some((arg) => /Bash|WebFetch|Edit|Write|Read/.test(arg)))
  assert.ok(spawn.cwd.startsWith(data) && spawn.cwd.endsWith("claude"))
  assert.ok(!("ANTHROPIC_API_KEY" in spawn.env) && !("CLI_PROXY_API_KEY" in spawn.env))
  assert.match(JSON.parse(spawn.stdin).message.content[0].text, /^Frage$/)
  assert.match(args[args.indexOf("--system-prompt") + 1]!, /untrusted data/)
})

test("Parser liest Antwort ohne Quellenblock, dedupliziert und lässt nur sichere Quellen zu", () => {
  const parser = createSearchParser()
  for (const line of lines) parser.push(line)
  const outcome = parser.finish()
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.match(outcome.answer, /Spanien/)
  assert.doesNotMatch(outcome.answer, /Sources:|Quellen:/)
  const urls = outcome.sources.map((source) => source.url)
  assert.equal(new Set(urls).size, urls.length)
  assert.ok(urls.length >= 3 && urls.length <= 8)
  assert.ok(urls.every((url) => /^https:\/\//.test(url)))
  assert.ok(outcome.sources.every((source) => source.title && source.title.length <= 200))
  assert.equal(outcome.usage?.output, 434)
  assert.equal(outcome.usage?.input, 2078 + 4098)
})

test("Zitierte Links stehen vorn, Treffer aus dem Werkzeug dahinter", () => {
  const parser = createSearchParser()
  parser.push(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: 'Links: [{"title":"A","url":"https://a.example/"},{"title":"B","url":"https://b.example/"}]' }] } }))
  parser.push(JSON.stringify({ type: "result", is_error: false, result: "Text [B-Titel](https://b.example/) fertig." }))
  const outcome = parser.finish()
  assert.equal(outcome.ok && outcome.sources.map((source) => source.title).join(","), "B,A")
  assert.deepEqual(linksFromToolResult([{ type: "text", text: 'Links: [{"url":"javascript:alert(1)"},{"url":"https://c.example/x"}]' }]), [{ title: "c.example", url: "https://c.example/x" }])
  assert.deepEqual(linksFromToolResult("kein Treffer"), [])
})

test("Websuche liefert Antwort und Quellen in der bisherigen Form", async (t) => {
  withRunner(t, feed(lines))
  const result = await webSearch({ query: "Euro 2024 Gewinner" })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.match(result.answer, /Spanien/)
    assert.ok(result.sources.length > 0 && result.sources.every((source) => typeof source.title === "string" && /^https:/.test(source.url)))
  }
})

test("Fehler sind klare deutsche Sätze (fehlt, nicht angemeldet, Limit, Zeit, Abbruch, leer)", async (t) => {
  withRunner(t, failing(new CliError("claude", "failed", "Die CLI wurde mit Fehler beendet (Code 1).")))
  const failed = await webSearch({ query: "test" })
  assert.equal(failed.ok, false)
  if (!failed.ok) assert.match(failed.error, /Websuche ist fehlgeschlagen.*Code 1/)

  withRunner(t, failing(new CliError("claude", "timeout", "Zeitüberschreitung")))
  const slow = await webSearch({ query: "test" })
  if (!slow.ok) assert.match(slow.error, /zu lange gedauert/)

  for (const [text, expected] of [["Not logged in · Please run /login", /braucht Claude.*claude auth login/], ["429 rate limit exceeded", /ausgelastet/]] as const) {
    withRunner(t, feed([JSON.stringify({ type: "result", is_error: true, result: text })]))
    const result = await webSearch({ query: "test" })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, expected)
  }

  withRunner(t, feed([JSON.stringify({ type: "result", is_error: false, result: "" })]))
  const empty = await webSearch({ query: "test" })
  if (!empty.ok) assert.match(empty.error, /keine Antwort/)
  withRunner(t, feed([]))
  const nothing = await webSearch({ query: "test" })
  if (!nothing.ok) assert.match(nothing.error, /keine Antwort/)

  const controller = new AbortController()
  controller.abort()
  withRunner(t, failing(new CliError("claude", "aborted", "Abgebrochen.")))
  const aborted = await webSearch({ query: "test", signal: controller.signal })
  if (!aborted.ok) assert.match(aborted.error, /abgebrochen/)
})

test("Fehlende CLI meldet Abhilfe, ungültige Anfrage wird vorher abgewiesen", async (t) => {
  const previous = process.env.ORBIT_CLAUDE_BIN
  process.env.ORBIT_CLAUDE_BIN = join(data, "gibt-es-nicht")
  t.after(() => {
    process.env.ORBIT_CLAUDE_BIN = previous
  })
  withRunner(t, feed(lines))
  const missing = await webSearch({ query: "test" })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.match(missing.error, /Websuche braucht Claude.*Installiere die Claude-CLI/)
  assert.equal((await webSearch({ query: " " })).ok, false)
  assert.equal((await webSearch({ query: "x".repeat(501) })).ok, false)
})
