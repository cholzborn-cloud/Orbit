// Ordnung des Composio-Katalogs: Composio liefert rund 100 fein geschnittene, teils doppelte Schlagwörter (z. B. „productivity“ und „productivity-&-project-management“).
// Orbit fasst sie zu 7 klaren deutschen Kategorien zusammen; jeder Dienst landet in mindestens einer (unbekannte Schlagwörter im Auffangbecken „Medien & Freizeit“).
// Stand der Zuordnung: Katalog vom 09.11.2026 (98 Schlagwörter, 1723 Dienste).

export type PluginGroup = { id: string, name: string }

export const PLUGIN_GROUPS: PluginGroup[] = [
  { id: "kommunikation", name: "Kommunikation" },
  { id: "produktivitaet", name: "Produktivität" },
  { id: "entwicklung", name: "Entwicklung & KI" },
  { id: "daten", name: "Daten & Analyse" },
  { id: "business", name: "Vertrieb & Marketing" },
  { id: "finanzen", name: "Finanzen & Shop" },
  { id: "medien", name: "Medien & Freizeit" },
]
// Alles, was nirgends passt, landet hier (kein eigener Eintrag „Sonstiges“).
const FALLBACK = "medien"

const RAW: Record<string, string[]> = {
  kommunikation: ["collaboration-&-communication", "communication", "team-chat", "team-collaboration", "phone-&-sms", "video-conferencing", "notifications", "webinars",
    "email", "email-newsletters", "transactional-email", "drip-emails", "calendar", "scheduling-&-booking"],
  produktivitaet: ["productivity", "productivity-&-project-management", "project-management", "task-management", "notes", "spreadsheets", "time-tracking-software", "bookmark-managers", "product-management", "dashboards",
    "documents", "documents-&-ocr", "content-&-files", "file-management-&-storage", "signatures", "ai-document-extraction", "forms-&-surveys",
    "hr-talent-&-recruitment", "human-resources", "education", "online-courses", "event-management"],
  entwicklung: ["developer-tools", "it-operations", "server-monitoring", "databases", "app-builder", "website-&-app-building", "website-builders", "security-&-identity-tools", "model-context-protocol", "internet-of-things", "ai-safety-compliance-detection",
    "artificial-intelligence", "ai-agents", "ai-models", "ai-content-generation", "ai-chatbots", "ai-assistants", "ai-meeting-assistants", "transcription", "audio-&-speech"],
  daten: ["analytics", "analytics-&-data", "business-intelligence", "market-data", "company-data", "people-&-contact-data", "web-scraping-&-browser", "ai-web-scraping", "web-search-&-research", "seo-&-ai-visibility", "legal-&-public-records", "social-&-creator-data"],
  business: ["crm", "sales-&-crm", "sales-&-customer-support", "ai-sales-tools", "contact-management", "customer-support", "support", "ticketing", "call-tracking", "reviews", "customer-appreciation",
    "marketing", "marketing-automation", "marketing-&-social-media", "social-media-marketing", "social-media-accounts", "ads-&-conversion", "url-shortener"],
  finanzen: ["accounting", "payment-processing", "proposal-&-invoice-management", "ecommerce", "commerce", "fundraising", "taxes"],
  medien: ["images-&-design", "video-&-audio", "media-generation", "video-generation", "lifestyle-&-entertainment", "news-&-lifestyle", "places-&-weather", "gaming", "fitness"],
}

const BY_RAW = new Map<string, string>()
for (const [group, raws] of Object.entries(RAW)) for (const raw of raws) BY_RAW.set(raw, group)

// „developer-tools“ und „model-context-protocol“ hängt Composio an fast jeden Dienst (zusammen rund ein Drittel des Katalogs): Sie zählen nur, wenn der Dienst sonst nirgends passt.
const WEAK = new Set(["developer-tools", "model-context-protocol"])

// Kategorien eines Dienstes aus den Composio-Schlagwörtern, in der festen Reihenfolge der Liste oben. Ohne Treffer: „Sonstiges“.
export function groupsOf(raw: { id: string }[]): PluginGroup[] {
  const map = (list: { id: string }[]) => new Set(list.map(c => BY_RAW.get(c.id) ?? (c.id === "popular" ? "" : FALLBACK)).filter(Boolean))
  let ids = map(raw.filter(c => !WEAK.has(c.id)))
  if (ids.size > 1 || (ids.size === 1 && !ids.has(FALLBACK))) ids.delete(FALLBACK) // Unbekanntes nur, wenn nichts anderes passt
  if (!ids.size) ids = map(raw)
  if (!ids.size) ids.add(FALLBACK)
  return PLUGIN_GROUPS.filter(g => ids.has(g.id))
}

// Empfohlen: bekannte, breit genutzte Dienste in fester Reihenfolge (nur was im Katalog vorkommt, wird gezeigt).
export const RECOMMENDED_SLUGS = [
  "gmail", "googlecalendar", "outlook", "slack", "notion", "googledrive", "googledocs", "googlesheets", "github", "linear",
  "jira", "trello", "asana", "todoist", "clickup", "hubspot", "salesforce", "stripe", "discord", "zoom",
  "figma", "airtable", "dropbox", "canva", "spotify", "supabase", "telegram", "whatsapp", "twitter", "linkedin",
]

// Die Beschreibungen kommen von Composio auf Englisch: gängige deutsche Suchwörter werden um das englische Gegenstück ergänzt.
const SEARCH_DE: [string, string][] = [
  ["kalender", "calendar"], ["termin", "calendar"], ["mail", "email"], ["aufgabe", "task"], ["notiz", "note"], ["nachricht", "message"],
  ["zahlung", "payment"], ["rechnung", "invoice"], ["kunde", "customer"], ["dokument", "document"], ["tabelle", "spreadsheet"], ["datei", "file"],
  ["projekt", "project"], ["buchhaltung", "accounting"], ["werbung", "ads"], ["bild", "image"], ["musik", "music"], ["umfrage", "survey"],
  ["personal", "hr"], ["bewerb", "recruit"], ["sicherheit", "security"], ["datenbank", "database"], ["speicher", "storage"], ["unterschrift", "signature"],
]
export function searchTerms(search: string): string[] {
  const q = search.trim().toLocaleLowerCase()
  if (!q) return []
  return [q, ...SEARCH_DE.filter(([de]) => q.includes(de)).map(([, en]) => en)]
}
