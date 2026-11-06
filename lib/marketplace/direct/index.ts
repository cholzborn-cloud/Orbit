import type { ProviderAdapter, ProviderContext } from "../provider.ts"
import { googleAdapter } from "./google.ts"
import { microsoftAdapter } from "./microsoft.ts"
import { spotifyAdapter } from "./spotify.ts"

export const directAdapters = (ctx: ProviderContext): ProviderAdapter[] => [
  googleAdapter(ctx),
  microsoftAdapter(ctx),
  spotifyAdapter(ctx),
]
