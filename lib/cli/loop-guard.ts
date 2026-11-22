// Schutz gegen Wiederholschleifen im Modellstrom (gelernt am 04.11.2026: Haiku schrieb endlos dasselbe Tag, der Turn lief weiter).
// Prüft den rohen Text (vor dem Tag-Filter), damit auch eine unsichtbare Schleife auffällt.
export const LOOP_TEXT = "Die Antwort hat sich ständig wiederholt und wurde deshalb gestoppt. Bitte frag noch einmal."
export const LONG_TEXT = "Die Antwort wurde zu lang und deshalb gestoppt. Bitte frag noch einmal, gern kürzer."

const MAX_CHARS = 120_000 // weit über jeder normalen Antwort
const MAX_UNIT = 400 // längstes Stück, das als Wiederholung zählt
const MIN_SPAN = 1_200 // so viel Text muss aus Wiederholungen bestehen
const MIN_REPEATS = 6
const TAIL = MAX_UNIT * MIN_REPEATS + MIN_SPAN

// Endet `text` mit demselben Stück, vielfach hintereinander?
export function endsInLoop(text: string): boolean {
  const tail = text.slice(-TAIL)
  for (let unit = 1; unit <= MAX_UNIT; unit++) {
    const span = Math.max(MIN_SPAN, unit * MIN_REPEATS)
    if (span > tail.length) break
    let same = true
    for (let i = tail.length - 1; i >= tail.length - span + unit; i--) {
      if (tail.charCodeAt(i) !== tail.charCodeAt(i - unit)) {
        same = false
        break
      }
    }
    if (same && tail.slice(-unit).trim()) return true
  }
  return false
}

// Zählt den Strom mit; liefert einen deutschen Satz, sobald abgebrochen werden soll. Geprüft wird alle 200 Zeichen.
export function createLoopGuard() {
  let text = ""
  let checkedAt = 0
  return (delta: string): string | undefined => {
    text = (text + delta).slice(-TAIL)
    const total = checkedAt + delta.length
    checkedAt = total
    if (total >= MAX_CHARS) return LONG_TEXT
    if (Math.floor(total / 200) !== Math.floor((total - delta.length) / 200) && endsInLoop(text)) return LOOP_TEXT
    return undefined
  }
}
