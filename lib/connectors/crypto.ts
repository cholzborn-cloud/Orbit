import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto"

type CryptoResult<T> = { ok: true; value: T } | { ok: false; error: string }

function secretKey(secret = process.env.CONNECTOR_SECRET): Buffer | null {
  if (!secret) return null
  const key = /^[\da-f]{64}$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : /^[A-Za-z\d+/]{43}=$/.test(secret)
      ? Buffer.from(secret, "base64")
      : null
  return key?.length === 32 ? key : null
}

export function encryptConnectorAuth(value: string): CryptoResult<string> {
  const key = secretKey()
  if (!key)
    return { ok: false, error: "CONNECTOR_SECRET fehlt oder ist ungültig." }
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ])
    return {
      ok: true,
      value: `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`,
    }
  } catch {
    return { ok: false, error: "Token konnte nicht verschlüsselt werden." }
  }
}

export function decryptConnectorAuth(value: string): CryptoResult<string> {
  const key = secretKey()
  if (!key)
    return { ok: false, error: "CONNECTOR_SECRET fehlt oder ist ungültig." }
  try {
    const [version, ivText, tagText, dataText, extra] = value.split(":")
    if (
      version !== "v1" ||
      !ivText ||
      !tagText ||
      dataText === undefined ||
      extra
    )
      return { ok: false, error: "Tokenformat wird nicht unterstützt." }
    const iv = Buffer.from(ivText, "base64url")
    const tag = Buffer.from(tagText, "base64url")
    const ciphertext = Buffer.from(dataText, "base64url")
    if (iv.length !== 12 || tag.length !== 16)
      return { ok: false, error: "Tokenformat ist ungültig." }
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    return {
      ok: true,
      value: Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8"),
    }
  } catch {
    return { ok: false, error: "Token ist ungültig oder wurde verändert." }
  }
}
