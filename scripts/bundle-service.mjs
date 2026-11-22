// Bündelt den Dienst (service/src/index.ts) zu einer Datei und legt better-sqlite3 (nativ, vorübersetzt) daneben.
// Aufruf: node scripts/bundle-service.mjs <Zielordner>   (die App legt ihn nach Contents/Resources/service)
import fs from "node:fs"
import path from "node:path"
import { build } from "esbuild"

const out = path.resolve(process.argv[2] ?? "build/service")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

await build({
  entryPoints: ["service/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfig: "service/tsconfig.json",
  outfile: path.join(out, "orbitd.mjs"),
  external: ["better-sqlite3", "sharp"],
  // Manche Pakete laden per require(); im ES-Modul gibt es das nicht von selbst.
  banner: { js: "import { createRequire as __orbitRequire } from 'node:module'; const require = __orbitRequire(import.meta.url); const __filename = import.meta.filename; const __dirname = import.meta.dirname;" },
  logLevel: "warning",
})

// Datenbank-Migrationen (der Dienst findet sie über ORBIT_MIGRATIONS_DIR).
fs.cpSync("drizzle/sqlite", path.join(out, "drizzle/sqlite"), { recursive: true, filter: (file) => !/ \d+(\.\w+)?$/.test(file) })

// Native Pakete bleiben draußen und werden samt Laufzeit-Abhängigkeiten nach node_modules neben das Bündel kopiert (nur macOS arm64,
// ohne iCloud-Konfliktkopien „Name 2.js“ und ohne Quellen zum Übersetzen).
const nativePackages = ["better-sqlite3", "sharp"]
const foreign = /(linux|win32|darwin-x64|musl|wasm32|s390x|ppc64|arm$|riscv)/
const copied = new Set()
function copyPackage(name) {
  if (copied.has(name)) return
  const src = path.resolve("node_modules", name)
  if (!fs.existsSync(src)) return
  copied.add(name)
  const dst = path.join(out, "node_modules", name)
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (file) => {
      const rel = path.relative(src, file)
      if (/ \d+(\.\w+)?$/.test(file) || path.basename(file) === ".bin") return false
      if (/^(src|deps|build|docs|test|tests)(\/|$)/.test(rel)) return false
      if (name === "better-sqlite3" && rel.startsWith("prebuilds") && rel !== "prebuilds" && !rel.includes("darwin-arm64")) return false
      return true
    },
  })
  const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"))
  // Hat das Paket seine eigene Fassung in node_modules (sharp/semver), wird sie mitkopiert und die oberste nicht gebraucht.
  const own = (dep) => fs.existsSync(path.join(src, "node_modules", dep))
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (!own(dep)) copyPackage(dep)
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) if (!foreign.test(dep)) copyPackage(dep)
}
nativePackages.forEach(copyPackage)
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "module", private: true }) + "\n")
console.log(`Dienst gebündelt: ${out} (${(fs.statSync(path.join(out, "orbitd.mjs")).size / 1e6).toFixed(1)} MB Code, Pakete: ${[...copied].join(", ")})`)
