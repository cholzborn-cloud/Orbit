import type { ProviderAdapter, ProviderContext, ProviderDef } from "../provider.ts"
import { directAdapter } from "./base.ts"

export const microsoftDef: ProviderDef = {
  id: "microsoft",
  label: "Microsoft (direkt)",
  route: "direct",
  services: ["outlook", "calendar"],
  setup: [{ key: "clientId", label: "Anwendungs-ID (Client-ID)", secret: false }],
  cost: "Keine Gebühr bei Microsoft; eigene App-Registrierung (Entra) nötig.",
  note: "Du registrierst eine eigene App und trägst die Client-ID ein (öffentlicher Client mit PKCE, kein Secret). Nur Lesen (Mail.Read, Calendars.Read). Bei Firmen- oder Schulkonten kann die Organisation zustimmen müssen.",
}

const endpoints = {
  authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["Mail.Read", "Calendars.Read", "offline_access"],
}

export const microsoftAdapter = (ctx: ProviderContext): ProviderAdapter =>
  directAdapter(ctx, {
    def: microsoftDef,
    endpoints,
    readUrl: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=totalItemCount",
    readAction: "outlook.inbox",
    summarize: (b) => `Outlook verbunden: ${Number(b.totalItemCount ?? 0)} Nachrichten im Posteingang.`,
  })
