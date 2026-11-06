// Bildfolgen der Web-UI zu festen Zeitpunkten (Gegenstück zu `Orbit --bildfolgen`): Kopf bei Scroll 0/24/48/72/96,
// Wippen beim Arbeiten (orbi-bob, Tempo 1, Phase 0) und Tipp-Punkte; CSS-Animationen werden angehalten und auf die Zeit gesetzt.
// node frames-web.mjs <chatId> <Ordner> [dark|light]. Nur gegen eine Datenbankkopie. Braucht puppeteer-core und Google Chrome.
import puppeteer from "puppeteer-core"

const [chatId, dir, scheme = "dark"] = process.argv.slice(2)
const headerOffsets = [0, 24, 48, 72, 96]
const bobTimes = [0, 0.36, 0.88, 1.2, 2.12, 3.04]
const dotTimes = [0, 0.2, 0.36, 0.52, 0.68, 0.9]
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-first-run"] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 })
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }])
await page.evaluateOnNewDocument((s) => { try { localStorage.setItem("theme", s) } catch {} }, scheme)
await page.goto(`http://localhost:3000/chats/${chatId}`, { waitUntil: "load", timeout: 120000 })
await new Promise((r) => setTimeout(r, 3000))
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })

// Kopf: Scroll-Stellung direkt setzen (ohne Nutzergeste rastet nichts ein). Der Verlauf steht beim Laden unten.
await page.evaluate(() => { window.__conv = [...document.querySelectorAll("*")].find((e) => e.scrollTop > 0 && !e.closest('[data-slot="sidebar"]')) })
for (const [i, offset] of headerOffsets.entries()) {
  await page.evaluate((y) => {
    const el = window.__conv
    el.scrollTop = y
    el.dispatchEvent(new Event("scroll"))
  }, offset)
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: `${dir}/kopf-${i}-${scheme}.png`, clip: { x: 304, y: 0, width: 976, height: 207 } })
}

// Wippen: Figur der Seitenleisten-Zeile „Karti“ arbeitet, Tempo 1, Phase 0. Die CSS-Animationen werden als Web-Animationen
// mit denselben Keyframes nachgestellt (React setzt data-working selbst zurück) und auf t angehalten.
const box = await page.evaluate(() => {
  const row = [...document.querySelectorAll('a[data-slot="sidebar-menu-button"]')].find((a) => a.textContent.includes("Karti"))
  const s = row.querySelector(".orbi-status")
  const get = (name) => [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules] } catch { return [] } }).find((r) => r.type === 7 && r.name === name)
  const frames = (name) => [...get(name).cssRules].flatMap((k) => k.keyText.split(",").map((o) => ({ offset: parseFloat(o) / 100, transform: k.style.transform || undefined, opacity: k.style.opacity || undefined, easing: "ease-in-out" }))).sort((a, b) => a.offset - b.offset)
  const run = (sel, name, dur) => s.querySelectorAll(sel).forEach((el) => { window.__anims = (window.__anims || []).concat(el.animate(frames(name), { duration: dur, iterations: Infinity })) })
  run(".orbi-bob", "orbi-bob", 4000); run(".orbi-shadow", "orbi-shadow-pulse", 4000); run(".orbi-scan", "orbi-scan", 7300); run(".orbi-up", "orbi-look-up", 11700)
  const r = s.getBoundingClientRect()
  return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }
})
await page.mouse.move(5, 895)
await new Promise((r) => setTimeout(r, 300))
for (const [i, t] of bobTimes.entries()) {
  await page.evaluate((t) => { for (const a of window.__anims) { a.pause(); a.currentTime = t * 1000 } }, t)
  await page.screenshot({ path: `${dir}/wippen-${i}-${scheme}.png`, clip: box })
}

// Tipp-Punkte: dieselbe Blase wie TypingBubble, Animationen angehalten auf t.
const dots = await page.evaluate(() => {
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;left:600px;top:400px;z-index:99;padding:8px"
  host.className = "bg-background"
  host.innerHTML = '<div class="rounded-2xl rounded-tl-md bg-secondary px-4 py-2.5 text-foreground"><span class="flex h-4 items-center gap-[3px]">' +
    [0, 160, 320].map((d) => `<span class="typing-dot size-1 rounded-full bg-current" style="animation-delay:${d}ms"></span>`).join("") + "</span></div>"
  document.body.append(host)
  const r = host.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})
for (const [i, t] of dotTimes.entries()) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) if (a.effect?.target?.classList?.contains("typing-dot")) { a.pause(); a.currentTime = t * 1000 }
  }, t)
  await page.screenshot({ path: `${dir}/punkte-${i}-${scheme}.png`, clip: dots })
}
await browser.close()
console.log("fertig", dir, scheme)
