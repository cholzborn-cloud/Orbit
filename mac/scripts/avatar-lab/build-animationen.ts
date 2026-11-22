// Baut die Web-App avatar-animationen.html (alle Avatare × Zustände × 5 Animationsvarianten, mit Auswahl und Export).
// Nutzt die Export-Engine des Avatar-Labs, damit alles wie auf der Website animiert.
import { writeFileSync } from 'node:fs'
import { proceduralBrowserRuntime } from '$LAB/src/features/export/proceduralBrowserRuntime'
import { standaloneEngineSource } from '$LAB/src/features/export/standaloneEngine.generated'
import { defaultExpression } from '$LAB/src/features/avatar/presets'
import { avatarDefs } from './avatar-defs'
import { customAnimations, customExpressions, STATES } from './animations'

const IDS: Record<string, string> = { 'Grok bot': 'grokbot' }
const idOf = (name: string) => IDS[name] ?? name.toLowerCase()
const eyeFields = ['widthLeft', 'widthRight', 'heightLeft', 'heightRight', 'spacing', 'positionXLeft', 'positionXRight', 'positionYLeft', 'positionYRight', 'leftAngle', 'rightAngle']
const base: any = defaultExpression
const expressions: any[] = [defaultExpression, ...Object.values(customExpressions)]

const payloads: Record<string, any> = {}
for (const a of avatarDefs) {
  const exprs: Record<string, any> = {}
  for (const e of expressions) {
    const { semanticKey: _s, ...rest } = e as any
    const r: any = { ...rest }
    for (const f of eyeFields) r[f] = e[f] + (a.eyes[f] ?? base[f]) - base[f]
    if (e.id === 'expression-neutral') { r.widthLeft *= 1.15; r.widthRight *= 1.15; r.heightLeft *= 1.12; r.heightRight *= 1.12 }
    for (const f of ['widthLeft', 'widthRight', 'heightLeft', 'heightRight']) r[f] = Math.max(10, r[f])
    exprs[e.id] = r
  }
  const animations: Record<string, any> = structuredClone(customAnimations)
  payloads[idOf(a.name)] = { version: 1, avatar: { name: a.name, surface: a.body.primary, bodyNodes: a.body.nodes, colors: a.colors, renderStyle: { type: 'vector' } }, expressions: exprs, animations }
}

const NAMES: Record<string, string> = Object.fromEntries(Object.entries(customAnimations).map(([k, v]: any) => [k, v.name]))
const DESCR: Record<string, string> = Object.fromEntries(Object.entries(customAnimations).map(([k, v]: any) => [k, v.description]))
const AVATARS = avatarDefs.map((a: any) => ({ id: idOf(a.name), name: a.name, color: a.colors.body }))
const json = (v: unknown) => JSON.stringify(v).split('<').join('\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029')

const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avatar-Animationen</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#171a20;--mute:#6b7380;--line:#dfe3ea;--accent:#4d6fe0;--accent-bg:#eaf0ff;--stage:#f1f3f8}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--ink:#f1f3f7;--mute:#9099a8;--line:#2a313c;--accent:#7f9cff;--accent-bg:#1c2540;--stage:#11151b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding-bottom:110px}
header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.bar{max-width:1180px;margin:0 auto;padding:12px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0;letter-spacing:-.02em}
.tabs{display:flex;gap:4px;background:var(--stage);padding:3px;border-radius:10px;border:1px solid var(--line)}
button{font:inherit;color:inherit;cursor:pointer}
.tab{border:0;background:none;padding:6px 12px;border-radius:8px;font-weight:600;color:var(--mute)}.tab[aria-pressed=true]{background:var(--card);color:var(--ink);box-shadow:0 1px 3px #0002}
.chips{max-width:1180px;margin:0 auto;padding:0 20px 12px;display:flex;gap:8px;overflow-x:auto}
.chip{flex:none;width:74px;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:6px 4px 5px;text-align:center;font-size:11px;font-weight:600}
.chip .mini{width:46px;height:46px;margin:0 auto 2px}.chip[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent);background:var(--accent-bg)}
main{max-width:1180px;margin:0 auto;padding:18px 20px}
.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-left:auto;color:var(--mute);font-size:12px}
.tools input[type=color]{width:30px;height:26px;border:1px solid var(--line);border-radius:6px;padding:0;background:none}
.btn{border:1px solid var(--line);background:var(--card);padding:6px 11px;border-radius:9px;font-weight:600;font-size:13px}.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}
section.state{margin:6px 0 26px}.state h2{font-size:15px;margin:0;display:flex;align-items:baseline;gap:10px}.state h2 small{font-weight:500;color:var(--mute);font-size:12px}
.row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:10px}
.card{position:relative;border:1px solid var(--line);background:var(--card);border-radius:16px;padding:10px 10px 12px;text-align:left}
.card:hover{border-color:var(--accent)}.card[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 24%,transparent);background:var(--accent-bg)}
.stage{background:var(--stage);border-radius:11px;aspect-ratio:1;display:grid;place-items:center;overflow:hidden}.stage>div{width:78%;height:78%}
.card b{display:block;margin-top:8px;font-size:13px}.card span{color:var(--mute);font-size:11px}
.check{position:absolute;top:14px;right:14px;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;display:none;place-items:center;font-size:13px}.card[aria-pressed=true] .check{display:grid}
.grid15{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:14px}.grid15 .card{cursor:default}
.pick{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}.pick .btn[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
.dock{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);z-index:6}
.dock .in{max-width:1180px;margin:0 auto;padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sel{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--mute)}.sel i{font-style:normal;background:var(--stage);border:1px solid var(--line);border-radius:999px;padding:2px 9px;color:var(--ink)}
.sp{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}.toast{font-size:12px;color:var(--accent);min-width:90px}
@media(max-width:860px){.row,.grid15{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body>
<header><div class="bar"><h1>Avatar-Animationen</h1>
<div class="tabs" role="tablist"><button class="tab" data-view="avatar" aria-pressed="true">Pro Avatar</button><button class="tab" data-view="all" aria-pressed="false">Alle Avatare</button></div>
<div class="tools"><label>Farbe <input type="color" id="color"></label><button class="btn" id="resetColor">Originalfarbe</button></div></div>
<div class="chips" id="chips"></div></header>
<main id="main"></main>
<div class="dock"><div class="in"><div class="sel" id="sel"></div>
<div class="sp"><button class="btn" id="allV">Alle Zustände: Variante …</button><button class="btn" id="copy">JSON kopieren</button><button class="btn primary" id="download">Auswahl exportieren</button><span class="toast" id="toast"></span></div></div></div>
<script>${standaloneEngineSource}</script>
<script>
const RUNTIME = ${json(proceduralBrowserRuntime)};
const PAYLOADS = ${json(payloads)};
const STATES = ${json(STATES)};
const NAMES = ${json(NAMES)};
const DESCR = ${json(DESCR)};
const AVATARS = ${json(AVATARS)};
const mounts = {};
function mountFn(id, color){
  const key = id + '|' + (color || '');
  if (!mounts[key]) { const data = structuredClone(PAYLOADS[id]); if (color) data.avatar.colors.body = color; mounts[key] = new Function('DATA', RUNTIME + '\\nreturn mountAvatar;')(data); }
  return mounts[key];
}
const store = { get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
let view = 'avatar', avatar = store.get('avatar', 'strobi'), color = store.get('color:' + avatar, '');
let sel = store.get('sel', Object.fromEntries(STATES.map(s => [s.id, 0])));
let allState = 'working', allVariant = 0;
const $ = s => document.querySelector(s);
const live = new Map();
const io = new IntersectionObserver(entries => entries.forEach(e => {
  const host = e.target, o = host._spec; if (!o) return;
  if (e.isIntersecting && !live.has(host)) { try { live.set(host, mountFn(o.id, o.color)(host, { animation: o.anim, size: '100%', autoplay: o.play !== false })) } catch (err) { console.error(err) } }
  else if (!e.isIntersecting && live.has(host)) { live.get(host).destroy(); live.delete(host) }
}), { rootMargin: '200px' });
function clearLive(){ live.forEach(a => a.destroy()); live.clear(); io.disconnect() }
function stage(spec){ const w = document.createElement('div'); w.className = 'stage'; const h = document.createElement('div'); h._spec = spec; w.append(h); io.observe(h); return w }
function card(spec, title, sub, pressed, onclick){
  const b = document.createElement(onclick ? 'button' : 'div'); b.className = 'card';
  if (onclick) { b.setAttribute('aria-pressed', pressed); b.onclick = onclick }
  b.append(stage(spec)); const t = document.createElement('b'); t.textContent = title; const s = document.createElement('span'); s.textContent = sub;
  const c = document.createElement('div'); c.className = 'check'; c.textContent = '✓'; b.append(t, s, c); return b;
}
function renderChips(){
  const el = $('#chips'); el.replaceChildren();
  for (const a of AVATARS) { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', a.id === avatar);
    const m = document.createElement('div'); m.className = 'mini'; m._spec = { id: a.id, anim: 'idle', play: false }; b.append(m, a.name); io.observe(m);
    b.onclick = () => { avatar = a.id; color = store.get('color:' + avatar, ''); store.set('avatar', avatar); render() }; el.append(b) }
}
function renderSel(){
  $('#sel').replaceChildren(...STATES.map(s => { const i = document.createElement('i'); i.textContent = s.name + ': ' + NAMES[s.variants[sel[s.id]]] + ' (' + (sel[s.id] + 1) + ')'; return i }));
}
function renderMain(){
  const main = $('#main'); main.replaceChildren();
  if (view === 'avatar') {
    for (const s of STATES) {
      const sec = document.createElement('section'); sec.className = 'state';
      sec.innerHTML = '<h2>' + s.name + ' <small>' + s.hint + '</small></h2>'; const row = document.createElement('div'); row.className = 'row';
      s.variants.forEach((anim, i) => row.append(card({ id: avatar, anim, color }, 'Variante ' + (i + 1) + ' · ' + NAMES[anim], DESCR[anim], sel[s.id] === i, () => { sel[s.id] = i; store.set('sel', sel); renderSel(); [...row.children].forEach((c, k) => c.setAttribute('aria-pressed', k === i)) })));
      sec.append(row); main.append(sec);
    }
  } else {
    const st = STATES.find(s => s.id === allState);
    const top = document.createElement('div');
    top.innerHTML = '<div class="pick" id="pickState"></div><div class="pick" id="pickVar"></div>';
    main.append(top);
    const ps = top.querySelector('#pickState'), pv = top.querySelector('#pickVar');
    STATES.forEach(s => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = s.name; b.setAttribute('aria-pressed', s.id === allState); b.onclick = () => { allState = s.id; renderMain() }; ps.append(b) });
    st.variants.forEach((a, i) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Variante ' + (i + 1) + ' · ' + NAMES[a]; b.setAttribute('aria-pressed', i === allVariant); b.onclick = () => { allVariant = i; renderMain() }; pv.append(b) });
    const grid = document.createElement('div'); grid.className = 'grid15';
    for (const a of AVATARS) grid.append(card({ id: a.id, anim: st.variants[allVariant], color: '' }, a.name, st.name + ' · ' + NAMES[st.variants[allVariant]]));
    const use = document.createElement('button'); use.className = 'btn primary'; use.style.marginTop = '14px'; use.textContent = 'Diese Variante für „' + st.name + '“ wählen';
    use.onclick = () => { sel[st.id] = allVariant; store.set('sel', sel); renderSel(); toast('Gewählt') }; main.append(use, grid);
  }
}
function render(){ clearLive(); $('#color').value = color || AVATARS.find(a => a.id === avatar).color; $('#color').parentElement.style.display = view === 'avatar' ? '' : 'none'; $('#resetColor').style.display = view === 'avatar' ? '' : 'none'; renderChips(); renderMain(); renderSel(); document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-pressed', t.dataset.view === view)) }
function toast(t){ $('#toast').textContent = t; setTimeout(() => $('#toast').textContent = '', 2200) }
function exportData(){
  const zustaende = {}, used = new Set();
  for (const s of STATES) { const a = s.variants[sel[s.id]]; zustaende[s.id] = { variante: sel[s.id] + 1, animation: a, name: NAMES[a] }; used.add(a) }
  const avatare = {};
  for (const a of AVATARS) { const p = structuredClone(PAYLOADS[a.id]); p.animations = Object.fromEntries(Object.entries(p.animations).filter(([k]) => used.has(k)));
    const need = new Set(Object.values(p.animations).flatMap(x => x.steps.map(s => s.expressionId))); p.expressions = Object.fromEntries(Object.entries(p.expressions).filter(([k]) => need.has(k))); avatare[a.id] = p }
  return { version: 1, quelle: 'bible-strong-avatar-lab', zustaende, avatare };
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { view = t.dataset.view; render() });
$('#color').oninput = e => { color = e.target.value; store.set('color:' + avatar, color); clearLive(); renderMain(); renderChips() };
$('#resetColor').onclick = () => { color = ''; store.set('color:' + avatar, ''); render() };
$('#allV').onclick = () => { const n = (Number(prompt('Variante 1 bis 5 für alle Zustände:', '1')) || 1) - 1; if (n < 0 || n > 8) return; STATES.forEach(s => sel[s.id] = Math.min(n, s.variants.length - 1)); store.set('sel', sel); render(); toast('Alle auf Variante ' + (n + 1)) };
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(exportData(), null, 2)); toast('Kopiert') } catch { toast('Kopieren nicht möglich') } };
$('#download').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' })); a.download = 'orbit-avatar-animationen.json'; a.click(); toast('Exportiert') };
render();
</script></body></html>`
writeFileSync(new URL('file://' + process.env.OUT_HTML!), html)
console.log('geschrieben', html.length)

// ── Swift-Daten für die Mac-App (nur die verwendeten Animationen) ──
const USED = ['calm-1', 'calm-3', 'listen-1', 'work-1', 'wait-1', 'wait-2', 'done-1', 'done-3', 'limit-1', 'error-1', 'error-5']
if (process.env.OUT_SWIFT) {
  const fields = ['headX', 'headY', 'headZ', 'widthLeft', 'widthRight', 'heightLeft', 'heightRight', 'spacing', 'positionXLeft', 'positionXRight', 'positionYLeft', 'positionYRight', 'leftAngle', 'rightAngle', 'perspective']
  const r = (v: number) => Math.round(v * 1000) / 1000
  const out: string[] = []
  for (const a of avatarDefs) {
    const id = idOf(a.name), p = payloads[id]
    const anims = Object.fromEntries(USED.map(k => [k, { blink: p.animations[k].blink, steps: p.animations[k].steps.map((s: any) => [s.expressionId, s.holdMs, s.transitionMs, s.transition]) }]))
    const need = new Set<string>(['expression-neutral'])
    for (const k of USED) for (const s of p.animations[k].steps) need.add(s.expressionId)
    const expr = Object.fromEntries([...need].map(e => [e, fields.map(f => r(p.expressions[e][f]))]))
    const data = { surface: p.avatar.surface, bodyNodes: p.avatar.bodyNodes, expressions: expr, animations: anims }
    out.push(`        "${id}": ##"${JSON.stringify(data)}"##,`)
  }
  if (standaloneEngineSource.includes('"##')) throw new Error('Engine enthält "##')
  const swift = `// Erzeugt von scripts/avatar-lab/build-animationen.ts (Avatar-Lab-Engine und Animationsdaten). Nicht von Hand ändern.

enum AvatarEngineSource {
    static let js = ##"${standaloneEngineSource}"##
}

enum AvatarAnimData {
    // Reihenfolge der Zahlen je Ausdruck: ${fields.join(', ')}
    static let avatars: [String: String] = [
${out.join('\n')}
    ]
}
`
  writeFileSync(new URL('file://' + process.env.OUT_SWIFT), swift)
  console.log('Swift-Daten geschrieben', swift.length)
}

