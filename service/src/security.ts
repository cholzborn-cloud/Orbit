import { constants } from "node:fs"
import { mkdir, open } from "node:fs/promises"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

export const WEB_ORIGIN = "http://localhost:3000"

// Der OAuth-Rücksprung ist ein Browser-Redirect ohne Token; Host und Origin gelten auch dort.
export const isOAuthCallback = (request: Request) =>
  request.method === "GET" &&
  new URL(request.url).pathname === "/oauth/callback"

export function validateRequest(
  request: Request,
  token: string,
  port: number
): 401 | 403 | null {
  if (request.headers.get("host") !== `127.0.0.1:${port}`) return 403
  const origin = request.headers.get("origin")
  if (origin !== null && origin !== WEB_ORIGIN) return 403
  if (isOAuthCallback(request)) return null
  const authorization = request.headers.get("authorization") ?? ""
  const expected = Buffer.from(`Bearer ${token}`)
  const supplied = Buffer.from(authorization)
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
    ? null
    : 401
}

export async function loadServiceToken(
  dataDir = process.env.ORBIT_DATA_DIR ??
    join(homedir(), "Library", "Application Support", "Orbit")
): Promise<string> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const path = join(dataDir, "service.token")
  let handle
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    )
    await handle.writeFile(randomBytes(32).toString("hex"))
    await handle.sync()
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error
  } finally {
    await handle?.close()
  }
  const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await existing.stat()
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.()
    ) {
      throw new Error(
        "service.token muss dem aktuellen Benutzer gehören und Rechte 0600 haben."
      )
    }
    const token = await existing.readFile("utf8")
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new Error("service.token ist ungültig.")
    return token
  } finally {
    await existing.close()
  }
}
