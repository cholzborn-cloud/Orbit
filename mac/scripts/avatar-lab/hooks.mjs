import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
export async function resolve(specifier, context, next) {
  const rel = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
  if (rel && !/\.(ts|json|js|mjs)$/.test(specifier) && context.parentURL) {
    const base = specifier.startsWith('/') ? specifier : fileURLToPath(new URL(specifier, context.parentURL))
    for (const ext of ['.ts', '/index.ts']) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context)
  }
  return next(specifier, context)
}
