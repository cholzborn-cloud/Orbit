import type { ProviderAdapter, ProviderContext } from "../provider.ts"
import { nangoAdapter } from "./nango.ts"
import { pipedreamAdapter } from "./pipedream.ts"

// Vermittler-Adapter (Nango, Pipedream).
export const hubAdapters = (ctx: ProviderContext): ProviderAdapter[] => [nangoAdapter(ctx), pipedreamAdapter(ctx)]
