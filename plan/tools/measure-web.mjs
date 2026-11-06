// Misst benannte Elemente der Web-UI (localhost:3000) per DOM und schreibt Rahmen plus Stilwerte als JSON.
// Aufruf: node measure-web.mjs <chatId> <out.json> [dark|light] [breite] [höhe] [panel]
// „panel“ (4g): klappt vorher das rechte Panel auf und misst es mit (side-panel, panel-tabs).
// Braucht puppeteer-core (npm i puppeteer-core in einem Temp-Ordner) und Google Chrome. Nur gegen eine Datenbankkopie laufen lassen.
import puppeteer from "puppeteer-core"
import fs from "fs"

const [chatId, out, scheme = "dark", width = "1280", height = "3200", action = ""] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-first-run", "--disable-gpu"] })
const page = await browser.newPage()
await page.setViewport({ width: +width, height: +height, deviceScaleFactor: 1 })
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
await page.evaluateOnNewDocument((s) => { try { localStorage.setItem("theme", s) } catch {} }, scheme)
await page.goto(`http://localhost:3000/chats/${chatId}`, { waitUntil: "networkidle2", timeout: 120000 })
// Überlagernde Rollbalken wie bei Trackpad-Einstellung: klassische Balken reservieren sonst 15 px je Rand (scrollbar-gutter: stable both-edges).
await page.addStyleTag({ content: "*{scrollbar-width:none!important;scrollbar-gutter:auto!important}" })
await new Promise((r) => setTimeout(r, 2500))
if (action === "panel") { await page.evaluate(() => document.querySelector('button[class*="rounded-[22px]"]').click()); await new Promise((r) => setTimeout(r, 900)) }

const data = await page.evaluate(() => {
  const q = (s, root = document) => root.querySelector(s)
  const byText = (selector, text, root = document) => [...root.querySelectorAll(selector)].find((e) => e.textContent.includes(text))
  const up = (el, test) => { while (el && !test(el)) el = el.parentElement; return el }
  const bubbleOf = (text) => up(byText("p", text), (e) => e.className.includes("w-fit"))
  const cardOf = (text, cls) => up(byText("p,span", text), (e) => e.className.includes(cls))
  const rows = [...document.querySelectorAll('a[data-slot="sidebar-menu-button"]')].filter((a) => a.getAttribute("href")?.startsWith("/chats/"))
  const avatars = q("div.pointer-events-none.absolute.flex")
  const els = {
    window: document.body,
    sidebar: q('[data-slot="sidebar-inner"]'),
    "sidebar-brand": byText('[data-slot="sidebar-header"] span', "Orbit"),
    "main-card": up(q('a[aria-label="Nepi"]'), (e) => e.className.includes("rounded-2xl")),
    "chat-row-0": rows[0], "chat-row-1": rows[1], "chat-row-2": rows[2],
    "header-pill": q('button[class*="rounded-[22px]"]'),
    "header-avatar": avatars,
    "bubble-user": bubbleOf("Zeig mir alle Karten"),
    "bubble-assistant": bubbleOf("Ich brauche deine Freigabe"),
    "approval-card": up(byText("p", "möchte bash"), (e) => e.tagName === "SECTION"),
    "tool-row": up(byText("span", "Befehl: echo hallo"), (e) => e.dataset.slot === "collapsible"),
    "ask-card": cardOf("Welche Farbe", "rounded-2xl"),
    "handoff-card": up(byText("span", "Zeno hat das übernommen"), (e) => e.dataset.slot === "collapsible"),
    "search-card": up(byText("span", "Websuche: Hono"), (e) => e.tagName === "SECTION"),
    "error-card": [...document.querySelectorAll("div")].find((d) => d.className.includes("border-destructive") && d.textContent.includes("Bildgenerierung")),
    "jev-block": up(byText("span", "Jev: Haiku"), (e) => e.className.includes("bg-muted")),
    image: q("main img[alt]") || [...document.querySelectorAll("main img")].find((i) => i.getBoundingClientRect().width > 300),
    composer: q('[data-slot="input-group"]'),
    "composer-send": [...document.querySelectorAll('[data-slot="input-group-addon"] button')].at(-1),
    "side-panel": [...document.querySelectorAll('[data-slot="resizable-panel"]')].at(-1),
    "panel-tabs": q('[data-slot="tabs-list"]'),
  }
  const keys = ["fontFamily","fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderRadius","boxShadow","backdropFilter","paddingTop","paddingRight","paddingBottom","paddingLeft","gap"]
  const cv = document.createElement("canvas"); cv.width = cv.height = 1
  const cx = cv.getContext("2d", { willReadFrequently: true })
  const rgb = (c) => { if (!c || c === "rgba(0, 0, 0, 0)") return ""; cx.clearRect(0,0,1,1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return "#" + [d[0],d[1],d[2]].map(v => v.toString(16).padStart(2,"0")).join("") + (d[3] < 255 ? "/" + (d[3]/255).toFixed(2) : "") }
  const res = {}
  for (const [name, el] of Object.entries(els)) {
    if (!el) { res[name] = null; continue }
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    const style = {}
    for (const k of keys) style[k] = cs[k]
    for (const k of ["color","backgroundColor","borderTopColor"]) style[k] = rgb(cs[k])
    res[name] = { x: +r.x.toFixed(1), y: +(r.y + scrollY).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), style }
  }
  return res
})
if (action !== "panel") { delete data["side-panel"]; delete data["panel-tabs"] }
fs.writeFileSync(out, JSON.stringify({ scheme, size: [+width, +height], elements: data }, null, 1))
console.log(Object.entries(data).map(([k, v]) => `${k}: ${v ? [v.x, v.y, v.w, v.h].join(",") : "FEHLT"}`).join("\n"))
await browser.close()
