import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

const reserved = new BlockList()
for (const [range, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["::7f00:1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["2002::", 16, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["fec0::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const)
  reserved.addSubnet(range, prefix, family)

type UrlResult =
  | {
      ok: true
      value: URL
      host: string
      addresses: { address: string; family: number }[]
    }
  | { ok: false; error: string }

function privateAddress(address: string): boolean {
  const ip = address.toLowerCase().split("%")[0]
  if (isIP(ip) && reserved.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6"))
    return true
  if (ip.includes(":")) {
    const groups = ipv6Groups(ip)
    if (!groups) return true
    const mapped =
      groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
    if (mapped)
      return privateAddress(
        `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`
      )
    return (
      (groups[0] & 0xfe00) === 0xfc00 ||
      (groups[0] & 0xffc0) === 0xfe80 ||
      (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1)
    )
  }
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255))
    return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function ipv6Groups(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null
  const normalized = ip.replace(/(\d+\.\d+\.\d+\.\d+)$/, (address) => {
    const [a, b, c, d] = address.split(".").map(Number)
    return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  })
  const halves = normalized.split("::")
  const parse = (part: string) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : []
  const left = parse(halves[0])
  const right = parse(halves[1] ?? "")
  if (halves.length === 1) return left.length === 8 ? left : null
  const zeros = 8 - left.length - right.length
  return zeros < 1 ? null : [...left, ...Array(zeros).fill(0), ...right]
}

export function inspectConnectorUrl(
  input: string
): { ok: true; value: URL; host: string } | { ok: false; error: string } {
  try {
    const url = new URL(input)
    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return {
        ok: false,
        error:
          "Nur HTTPS-URLs ohne Zugangsdaten und mit Port 443 sind erlaubt.",
      }
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      return { ok: false, error: "Dieser Hostname ist nicht erlaubt." }
    if (
      isIP(host) ||
      /^(?:0x[\da-f]+|0[0-7]+|\d+)(?:\.(?:0x[\da-f]+|0[0-7]+|\d+))*$/i.test(
        host
      )
    )
      return { ok: false, error: "IP-Adressen sind nicht erlaubt." }
    const allow = process.env.CONNECTOR_ALLOW_HOSTS
    if (allow) {
      const hosts = allow
        .split(",")
        .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ""))
      if (!hosts.includes(host))
        return {
          ok: false,
          error: "Dieser Host steht nicht auf der Freigabeliste.",
        }
    }
    return { ok: true, value: url, host }
  } catch {
    return {
      ok: false,
      error: "Die Konnektor-URL ist ungültig oder der Host nicht erreichbar.",
    }
  }
}

export async function resolveConnectorUrl(
  input: string,
  resolver: typeof lookup = lookup
): Promise<UrlResult> {
  const inspected = inspectConnectorUrl(input)
  if (!inspected.ok) return inspected
  try {
    const addresses = await resolver(inspected.host, {
      all: true,
      verbatim: true,
    })
    if (
      !addresses.length ||
      addresses.some(({ address }) => privateAddress(address))
    )
      return {
        ok: false,
        error:
          "Der Hostname verweist auf einen nicht erlaubten Netzwerkbereich.",
      }
    return {
      ok: true,
      value: inspected.value,
      host: inspected.host,
      addresses,
    }
  } catch {
    return {
      ok: false,
      error: "Die Konnektor-URL ist ungültig oder der Host nicht erreichbar.",
    }
  }
}

export const guardConnectorUrl = resolveConnectorUrl

export { privateAddress }
