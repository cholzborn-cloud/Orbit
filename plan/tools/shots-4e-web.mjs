// Web-Bilder für 4e (1280 × 800, 2×): geplant, verlauf, formular, suche, palette. Aufruf: node shots-4e-web.mjs <Ordner> <dark|light> [Szenen,…]
// Nur gegen die Web-Seite mit ORBIT_DATA_DIR der Testkopie (siehe CONVENTIONS); Beispieldaten per seed-4e.mjs.
import puppeteer from "puppeteer-core"
import fs from "fs"
const [outDir, scheme = "dark", only] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const scenes = only ? only.split(",") : ["geplant", "verlauf", "formular", "suche", "palette"]
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-first-run", "--disable-gpu"] })
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
await p.evaluateOnNewDocument(() => { try { localStorage.setItem("theme", "system") } catch {} })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const open = async (path) => {
  await p.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle2", timeout: 120000 })
  await p.addStyleTag({ content: "nextjs-portal{display:none!important} *{scrollbar-width:none!important}" })
  await wait(1500)
}
const shot = (name) => p.screenshot({ path: `${outDir}/web-${name}-${scheme}.png` })
for (const scene of scenes) {
  if (scene === "geplant" || scene === "verlauf" || scene === "formular") {
    await open("/geplant")
    if (scene === "verlauf") {
      await p.evaluate(() => { [...document.querySelectorAll("li")].find((li) => li.textContent.includes("Morgenbriefing"))?.querySelectorAll('button')?.forEach((x) => x.textContent.trim() === "Verlauf" && x.click()) })
      await wait(1200)
    }
    if (scene === "formular") {
      await p.evaluate(() => { [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Neue Automation"))?.click() })
      await wait(1000)
    }
  }
  if (scene === "computer" || scene === "computer-vollbild") {
    // Chat des Hauptorbis, Pille im Kopf öffnet das Panel, Reiter „Computer“ lädt das iframe (dauert, Sandbox).
    await open("/")
    await p.evaluate(() => { document.querySelector('[aria-label="Hauptorbi"]'); [...document.querySelectorAll("main button, header button")].find((x) => /Nepi/.test(x.textContent))?.click() })
    await wait(1500)
    await p.evaluate(() => { [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === "Computer")?.click() })
    await wait(14000)
    if (scene === "computer-vollbild") {
      await p.evaluate(() => document.querySelector('[aria-label="Computer im Vollbild öffnen"]')?.click())
      await wait(6000)
    }
  }
  if (scene === "suche" || scene === "palette") {
    // Chat des Hauptorbis: erster Link der Seitenleiste.
    await open("/")
    await wait(1500)
    if (scene === "suche") {
      await p.type('input[aria-label="Chats und Nachrichten durchsuchen"]', "Quarkkuchen")
      await wait(2500)
    } else {
      await p.keyboard.down("Control"); await p.keyboard.press("k"); await p.keyboard.up("Control")
      await wait(1000)
    }
  }
  await shot(scene)
}
await b.close()
