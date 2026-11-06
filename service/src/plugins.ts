import { createHash, randomBytes } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { z } from "zod"
import { tool, type Tool, type ToolSet, type ToolExecutionOptions } from "ai"
import { registerConnectorToolOrigin, safeOutput } from "@/lib/connectors/client"

// API contract: https://docs.composio.dev/reference/api-reference/tool-router
const API = "https://backend.composio.dev/api/v3.1"
const slugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)
const text = z.string().max(4000)
const httpsUrl = (value: unknown) => {
  if (typeof value !== "string") return null
  try {
    const u = new URL(value)
    return u.protocol === "https:" && !u.username && !u.password && !u.port ? u.toString() : null
  } catch { return null }
}
const toolkitSchema = z.object({
  slug: slugSchema, name: text, auth_schemes: z.array(text).default([]),
  composio_managed_auth_schemes: z.array(text).default([]), no_auth: z.boolean().default(false),
  meta: z.object({ description: text.default(""), logo: text.optional(), categories: z.array(z.object({ id: text.optional(), slug: text.optional(), name: text }).transform(c => ({ id: c.id ?? c.slug ?? c.name, name: c.name }))).default([]) }),
})
const accountSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/), user_id: text, status: text, toolkit: z.object({ slug: slugSchema }), is_disabled: z.boolean().optional() })
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item).max(1000), next_cursor: z.string().max(2048).nullish(), total_items: z.number().optional() })
const setupFieldSchema = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/), displayName: z.string().max(300).optional(), description: text.optional(), type: z.string().max(50), is_secret: z.boolean().optional(), user_visible: z.boolean().optional() })
const setupGroupSchema = z.object({ required: z.array(setupFieldSchema).max(50), optional: z.array(setupFieldSchema).max(50).default([]) })
const toolkitSetupSchema = toolkitSchema.extend({ auth_guide_url: text.optional(), auth_config_details: z.array(z.object({ mode: z.string().max(50), required_scopes: z.array(text).default([]), fields: z.object({ auth_config_creation: setupGroupSchema.optional(), connected_account_initiation: setupGroupSchema.optional() }) })).max(30).default([]) })
const setupField = (field: z.infer<typeof setupFieldSchema>, required: boolean) => ({ name: field.name, label: field.displayName ?? field.name, type: field.type.toLowerCase(), required, secret: field.is_secret !== false || /secret|password|token|key/i.test(field.name), description: field.description ?? "" })
function setupSchemes(details: z.infer<typeof toolkitSetupSchema>) {
  const modes = details.auth_config_details.map(mode => {
    const group = mode.fields.auth_config_creation
    const configFields = group ? [...group.required.map(f => setupField(f, true)), ...group.optional.filter(f => f.user_visible !== false).map(f => setupField(f, false))] : []
    const connectionGroup = mode.fields.connected_account_initiation
    const connectionFields = connectionGroup ? [...connectionGroup.required.map(f => setupField(f, true)), ...connectionGroup.optional.filter(f => f.user_visible !== false).map(f => setupField(f, false))] : []
    const supported = ["API_KEY", "BEARER_TOKEN", "BASIC", "OAUTH2"].includes(mode.mode.toUpperCase()) && !!group && configFields.every(f => ["string", "number", "integer", "boolean"].includes(f.type)) && !group.required.some(f => f.user_visible === false) && new Set(configFields.map(f => f.name)).size === configFields.length
    return { scheme: mode.mode.toUpperCase(), supported, configFields, connectionFields, requiredScopes: mode.required_scopes, ...(supported ? {} : { reason: "Diese Einrichtung hat unvollständige oder nicht unterstützte Felder. Anbieter-Anleitung verwenden." }) }
  })
  // shortcut: connectionless toolkits need a separate execution path; enable once verified against Composio.
  if (details.no_auth && !modes.some(m => m.scheme === "NO_AUTH")) modes.push({ scheme: "NO_AUTH", supported: false, configFields: [], connectionFields: [], requiredScopes: [], reason: "Dienste ohne Anmeldung sind in Orbit noch nicht verfügbar." })
  return modes
}
type Account = z.infer<typeof accountSchema>
const actionSchema = z.object({ slug: z.string().regex(/^[A-Z][A-Z0-9_]{1,149}$/), toolkit: z.object({ slug: slugSchema }), description: text.default(""), input_parameters: z.record(z.string(), z.unknown()), tags: z.array(text).default([]), is_deprecated: z.boolean().optional(), version: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(), deprecated: z.object({ version: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional() }).optional() })
export type PluginActionRunner = (name: string, action: Tool, input: Record<string, unknown>, call: ToolExecutionOptions<unknown>) => Promise<unknown>
export type PluginStatus = "not_connected" | "pending" | "connected" | "unavailable"
const statusOf = (accounts: Account[]): PluginStatus => accounts.some(a => a.status === "ACTIVE" && !a.is_disabled) ? "connected" : accounts.some(a => ["INITIATED", "INITIALIZING"].includes(a.status)) ? "pending" : "not_connected"
const failure = (error: unknown) => ({ ok: false as const, error: error instanceof PluginError ? error.message : "Plugin-Dienst nicht erreichbar. Bitte später erneut versuchen." })
class PluginError extends Error {}

type PluginConfig = { key?: string, user?: string }
const execKeychain = promisify(execFile)
let cachedKeychain: { value: PluginConfig, until: number } | undefined
export function invalidatePluginCredentials() { cachedKeychain = undefined }
async function defaultConfig(): Promise<PluginConfig> {
  if (process.env.NODE_TEST_CONTEXT || process.env.ORBIT_PLUGIN_STORE_DISABLED === "1") return {}
  const env = { key: process.env.COMPOSIO_API_KEY, user: process.env.COMPOSIO_USER_ID }
  if (env.key && env.user) return env
  if (cachedKeychain && cachedKeychain.until > Date.now()) return cachedKeychain.value
  try {
    const { stdout } = await execKeychain("/usr/bin/security", ["find-generic-password", "-s", "de.consti.orbit.composio", "-a", "local", "-w"], { timeout: 15_000, maxBuffer: 16_384 })
    const value = z.object({ key: z.string().min(1).max(4096), user: z.string().min(1).max(150) }).parse(JSON.parse(stdout))
    cachedKeychain = { value, until: Date.now() + 30_000 }
    return value
  } catch { cachedKeychain = { value: {}, until: Date.now() + 30_000 }; return {} }
}

export class PluginStore {
  private setupConfigs = new Map<string, string>()
  private sessions = new Map<string, { id: string; until: number }>()
  constructor(private config: () => PluginConfig | Promise<PluginConfig> = defaultConfig, private fetcher: typeof fetch = fetch) {}
  private async identity() {
    const c = await this.config()
    if (!c.key?.trim() || !c.user?.trim()) throw new PluginError("Composio ist noch nicht eingerichtet. Projekt-Schlüssel und eindeutige Nutzerkennung fehlen.")
    return { key: c.key, user: c.user }
  }
  private async request(path: string, body?: unknown, method?: "DELETE") {
    const { key } = await this.identity()
    const response = await this.fetcher(`${API}${path}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "x-api-key": key, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new PluginError(response.status === 401 || response.status === 403 ? "Composio-Zugang oder Berechtigung fehlt." : response.status === 429 ? "Composio hat zu viele Anfragen erhalten. Bitte später erneut versuchen." : "Composio konnte die Anfrage nicht abschließen.")
    const reader = response.body?.getReader()
    if (!reader) throw new PluginError("Composio liefert keine Antwort.")
    let size = 0; const chunks: Uint8Array[] = []
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4 * 1024 * 1024) throw new PluginError("Composio-Antwort ist zu groß."); chunks.push(value) }
    } finally { await reader.cancel().catch(() => undefined) }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  }
  private async accounts(slug?: string) {
    const { user } = await this.identity()
    const query = new URLSearchParams({ user_ids: user, limit: "100", account_type: "PRIVATE" })
    if (slug) query.set("toolkit_slugs", slug)
    const accounts: Account[] = []
    const cursors = new Set<string>()
    for (;;) {
      const result = page(accountSchema).parse(await this.request(`/connected_accounts?${query}`))
      accounts.push(...result.items.filter(a => a.user_id === user && (!slug || a.toolkit.slug === slug)))
      if (!result.next_cursor) return accounts
      if (cursors.has(result.next_cursor) || cursors.size >= 100) throw new PluginError("Composio-Kontenliste ist unvollständig.")
      cursors.add(result.next_cursor)
      query.set("cursor", result.next_cursor)
    }
  }
  async catalog(query: URLSearchParams) {
    try {
      await this.identity()
    } catch { return { ok: true as const, configured: false, entries: [], nextCursor: null, totalItems: 0 } }
    try {
      const parsed = z.object({ search: z.string().max(200).optional(), category: z.string().max(100).optional(), cursor: z.string().max(2048).optional(), connected: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(Object.fromEntries(query))
      if (!parsed.success) throw new PluginError("Suche oder Seitenangabe ist ungültig.")
      let accounts: Account[] | null = null
      try { accounts = await this.accounts() } catch { /* Account status must remain unknown on failure. */ }
      let items: z.infer<typeof toolkitSchema>[]
      let nextCursor: string | null = null
      let totalItems = 0
      if (parsed.data.connected === "true") {
        if (!accounts) throw new PluginError("Verbundene Dienste konnten nicht geladen werden.")
        const offsetText = parsed.data.cursor ?? "0"
        if (!/^\d{1,6}$/.test(offsetText)) throw new PluginError("Ungültige Seitenangabe.")
        const slugs = [...new Set(accounts.filter(a => a.status === "ACTIVE" && !a.is_disabled).map(a => a.toolkit.slug))]
        const all: z.infer<typeof toolkitSchema>[] = []
        for (let i = 0; i < slugs.length; i += 10) {
          all.push(...await Promise.all(slugs.slice(i, i + 10).map(async slug => toolkitSchema.parse(await this.request(`/toolkits/${slug}`)))))
        }
        const search = parsed.data.search?.toLocaleLowerCase() ?? ""
        const filtered = all.filter(t => (!search || `${t.name} ${t.meta.description}`.toLocaleLowerCase().includes(search)) && (!parsed.data.category || t.meta.categories.some(c => c.id === parsed.data.category))).sort((a,b) => a.name.localeCompare(b.name))
        const offset = Number(offsetText)
        items = filtered.slice(offset, offset + parsed.data.limit)
        totalItems = filtered.length
        if (offset + parsed.data.limit < totalItems) nextCursor = String(offset + parsed.data.limit)
      } else {
        const params = new URLSearchParams({ limit: String(parsed.data.limit), sort_by: "alphabetically", include_deprecated: "false" })
        for (const key of ["search", "category", "cursor"] as const) if (parsed.data[key]) params.set(key, parsed.data[key])
        const result = page(toolkitSchema).parse(await this.request(`/toolkits?${params}`))
        items = result.items; nextCursor = result.next_cursor ?? null; totalItems = result.total_items ?? result.items.length
      }
      return { ok: true as const, configured: true, entries: items.map(t => ({ id: `composio:${t.slug}`, slug: t.slug, name: t.name, description: t.meta.description, logoUrl: httpsUrl(t.meta.logo), categories: t.meta.categories, authSchemes: t.auth_schemes, managedAuthSchemes: t.composio_managed_auth_schemes, authMode: t.no_auth ? "setup_required" : t.composio_managed_auth_schemes.some(s => s.toLowerCase() === "oauth2") ? "managed_oauth" : "setup_required", connectionStatus: accounts ? statusOf(accounts.filter(a => a.toolkit.slug === t.slug)) : "unavailable", toolsEnabled: false, toolsStatus: "not_checked", accessMode: "individual_actions", source: "Composio" })), nextCursor, totalItems }
    } catch (error) { return failure(error) }
  }
  async status(input: string) {
    try { const slug = slugSchema.parse(input); const status = statusOf(await this.accounts(slug)); return { ok: true as const, connectionStatus: status, toolsEnabled: false, toolsStatus: "not_checked", accessMode: "individual_actions" } } catch (error) { return failure(error) }
  }
  async setup(input: string) {
    try {
      const slug = slugSchema.parse(input)
      const details = toolkitSetupSchema.parse(await this.request(`/toolkits/${slug}`))
      if (details.slug !== slug) throw new PluginError("Der Anbieter passt nicht zur Anfrage.")
      return { ok: true as const, slug, name: details.name, guideUrl: httpsUrl(details.auth_guide_url), schemes: setupSchemes(details), credentialDestination: "Composio", connectionFieldsHosted: true, oauthRedirectUrl: "https://backend.composio.dev/api/v3/toolkits/auth/callback", notice: "Eigene App-Zugänge werden einmal an Composio übertragen und dort gespeichert. Konto-Zugänge gibst du nur auf der Composio-Anmeldeseite ein. Anbieter und Composio können Nutzungskosten berechnen." }
    } catch (error) { return failure(error) }
  }
  async setupConnect(input: string, body: unknown) {
    try {
      const slug = slugSchema.parse(input)
      const parsed = z.object({ scheme: z.string().max(50), fields: z.record(z.string(), z.union([z.string().max(25_000), z.number().finite(), z.boolean()])).refine(fields => Object.keys(fields).length <= 50).default({}) }).strict().safeParse(body)
      if (!parsed.success) throw new PluginError("Einrichtungsdaten sind ungültig.")
      // Read the owning schema again; never accept a client-supplied field list or arbitrary auth-config id.
      const details = toolkitSetupSchema.parse(await this.request(`/toolkits/${slug}`))
      if (details.slug !== slug) throw new PluginError("Der Anbieter passt nicht zur Anfrage.")
      const mode = setupSchemes(details).find(m => m.scheme === parsed.data.scheme.toUpperCase())
      if (!mode?.supported) throw new PluginError("Diese Anmeldeart ist noch nicht sicher unterstützt.")
      const fields = parsed.data.fields
      if (Object.keys(fields).some(key => !mode.configFields.some(f => f.name === key))) throw new PluginError("Nur die ausgewiesenen Einrichtungsfelder sind erlaubt. Konto-Zugänge gehören auf die Composio-Anmeldeseite.")
      for (const field of mode.configFields) {
        const value = fields[field.name]
        if (value === undefined) { if (field.required) throw new PluginError(`Pflichtfeld fehlt: ${field.label}`); continue }
        if ((field.type === "string" && (typeof value !== "string" || (field.required && !value.trim()))) || (field.type === "boolean" && typeof value !== "boolean") || (["number", "integer"].includes(field.type) && (typeof value !== "number" || (field.type === "integer" && !Number.isInteger(value))))) throw new PluginError(`Ungültiges Einrichtungsfeld: ${field.label}`)
        if (field.name === "oauth_redirect_uri" && !["https://backend.composio.dev/api/v3/toolkits/auth/callback", "https://backend.composio.dev/api/v3.1/toolkits/auth/callback", "https://backend.composio.dev/api/v1/auth-apps/add"].includes(String(value))) throw new PluginError("Nur der dokumentierte Composio-OAuth-Rücksprung ist unterstützt.")
      }
      const identity = await this.identity()
      const cacheKey = createHash("sha256").update(JSON.stringify([identity, slug, mode.scheme, Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))])).digest("hex")
      let id = this.setupConfigs.get(cacheKey)
      if (!id) {
        // authScheme is camelCase on the wire, matching Composio's official AuthConfigs.ts createBody.
        const created = z.object({ toolkit: z.object({ slug: slugSchema }), auth_config: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), auth_scheme: z.string(), is_composio_managed: z.boolean() }) }).parse(await this.request("/auth_configs", { toolkit: { slug }, auth_config: { type: "use_custom_auth", authScheme: mode.scheme, name: `Orbit ${slug}`, credentials: fields } }))
        if (created.toolkit.slug !== slug || created.auth_config.auth_scheme.toUpperCase() !== mode.scheme || created.auth_config.is_composio_managed) throw new PluginError("Composio hat die erwartete eigene Einrichtung nicht bestätigt.")
        id = created.auth_config.id
        this.setupConfigs.set(cacheKey, id)
      }
      const link = z.object({ redirect_url: text }).parse(await this.request("/connected_accounts/link", { auth_config_id: id, user_id: identity.user }))
      const url = httpsUrl(link.redirect_url)
      if (!url || !["connect.composio.dev", "app.composio.dev"].includes(new URL(url).hostname)) throw new PluginError("Composio liefert keine sichere Anmeldeadresse.")
      return { ok: true as const, url, connectionStatus: "pending", toolsEnabled: false, toolsStatus: "not_checked", credentialDestination: "Composio" }
    } catch (error) { return failure(error) }
  }
  private async session(slug: string, account?: string) {
    const identity = await this.identity()
    const cacheKey = `${identity.user}:${slug}:${account ?? "login"}`
    const cached = this.sessions.get(cacheKey)
    if (cached && cached.until > Date.now()) return cached.id
    const body = { user_id: identity.user, toolkits: { enable: [slug] }, ...(account ? { connected_accounts: { [slug]: [account] } } : {}), instant: false, manage_connections: { enable: false }, workbench: { enable: false }, proxy_execute: { enable: false }, search: { enable: false }, execute: { enable_multi_execute: false } }
    const result = z.object({ session_id: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/) }).parse(await this.request("/tool_router/session", body))
    if (this.sessions.size >= 40) this.sessions.clear()
    this.sessions.set(cacheKey, { id: result.session_id, until: Date.now() + 10 * 60_000 })
    return result.session_id
  }
  async connectionAccounts(input: string) {
    try {
      const slug = slugSchema.parse(input)
      return { ok: true as const, accounts: (await this.accounts(slug)).map(a => ({ id: a.id, status: a.status })) }
    } catch (error) { return failure(error) }
  }
  async disconnect(input: string, body: unknown) {
    try {
      const slug = slugSchema.parse(input)
      const parsed = z.object({ accountIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/)).min(1).max(100), confirmed: z.literal(true) }).strict().parse(body)
      const owned = await this.accounts(slug)
      const ids = [...new Set(parsed.accountIds)]
      if (ids.some(id => !owned.some(account => account.id === id))) throw new PluginError("Mindestens eine Verbindung gehört nicht zu diesem Dienst oder Nutzer.")
      const deletedIds: string[] = [], failedIds: string[] = []
      for (const id of ids) {
        try {
          z.object({ success: z.literal(true) }).parse(await this.request(`/connected_accounts/${id}`, undefined, "DELETE"))
          deletedIds.push(id)
        } catch { failedIds.push(id) }
      }
      this.sessions.clear()
      return { ok: true as const, deletedIds, failedIds, notice: "Bei Composio getrennt. Berechtigungen beim Anbieter gegebenenfalls separat widerrufen." }
    } catch (error) { return failure(error) }
  }
  async connect(input: string) {
    try {
      const slug = slugSchema.parse(input)
      const toolkit = toolkitSchema.parse(await this.request(`/toolkits/${slug}`))
      if (toolkit.slug !== slug) throw new PluginError("Der Anbieter passt nicht zur Anfrage.")
      if (!toolkit.composio_managed_auth_schemes.some(s => s.toLowerCase() === "oauth2")) throw new PluginError("Dieser Dienst braucht zusätzliche Einrichtung. Eine verwaltete OAuth-Anmeldung ist nicht bestätigt.")
      const current = statusOf(await this.accounts(slug))
      if (current === "connected") return { ok: true as const, connectionStatus: current, toolsEnabled: false, toolsStatus: "not_checked", accessMode: "individual_actions" }
      const id = await this.session(slug)
      const link = z.object({ redirect_url: text }).parse(await this.request(`/tool_router/session/${id}/link`, { toolkit: slug }))
      const url = httpsUrl(link.redirect_url)
      if (!url || !["connect.composio.dev", "app.composio.dev"].includes(new URL(url).hostname)) throw new PluginError("Composio liefert keine sichere Anmeldeadresse.")
      return { ok: true as const, url, connectionStatus: "pending", toolsEnabled: false, accessMode: "individual_actions" }
    } catch (error) { return failure(error) }
  }
  async tools(isGroup = false, runAction?: PluginActionRunner): Promise<ToolSet> {
    try { await this.identity() } catch { return {} }
    // Handles belong to one turn and credential identity. Neither the provider nor the model can invent one.
    const handles = new Map<string, { definition: z.infer<typeof actionSchema> & { version: string }; schema: Record<string, unknown>; validator: z.ZodType; accounts: string[]; identity: string; until: number }>()
    const fingerprint = async () => { const c = await this.identity(); return createHash("sha256").update(JSON.stringify(c)).digest("hex") }
    const readOnly = (tags: string[]) => tags.includes("readOnlyHint") && !tags.some(t => ["createHint", "updateHint", "destructiveHint"].includes(t))
    const search = tool({
      description: "Find connected accounts without toolkit; then search toolkit actions with short query keywords. Follow nextCursor. Only query goes to Composio, no chat history. Returns turn-local handles and schemas.",
      inputSchema: z.object({ toolkit: slugSchema.optional(), query: z.string().max(200).default(""), cursor: z.string().max(2048).optional() }),
      execute: async input => {
        try {
          const identity = await fingerprint()
          const active = (await this.accounts(input.toolkit)).filter(a => a.status === "ACTIVE" && !a.is_disabled)
          if (!input.toolkit) {
            const offsetText = input.cursor ?? "0"
            if (!/^\d{1,8}$/.test(offsetText)) return { error: "Ungültige Kontenseite." }
            const offset = Number(offsetText)
            return { accounts: active.slice(offset, offset + 25).map(a => ({ toolkit: a.toolkit.slug, account: a.id })), nextCursor: offset + 25 < active.length ? String(offset + 25) : null, totalAccounts: active.length }
          }
          if (!active.length) return { error: "Dieser Dienst hat keine aktive eigene Verbindung." }
          // Official paginated full-text catalog search. No session or provider action is started here.
          const query = new URLSearchParams({ toolkit_slug: input.toolkit, query: input.query, limit: "20", include_deprecated: "false", toolkit_versions: "latest" })
          if (input.cursor) query.set("cursor", input.cursor)
          const result = page(z.unknown()).parse(await this.request(`/tools?${query}`))
          const actions = []; let unsupported = 0
          for (const item of result.items) {
            const parsed = actionSchema.safeParse(item)
            if (!parsed.success) { unsupported++; continue }
            let metadata = parsed.data
            if (!metadata.version && !metadata.deprecated?.version) {
              try { metadata = actionSchema.parse(await this.request(`/tools/${metadata.slug}?toolkit_versions=latest`)) } catch { unsupported++; continue }
            }
            const version = metadata.version ?? metadata.deprecated?.version
            if (!version || version === "latest" || metadata.slug !== parsed.data.slug) { unsupported++; continue }
            const definition = { ...metadata, version }
            if (definition.toolkit.slug !== input.toolkit || definition.slug.startsWith("COMPOSIO_") || definition.is_deprecated || (isGroup && !readOnly(definition.tags))) { unsupported++; continue }
            const schema = normalizePluginSchema(definition.input_parameters)
            if (!schema) { unsupported++; continue }
            let validator: z.ZodType
            try { validator = z.fromJSONSchema(schema) } catch { unsupported++; continue }
            const handle = randomBytes(24).toString("hex")
            handles.set(handle, { definition, schema, validator, accounts: active.map(a => a.id), identity, until: Date.now() + 10 * 60_000 })
            actions.push({ handle, toolkit: input.toolkit, action: definition.slug, description: definition.description, inputSchema: schema, readOnly: readOnly(definition.tags) })
          }
          return { actions, accounts: active.map(a => ({ account: a.id })), nextCursor: result.next_cursor ?? null, unsupported, note: "Nur geprüfte Einzelaktionen. Konto bei mehreren Verbindungen ausdrücklich wählen. Composio und Anbieter können Nutzungskosten berechnen." }
        } catch (error) { return failure(error) }
      },
    })
    const execute = tool({
      description: "Run one found action by handle and schema. Select account if ambiguous. Orbit checks its real risk. action_quote must quote a user instruction covering these arguments; generic approval is invalid.",
      inputSchema: z.object({ handle: z.string().regex(/^[a-f0-9]{48}$/), account: z.string().max(150).optional(), action_quote: z.string().max(2000).optional(), arguments: z.record(z.string(), z.unknown()) }),
      execute: async (input, call) => {
        try {
          const entry = handles.get(input.handle)
          if (!entry || entry.until < Date.now() || entry.identity !== await fingerprint()) return { error: "Ungültige oder abgelaufene Aktion. Erneut suchen." }
          if (!runAction) return { error: "Orbit-Freigabeprüfung für Plugins ist nicht verfügbar." }
          const account = input.account ?? (entry.accounts.length === 1 ? entry.accounts[0] : undefined)
          if (!account || !entry.accounts.includes(account)) return { error: "Eigenes Konto ausdrücklich auswählen." }
          const { definition, validator } = entry
          // Never promote a quote from a generic gateway into authorization for a concrete action.
          const { consti_said: ignored, ...args } = input.arguments
          const validated = validator.safeParse(args)
          if (!validated.success || !validated.data || typeof validated.data !== "object" || Array.isArray(validated.data)) return { error: "Plugin-Eingaben entsprechen nicht dem geprüften Schema." }
          if (isGroup && !readOnly(definition.tags)) return { error: "Gruppen dürfen diese Schreibaktion nicht ausführen." }
          const isOwned = async () => entry.identity === await fingerprint() && (await this.accounts(definition.toolkit.slug)).some(a => a.id === account && a.status === "ACTIVE" && !a.is_disabled)
          if (!await isOwned()) return { error: "Verbindung ist nicht mehr aktiv oder gehört nicht zu diesem Nutzer." }
          const action = tool({ description: definition.description, inputSchema: validator, execute: async actionInput => {
            try {
              // Recheck after a potentially long approval wait. The version and account are pinned.
              if (!await isOwned() || entry.until < Date.now()) return { error: "Verbindung oder Aktion ist nicht mehr gültig." }
              if (!validator.safeParse(actionInput).success) return { error: "Ungültige Plugin-Eingaben." }
              const result = z.object({ successful: z.boolean(), data: z.unknown().optional(), error: z.string().nullish() }).parse(await this.request(`/tools/execute/${definition.slug}`, { user_id: (await this.identity()).user, connected_account_id: account, version: definition.version, arguments: actionInput }))
              if (!result.successful || result.error) return { error: "Plugin-Aktion wurde nicht abgeschlossen." }
              return safeOutput(result.data, `Composio ${definition.toolkit.slug}`)
            } catch { return { error: "Plugin-Aktion konnte nicht ausgeführt werden." } }
          } })
          registerConnectorToolOrigin(action, { connectorId: `composio-${definition.toolkit.slug}`, connectorName: definition.toolkit.slug, connectorUrl: API, mcpName: definition.slug, readOnlyHint: readOnly(definition.tags), destructiveHint: definition.tags.includes("destructiveHint"), ...(definition.slug === "GMAIL_CREATE_EMAIL_DRAFT" && definition.toolkit.slug === "gmail" ? { override: { free: [definition.slug] } } : {}) })
          const actionInput = validated.data as Record<string, unknown>
          return await runAction(`connector_composio-${definition.toolkit.slug}__${definition.slug}`, action, { ...actionInput, ...(input.action_quote ? { consti_said: input.action_quote } : {}) }, call)
        } catch (error) { return failure(error) }
      },
    })
    // Only the local gateways are free: execute cannot reach the provider without runAction's concrete guard.
    for (const gateway of [search, execute]) registerConnectorToolOrigin(gateway, { connectorId: "plugins", connectorName: "Plugin-Suche", connectorUrl: API, mcpName: "plugin_gateway", override: { free: ["plugin_gateway"] } })
    return { connector_plugins__search: search, connector_plugins__execute: execute }
  }
}

// v3.1 also documents per-field maps with a boolean `required` on each field.
export function normalizePluginSchema(input: Record<string, unknown>): Record<string, unknown> | null {
  if (input.type === "object" && input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)) return input
  if ("type" in input || "$ref" in input) return null
  const properties: Record<string, unknown> = {}; const required: string[] = []
  for (const [name, value] of Object.entries(input)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const field = { ...value } as Record<string, unknown>
    if (typeof field.type !== "string" || !["string", "number", "integer", "boolean", "array", "object", "null"].includes(field.type)) return null
    if (field.required === true) required.push(name)
    if (field.required !== undefined && typeof field.required !== "boolean") return null
    delete field.required; properties[name] = field
  }
  return { type: "object", properties, required, additionalProperties: false }
}

export async function verifyComposio(input: unknown) {
  const parsed = z.object({ key: z.string().min(1).max(4096), user: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/) }).safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Composio-Zugang ist ungültig." }
  const result = await new PluginStore(() => parsed.data).catalog(new URLSearchParams({ limit: "1" }))
  return result.ok && result.configured ? { ok: true as const } : { ok: false as const, error: "Composio-Zugang konnte nicht geprüft werden." }
}

export const pluginStore = new PluginStore()
