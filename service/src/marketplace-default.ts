import { oauthRedirectUrl } from "@/lib/connectors/oauth"
import { directAdapters } from "@/lib/marketplace/direct/index"
import { hubAdapters } from "@/lib/marketplace/hub/index"
import { vault } from "@/lib/marketplace/vault"

import { Marketplace } from "./marketplace"

// Echte Verdrahtung: Schlüsselbund, echtes fetch. Wird erst bei der ersten Nutzeraktion gebaut (kein Aufruf beim Start).
let instance: Marketplace | undefined
export const marketplace = () =>
  (instance ??= new Marketplace(
    {
      vault,
      fetchFn: fetch,
      now: Date.now,
      log: () => {},
      redirectUrl: oauthRedirectUrl(),
    },
    (ctx) => [...directAdapters(ctx), ...hubAdapters(ctx)]
  ))
