type SandboxReadResult =
  | { kind: "file"; size: number; data: string }
  | { kind: "directory" }
  | { kind: "too_large" }

export function parseBoundedSandboxRead(output: string, maxBytes: number) {
  let parsed: SandboxReadResult
  try {
    parsed = JSON.parse(output) as SandboxReadResult
  } catch {
    throw new Error("Datei konnte nicht freigegeben werden.")
  }
  if (parsed.kind === "directory")
    throw new Error("Das ist ein Ordner. Packe ihn zuerst, z. B. mit `zip -r`.")
  if (parsed.kind === "too_large")
    throw new Error(
      `Datei ist größer als ${Math.floor(maxBytes / 1024 / 1024)} MB.`
    )
  if (
    parsed.kind !== "file" ||
    !Number.isInteger(parsed.size) ||
    parsed.size < 0 ||
    parsed.size > maxBytes
  )
    throw new Error("Datei konnte nicht freigegeben werden.")
  const bytes = Buffer.from(parsed.data, "base64")
  if (bytes.length !== parsed.size || bytes.length > maxBytes)
    throw new Error("Datei konnte nicht freigegeben werden.")
  return { size: bytes.length, data: parsed.data }
}
