import type { ProviderAdapter, ProviderContext, ProviderDef } from "../provider.ts"
import { directAdapter } from "./base.ts"

export const googleDef: ProviderDef = {
  id: "google",
  label: "Google (direkt)",
  route: "direct",
  services: ["gmail", "calendar"],
  setup: [
    { key: "clientId", label: "OAuth-Client-ID", secret: false },
    { key: "clientSecret", label: "OAuth-Client-Secret", secret: true },
  ],
  cost: "Keine Gebühr bei Google; eigenes Google-Cloud-Projekt nötig.",
  note: "Du brauchst ein eigenes Google-Cloud-Projekt mit aktivierter Gmail- und Kalender-API und einem OAuth-Client. Nur Lesen (gmail.readonly, calendar.readonly). Im Testmodus laufen Anmeldungen nach wenigen Tagen ab.",
}

const endpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  extraAuthParams: { access_type: "offline", prompt: "consent" },
}

export const googleAdapter = (ctx: ProviderContext): ProviderAdapter =>
  directAdapter(ctx, {
    def: googleDef,
    endpoints,
    readUrl: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    readAction: "gmail.profile",
    summarize: (b) => `Gmail verbunden: ${String(b.emailAddress ?? "?")}, ${Number(b.messagesTotal ?? 0)} Nachrichten.`,
  })
