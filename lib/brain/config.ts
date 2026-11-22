import { createBrainClient } from "./client.ts"
import { createLocalBrainClient, resolveVaultPath } from "./local.ts"

// Lokaler Vault: wird beim Start des Dienstes einmal eingeschaltet (enableLocalBrain). Tests schalten ihn nie ein.
let localVault: string | null = null

export function enableLocalBrain(path = resolveVaultPath()) {
  localVault = path
  return localVault
}
export const disableLocalBrain = () => {
  localVault = null
}
export const localBrainPath = () => localVault

export function brainAvailable(env: Record<string, string | undefined> = process.env) {
  return !!localVault || !!(env.BRAIN_SERVER_URL && env.BRAIN_SERVER_TOKEN)
}

// Lokal bevorzugt (kein Server, kein Tunnel); sonst der MCP-Server wie bisher.
export function brainClient() {
  return localVault ? createLocalBrainClient(localVault) : createBrainClient()
}
