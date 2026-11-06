import type { ProviderAdapter, ProviderContext, ProviderDef } from "../provider.ts"
import { directAdapter } from "./base.ts"

export const spotifyDef: ProviderDef = {
  id: "spotify",
  label: "Spotify (direkt)",
  route: "direct",
  services: ["spotify"],
  setup: [
    { key: "clientId", label: "Client-ID", secret: false },
    { key: "clientSecret", label: "Client-Secret (optional)", secret: true },
  ],
  cost: "Keine Gebühr für die API; für die Entwickler-App braucht der Eigentümer Spotify Premium.",
  note: "Du brauchst eine eigene Spotify-Entwickler-App. Im Entwicklermodus verlangt Spotify Premium für den App-Eigentümer und erlaubt höchstens fünf zugelassene Nutzer. Rechte: user-read-private, user-read-playback-state (nur Lesen).",
}

const endpoints = {
  authorize: "https://accounts.spotify.com/authorize",
  token: "https://accounts.spotify.com/api/token",
  scopes: ["user-read-private", "user-read-playback-state"],
}

export const spotifyAdapter = (ctx: ProviderContext): ProviderAdapter =>
  directAdapter(ctx, {
    def: spotifyDef,
    endpoints,
    readUrl: "https://api.spotify.com/v1/me",
    readAction: "me",
    summarize: (b) => `Spotify verbunden: ${String(b.display_name ?? b.id ?? "?")} (${String(b.product ?? "?")}).`,
  })
