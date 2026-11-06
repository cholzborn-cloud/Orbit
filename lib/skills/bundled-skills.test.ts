import assert from "node:assert/strict"
import test from "node:test"

import { loadSkillCatalog, skillTools, READ_SKILL } from "../chat/skill-tools.ts"
import { PLAYBOOK_SKILLS } from "./playbooks.ts"

test("Skill-Katalog: enthält orbit-app und Playbooks", async () => {
  const dummySql = (async () => []) as any
  const catalog = await loadSkillCatalog("test-bot", dummySql)

  const orbitApp = catalog.find((s) => s.root === "a" && s.name === "orbit-app")
  assert.ok(orbitApp, "orbit-app muss im Katalog sein")

  for (const p of PLAYBOOK_SKILLS) {
    const found = catalog.find((s) => s.root === "a" && s.name === p.name)
    assert.ok(found, `Playbook ${p.name} muss im Katalog sein`)
  }
})

test("read_skill: liest orbit-app.md und Playbooks sachlich", async () => {
  const dummySql = (async () => []) as any
  const tools = skillTools({
    botId: "test-bot",
    botName: "TestBot",
    sql: () => dummySql,
  })

  const readTool = tools[READ_SKILL]
  assert.ok(readTool)

  const orbitAppResult = (await (readTool as any).execute({ name: "a/orbit-app" })) as string
  assert.match(orbitAppResult, /<skill_data name="a\/orbit-app">/)
  assert.match(orbitAppResult, /Application Support\/Orbit/)

  const playbookResult = (await (readTool as any).execute({ name: "a/playbook-kauf" })) as string
  assert.match(playbookResult, /<skill_data name="a\/playbook-kauf">/)
  assert.match(playbookResult, /Fertig, wenn:/)
})
