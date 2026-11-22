import assert from "node:assert/strict"
import test from "node:test"
import { parseConnectorTool, toolLabel } from "./tool-label.ts"

test("Konnektor-Tools werden lesbar und normale Tools bleiben", () => {
  assert.deepEqual(parseConnectorTool("connector_abc-1__search"), {
    id: "abc-1",
    tool: "search",
  })
  assert.equal(parseConnectorTool("brain_write"), null)
  assert.equal(toolLabel("connector_abc-1__search"), "search (Konnektor)")
  assert.equal(toolLabel("brain_write"), "brain_write")
})
