// Bilder der Web-Einstellungen je Reiter (768 × 576, 1×) und Messwerte der Reiter-Elemente. Aufruf:
// node shots-settings-web.mjs <Ordner> [dark|light] [Reiter,…]
// Braucht puppeteer-core und Google Chrome; nur gegen die Web-Seite mit ORBIT_DATA_DIR der Testkopie (siehe CONVENTIONS).
import puppeteer from "puppeteer-core"
import fs from "fs"
const [outDir, scheme = "dark", only] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const SECTIONS = { usage: "Nutzung", jev: "Jev", orbis: "Orbis-Anleitung", skills: "Skills", connectors: "Konnektoren", approvals: "Freigaben", marketplace: "Marktplatz", appearance: "Darstellung" }
const wanted = only ? only.split(",") : Object.keys(SECTIONS)
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-first-run", "--disable-gpu"] })
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
await p.evaluateOnNewDocument(() => { try { localStorage.setItem("theme", "system") } catch {} })
// /geplant: kein offener Chat, also kein Orbi-Akzent (applyAccent(null)) wie im nativen Fenster ohne Auswahl.
await p.goto("http://localhost:3000/geplant", { waitUntil: "networkidle2", timeout: 120000 })
await p.addStyleTag({ content: "nextjs-portal{display:none!important}" })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(2000)
await p.click('[aria-label="Einstellungen"]')
await wait(800)
const R = {}
for (const key of wanted) for (let attempt = 0; attempt < 3; attempt++) try {
  const label = SECTIONS[key]
  await p.evaluate((label) => { [...document.querySelectorAll('nav[aria-label="Einstellungen"] button')].find((x) => x.textContent.trim() === label)?.click() }, label)
  await wait(key === "usage" ? 3500 : 1500)
  if (key === "connectors") {
    // Alle Konnektoren testen (Aktionen → Testen), wie die native Szene.
    const n = await p.$$eval('[role=dialog] button[aria-label$=": Aktionen"]', (x) => x.length)
    for (let i = 0; i < n; i++) {
      const buttons = await p.$$('[role=dialog] button[aria-label$=": Aktionen"]')
      await buttons[i].click(); await wait(300)
      await p.evaluate(() => { [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.includes("Testen"))?.click() })
      await wait(2500)
    }
  }
  // Nur der Inhalt unter der Web-Kopfzeile (45 hoch): nativ liefert das Systemfenster die Titelzeile.
  const box = await (await p.$('[role=dialog]')).boundingBox()
  await p.screenshot({ path: `${outDir}/web-${key}-${scheme}.png`, clip: { x: box.x, y: box.y + 45, width: box.width, height: box.height - 45 } })
  R[key] = await p.evaluate(() => {
    const d = document.querySelector('[role=dialog]'), out = []
    d.querySelectorAll("h2, h3, button, article, label, p, [data-slot]").forEach((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
      out.push({ tag: el.tagName, text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), rect: [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(1)), fontSize: cs.fontSize, fontWeight: cs.fontWeight })
    })
    return out
  })
  break
} catch (e) {
  // next dev lädt beim ersten Aufruf manchmal neu (Ausführungskontext weg): Dialog neu öffnen und wiederholen.
  console.error(`${key}: ${e.message.slice(0, 80)} (Versuch ${attempt + 1})`)
  await p.goto("http://localhost:3000/geplant", { waitUntil: "networkidle2" }); await wait(2000)
  await p.click('[aria-label="Einstellungen"]'); await wait(800)
}
fs.writeFileSync(`${outDir}/web-einstellungen-${scheme}.json`, JSON.stringify(R, null, 1))
await b.close()
