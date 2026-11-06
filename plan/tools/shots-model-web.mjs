// Web-Bilder der Modellwahl (Symbole, Gold der höchsten Stufe, Jev): node shots-model-web.mjs <Ordner> [dark|light]
// Nur gegen die Web-Seite mit ORBIT_DATA_DIR der Testkopie. Braucht puppeteer-core und Google Chrome.
import puppeteer from "puppeteer-core"
import fs from "fs"
const [outDir, scheme = "dark"] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-first-run", "--disable-gpu"] })
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
await p.evaluateOnNewDocument(() => { try { localStorage.setItem("theme", "system") } catch {} })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await p.goto("http://localhost:3000/", { waitUntil: "networkidle2", timeout: 120000 })
await p.addStyleTag({ content: "nextjs-portal{display:none!important}" })
await wait(2500)
const shot = (n) => p.screenshot({ path: `${outDir}/web-${n}-${scheme}.png` })
await p.click('[aria-label="Modell wählen"]'); await wait(600)
// Höchste Stufe: Regler per Taste „Ende“.
const slider = await p.$('[data-slot=popover-content] [role=slider]')
if (slider) { await slider.focus(); await p.keyboard.press("End"); await wait(700) }
await shot("modell-max")
const head = await p.$('[data-slot=popover-content] button'); if (head) { await head.click(); await wait(500) }
await shot("modell-liste")
// Auto (Jev)
await p.evaluate(() => { [...document.querySelectorAll('[role=option]')].find((x) => x.textContent.includes("Auto (Jev)"))?.click() }); await wait(800)
// Das Panel bleibt nach der Wahl offen; sonst neu öffnen.
if (!(await p.$('[data-slot=popover-content]'))) { await p.click('[aria-label="Modell wählen"]'); await wait(600) }
const listOpen = await p.$('[data-slot=popover-content] [role=listbox]')
if (listOpen) { const h = await p.$('[data-slot=popover-content] button'); if (h) { await h.click(); await wait(500) } }
await shot("modell-auto")
// Skill gewählt: Chip über dem Feld; Freigabe-Modus (Menüzeilen 40 hoch).
await p.keyboard.press("Escape"); await wait(300)
await p.reload({ waitUntil: "networkidle2" }); await wait(2000)
const ta = await p.$("textarea"); await ta.click(); await ta.type("/"); await wait(800)
await p.keyboard.press("Enter"); await wait(600)
await ta.type("Fasse das zusammen"); await wait(300)
await shot("chip")
await p.reload({ waitUntil: "networkidle2" }); await wait(2000)
await p.click('[aria-label="Freigabe-Modus wählen"]'); await wait(600)
await shot("modus")
await b.close()
