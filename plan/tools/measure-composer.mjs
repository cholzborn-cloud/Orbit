// Misst den Composer der Web-UI (Rahmen, Stilwerte, Menüs, Anhänge) und legt Bilder ab. Aufruf: node measure-composer.mjs <chatId> <Ordner> [dark|light] [breite]
// Braucht puppeteer-core und Google Chrome; nur gegen eine Datenbankkopie.
import puppeteer from "puppeteer-core"
import fs from "fs"
const [chatId, outDir, scheme = "dark", width = "1280"] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const b = await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-first-run","--disable-gpu"]})
const p = await b.newPage(); await p.setViewport({width:+width,height:900,deviceScaleFactor:2})
await p.emulateMediaFeatures([{name:"prefers-color-scheme",value:scheme}])
await p.evaluateOnNewDocument((s)=>{try{localStorage.setItem("theme",s)}catch{}},scheme)
await p.goto(`http://localhost:3000/chats/${chatId}`,{waitUntil:"networkidle2",timeout:120000})
await p.addStyleTag({content:"nextjs-portal{display:none!important}"})
const wait=ms=>new Promise(r=>setTimeout(r,ms)); await wait(2500)
const R={}
const keys=["fontSize","fontWeight","lineHeight","color","backgroundColor","borderTopWidth","borderTopColor","borderRadius","paddingTop","paddingLeft","paddingRight","height","width","gap","boxShadow","opacity"]
const info = (sel)=>p.evaluate((sel,keys)=>{const out=[];document.querySelectorAll(sel).forEach(el=>{const cs=getComputedStyle(el),r=el.getBoundingClientRect();const o={sel,text:(el.getAttribute("aria-label")||el.textContent||"").trim().slice(0,40),rect:[r.x,r.y,r.width,r.height].map(v=>+v.toFixed(1))};keys.forEach(k=>o[k]=cs[k]);out.push(o)});return out},sel,keys)
const shot=async(n)=>{await p.screenshot({path:`${outDir}/${n}-${scheme}.png`})}
R.composer=await info(".chat-prompt, .chat-prompt *[data-slot], .chat-prompt button, .chat-prompt textarea")
await shot("web-composer")
// Freigabe-Modus
await p.click('[aria-label="Freigabe-Modus wählen"]'); await wait(500)
R.mode=await info('[role=listbox][aria-label="Freigabe-Modus"], [role=listbox][aria-label="Freigabe-Modus"] button')
await shot("web-modus"); await p.keyboard.press("Escape"); await wait(300)
// Modell
await p.click('[aria-label="Modell wählen"]'); await wait(500)
R.model1=await info('[data-slot=popover-content], [data-slot=popover-content] *[role=slider], [data-slot=popover-content] button')
await shot("web-modell")
const head=await p.$('[data-slot=popover-content] button'); if(head){await head.click(); await wait(500)}
R.model2=await info('[data-slot=popover-content], [data-slot=popover-content] [role=option], [data-slot=popover-content] p')
await shot("web-modell-liste"); await p.keyboard.press("Escape"); await wait(300)
// Slash
const ta=await p.$("textarea"); await ta.click(); await ta.type("/"); await wait(800)
R.slash=await info('[role=listbox][aria-label="Skills"], [role=listbox][aria-label="Skills"] button, [role=listbox][aria-label="Skills"] p')
await shot("web-slash")
// Anhang
await ta.evaluate(e=>{e.value=""}); await p.keyboard.press("Escape")
fs.writeFileSync(`${outDir}/probe.png`,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64"))
fs.writeFileSync(`${outDir}/notiz.txt`,"Hallo")
const inp=await p.$('input[type=file]'); await inp.uploadFile(`${outDir}/probe.png`,`${outDir}/notiz.txt`); await wait(800)
R.attach=await info('.chat-prompt [data-slot], .chat-prompt header, .chat-prompt header *')
await shot("web-anhang")
fs.writeFileSync(`${outDir}/web-composer.json`,JSON.stringify(R,null,1))
await b.close()
