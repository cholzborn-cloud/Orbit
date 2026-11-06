import assert from "node:assert/strict"
import { test } from "node:test"
import { verifyICloud, iCloudTools } from "./icloud-calendar.ts"
import { ICloudCalendarClient } from "@/lib/icloud-calendar/client"

test("iCloud verification rejects malformed credentials without calling provider", async () => {
  let called = false
  const result = await verifyICloud({appleId:"test@example.invalid", appPassword:"not-a-valid-password"}, value => { called = true; return new ICloudCalendarClient(value) })
  assert.equal(result.ok, false)
  assert.equal(called, false)
})

test("iCloud verification sanitizes provider errors and returns only calendar count", async () => {
  const input = {appleId:"test@example.invalid", appPassword:"aaaa-bbbb-cccc-dddd"}
  class Fake extends ICloudCalendarClient { async discover() { return [{name:"Private",url:"https://p42-caldav.icloud.com/private/"}] } }
  const good = await verifyICloud(input, value => new Fake(value))
  assert.deepEqual(good, {ok:true,count:1})
  class Broken extends ICloudCalendarClient { async discover(): Promise<never> { throw Error(input.appPassword) } }
  const bad = await verifyICloud(input, value => new Broken(value))
  assert.equal(bad.ok, false)
  assert.equal(JSON.stringify(bad).includes(input.appPassword), false)
})

test("calendar tool schemas never accept Apple credentials", () => {
  const names = Object.keys(iCloudTools(async () => null))
  assert.deepEqual(names.sort(), ["apple_calendar_create", "apple_calendar_delete", "apple_calendar_invite", "apple_calendar_list", "apple_calendar_update"])
})

test("calendar action uses discovered calendar and never returns credentials", async () => {
  const input = { appleId:"test@example.invalid", appPassword:"aaaa-bbbb-cccc-dddd" }
  let written = false
  class Fake extends ICloudCalendarClient {
    async discover() { return [{name:"Arbeit",url:"https://p42-caldav.icloud.com/work/"}] }
    async createEvent(url: string) { written = url.endsWith("/work/"); return {url,etag:null} }
  }
  const tools = iCloudTools(async () => input, value => new Fake(value))
  const action = tools.apple_calendar_create
  assert.ok(action.execute)
  const result = await action.execute({calendar:"Arbeit", title:"Test", start:"2026-11-02T10:00:00+01:00", end:"2026-11-02T11:00:00+01:00"}, {toolCallId:"test",messages:[],abortSignal:new AbortController().signal})
  assert.equal(written, true)
  assert.equal(JSON.stringify(result).includes(input.appPassword), false)
})

test("Kalenderseiten bleiben vollständig und beziehen sich auf denselben Momentstand", async () => {
  const input = { appleId: "test@example.invalid", appPassword: "aaaa-bbbb-cccc-dddd" }
  let queries = 0
  const entries = Array.from({ length: 100 }, (_, i) => ({ url: `https://p42-caldav.icloud.com/work/${i}.ics`, etag: `"${i}"`, iCalendar: `BEGIN:VEVENT\r\nSUMMARY:${i} 🌍 ${'"\\'.repeat(40)}\r\nEND:VEVENT` }))
  class Fake extends ICloudCalendarClient {
    async discover() { return [{ name: "Arbeit", url: "https://p42-caldav.icloud.com/work/" }, { name: "Leer", url: "https://p42-caldav.icloud.com/empty/" }] }
    async query(url: string) { queries++; return url.includes("/work/") ? entries.slice() : [] }
  }
  const list = iCloudTools(async () => input, value => new Fake(value)).apple_calendar_list!
  const args = { start: "2026-11-02T10:00:00+01:00", end: "2026-11-03T10:00:00+01:00" }
  const opts = { toolCallId: "test", messages: [], abortSignal: new AbortController().signal }
  const read = async (cursor?: string) => {
    const output = await list.execute!({ ...args, ...(cursor && { cursor }) }, opts) as { content: { text: string }[] }
    const framed = output.content[0]!.text
    assert.ok(Buffer.byteLength(framed) < 20_000)
    assert.ok(JSON.stringify(output).length < 7000)
    assert.ok(!framed.includes("[truncated]"))
    return JSON.parse(framed.slice(framed.indexOf("\n") + 1, framed.lastIndexOf("\n"))) as { entries: { calendar: string; event: { url: string } | null }[]; nextCursor: string | null; complete: boolean }
  }
  let page = await read()
  assert.equal(page.complete, false)
  const firstCursor = page.nextCursor!
  const wrongRange = await list.execute!({ ...args, end: "2026-11-04T10:00:00+01:00", cursor: firstCursor }, opts) as { error: string }
  assert.match(wrongRange.error, /anderen Zeitraum/)
  assert.deepEqual(await read(firstCursor), await read(firstCursor))
  entries.length = 0
  const seen = [...page.entries]
  while (page.nextCursor) { page = await read(page.nextCursor); seen.push(...page.entries) }
  assert.equal(page.complete, true)
  assert.equal(queries, 2)
  assert.equal(seen.filter(e => e.calendar === "Arbeit").length, 100)
  assert.equal(new Set(seen.flatMap(e => e.event ? [e.event.url] : [])).size, 100)
  assert.ok(seen.some(e => e.calendar === "Leer" && e.event === null))
  const bad = await list.execute!({ ...args, cursor: "00000000-0000-4000-8000-000000000000" }, opts) as { error: string }
  assert.match(bad.error, /abgelaufen/)
})

test("Ein zu großer Kalendertermin wird nicht still abgeschnitten", async () => {
  const input = { appleId: "test@example.invalid", appPassword: "aaaa-bbbb-cccc-dddd" }
  class Fake extends ICloudCalendarClient {
    async discover() { return [{ name: "Arbeit", url: "https://p42-caldav.icloud.com/work/" }] }
    async query() { return [{ url: "https://p42-caldav.icloud.com/work/1.ics", etag: '"1"', iCalendar: "界".repeat(20_000) }] }
  }
  const list = iCloudTools(async () => input, value => new Fake(value)).apple_calendar_list!
  const result = await list.execute!({ start: "2026-11-02T10:00:00+01:00", end: "2026-11-03T10:00:00+01:00" }, { toolCallId: "test", messages: [], abortSignal: new AbortController().signal }) as { error: string }
  assert.match(result.error, /zu groß.*unvollständig/)
})


test("Kalender: Löschen und Einladen brauchen Freigabe, Lesen, Anlegen und Ändern nicht", async () => {
  const { protectTools } = await import("./chat/approvals.ts")
  const { InteractionManager } = await import("./interactions.ts")
  const input = { appleId: "test@example.invalid", appPassword: "aaaa-bbbb-cccc-dddd" }
  let writes = 0, reads = 0, cards = 0
  class Fake extends ICloudCalendarClient {
    async discover() { return [{ name: "Arbeit", url: "https://p42-caldav.icloud.com/work/" }] }
    async query() { reads++; return [] }
    async createEvent(url: string) { writes++; return { url, etag: null } }
    async updateEvent() { writes++ }
    async deleteEvent() { writes++ }
    async inviteEvent() { writes++ }
  }
  const store = { create: async () => Date.now(), get: async () => Date.now() }
  const manager = new InteractionManager({ store, saveRule: async () => {} })
  const protectedTools = protectTools(iCloudTools(async () => input, value => new Fake(value)), {
    chatId: "c", ctx: { speaker: { id: "b" } } as never, rules: [], manager, store, signal: new AbortController().signal,
    onApproval: async request => { cards++; await manager.decide(request.id, { approved: false }) }, onDecision: () => {},
  })
  const run = async (name: string, args: unknown) => {
    const value = await protectedTools[name]!.execute!(args as never, { toolCallId: `${name}-${cards}`, messages: [], abortSignal: new AbortController().signal })
    if (value && typeof value === "object" && Symbol.asyncIterator in value) for await (const _ of value as AsyncIterable<unknown>) { /* Ergebnis abwarten */ }
  }
  const base = { calendar: "Arbeit", url: "https://p42-caldav.icloud.com/work/test.ics", etag: '"e"', eventTitle: "Test", eventStart: "DTSTART:20261102T120000Z", attendees: [], series: false }
  const dates = { start: "2026-11-02T10:00:00+01:00", end: "2026-11-02T11:00:00+01:00" }
  await run("apple_calendar_list", dates)
  await run("apple_calendar_create", { calendar: "Arbeit", title: "Test", ...dates })
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(cards, 0)
  await run("apple_calendar_update", { ...base, title: "Neu", ...dates })
  assert.equal(cards, 0); assert.equal(writes, 2)
  await run("apple_calendar_delete", base)
  await run("apple_calendar_invite", { ...base, recipient: "person@example.invalid" })
  assert.equal(cards, 2); assert.equal(writes, 2)
})
