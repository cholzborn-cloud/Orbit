// Misst Zustände (normal/hover/aktiv/fokus/deaktiviert), offene Menüs/Panels/Dialoge und Animationen (getAnimations) der Web-UI.
// node states.mjs <chatId> <groupId> <out.json> [dark|light]
import puppeteer from "puppeteer-core"
import fs from "fs"
const [chatId, groupId, out, scheme = "dark"] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-first-run", "--disable-gpu"] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
await page.evaluateOnNewDocument((s) => { try { localStorage.setItem("theme", s) } catch {} }, scheme)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const R = {}
await page.goto(`http://localhost:3000/chats/${chatId}`, { waitUntil: "networkidle2", timeout: 120000 })
await wait(2000)
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
const inject = () => page.evaluate(() => {
  const keys = ["fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderRadius","boxShadow","outline","outlineOffset","transform","translate","opacity","paddingTop","paddingLeft","height","width","transitionProperty","transitionDuration","transitionTimingFunction","backdropFilter"]
  const cv = document.createElement("canvas"); cv.width = cv.height = 1
  const cx = cv.getContext("2d", { willReadFrequently: true })
  const rgb = (c) => { if (!c || c === "rgba(0, 0, 0, 0)") return ""; cx.clearRect(0,0,1,1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return "#" + [d[0],d[1],d[2]].map(v => v.toString(16).padStart(2,"0")).join("") + (d[3] < 255 ? "/" + (d[3]/255).toFixed(2) : "") }
  window.__st = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), o = { rect: [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(1)) }
    for (const k of keys) o[k] = cs[k]
    for (const k of ["color","backgroundColor","borderTopColor"]) o[k] = rgb(cs[k])
    return o
  }
  window.__anims = () => document.getAnimations().map((a) => {
    const t = a.effect?.getTiming?.() ?? {}, el = a.effect?.target
    return { name: a.animationName || a.transitionProperty || a.constructor.name, dur: t.duration, delay: t.delay, easing: t.easing, iter: t.iterations, target: el ? (el.dataset?.slot || el.getAttribute?.("class")?.slice(0, 60) || el.tagName) : "", kf: (a.effect?.getKeyframes?.() ?? []).map((k) => ({ o: k.offset, e: k.easing, t: k.transform, op: k.opacity, tr: k.translate, s: k.scale, ...(k.flexGrow ? { fg: k.flexGrow } : {}) })).slice(0, 12), ease2: el ? getComputedStyle(el).animationTimingFunction : "" }
  })
})
await inject()
const st = (sel) => page.evaluate((s) => window.__st(typeof s === "string" ? document.querySelector(s) : null), sel)
const stEl = (h) => page.evaluate((e) => window.__st(e), h)
const anims = () => page.evaluate(() => window.__anims())
const byText = (sel, text) => page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t || e.getAttribute("aria-label") === t) ?? null, sel, text)
let step = 0
const clk = async (h) => { step++; if (!(await h.evaluate((e) => !!e))) { console.log("FEHLT Klickziel", step); return } await h.evaluate((x) => x.click()) }
const states = async (name, h) => {
  if (!h || !(await h.evaluate((e) => !!e))) { R[name] = null; return }
  const o = { normal: await stEl(h) }
  const box = await h.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await wait(400)
  o.hover = await stEl(h)
  await page.mouse.down(); await wait(80); o.active = await stEl(h); await page.mouse.up()
  await page.mouse.move(5, 895); await wait(300)
  await h.evaluate((e) => e.blur?.())
  R[name] = o
}

try {
// Kopf-Pille: Zustände, dann Klick -> Panel mit Übergängen
const pill = await page.$('button[class*="rounded-[22px]"]')
await states("header-pill", pill)
await pill.click(); await wait(30)
R["panel-open-anims"] = await anims()
await wait(700)
R["panel"] = await page.evaluate(() => { const p = [...document.querySelectorAll('[data-slot="resizable-panel"]')].at(-1); return window.__st(p) })
R["panel-tabs"] = await st('[data-slot="tabs-list"]')
R["panel-tab-indicator"] = await page.evaluate(() => window.__st(document.querySelector('[data-slot="tabs-list"] > span, [data-slot="tabs-list"] [class*="active-tab"]')))
R["panel-tab-active"] = await st('[data-slot="tabs-trigger"][data-active]')
R["panel-tab-inactive"] = await st('[data-slot="tabs-trigger"]:not([data-active])')
R["panel-fields"] = await page.evaluate(() => [...document.querySelectorAll('[data-panel] [data-slot="field"]')].slice(0, 8).map((f) => ({ label: f.querySelector("label")?.textContent, rect: window.__st(f).rect })))
R["panel-buttons"] = await page.evaluate(() => [...document.querySelectorAll('[data-panel] button[data-slot="button"]')].map((b) => ({ text: b.textContent.trim().slice(0, 30), st: window.__st(b) })))
// Knopfvarianten aus dem Panel: Zustände
for (const t of ["Speichern", "Abbrechen", "Löschen", "Verlauf leeren"]) await states("btn-" + t, await byText('[data-panel] button[data-slot="button"]', t))
// Schalter, Eingabe
const sw = await page.$('[data-panel] [data-slot="switch"]')
await states("switch", sw)
R["switch-thumb"] = await st('[data-panel] [data-slot="switch-thumb"]')
const input = await page.$('[data-panel] input[data-slot="input"]')
await states("input", input)
await input.click(); await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift"); await page.keyboard.press("Tab"); await wait(200)
R["input-focus"] = await page.evaluate(() => window.__st(document.activeElement))
// AlertDialog: Verlauf leeren (nur öffnen, abbrechen)
await clk(await byText('button[data-slot="button"]', "Verlauf leeren")); await wait(20)
R["alert-open-anims"] = await anims()
await wait(300)
R["alert"] = await st('[data-slot="alert-dialog-content"]')
R["alert-overlay"] = await st('[data-slot="alert-dialog-overlay"]')
R["alert-title"] = await st('[data-slot="alert-dialog-title"]')
R["alert-desc"] = await st('[data-slot="alert-dialog-description"]')
R["alert-buttons"] = await page.evaluate(() => [...document.querySelectorAll('[data-slot="alert-dialog-content"] button')].map((b) => ({ text: b.textContent.trim(), st: window.__st(b) })))
R["alert-footer"] = await st('[data-slot="alert-dialog-footer"]')
await clk(await byText('[data-slot="alert-dialog-content"] button', "Abbrechen")); await wait(20)
R["alert-close-anims"] = await anims()
await wait(400)
// Tab "Computer": Indikator gleitet
const tabComputer = await byText('[data-slot="tabs-trigger"]', "Computer")
await tabComputer.click(); await wait(20)
R["tab-switch-anims"] = await anims()
await wait(400)
R["computer-skeleton"] = await page.evaluate(() => window.__st(document.querySelector('[data-slot="skeleton"]')))
await clk(await byText('[data-slot="tabs-trigger"]', "Bearbeiten")); await wait(600)
R["computer-error"] = await page.evaluate(() => document.querySelector('[data-slot="tabs-content"]:not([hidden]) [role="alert"], [data-slot="alert"]')?.textContent)
// Panel schließen
await pill.click(); await wait(30); R["panel-close-anims"] = await anims(); await wait(700)

// Plus-Menü
const plus = await page.$('button[aria-label="Neu erstellen"]')
await states("plus", plus)
await page.keyboard.press("Escape"); await wait(400)
await plus.click(); await wait(20)
R["menu-open-anims"] = await anims()
await wait(300)
R["menu"] = await st('[data-slot="dropdown-menu-content"]')
const items = await page.$$('[data-slot="dropdown-menu-item"]')
R["menu-item"] = await stEl(items[0])
const ib = await items[0].boundingBox(); await page.mouse.move(ib.x + 10, ib.y + 5); await wait(200)
R["menu-item-hover"] = await stEl(items[0])
R["menu-item-icon"] = await page.evaluate(() => window.__st(document.querySelector('[data-slot="dropdown-menu-item"] svg')))
await page.keyboard.press("Escape"); await wait(20); R["menu-close-anims"] = await anims(); await wait(300)

// Nachricht: Aktionen beim Überfahren
const bubble = await byText("p", "Zeig mir alle Karten.")
const bb = await bubble.boundingBox()
R["msg-actions-before"] = await page.evaluate(() => window.__st(document.querySelector('[class*="group-hover:opacity-100"]')))
await page.mouse.move(bb.x + 5, bb.y + 5); await wait(20); R["msg-hover-anims"] = await anims(); await wait(300)
R["msg-actions-after"] = await page.evaluate(() => window.__st(document.querySelector('[class*="group-hover:opacity-100"]')))
R["msg-action-btn"] = await page.evaluate(() => window.__st(document.querySelector('[class*="group-hover:opacity-100"] button')))
await page.mouse.move(5, 895); await wait(300)

// Seitenleiste: Zeile, Hauptkarte, Einklappen
await states("row", (await page.$$('a[data-slot="sidebar-menu-button"][href^="/chats/"]'))[1])
await states("main-card", await page.evaluateHandle(() => document.querySelector('a[aria-label][href^="/chats/"].absolute')?.parentElement ?? null))
const trigger = await page.$('[data-slot="sidebar-trigger"]')
await states("sidebar-trigger", trigger)
await trigger.click(); await wait(30); R["collapse-anims"] = await anims(); await wait(600)
R["sidebar-collapsed"] = await st('[data-slot="sidebar-container"]')
R["sidebar-gap-collapsed"] = await st('[data-slot="sidebar-gap"]')
R["row-collapsed"] = await page.evaluate(() => window.__st([...document.querySelectorAll('a[data-slot="sidebar-menu-button"][href^="/chats/"]')][1]))
const rc = await page.evaluate(() => { const r = [...document.querySelectorAll('a[data-slot="sidebar-menu-button"][href^="/chats/"]')][1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
await page.mouse.move(rc[0], rc[1]); await wait(30); R["tooltip-open-anims"] = await anims(); await wait(400)
R["tooltip"] = await st('[data-slot="tooltip-content"]')
await page.mouse.move(600, 895); await wait(300)
await page.$eval('[data-slot="sidebar-trigger"]', (e) => e.click()); await wait(30); R["expand-anims"] = await anims(); await wait(600)

// Orbi-Dialog: Schalter, Planet, Farbpunkt, Chips (Zustände), Dialog-Animation
await page.$eval('button[aria-label="Neu erstellen"]', (e) => e.click()); await wait(300)
await clk(await byText('[data-slot="dropdown-menu-item"]', "Neuen Orbi erstellen")); await wait(20)
R["dialog-open-anims"] = await anims(); await wait(400)
R["dialog"] = await st('[data-slot="dialog-content"]')
R["dialog-overlay"] = await st('[data-slot="dialog-overlay"]')
R["dialog-close"] = await st('[data-slot="dialog-close"]')
await states("dialog-close", await page.$('[data-slot="dialog-close"]'))
await states("chip", (await page.$$('[data-slot="dialog-content"] button[data-slot="button"]')).find(Boolean))
R["dialog-chips"] = await page.evaluate(() => [...document.querySelectorAll('[data-slot="dialog-content"] button')].slice(0, 30).map((b) => ({ text: b.textContent.trim().slice(0, 20), aria: b.getAttribute("aria-label"), st: window.__st(b) })))
await page.keyboard.press("Escape"); await wait(20); R["dialog-close-anims"] = await anims(); await wait(300)

// Gruppe: Panel mit Checkboxen, Zeilen-Hover-Knöpfe
if (groupId) {
  await page.goto(`http://localhost:3000/chats/${groupId}`, { waitUntil: "networkidle2", timeout: 120000 }); await wait(1500)
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  await inject()
  await (await page.$('button[class*="rounded-[22px]"]')).click(); await wait(800)
  R["group-panel-buttons"] = await page.evaluate(() => [...document.querySelectorAll('[data-panel] button')].map((b) => ({ text: (b.textContent.trim() || b.getAttribute("aria-label") || "").slice(0, 30), st: window.__st?.(b) })))
  const cb = await page.$('[data-panel] [data-slot="checkbox"]')
  await states("checkbox", cb)
  const rowEl = await page.evaluateHandle(() => document.querySelector('[data-panel] [class*="group/row"]'))
  await states("group-row", rowEl)
}
} catch (e) { console.log("ABBRUCH", e.message) }
fs.writeFileSync(out, JSON.stringify(R, null, 1))
console.log(Object.keys(R).map((k) => k + (R[k] === null ? " FEHLT" : "")).join("\n"))
await browser.close()
