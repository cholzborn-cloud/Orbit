import "./chat/fixtures/temp-data.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { PluginStore, normalizePluginSchema } from "./plugins.ts"

const config = () => ({ key: "fixture-key", user: "fixture-user" })
const toolkit = { slug: "gmail", name: "Gmail", auth_schemes: ["OAUTH2"], composio_managed_auth_schemes: ["OAUTH2"], no_auth: false, meta: { description: "Mail", logo: "https://example.invalid/logo.png", categories: [] } }
const account = { id: "ca_fixture", user_id: "fixture-user", status: "ACTIVE", toolkit: { slug: "gmail" } }
const json = (value: unknown) => Response.json(value)

test("catalog has separate entries and unknown tool readiness", async () => {
  const store = new PluginStore(config, async input => String(input).includes("connected_accounts") ? json({items: [account]}) : json({items: [toolkit], next_cursor: null}))
  const result = await store.catalog(new URLSearchParams())
  assert.equal(result.ok, true)
  if (result.ok && result.entries[0]) {
    assert.equal(result.entries[0].slug, "gmail")
    assert.equal(result.entries[0].connectionStatus, "connected")
    assert.equal(result.entries[0].toolsEnabled, false)
    assert.equal(result.entries[0].toolsStatus, "not_checked")
  } else assert.fail("Katalog fehlt")
})

test("unconfigured store never contacts provider", async () => {
  let calls = 0
  const store = new PluginStore(() => ({ key: undefined, user: undefined }), async () => { calls++; throw Error("unexpected") })
  const result = await store.catalog(new URLSearchParams())
  assert.equal(result.ok && result.configured, false)
  assert.equal(calls, 0)
})

test("connection only exposes an allowed HTTPS authentication URL", async () => {
  let host = "connect.composio.dev"
  const store = new PluginStore(config, async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/toolkits/gmail")) return json({...toolkit, meta:{...toolkit.meta, categories:[{slug:"productivity", name:"Productivity"}]}})
    if (url.pathname.endsWith("/connected_accounts")) return json({items: []})
    if (url.pathname.endsWith("/tool_router/session")) return json({session_id:"trs_fixture"})
    if (url.pathname.endsWith("/link")) return json({redirect_url:`https://${host}/link/fixture`})
    throw Error("unexpected")
  })
  const first = await store.connect("gmail")
  assert.equal(first.ok, true)
  host = "evil.invalid"
  assert.equal((await store.connect("gmail")).ok, false)
})

test("other users accounts cannot produce a connected state", async () => {
  const store = new PluginStore(config, async () => json({items: [{...account, user_id:"other-user"}]}))
  const result = await store.status("gmail")
  assert.equal(result.ok && result.connectionStatus, "not_connected")
})

test("documented parameter maps become object schemas with required fields", () => {
  assert.deepEqual(normalizePluginSchema({repo:{type:"string",required:true},limit:{type:"integer",required:false}}), {type:"object",properties:{repo:{type:"string"},limit:{type:"integer"}},required:["repo"],additionalProperties:false})
  assert.equal(normalizePluginSchema({repo:{type:"mystery"}}), null)
})

test("connection status includes later account pages", async () => {
  let calls = 0
  const store = new PluginStore(config, async input => {
    calls++
    return new URL(String(input)).searchParams.has("cursor") ? json({items:[account]}) : json({items:[], next_cursor:"page-2"})
  })
  const result = await store.status("gmail")
  assert.equal(result.ok && result.connectionStatus, "connected")
  assert.equal(calls, 2)
})

test("connected filter uses connected accounts beyond the catalog first page", async () => {
  const store = new PluginStore(config, async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/connected_accounts")) return json({items:[account]})
    if (url.pathname.endsWith("/toolkits/gmail")) return json(toolkit)
    throw Error("catalog first page should not be requested")
  })
  const result = await store.catalog(new URLSearchParams({connected:"true"}))
  assert.equal(result.ok && result.entries[0]?.slug, "gmail")
})

const call = { toolCallId: "gateway-fixture", messages: [] }
async function run(tools: Awaited<ReturnType<PluginStore["tools"]>>, name: string, input: unknown) {
  const output = await tools[name]!.execute!(input, call)
  if (output && typeof output === "object" && Symbol.asyncIterator in output) { let last: unknown; for await (const part of output as AsyncIterable<unknown>) last = part; return last as any }
  return output as any
}
const action = (slug = "GMAIL_FETCH_EMAILS", extra: object = {}) => ({ slug, toolkit: { slug: "gmail" }, description: "Fixture action", input_parameters: { to: { type: "string", required: true } }, version: "20261101_00", tags: ["readOnlyHint"], ...extra })

function providerFixture(options: { definitions?: unknown[]; accountPages?: boolean; secondToolPage?: boolean } = {}) {
  const calls: { url: URL; body: any }[] = []
  const accounts = Array.from({ length: 6 }, (_, i) => ({ ...account, id: `ca_fixture_${i}`, toolkit: { slug: i === 5 ? "gmail" : `app${i}` } }))
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body })
    if (url.pathname.endsWith("/connected_accounts")) return json(options.accountPages && !url.searchParams.has("cursor") ? { items: accounts.slice(0, 5), next_cursor: "accounts-2" } : { items: options.accountPages ? accounts.slice(5) : accounts })
    if (url.pathname.endsWith("/tools")) return json(options.secondToolPage && !url.searchParams.has("cursor") ? { items: [], next_cursor: "tools-2" } : { items: options.definitions ?? [action()] })
    if (url.pathname.includes("/tools/execute/")) return json({ successful: true, data: { fixture: "result" } })
    throw Error("Unexpected fixture request")
  }
  return { fetcher, calls }
}

test("gateway reaches sixth account and second action page without sessions or prompt catalog", async () => {
  const fixture = providerFixture({ accountPages: true, secondToolPage: true })
  const store = new PluginStore(config, fixture.fetcher)
  const tools = await store.tools(false, async (_name, original, args, options) => original.execute!(args, options))
  assert.deepEqual(Object.keys(tools).sort(), ["connector_plugins__execute", "connector_plugins__search"])
  const accounts = await run(tools, "connector_plugins__search", { query: "" })
  assert.equal(accounts.accounts.length, 6)
  const first = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "fetch" })
  assert.equal(first.nextCursor, "tools-2")
  const second = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "fetch", cursor: first.nextCursor })
  assert.equal(second.actions[0].action, "GMAIL_FETCH_EMAILS")
  assert.equal(second.accounts[0].account, "ca_fixture_5")
  const result = await run(tools, "connector_plugins__execute", { handle: second.actions[0].handle, arguments: { to: "reader@example.invalid" } })
  assert.ok(JSON.stringify(result).includes("result"))
  const execution = fixture.calls.find(c => c.url.pathname.includes("/tools/execute/"))!
  assert.equal(execution.body.connected_account_id, "ca_fixture_5")
  assert.equal(execution.body.version, "20261101_00")
  assert.equal(fixture.calls.some(c => c.url.pathname.includes("session")), false)
})

test("forged handles and absent approval guard never execute", async () => {
  const fixture = providerFixture(); const store = new PluginStore(config, fixture.fetcher)
  const tools = await store.tools()
  assert.match((await run(tools, "connector_plugins__execute", { handle: "f".repeat(48), arguments: {} })).error, /Ungültige/)
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "fetch" })
  assert.match((await run(tools, "connector_plugins__execute", { handle: found.actions[0].handle, arguments: { to: "x" } })).error, /Freigabeprüfung/)
  assert.equal(fixture.calls.some(c => c.body), false)
})

test("unsupported schemas and meta-tools are not exposed, invalid arguments do not execute", async () => {
  const fixture = providerFixture({ definitions: [action("GMAIL_INVALID", { input_parameters: { field: { type: "mystery" } } }), action("COMPOSIO_MULTI_EXECUTE_TOOL"), action()] })
  const tools = await new PluginStore(config, fixture.fetcher).tools(false, async (_name, original, args, options) => original.execute!(args, options))
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "mail" })
  assert.equal(found.actions.length, 1)
  assert.equal(found.unsupported, 2)
  assert.match((await run(tools, "connector_plugins__execute", { handle: found.actions[0].handle, arguments: { to: 123 } })).error, /Schema/)
  assert.equal(fixture.calls.some(c => c.body), false)
})

test("actual send action and recipient need approval; denial and generic quote do not authorize", async () => {
  const { createPluginActionRunner } = await import("./chat/approvals.ts")
  const { InteractionManager } = await import("./interactions.ts")
  const fixture = providerFixture({ definitions: [action("GMAIL_SEND_EMAIL", { tags: ["createHint"] })] })
  const requests: any[] = []; let approved = false
  const approvalStore = { create: async () => Date.now(), get: async () => Date.now() }
  const manager = new InteractionManager({ store: approvalStore, saveRule: async () => {} })
  const guard = createPluginActionRunner({ chatId: "fixture-chat", ctx: { speaker: { id: "fixture-bot" } } as never, rules: [], lastUserText: "Sende an reader@example.invalid", manager, store: approvalStore, signal: new AbortController().signal, onApproval: async request => { requests.push(request); await manager.decide(request.id, { approved }) }, onDecision: () => {} })
  const tools = await new PluginStore(config, fixture.fetcher).tools(false, guard)
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "send" })
  const input = { handle: found.actions[0].handle, arguments: { to: "reader@example.invalid", consti_said: "Sende an reader@example.invalid" } }
  const denied = await run(tools, "connector_plugins__execute", input)
  assert.match(denied.error, /abgelehnt/)
  assert.equal(fixture.calls.some(c => c.body), false)
  assert.equal(requests[0].tool, "connector:composio-gmail:GMAIL_SEND_EMAIL")
  assert.deepEqual(requests[0].input, { to: "reader@example.invalid" })
  assert.equal(requests[0].reason, "nachricht")
  approved = true
  const allowed = await run(tools, "connector_plugins__execute", input)
  assert.ok(JSON.stringify(allowed).includes("result"))
  assert.equal(requests.length, 2)
  assert.equal(fixture.calls.filter(c => c.body).length, 1)
  assert.equal(fixture.calls.find(c => c.body)!.body.arguments.consti_said, undefined)
})

test("read-only actions remain autonomous; groups cannot discover writes", async () => {
  const { createPluginActionRunner } = await import("./chat/approvals.ts")
  let waits = 0
  const fixture = providerFixture({ definitions: [action(), action("GMAIL_SEND_EMAIL", { tags: ["createHint"] })] })
  const guard = createPluginActionRunner({ chatId: "fixture", ctx: { speaker: { id: "bot" } } as never, rules: [], manager: { wait: async () => { waits++; throw Error("must not ask") } } as never, store: { create: async () => Date.now(), get: async () => Date.now() }, signal: new AbortController().signal, onApproval: async () => {}, onDecision: () => {} })
  const tools = await new PluginStore(config, fixture.fetcher).tools(true, guard)
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "mail" })
  assert.equal(found.actions.length, 1)
  assert.ok(JSON.stringify(await run(tools, "connector_plugins__execute", { handle: found.actions[0].handle, arguments: { to: "x" } })).includes("result"))
  assert.equal(waits, 0)
})

test("handles are turn-local and account and credentials must still belong to the owner", async () => {
  let user = "fixture-user"
  const fixture = providerFixture()
  const store = new PluginStore(() => ({ key: "fixture-key", user }), fixture.fetcher)
  const tools = await store.tools(false, async (_name, original, args, options) => original.execute!(args, options))
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "fetch" })
  const input = { handle: found.actions[0].handle, arguments: { to: "x" } }
  const otherTurn = await store.tools(false, async () => ({ impossible: true }))
  assert.match((await run(otherTurn, "connector_plugins__execute", input)).error, /Ungültige/)
  assert.match((await run(tools, "connector_plugins__execute", { ...input, account: "ca_someone_else" })).error, /Konto/)
  user = "different-user"
  assert.match((await run(tools, "connector_plugins__execute", input)).error, /Ungültige/)
  assert.equal(fixture.calls.some(c => c.body), false)
})

test("official legacy version metadata and detail fallback pin a concrete version", async () => {
  // Official v3.1 tool shape: input_parameters field map; some responses keep version in deprecated.
  const official = { slug: "GITHUB_CREATE_A_WORKFLOW_DISPATCH_EVENT", name: "GitHub Actions", description: "Automate GitHub workflows", toolkit: { slug: "github", name: "GitHub" }, input_parameters: { repo_name: { type: "string", description: "owner/repo", required: true, example: "octocat/Hello-World" }, workflow_id: { type: "string", required: true } }, no_auth: false, available_versions: ["20250905_00"], tags: ["ci-cd", "github"], is_deprecated: false, deprecated: { displayName: "GitHub Actions", version: "20250905_00", is_deprecated: false } }
  let details = 0; let omitLegacyVersion = false; let omitDetailVersion = false
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/connected_accounts")) return json({ items: [{ ...account, toolkit: { slug: "github" } }] })
    if (url.pathname.endsWith("/tools")) return json({ items: [omitLegacyVersion ? { ...official, deprecated: undefined } : official] })
    if (url.pathname.includes("/tools/GITHUB_")) { details++; return json(omitDetailVersion ? { ...official, deprecated: undefined } : { ...official, version: "20261101_00" }) }
    throw Error("Unexpected request")
  }
  const tools = await new PluginStore(config, fetcher).tools(false, async () => null)
  assert.equal((await run(tools, "connector_plugins__search", { toolkit: "github", query: "workflow" })).actions.length, 1)
  assert.equal(details, 0)
  omitLegacyVersion = true
  assert.equal((await run(tools, "connector_plugins__search", { toolkit: "github", query: "workflow" })).actions.length, 1)
  assert.equal(details, 1)
  omitDetailVersion = true
  const unsupported = await run(tools, "connector_plugins__search", { toolkit: "github", query: "workflow" })
  assert.equal(unsupported.actions.length, 0)
  assert.equal(unsupported.unsupported, 1)
})

test("search sends only explicit keywords, keeps provider errors private, and frames results", async () => {
  const { frameUntrustedResults } = await import("@/lib/chat/untrusted")
  const fixture = providerFixture()
  const tools = frameUntrustedResults(await new PluginStore(config, fixture.fetcher).tools())
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "fetch recent emails" })
  const searches = fixture.calls.filter(c => c.url.pathname.endsWith("/tools"))
  assert.equal(searches[0]!.url.searchParams.get("query"), "fetch recent emails")
  assert.equal(searches[0]!.body, undefined)
  assert.equal(searches[0]!.url.searchParams.has("user_id"), false)
  assert.equal(fixture.calls.some(c => c.url.pathname.includes("session")), false)
  const framed = await tools.connector_plugins__search!.toModelOutput!({ output: found } as never)
  assert.match(JSON.stringify(framed), /untrusted_data/)
  const broken = await new PluginStore(config, async () => new Response("fixture-secret-never-display", { status: 500 })).tools()
  assert.equal(JSON.stringify(await run(broken, "connector_plugins__search", { query: "" })).includes("fixture-secret-never-display"), false)
})

test("owner is checked again after approval and safe drafts do not ask", async () => {
  const { createPluginActionRunner } = await import("./chat/approvals.ts")
  const { InteractionManager } = await import("./interactions.ts")
  let active = true; let executions = 0; let asks = 0
  const store = new PluginStore(config, async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/connected_accounts")) return json({ items: [{ ...account, status: active ? "ACTIVE" : "DISABLED" }] })
    if (url.pathname.endsWith("/tools")) return json({ items: [action("GMAIL_SEND_EMAIL", { tags: ["createHint"] }), action("GMAIL_CREATE_EMAIL_DRAFT", { tags: ["createHint"] })] })
    if (url.pathname.includes("/tools/execute/")) { executions++; return json({ successful: true, data: { drafted: true } }) }
    throw Error("Unexpected request")
  })
  const approvalStore = { create: async () => Date.now(), get: async () => Date.now() }
  const manager = new InteractionManager({ store: approvalStore, saveRule: async () => {} })
  const guard = createPluginActionRunner({ chatId: "fixture", ctx: { speaker: { id: "bot" } } as never, rules: [], manager, store: approvalStore, signal: new AbortController().signal, onApproval: async request => { asks++; active = false; await manager.decide(request.id, { approved: true }) }, onDecision: () => {} })
  const tools = await store.tools(false, guard)
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "mail" })
  const draft = found.actions.find((a: any) => a.action === "GMAIL_CREATE_EMAIL_DRAFT")
  assert.ok(JSON.stringify(await run(tools, "connector_plugins__execute", { handle: draft.handle, arguments: { to: "draft@example.invalid" } })).includes("drafted"))
  assert.equal(asks, 0)
  const send = found.actions.find((a: any) => a.action === "GMAIL_SEND_EMAIL")
  assert.match((await run(tools, "connector_plugins__execute", { handle: send.handle, arguments: { to: "reader@example.invalid" } })).error, /gültig/)
  assert.equal(asks, 1)
  assert.equal(executions, 1)
})

test("gateway descriptions meet project budget and default test config skips Keychain", async () => {
  const { asSchema } = await import("ai")
  const tools = await new PluginStore(config, providerFixture().fetcher).tools()
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return
    const object = value as Record<string, unknown>
    if (typeof object.description === "string") assert.ok(object.description.length <= 80)
    for (const child of Object.values(object)) if (Array.isArray(child)) child.forEach(inspect); else inspect(child)
  }
  for (const definition of Object.values(tools)) { assert.ok((definition.description?.length ?? 0) <= 200, definition.description); inspect(await asSchema(definition.inputSchema).jsonSchema) }
  const unconfigured = new PluginStore(undefined, async () => { throw Error("Default test config must not call provider") })
  assert.deepEqual(await unconfigured.tools(), {})
})

test("only an exact action quote covering concrete arguments preserves user authorization", async () => {
  const { createPluginActionRunner } = await import("./chat/approvals.ts")
  const { InteractionManager } = await import("./interactions.ts")
  const fixture = providerFixture({ definitions: [action("GMAIL_SEND_EMAIL", { tags: ["createHint"] })] })
  const approvalStore = { create: async () => Date.now(), get: async () => Date.now() }
  const manager = new InteractionManager({ store: approvalStore, saveRule: async () => {} })
  let asks = 0
  const quote = "Sende eine Nachricht an reader@example.invalid"
  const guard = createPluginActionRunner({ chatId: "fixture", ctx: { speaker: { id: "bot" } } as never, rules: [], lastUserText: quote, manager, store: approvalStore, signal: new AbortController().signal, onApproval: async request => { asks++; await manager.decide(request.id, { approved: false }) }, onDecision: () => {} })
  const tools = await new PluginStore(config, fixture.fetcher).tools(false, guard)
  const found = await run(tools, "connector_plugins__search", { toolkit: "gmail", query: "send" })
  const base = { handle: found.actions[0].handle, action_quote: quote }
  assert.ok(JSON.stringify(await run(tools, "connector_plugins__execute", { ...base, arguments: { to: "reader@example.invalid" } })).includes("result"))
  assert.equal(asks, 0)
  assert.match((await run(tools, "connector_plugins__execute", { ...base, arguments: { to: "different@example.invalid" } })).error, /abgelehnt/)
  assert.equal(asks, 1)
  assert.equal(fixture.calls.filter(c => c.body).length, 1)
  assert.equal(fixture.calls.find(c => c.body)!.body.arguments.consti_said, undefined)
})

test("a quote cannot silently authorize a boolean action parameter", async () => {
  const { createPluginActionRunner } = await import("./chat/approvals.ts")
  const { InteractionManager } = await import("./interactions.ts")
  const fixture = providerFixture({ definitions: [action("GMAIL_SEND_EMAIL", { tags: ["createHint"], input_parameters: { to: { type:"string", required:true }, public: { type:"boolean", required:true } } })] })
  const approvalStore = { create: async () => Date.now(), get: async () => Date.now() }
  const manager = new InteractionManager({ store: approvalStore, saveRule: async () => {} })
  let asks = 0
  const quote = "Sende eine Nachricht an reader@example.invalid"
  const guard = createPluginActionRunner({ chatId:"fixture", ctx:{ speaker:{id:"bot"} } as never, rules:[], lastUserText:quote, manager, store:approvalStore, signal:new AbortController().signal, onApproval:async request => { asks++; await manager.decide(request.id, {approved:false}) }, onDecision:() => {} })
  const tools = await new PluginStore(config, fixture.fetcher).tools(false, guard)
  const found = await run(tools, "connector_plugins__search", {toolkit:"gmail",query:"send"})
  const result = await run(tools, "connector_plugins__execute", {handle:found.actions[0].handle,action_quote:quote,arguments:{to:"reader@example.invalid",public:true}})
  assert.match(result.error, /abgelehnt/)
  assert.equal(asks,1)
  assert.equal(fixture.calls.some(c => c.body),false)
})

function setupFixture(mode = "API_KEY") {
  const configFields = mode === "OAUTH2" ? [
    { name: "client_id", displayName: "Client-ID", type: "string", is_secret: false, default: "metadata-default-must-not-return" },
    { name: "client_secret", displayName: "Client-Secret", type: "string", is_secret: true, default: "secret-default-must-not-return" },
  ] : []
  const detail = { ...toolkit, composio_managed_auth_schemes: [], no_auth: mode === "NO_AUTH", auth_guide_url: "https://example.invalid/auth-guide", auth_config_details: mode === "NO_AUTH" ? [] : [{ mode, required_scopes: ["fixture.read"], fields: { auth_config_creation: { required: configFields, optional: [] }, connected_account_initiation: { required: [{ name: "api_key", displayName: "Account key", type: "string", is_secret: true, default: "account-default-must-not-return" }], optional: [] } } }] }
  const calls: { url: URL; body: any }[] = []; let linkHost = "connect.composio.dev"; let failLink = false
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body })
    if (url.pathname.endsWith("/toolkits/gmail")) return json(detail)
    if (url.pathname.endsWith("/auth_configs")) return json({ toolkit: { slug: "gmail" }, auth_config: { id: "ac_fixture_custom", auth_scheme: mode, is_composio_managed: false, credentials: { secret: "provider-response-secret" } } })
    if (url.pathname.endsWith("/connected_accounts/link")) return failLink ? new Response("fixture-provider-secret", { status: 500 }) : json({ redirect_url: `https://${linkHost}/link/fixture`, connected_account_id: "ca_fixture", connectionData: { token: "provider-response-token" } })
    throw Error("Unexpected fixture request")
  }
  return { detail, calls, store: new PluginStore(config, fetcher), unsafeLink: () => { linkHost = "evil.invalid" }, failLink: (value: boolean) => { failLink = value } }
}

test("custom auth setup exposes metadata only and keeps account credential collection hosted", async () => {
  const fixture = setupFixture("OAUTH2")
  const result = await fixture.store.setup("gmail")
  assert.equal(result.ok, true)
  if (!result.ok) assert.fail("setup metadata missing")
  assert.equal(result.credentialDestination, "Composio")
  assert.equal(result.connectionFieldsHosted, true)
  assert.equal(result.schemes[0]!.configFields[0]!.name, "client_id")
  assert.equal(result.schemes[0]!.configFields[1]!.secret, true)
  assert.equal(result.schemes[0]!.connectionFields[0]!.name, "api_key")
  assert.equal(result.schemes[0]!.supported, true)
  assert.equal(JSON.stringify(result).includes("must-not-return"), false)
  assert.equal(fixture.calls.some(c => c.body), false)
})

test("API key, bearer and basic use explicit custom configuration and hosted links", async () => {
  for (const scheme of ["API_KEY", "BEARER_TOKEN", "BASIC"]) {
    const fixture = setupFixture(scheme)
    const metadata = await fixture.store.setup("gmail")
    assert.equal(metadata.ok && metadata.schemes[0]!.supported, true)
    const result = await fixture.store.setupConnect("gmail", { scheme, fields: {} })
    assert.equal(result.ok, true)
    if (!result.ok) assert.fail(`setup failed: ${scheme}`)
    assert.equal(result.connectionStatus, "pending")
    const create = fixture.calls.find(c => c.url.pathname.endsWith("/auth_configs"))!
    assert.deepEqual(create.body, { toolkit: { slug: "gmail" }, auth_config: { type: "use_custom_auth", authScheme: scheme, name: "Orbit gmail", credentials: {} } })
    const link = fixture.calls.find(c => c.url.pathname.endsWith("/connected_accounts/link"))!
    assert.deepEqual(link.body, { auth_config_id: "ac_fixture_custom", user_id: "fixture-user" })
    assert.equal(JSON.stringify(result).includes("provider-response"), false)
  }
})

test("own OAuth config accepts only declared fields, never returns or stores secret values", async () => {
  const fixture = setupFixture("OAUTH2")
  const body = { scheme: "OAUTH2", fields: { client_id: "fixture-client", client_secret: "fixture-client-secret" } }
  const first = await fixture.store.setupConnect("gmail", body)
  assert.equal(first.ok, true)
  assert.equal(JSON.stringify(first).includes("fixture-client"), false)
  assert.deepEqual(fixture.calls.find(c => c.url.pathname.endsWith("/auth_configs"))!.body.auth_config.credentials, body.fields)
  await fixture.store.setupConnect("gmail", body)
  assert.equal(fixture.calls.filter(c => c.url.pathname.endsWith("/auth_configs")).length, 1)
  assert.equal((await fixture.store.setupConnect("gmail", { scheme: "OAUTH2", fields: { client_id: "fixture-client" } })).ok, false)
  assert.equal((await fixture.store.setupConnect("gmail", { ...body, fields: { ...body.fields, unknown_key: "do-not-forward" } })).ok, false)
  assert.equal((await fixture.store.setupConnect("gmail", { ...body, fields: { ...body.fields, client_id: 99 } })).ok, false)
  assert.equal(fixture.calls.filter(c => c.url.pathname.endsWith("/auth_configs")).length, 1)
})

test("unsafe or incomplete setup fails closed and partial link failure retries without duplicate config", async () => {
  const fixture = setupFixture("API_KEY")
  assert.equal((await fixture.store.setupConnect("gmail", { scheme: "API_KEY", fields: { api_key: "account-key-never-send-here" } })).ok, false)
  assert.equal(fixture.calls.some(c => c.body), false)
  fixture.failLink(true)
  const failed = await fixture.store.setupConnect("gmail", { scheme: "API_KEY", fields: {} })
  assert.equal(failed.ok, false)
  assert.equal(JSON.stringify(failed).includes("fixture-provider-secret"), false)
  fixture.failLink(false)
  fixture.unsafeLink()
  assert.equal((await fixture.store.setupConnect("gmail", { scheme: "API_KEY", fields: {} })).ok, false)
  assert.equal(fixture.calls.filter(c => c.url.pathname.endsWith("/auth_configs")).length, 1)
  const unsupported = setupFixture("SERVICE_ACCOUNT")
  const metadata = await unsupported.store.setup("gmail")
  assert.equal(metadata.ok && metadata.schemes[0]!.supported, false)
  assert.equal((await unsupported.store.setupConnect("gmail", { scheme: "SERVICE_ACCOUNT", fields: {} })).ok, false)
})

test("hidden optional setup fields are not exposed or accepted", async () => {
  const fixture = setupFixture("OAUTH2")
  fixture.detail.auth_config_details[0]!.fields.auth_config_creation.optional.push({name:"hidden",type:"string",user_visible:false} as never)
  const detail = await fixture.store.setup("gmail")
  assert.equal(detail.ok,true)
  if (!detail.ok) assert.fail("no setup")
  assert.equal(detail.schemes[0]!.configFields.some(field => field.name === "hidden"),false)
  const result = await fixture.store.setupConnect("gmail", {scheme:"OAUTH2",fields:{client_id:"x",client_secret:"y",hidden:"z"}})
  assert.equal(result.ok,false)
  assert.equal(fixture.calls.some(call => call.body),false)
})


test("connectionless toolkits do not start an unsupported login flow", async () => {
  const fixture = setupFixture("NO_AUTH")
  const metadata = await fixture.store.setup("gmail")
  assert.equal(metadata.ok && metadata.schemes[0]!.supported, false)
  assert.equal((await fixture.store.setupConnect("gmail", { scheme: "NO_AUTH", fields: {} })).ok, false)
  assert.equal(fixture.calls.some(c => c.body), false)
})
