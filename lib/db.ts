import "server-only"

import { getDatabase } from "./db/client.ts"

export const db = getDatabase()
