import assert from "node:assert/strict";
import { test } from "node:test";
import { ICloudCalendarClient, type CalendarTransport } from "./client.ts";
import { parseXml } from "./xml.ts";

const account = { appleId: "fixture@example.invalid", appPassword: "aaaa-bbbb-cccc-dddd" };
const origin = "https://p42-caldav.icloud.com";
const calendar = `${origin}/123/calendars/work/`;
const multi = (content: string) => `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${content}</D:multistatus>`;
const row = (href: string, properties: string, status = "200 OK") => `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${properties}</D:prop><D:status>HTTP/1.1 ${status}</D:status></D:propstat></D:response>`;
const response = (xml: string) => new Response(xml, { status: 207 });
const discovery = [
  new Response(null, { status: 301, headers: { Location: origin + "/" } }),
  response(multi(row("/", "<D:current-user-principal><D:href>/123/principal/</D:href></D:current-user-principal>"))),
  response(multi(row("/123/principal/", "<C:calendar-home-set><D:href>/123/calendars/</D:href></C:calendar-home-set>"))),
  response(multi(row("/123/calendars/work/", "<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Arbeit &amp; Schule</D:displayname>"))),
];
function fixture(extra: Response[] = []) {
  const requests: { url: string; init: RequestInit }[] = [];
  // Responses cannot be reused after their streams are consumed.
  const queue = [...discovery.map(item => item.clone()), ...extra];
  const transport: CalendarTransport = async (url, init) => {
    requests.push({ url, init });
    const result = queue.shift(); assert.ok(result, "No unexpected requests"); return result;
  };
  return { client: new ICloudCalendarClient(account, transport), requests };
}

test("RFC discovery follows validated redirect, principal and home-set; query returns raw recurrence data", async () => {
  const ics = "BEGIN:VCALENDAR\r\nSUMMARY:A & B\r\nEND:VCALENDAR";
  const { client, requests } = fixture([response(multi(row(calendar + "event.ics", `<D:getetag>&quot;abc&quot;</D:getetag><C:calendar-data><![CDATA[${ics}]]></C:calendar-data>`)))]);
  assert.deepEqual(await client.discover(), [{ url: calendar, name: "Arbeit & Schule" }]);
  assert.deepEqual(await client.query(calendar, new Date("2026-11-01Z"), new Date("2026-11-03Z")), [{ url: calendar + "event.ics", etag: '"abc"', iCalendar: ics }]);
  assert.equal(requests[0].url, "https://caldav.icloud.com/.well-known/caldav");
  assert.equal(requests[2].url, origin + "/123/principal/");
  assert.equal(requests[3].init.method, "PROPFIND");
  for (const request of requests) { assert.equal(request.init.redirect, "manual"); assert.ok(request.init.signal); }
});

test("untrusted redirect targets never receive a request or authorization", async () => {
  const targets = ["http://caldav.icloud.com/", "https://evil.invalid/", "https://caldav.icloud.com.evil.invalid/", "https://icloud.com/", "https://foo.icloud.com/", "https://p42-caldav.icloud.com:444/", "https://user:pass@caldav.icloud.com/", "https://127.0.0.1/", "https://caldav.icloud.com/?token=x", "https://caldav.icloud.com/#x"];
  for (const target of targets) {
    let calls = 0;
    const client = new ICloudCalendarClient(account, async () => { calls++; return new Response(null, { status: 302, headers: { Location: target } }); });
    await assert.rejects(client.discover()); assert.equal(calls, 1, target);
  }
});

test("redirect loops are bounded and automatic redirects are rejected", async () => {
  let calls = 0;
  const loop = new ICloudCalendarClient(account, async () => { calls++; return new Response(null, { status: 307, headers: { Location: "/again" } }); });
  await assert.rejects(loop.discover()); assert.equal(calls, 4);
  const followed = new Response("sensitive"); Object.defineProperty(followed, "redirected", { value: true });
  await assert.rejects(new ICloudCalendarClient(account, async () => followed).discover());
});

test("discovery hrefs also enforce the Apple host boundary", async () => {
  let calls = 0;
  const client = new ICloudCalendarClient(account, async () => { calls++; return response(multi(row("/", "<D:current-user-principal><D:href>https://evil.invalid/</D:href></D:current-user-principal>"))); });
  await assert.rejects(client.discover()); assert.equal(calls, 1);
});

test("failed property status cannot establish discovery", async () => {
  const client = new ICloudCalendarClient(account, async () => response(multi(row("/", "<D:current-user-principal><D:href>/principal/</D:href></D:current-user-principal>", "404 Not Found"))));
  await assert.rejects(client.discover(), /nicht erkannt/);
});

test("credentials and transport exceptions are not serialized or reflected", async () => {
  const client = new ICloudCalendarClient(account, async () => { throw new Error(`Kalender ${account.appPassword}`); });
  assert.equal(JSON.stringify(client), "{}");
  await assert.rejects(client.discover(), error => error instanceof Error && !error.message.includes(account.appPassword) && !error.message.includes(account.appleId));
  assert.throws(() => new ICloudCalendarClient({ ...account, appPassword: "normal-password" }));
});

test("oversized streaming responses cancel the body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(new ICloudCalendarClient(account, async () => new Response(stream, { status: 207 })).discover());
  assert.ok(cancelled);
});

test("XML reader handles namespace aliases, character references, rejects DTD and malformed documents", () => {
  const parsed = parseXml('<multistatus xmlns="DAV:"><displayname>A &#x1f600; &amp; B</displayname></multistatus>');
  assert.equal(parsed.name, "DAV:|multistatus"); assert.equal(parsed.children[0].text, "A 😀 & B");
  for (const xml of ['<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>', '<x>&unknown;</x>', '<x>&#0;</x>', '<x><y></x>', '<x/><x/>', '<x a="a" a="b"/>', '<d:x/>', '<x> &broken </x>', '<x>' + '<y>'.repeat(40)]) assert.throws(() => parseXml(xml));
});

test("create uses conditional PUT, valid UTF-8 line folding and escaped title; no invitations", async () => {
  const { client, requests } = fixture([new Response(null, { status: 201, headers: { ETag: '"new"' } })]);
  await client.discover();
  const result = await client.createEvent(calendar, { title: "😀".repeat(40) + ",;\\", start: new Date("2026-11-02T12:00:00Z"), end: new Date("2026-11-02T13:00:00Z") });
  const request = requests.at(-1)!;
  assert.equal(request.init.method, "PUT"); assert.equal(new Headers(request.init.headers).get("If-None-Match"), "*");
  assert.equal(result.etag, '"new"'); assert.ok(result.url.startsWith(calendar));
  const body = String(request.init.body);
  assert.ok(body.includes("\\,\\;\\\\")); assert.ok(!body.includes("ATTENDEE"));
  for (const line of body.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  assert.ok(body.includes("DTSTART:20261102T120000Z"));
});

test("writes refuse redirects; bad input and undiscovered calendars never reach the transport", async () => {
  const { client, requests } = fixture([new Response(null, { status: 307, headers: { Location: origin + "/other/" } })]);
  const event = { title: "Test", start: new Date("2026-11-02T12:00Z"), end: new Date("2026-11-02T13:00Z") };
  await assert.rejects(client.createEvent(calendar, event)); assert.equal(requests.length, 0);
  await client.discover();
  await assert.rejects(client.createEvent(calendar, { ...event, title: "Test\r\nATTENDEE:bad" }));
  await assert.rejects(client.query(calendar, event.end, event.start));
  assert.equal(requests.length, 4);
  await assert.rejects(client.createEvent(calendar, event)); assert.equal(requests.length, 5);
});

test("query rejects a foreign collection object URL", async () => {
  const { client } = fixture([response(multi(row(origin + "/other/event.ics", '<C:calendar-data>BEGIN:VCALENDAR</C:calendar-data>')))]);
  await client.discover();
  await assert.rejects(client.query(calendar, new Date("2026-11-01Z"), new Date("2026-11-02Z")), /außerhalb/);
});

test("query meldet fehlende oder nicht verfügbare Kalenderdaten statt Termine auszulassen", async () => {
  for (const [properties, status] of [["<D:getetag>&quot;abc&quot;</D:getetag>", "404 Not Found"], ["<C:calendar-data/>", "200 OK"]]) {
    const { client } = fixture([response(multi(row(calendar + "event.ics", properties!, status!)))]);
    await client.discover();
    await assert.rejects(client.query(calendar, new Date("2026-11-01Z"), new Date("2026-11-02Z")), /unvollständig/);
  }
});


const simpleEvent = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:123\r\nDTSTAMP:20261101T120000Z\r\nDTSTART:20261102T120000Z\r\nDTEND:20261102T130000Z\r\nSUMMARY:Termin\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const eventResponse = (body = simpleEvent, etag = '"v1"') => new Response(body, { status: 200, headers: { ETag: etag } });

test("Ändern und Löschen nur mit geprüftem Titel und If-Match, keine Redirects", async () => {
  const { client, requests } = fixture([eventResponse(), new Response(null, { status: 204 }), eventResponse(), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") });
  const put = requests.at(-1)!; assert.equal(put.init.method, "PUT"); assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"'); assert.match(String(put.init.body), /SUMMARY:Neu/);
  await client.deleteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z");
  const del = requests.at(-1)!; assert.equal(del.init.method, "DELETE"); assert.equal(new Headers(del.init.headers).get("if-match"), '"v1"');
});

test("Einladung enthält nur freigegebene Adresse, Konflikte und Serien schreiben nichts", async () => {
  const { client, requests } = fixture([eventResponse(), new Response(null, { status: 204 }), eventResponse(simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=DAILY\r\nSUMMARY:Termin")), eventResponse(simpleEvent, '"neu"')]);
  await client.discover();
  await client.inviteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", "gast@example.invalid");
  const body = String(requests.at(-1)!.init.body); assert.match(body, /ORGANIZER:mailto:fixture@example\.invalid/); assert.match(body, /ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:gast@example\.invalid/);
  const before = requests.length;
  await assert.rejects(client.deleteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z"));
  await assert.rejects(client.deleteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z"));
  assert.equal(requests.length, before + 2); assert.equal(requests.at(-1)!.init.method, "GET");
  await assert.rejects(client.deleteEvent(calendar, "https://evil.invalid/event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z"));
  await assert.rejects(client.deleteEvent(calendar, calendar + "event.ics", "*", "Termin", "DTSTART:20261102T120000Z"));
  assert.equal(requests.length, before + 2);
});


test("Änderung erhält Zeitzonen, Alarm, unbekannte Felder und freigegebene Teilnehmer", async () => {
  const attendee = "ATTENDEE;CN=Gast;PARTSTAT=ACCEPTED:mailto:gast@example.invalid";
  const contents = simpleEvent.replace("BEGIN:VEVENT", "BEGIN:VTIMEZONE\r\nTZID:Europe/Vienna\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT").replace("SUMMARY:Termin", `ORGANIZER:mailto:fixture@example.invalid\r\n${attendee}\r\nX-APPLE-FOO:keep\r\nSUMMARY:Termin\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Erinnerung\r\nEND:VALARM`);
  const { client, requests } = fixture([eventResponse(contents), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") }, [attendee], false);
  const body = String(requests.at(-1)!.init.body);
  for (const preserved of ["BEGIN:VTIMEZONE", "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "BEGIN:VALARM", "TRIGGER:-PT15M", "X-APPLE-FOO:keep", attendee]) assert.ok(body.includes(preserved), preserved);
  assert.match(body, /SUMMARY:Neu/); assert.equal(new Headers(requests.at(-1)!.init.headers).get("if-match"), '"v1"');
});

test("Teilnehmer und Serienumfang müssen der Freigabe entsprechen; ganze Serie nur ausdrücklich löschen", async () => {
  const attendee = "ATTENDEE:mailto:gast@example.invalid";
  const series = simpleEvent.replace("SUMMARY:Termin", `ORGANIZER:mailto:fixture@example.invalid\r\n${attendee}\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Termin`).replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:123\r\nRECURRENCE-ID:20261103T120000Z\r\nDTSTART:20261103T130000Z\r\nDTEND:20261103T140000Z\r\nSUMMARY:Ausnahme\r\nEND:VEVENT\r\nEND:VCALENDAR");
  const { client, requests } = fixture([eventResponse(series), eventResponse(series), eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await assert.rejects(client.deleteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", [], true));
  await assert.rejects(client.deleteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", [attendee], false));
  assert.equal(requests.at(-1)!.init.method, "GET");
  await client.deleteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", [attendee], true);
  assert.equal(requests.at(-1)!.init.method, "DELETE");
});

test("Einladung bewahrt bestehende Teilnehmer, lehnt irreführende Liste und Serienänderung ab", async () => {
  const attendee = "ATTENDEE:mailto:vorhanden@example.invalid";
  const content = simpleEvent.replace("SUMMARY:Termin", `ORGANIZER:mailto:fixture@example.invalid\r\n${attendee}\r\nSUMMARY:Termin`);
  const series = content.replace("SUMMARY:Termin", "RRULE:FREQ=DAILY\r\nSUMMARY:Termin");
  const { client, requests } = fixture([eventResponse(content), eventResponse(content), new Response(null, { status: 204 }), eventResponse(series)]);
  await client.discover();
  await assert.rejects(client.inviteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", "neu@example.invalid"));
  await client.inviteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", "neu@example.invalid", [attendee], false);
  const body = String(requests.at(-1)!.init.body); assert.ok(body.includes(attendee)); assert.ok(body.includes("mailto:neu@example.invalid"));
  await assert.rejects(client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") }, [attendee], true), /Terminserie/);
  assert.equal(requests.at(-1)!.init.method, "GET");
});

test("Einladung zur ganzen Serie erhält Regel und bestehende Teilnehmer", async () => {
  const attendee = "ATTENDEE:mailto:vorhanden@example.invalid";
  const series = simpleEvent.replace("SUMMARY:Termin", `ORGANIZER:mailto:fixture@example.invalid\r\n${attendee}\r\nRRULE:FREQ=WEEKLY;COUNT=10\r\nSUMMARY:Termin`);
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.inviteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", "neu@example.invalid", [attendee], true);
  const put = requests.at(-1)!;
  assert.equal(put.init.method, "PUT");
  assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"');
  const body = String(put.init.body);
  for (const text of ["RRULE:FREQ=WEEKLY;COUNT=10", attendee, "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:neu@example.invalid"]) assert.ok(body.includes(text), text);
});

test("Serien mit Ausnahmen und doppelte Einladungen werden nicht geschrieben", async () => {
  const base = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY\r\nSUMMARY:Termin");
  const cases = [
    { body: base.replace("SUMMARY:Termin", "EXDATE:20261109T120000Z\r\nSUMMARY:Termin"), attendee: [], recipient: "neu@example.invalid" },
    { body: base.replace("SUMMARY:Termin", "EXRULE:FREQ=MONTHLY\r\nSUMMARY:Termin"), attendee: [], recipient: "neu@example.invalid" },
    { body: base.replace("SUMMARY:Termin", "RDATE:20261109T120000Z\r\nSUMMARY:Termin"), attendee: [], recipient: "neu@example.invalid" },
    { body: base.replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:123\r\nRECURRENCE-ID:20261109T120000Z\r\nDTSTART:20261109T120000Z\r\nDTEND:20261109T130000Z\r\nSUMMARY:Ausnahme\r\nEND:VEVENT\r\nEND:VCALENDAR"), attendee: [], recipient: "neu@example.invalid" },
    { body: base.replace("SUMMARY:Termin", "ORGANIZER:mailto:fixture@example.invalid\r\nATTENDEE:mailto:neu@example.invalid\r\nSUMMARY:Termin"), attendee: ["ATTENDEE:mailto:neu@example.invalid"], recipient: "NEU@example.invalid" },
  ];
  for (const item of cases) {
    const { client, requests } = fixture([eventResponse(item.body)]);
    await client.discover();
    await assert.rejects(client.inviteEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", item.recipient, item.attendee, true));
    assert.equal(requests.at(-1)!.init.method, "GET");
  }
});

test("Titel einer unveränderten UTC-Serie ändern erhält Serienregel und Parameter", async () => {
  const series = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY;COUNT=10\r\nSUMMARY;LANGUAGE=de:Termin");
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu $&", start: new Date("2026-11-02T12:00Z"), end: new Date("2026-11-02T13:00Z") }, [], true);
  const put = requests.at(-1)!;
  assert.equal(put.init.method, "PUT");
  assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"');
  const body = String(put.init.body);
  for (const expected of ["RRULE:FREQ=WEEKLY;COUNT=10", "SUMMARY;LANGUAGE=de:Neu $&", "DTSTART:20261102T120000Z", "DTEND:20261102T130000Z"]) assert.ok(body.includes(expected), expected);
});

test("Einfache UTC-Serie kann unabhängig von der Regelreihenfolge verschoben werden", async () => {
  const series = simpleEvent.replace("SUMMARY:Termin", "RRULE:BYDAY=MO;FREQ=WEEKLY;COUNT=10\r\nSUMMARY:Termin");
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") }, [], true);
  const put = requests.at(-1)!;
  assert.equal(put.init.method, "PUT");
  assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"');
  for (const expected of ["RRULE:BYDAY=MO;FREQ=WEEKLY;COUNT=10", "DTSTART:20261102T140000Z", "DTEND:20261102T150000Z"]) assert.ok(String(put.init.body).includes(expected), expected);
});

test("UTC-Serie mit Enddatum verschiebt auch ihre Wiederholungsgrenze", async () => {
  const series = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY;UNTIL=20261201T120000Z\r\nSUMMARY:Termin");
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") }, [], true);
  assert.match(String(requests.at(-1)!.init.body), /RRULE:FREQ=WEEKLY;UNTIL=20261201T140000Z/);
});

test("UTC-Serie verschiebt ausgeschlossene Termine und Enddatum gemeinsam", async () => {
  const series = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY;UNTIL=20261201T120000Z\r\nEXDATE:20261109T120000Z,20261116T120000Z\r\nEXDATE:20261123T120000Z\r\nX-APPLE-FOO:behalten\r\nSUMMARY:Termin");
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") }, [], true);
  const put = requests.at(-1)!;
  assert.equal(put.init.method, "PUT");
  assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"');
  const body = String(put.init.body);
  for (const expected of ["RRULE:FREQ=WEEKLY;UNTIL=20261201T140000Z", "EXDATE:20261109T140000Z,20261116T140000Z", "EXDATE:20261123T140000Z", "X-APPLE-FOO:behalten", "DTSTART:20261102T140000Z", "DTEND:20261102T150000Z"]) assert.ok(body.includes(expected), expected);
});

test("Zusätzliche und ausgeschlossene UTC-Termine behalten beim Verschieben ihre Wirkung", async () => {
  const series = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY;UNTIL=20261201T120000Z\r\nRDATE;VALUE=DATE-TIME:20261110T120000Z,20261117T120000Z\r\nRDATE:20261124T120000Z\r\nEXDATE;VALUE=DATE-TIME:20261117T120000Z\r\nX-APPLE-FOO:behalten\r\nSUMMARY:Termin");
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T14:00Z"), end: new Date("2026-11-02T15:00Z") }, [], true);
  const put = requests.at(-1)!;
  assert.equal(put.init.method, "PUT");
  assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"');
  const body = String(put.init.body).replace(/\r\n[ \t]/g, "");
  for (const expected of ["RRULE:FREQ=WEEKLY;UNTIL=20261201T140000Z", "RDATE;VALUE=DATE-TIME:20261110T140000Z,20261117T140000Z", "RDATE:20261124T140000Z", "EXDATE;VALUE=DATE-TIME:20261117T140000Z", "X-APPLE-FOO:behalten", "DTSTART:20261102T140000Z", "DTEND:20261102T150000Z"]) assert.ok(body.includes(expected), expected);
});

test("Umbenennen einer Serie erhält nicht veränderte Ausnahmen unverändert", async () => {
  const exclusion = "EXDATE;TZID=Europe/Vienna:20261109T130000";
  const series = simpleEvent.replace("SUMMARY:Termin", `RRULE:FREQ=WEEKLY\r\n${exclusion}\r\nSUMMARY:Termin`);
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neu", start: new Date("2026-11-02T12:00Z"), end: new Date("2026-11-02T13:00Z") }, [], true);
  assert.ok(String(requests.at(-1)!.init.body).includes(exclusion));
  assert.match(String(requests.at(-1)!.init.body), /SUMMARY:Neu/);
});

test("Serientitel ändern erhält einen abweichenden Einzeltermin samt Alarm", async () => {
  const exception = "BEGIN:VEVENT\r\nUID:123\r\nRECURRENCE-ID:20261109T120000Z\r\nDTSTART:20261109T140000Z\r\nDTEND:20261109T150000Z\r\nSUMMARY:Anderer Ort\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\n";
  const series = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY;COUNT=5\r\nSUMMARY:Termin").replace("END:VCALENDAR", exception + "END:VCALENDAR");
  const { client, requests } = fixture([eventResponse(series), new Response(null, { status: 204 })]);
  await client.discover();
  await client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", "DTSTART:20261102T120000Z", { title: "Neuer Serientitel", start: new Date("2026-11-02T12:00Z"), end: new Date("2026-11-02T13:00Z") }, [], true);
  const put = requests.at(-1)!;
  assert.equal(put.init.method, "PUT");
  assert.equal(new Headers(put.init.headers).get("if-match"), '"v1"');
  const body = String(put.init.body);
  assert.ok(body.includes(exception));
  assert.match(body, /SUMMARY:Neuer Serientitel/);
  assert.match(body, /RRULE:FREQ=WEEKLY;COUNT=5/);
});

test("Komplexe Serienänderungen werden nicht geschrieben", async () => {
  const base = simpleEvent.replace("SUMMARY:Termin", "RRULE:FREQ=WEEKLY\r\nSUMMARY:Termin");
  const cases = [
    { event: base, start: "DTSTART:20261102T120000Z", changeStart: "2026-11-03T14:00Z" },
    { event: base.replace("RRULE:FREQ=WEEKLY", "RRULE:FREQ=WEEKLY;UNTIL=20260230T120000Z"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("RRULE:FREQ=WEEKLY", "RRULE:FREQ=WEEKLY;COUNT=2;UNTIL=20261201T120000Z"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("RRULE:FREQ=WEEKLY", "RRULE:FREQ=WEEKLY;BYHOUR=12"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("RRULE:FREQ=WEEKLY", "RRULE:FREQ=WEEKLY;COUNT=2;COUNT=3"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("DTSTART:20261102T120000Z", "DTSTART;TZID=Europe/Vienna:20261102T130000"), start: "DTSTART;TZID=Europe/Vienna:20261102T130000", changeStart: "2026-11-02T12:00Z" },
    { event: base.replace("SUMMARY:Termin", "EXDATE;TZID=Europe/Vienna:20261109T130000\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "EXDATE:20261109T130000Z\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "EXDATE:20260230T120000Z\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "RDATE;TZID=Europe/Vienna:20261109T130000\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "RDATE;VALUE=PERIOD:20261109T120000Z/20261109T130000Z\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "RDATE:20261109T130000Z\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "RDATE:20260230T120000Z\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("SUMMARY:Termin", "EXRULE:FREQ=MONTHLY\r\nSUMMARY:Termin"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:123\r\nRECURRENCE-ID:20261109T120000Z\r\nDTSTART:20261109T120000Z\r\nDTEND:20261109T130000Z\r\nSUMMARY:Ausnahme\r\nEND:VEVENT\r\nEND:VCALENDAR"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T14:00Z" },
    { event: base.replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:123\r\nRECURRENCE-ID;TZID=Europe/Vienna:20261109T130000\r\nDTSTART:20261109T120000Z\r\nDTEND:20261109T130000Z\r\nSUMMARY:Ausnahme\r\nEND:VEVENT\r\nEND:VCALENDAR"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T12:00Z" },
    { event: base.replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:123\r\nRECURRENCE-ID:20260230T120000Z\r\nDTSTART:20261109T120000Z\r\nDTEND:20261109T130000Z\r\nSUMMARY:Ausnahme\r\nEND:VEVENT\r\nEND:VCALENDAR"), start: "DTSTART:20261102T120000Z", changeStart: "2026-11-02T12:00Z" },
  ];
  for (const item of cases) {
    const { client, requests } = fixture([eventResponse(item.event)]);
    await client.discover();
    const end = item.changeStart.replace("14:00", "15:00").replace("12:00", "13:00");
    await assert.rejects(client.updateEvent(calendar, calendar + "event.ics", '"v1"', "Termin", item.start, { title: "Neu", start: new Date(item.changeStart), end: new Date(end) }, [], true));
    assert.equal(requests.at(-1)!.init.method, "GET");
  }
});
