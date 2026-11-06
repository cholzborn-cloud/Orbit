// Eigene Animationen für die Zustände der Orbis (7 Zustände × 5 Varianten), gebaut aus den Ausdrücken des Avatar-Labs.
// Werte sind relativ zum neutralen Ausdruck: hx/hy/hz = Kopf (x: + oben, y: + rechts, hz: Kippen), pers = Nähe/Größe (atmen, hüpfen),
// w/h = Augengröße (hl/hr je Auge), sp = Abstand, py/px = Augenlage, al/ar = Augenwinkel (links + / rechts − = traurig, umgekehrt = wütend).
import { defaultExpression } from '$LAB/src/features/avatar/presets'

const base: any = defaultExpression
type Pose = Partial<Record<'hx' | 'hy' | 'hz' | 'w' | 'h' | 'hl' | 'hr' | 'sp' | 'py' | 'px' | 'al' | 'ar' | 'pers', number>> & { em?: string; bm?: string }
let amp = 1  // Verstärkung der Bewegung je Abschnitt
let spd = 1  // Tempo-Faktor (kleiner = schneller)
export const customExpressions: Record<string, any> = {}
let counter = 0
const pose = (o: Pose = {}) => {
  const id = `p${counter++}`
  // Augen 15 % breiter, 12 % höher (geschlossene Augen bleiben flach)
  const grow = (v: number, k: number) => (v > 16 ? v * k : v)
  const w = grow(o.w ?? base.widthLeft, 1.15), h = grow(o.h ?? base.heightLeft, 1.12)
  customExpressions[id] = {
    ...base, id, headX: (o.hx ?? 0) * amp, headY: (o.hy ?? 0) * amp, headZ: (o.hz ?? 0) * amp,
    widthLeft: w, widthRight: w, heightLeft: o.hl !== undefined ? grow(o.hl, 1.12) : h, heightRight: o.hr !== undefined ? grow(o.hr, 1.12) : h, spacing: o.sp ?? base.spacing,
    positionXLeft: o.px ?? 0, positionXRight: o.px ?? 0, positionYLeft: base.positionYLeft + ((o.py ?? base.positionYLeft) - base.positionYLeft) * amp, positionYRight: base.positionYRight + ((o.py ?? base.positionYRight) - base.positionYRight) * amp,
    leftAngle: o.al ?? 0, rightAngle: o.ar ?? 0, perspective: 1 + ((o.pers ?? 1) - 1) * amp, eyeMotion: o.em ?? 'none', bodyMotion: o.bm ?? 'none',
  }
  return id
}
type Kind = 'smooth' | 'snappy' | 'spring'
const step = (p: string, hold: number, t: number, kind: Kind = 'smooth') => ({ expressionId: p, holdMs: Math.round(hold * spd), transitionMs: Math.round(t * spd), transition: kind })
const blink = (min = 2800, max = 5200, on = true) => ({ enabled: on, initialDelayMs: 1800, minIntervalMs: min, maxIntervalMs: max, durationMs: 240 })
export const customAnimations: Record<string, any> = {}
const anim = (id: string, name: string, description: string, steps: any[], b = blink(), mode = 'loop') => {
  customAnimations[id] = { name, description, playbackMode: mode, blink: b, steps }
}

// ── Ruhig: nach rechts geneigt, schaut links nach oben, atmet und blinzelt ──
const rest = { hz: 9, hy: -12, hx: 13, py: -13 }
anim('calm-1', 'Geneigt, links oben', 'Kopf nach rechts geneigt, Blick links nach oben, atmet und wiegt sich sacht.', [step(pose({ ...rest, pers: 1.06 }), 400, 2300), step(pose({ ...rest, hz: 12, hy: -9, pers: 0.97 }), 400, 2300), step(pose({ ...rest, hz: 8, hy: -13, hx: 15, pers: 1.05 }), 400, 2300)])
anim('calm-2', 'Tief atmen', 'Wie zuvor, aber mit deutlich tieferem, langsamem Atem.', [step(pose({ ...rest, pers: 1.09 }), 700, 3000), step(pose({ ...rest, pers: 0.96 }), 700, 3000)])
// Chat offen: ganz leicht nach links, rechts und wieder nach vorn, dazu Blinzeln (ruhig, nur ein wenig Bewegung)
const open = { hx: 8, py: -3, pers: 1.03 }
anim('calm-3', 'Blick links, rechts, vorn', 'Schaut ganz leicht nach links, nach rechts und wieder nach vorn, blinzelt dabei.', [
  step(pose({ ...open, hy: 0, hz: 0 }), 1500, 1500), step(pose({ ...open, hy: -9, hz: -3, pers: 1.0 }), 1300, 1500),
  step(pose({ ...open, hy: 0, hz: 0 }), 1200, 1500), step(pose({ ...open, hy: 9, hz: 3, pers: 1.0 }), 1300, 1500)], blink(2200, 4200))
anim('calm-4', 'Leicht schwebend', 'Geneigt und links oben, sanftes Schweben und feine Augenbewegung.', [step(pose({ ...rest, pers: 1.03, em: 'microSaccades', bm: 'slowDrift' }), 2400, 2200), step(pose({ ...rest, pers: 0.99, em: 'microSaccades', bm: 'slowDrift' }), 2400, 2200)])
anim('calm-5', 'Starr und blinzelnd', 'Geneigt, Blick links oben, nur Blinzeln.', [step(pose(rest), 4000, 800)], blink(1700, 3300))

amp = 1.35; spd = 0.88
// ── Hört zu: Kopf neigen, aufmerksam, nach vorn lehnen ──
const ear = { w: 24, h: 58, py: -9, pers: 1.06 }
anim('listen-1', 'Kopf schief links', 'Neigt den Kopf nach links und nickt einmal.', [step(pose({ ...ear, hz: -11 }), 2600, 1100), step(pose({ ...ear, hz: -11, hx: -8 }), 350, 600), step(pose({ ...ear, hz: -11 }), 2000, 650)], blink(3200, 5600))
anim('listen-2', 'Kopf schief rechts', 'Neigt den Kopf nach rechts und nickt einmal.', [step(pose({ ...ear, hz: 11 }), 2600, 1100), step(pose({ ...ear, hz: 11, hx: -8 }), 350, 600), step(pose({ ...ear, hz: 11 }), 2000, 650)], blink(3200, 5600))
anim('listen-3', 'Zustimmend nicken', 'Nickt mehrmals sanft, als würde er zustimmen.', [step(pose({ ...ear, hx: -10 }), 200, 650), step(pose({ ...ear, hx: 3 }), 200, 650), step(pose({ ...ear, hx: -10 }), 200, 650), step(pose({ ...ear, hx: 3 }), 1800, 700)])
anim('listen-4', 'Nach vorn lehnen', 'Lehnt sich mit großen Augen zu dir hin.', [step(pose({ w: 26, h: 62, py: -9, hx: -4, pers: 1.15 }), 3000, 1400), step(pose({ w: 24, h: 56, py: -9, pers: 1.07 }), 1400, 1200)], blink(3800, 6000))
anim('listen-5', 'Hinhören', 'Wiegt den Kopf langsam von einer Seite zur anderen.', [step(pose({ ...ear, hz: -9, hy: -6 }), 1100, 1700), step(pose({ ...ear, hz: 9, hy: 6 }), 1100, 1700)])

amp = 1.45; spd = 0.85
// ── Arbeitet: deutliche, weiche Bewegung ──
const focus = { h: 38, w: 22, py: 2 }
anim('work-1', 'Tippen', 'Nickt im Takt nach unten und oben, als würde er tippen.', [step(pose({ ...focus, hx: -15, pers: 0.96 }), 100, 650), step(pose({ ...focus, hx: -2, pers: 1.05 }), 100, 650), step(pose({ ...focus, hx: -15, pers: 0.96 }), 100, 650), step(pose({ ...focus, hx: -2, pers: 1.05 }), 100, 650), step(pose({ ...focus, hx: -18, pers: 0.94 }), 350, 800), step(pose({ ...focus, hx: -2, pers: 1.05 }), 100, 750)], blink(5200, 8000))
// Zehn Augenpositionen: schaut hin und her, mal hoch, mal runter, mal zur Seite
const looks: Pose[] = [{ hy: -22, hx: 6, py: -9 }, { hy: 10, hx: -8, py: 3 }, { hy: 24, hx: 4, py: -7 }, { hy: -6, hx: 14, py: -12 }, { hy: -26, hx: -6, py: 4 }, { hy: 18, hx: 12, py: -11 }, { hy: -12, hx: -12, py: 6 }, { hy: 26, hx: -2, py: -2 }, { hy: -18, hx: 10, py: -9 }, { hy: 6, hx: -4, py: 2 }]
anim('work-2', 'Umherschauen', 'Zehn Blickpositionen: schaut aktiv hin und her.', looks.map(l => step(pose({ ...l, h: 46, hz: (l.hy ?? 0) > 0 ? 5 : -5 }), 200, 850)), blink(4500, 7500))
anim('work-3', 'Lesen', 'Der Blick fährt Zeile für Zeile von links nach rechts.', [step(pose({ ...focus, hy: -22, hx: 2 }), 150, 550), step(pose({ ...focus, hy: 22, hx: 2 }), 150, 1500), step(pose({ ...focus, hy: -22, hx: -6 }), 150, 650), step(pose({ ...focus, hy: 22, hx: -6 }), 150, 1500), step(pose({ ...focus, hy: -22, hx: -12 }), 150, 650), step(pose({ ...focus, hy: 22, hx: -12 }), 150, 1500)], blink(6000, 9000))
anim('work-4', 'Rechnen', 'Wiegt sich mit zusammengekniffenen Augen hin und her.', [step(pose({ h: 34, w: 24, hz: -15, hy: -6, pers: 1.07 }), 120, 900), step(pose({ h: 34, w: 24, hz: 15, hy: 6, pers: 0.99 }), 120, 900)], blink(6000, 9000))
anim('work-5', 'Fokussieren', 'Presst die Augen konzentriert zusammen und zittert leicht.', [step(pose({ h: 30, w: 24, al: -10, ar: 10, hx: -10, pers: 1.1, em: 'microSaccades', bm: 'slowDrift' }), 1400, 1000), step(pose({ h: 32, w: 24, al: -8, ar: 8, hx: -6, hy: 8, pers: 1.04, em: 'microSaccades', bm: 'slowDrift' }), 1400, 1100)], blink(6500, 9500))

// ── Wartet auf dich: unruhig und aktiv ──
amp = 1.55; spd = 0.8
anim('wait-1', 'Umschauen', 'Schaut sich suchend um, ob du kommst.', [step(pose({ hy: -22, hx: 4, py: -9 }), 500, 1000), step(pose({ hy: 22, hx: 4, py: -9 }), 500, 1500), step(pose({ hy: -14, hx: -6, py: 2 }), 400, 1000), step(pose({ hy: 14, hx: -6, py: 2 }), 400, 1300)])
anim('wait-2', 'Hibbeln', 'Wippt unruhig von einer Seite zur anderen und federt dabei.', [step(pose({ hz: -9, hy: -9, py: 3, pers: 1.06 }), 100, 650), step(pose({ hz: 9, hy: 9, py: 3, pers: 0.98 }), 100, 650)])
anim('wait-3', 'Augen rollen', 'Halb geschlossene Augen, rollt gelangweilt den Blick im Kreis.', [step(pose({ h: 30, hy: -16, hx: 12, py: -11, pers: 0.97 }), 200, 1100), step(pose({ h: 30, hy: 16, hx: 12, py: -11, pers: 1.03 }), 200, 1100), step(pose({ h: 28, hy: 18, hx: -8, py: 3, pers: 1.0 }), 200, 1100), step(pose({ h: 28, hy: -18, hx: -8, py: 3, pers: 0.97 }), 200, 1100)], blink(2200, 3800))
anim('wait-4', 'Ungeduldig tippen', 'Schaut nach unten und wippt ungeduldig im Takt.', [step(pose({ hx: -8, py: 7, pers: 1.04 }), 80, 500), step(pose({ hx: -16, py: 7, pers: 0.97 }), 80, 450), step(pose({ hx: -8, py: 7, pers: 1.04 }), 80, 500), step(pose({ hx: -16, py: 7, pers: 0.97 }), 80, 450), step(pose({ hx: -8, py: 7, pers: 1.02, hy: 10 }), 700, 650)])
anim('wait-5', 'Fragend', 'Legt den Kopf schief und schaut dich fragend an.', [step(pose({ hz: 13, hx: 7, hl: 62, hr: 36, al: 9, ar: 9, py: -9, pers: 1.05 }), 1400, 900), step(pose({ hz: -10, hx: 7, hl: 36, hr: 62, al: -9, ar: -9, py: -9, pers: 1.05 }), 1400, 1000)])

amp = 1.4; spd = 0.85
// ── Fertig ──
anim('done-1', 'Hüpfen', 'Duckt sich und streckt sich zum Hüpfen.', [step(pose({ hx: -8, h: 36, pers: 0.93 }), 120, 600), step(pose({ hx: 14, h: 58, pers: 1.14, py: -10 }), 250, 750, 'spring'), step(pose({ pers: 1.0 }), 700, 700)], blink(3500, 6000))
anim('done-2', 'Jubeln', 'Wiegt sich vergnügt hin und her mit fröhlichen Augen.', [step(pose({ hz: -14, h: 24, py: -9, pers: 1.06 }), 150, 800, 'spring'), step(pose({ hz: 14, h: 24, py: -9, pers: 1.06 }), 150, 800, 'spring')], blink(4000, 6000, false))
anim('done-3', 'Stolz', 'Hebt zufrieden den Kopf und schließt halb die Augen.', [step(pose({ hx: 17, h: 34, py: -10, pers: 1.07, hz: 4 }), 3200, 1400), step(pose({ hx: 9, h: 40, py: -9, pers: 1.04 }), 1500, 1300)])
anim('done-4', 'Strahlen', 'Große glänzende Augen, atmet freudig.', [step(pose({ w: 30, h: 66, sp: 41, pers: 1.14, py: -9 }), 900, 1000), step(pose({ w: 30, h: 66, sp: 41, pers: 1.08, py: -9 }), 900, 1000)], blink(4000, 6500))
anim('done-5', 'Zwinkern', 'Zwinkert dir mit einem Auge zu.', [step(pose({ hz: 8, hl: 12, hr: 54, py: -9, hx: 4 }), 750, 450), step(pose({ hz: 4, py: -9 }), 2000, 700)], blink(4500, 7000, false))

amp = 1.3; spd = 0.93
// ── Limit erreicht: Pause ──
anim('limit-1', 'Schlafen', 'Augen zu, Kopf gesenkt, atmet ganz langsam.', [step(pose({ h: 12, hx: -16, pers: 1.03, py: 0 }), 500, 2400), step(pose({ h: 12, hx: -16, pers: 0.97, py: 0 }), 500, 2400)], blink(3000, 4000, false))
anim('limit-2', 'Wegnicken', 'Der Kopf sackt langsam ab, dann schreckt er kurz hoch.', [step(pose({ h: 24, hx: -6 }), 600, 2000), step(pose({ h: 12, hx: -26, pers: 0.96 }), 800, 2200), step(pose({ h: 44, hx: 5, py: -9 }), 900, 500, 'snappy')], blink(3000, 4000, false))
anim('limit-3', 'Erschöpft', 'Müde, hängende Augen, der Körper sackt ein.', [step(pose({ h: 28, w: 22, al: 14, ar: -14, hx: -12, pers: 0.88, py: 3, hz: -4 }), 2400, 1900), step(pose({ h: 26, w: 22, al: 14, ar: -14, hx: -14, pers: 0.86, py: 4, hz: 4 }), 2400, 1900)], blink(2600, 4200))
anim('limit-4', 'Gähnen', 'Reißt den Mund nicht auf, aber streckt sich und gähnt.', [step(pose({ h: 14, hx: 22, pers: 1.13, sp: 39 }), 1400, 1500), step(pose({ h: 26, hx: -4, pers: 0.96, py: 2 }), 1700, 1500)], blink(3000, 4000, false))
anim('limit-5', 'Dösen', 'Schaukelt schlaftrunken mit halb offenen Augen.', [step(pose({ h: 24, hy: 10, hx: -8, hz: -10 }), 2600, 2000), step(pose({ h: 24, hy: -10, hx: -8, hz: 10 }), 2600, 2000)], blink(2400, 4000))

amp = 1.35; spd = 0.85
// ── Fehler ──
anim('error-1', 'Kopfschütteln', 'Schüttelt den Kopf: nein.', [step(pose({ hy: -20, h: 36, al: 6, ar: -6 }), 80, 520), step(pose({ hy: 20, h: 36, al: 6, ar: -6 }), 80, 520), step(pose({ hy: -20, h: 36, al: 6, ar: -6 }), 80, 520), step(pose({ hy: 20, h: 36, al: 6, ar: -6 }), 80, 520), step(pose({ h: 44, al: 6, ar: -6 }), 1200, 800)], blink(4000, 6000, false))
anim('error-2', 'Erschrocken', 'Reißt die Augen auf und zittert.', [step(pose({ w: 32, h: 70, sp: 44, pers: 1.16, hx: 10, em: 'shake' }), 1800, 400, 'snappy'), step(pose({ w: 24, h: 58, sp: 40, pers: 1.05, hx: 4 }), 1300, 1000)], blink(3000, 5000, false))
anim('error-3', 'Wütend', 'Zusammengezogene Augen, bebt vor Ärger.', [step(pose({ al: -22, ar: 22, h: 34, w: 24, hx: -10, pers: 1.07, bm: 'shake' }), 2000, 700), step(pose({ al: -22, ar: 22, h: 30, w: 24, hx: -14, pers: 1.12, bm: 'shake' }), 1700, 700)], blink(5000, 8000, false))
anim('error-4', 'Verwirrt', 'Schaut schief und unsicher von Seite zu Seite.', [step(pose({ hz: -14, hy: 12, hl: 62, hr: 34, al: 8, ar: 8 }), 1100, 1100), step(pose({ hz: 14, hy: -12, hl: 34, hr: 62, al: -8, ar: -8 }), 1100, 1300)])
anim('error-5', 'Traurig', 'Lässt den Kopf hängen, Augen schauen traurig nach unten.', [step(pose({ al: 18, ar: -18, h: 44, hx: -14, pers: 0.92, py: 8 }), 3000, 1500), step(pose({ al: 18, ar: -18, h: 40, hx: -18, pers: 0.9, py: 9 }), 2000, 1800)], blink(2600, 4200))

// Zusätzliche wütende und traurige Varianten
anim('error-6', 'Toben', 'Wütend: wippt heftig hin und her und plustert sich auf.', [step(pose({ al: -22, ar: 22, h: 32, w: 24, hz: -11, hx: -8, pers: 1.14 }), 60, 450, 'spring'), step(pose({ al: -22, ar: 22, h: 32, w: 24, hz: 11, hx: -8, pers: 1.14 }), 60, 450, 'spring'), step(pose({ al: -22, ar: 22, h: 30, w: 24, hz: -11, hx: -12, pers: 1.18 }), 60, 450, 'spring'), step(pose({ al: -22, ar: 22, h: 34, w: 24, hz: 0, hx: -6, pers: 1.06 }), 500, 700)], blink(4000, 6000, false))
anim('error-7', 'Grollen', 'Wütend: senkt den Kopf, bläht sich langsam auf und stößt Luft aus.', [step(pose({ al: -24, ar: 24, h: 28, w: 24, hx: -16, pers: 1.2, bm: 'shake', em: 'microSaccades' }), 1500, 1300), step(pose({ al: -18, ar: 18, h: 36, w: 22, hx: 6, pers: 1.0 }), 900, 900)], blink(4500, 7000, false))
anim('error-8', 'Seufzen', 'Traurig: sackt mit einem tiefen Seufzer in sich zusammen.', [step(pose({ al: 16, ar: -16, h: 44, hx: -6, pers: 1.05, py: 4 }), 700, 1500), step(pose({ al: 18, ar: -18, h: 38, hx: -22, pers: 0.86, py: 9 }), 1600, 2100)], blink(2400, 4000))
anim('error-9', 'Schluchzen', 'Traurig: wackelt mit hängendem Kopf und zittert leicht.', [step(pose({ al: 20, ar: -20, h: 40, hx: -12, pers: 0.94, py: 8, em: 'shake' }), 120, 480), step(pose({ al: 20, ar: -20, h: 40, hx: -17, pers: 0.9, py: 9, em: 'shake' }), 120, 480), step(pose({ al: 20, ar: -20, h: 40, hx: -12, pers: 0.94, py: 8, em: 'shake' }), 120, 480), step(pose({ al: 18, ar: -18, h: 44, hx: -15, pers: 0.92, py: 8 }), 1100, 900)], blink(1800, 3200))

export const STATES = [
  { id: 'calm', name: 'Ruhig', hint: 'Nichts zu tun: geneigt, Blick links oben', variants: ['calm-1', 'calm-2', 'calm-3', 'calm-4', 'calm-5'] },
  { id: 'listening', name: 'Hört zu', hint: 'Du schreibst gerade', variants: ['listen-1', 'listen-2', 'listen-3', 'listen-4', 'listen-5'] },
  { id: 'working', name: 'Arbeitet', hint: 'Bot bearbeitet die Aufgabe', variants: ['work-1', 'work-2', 'work-3', 'work-4', 'work-5'] },
  { id: 'waiting', name: 'Wartet auf dich', hint: 'Braucht eine Antwort oder Freigabe', variants: ['wait-1', 'wait-2', 'wait-3', 'wait-4', 'wait-5'] },
  { id: 'done', name: 'Fertig', hint: 'Aufgabe erledigt', variants: ['done-1', 'done-2', 'done-3', 'done-4', 'done-5'] },
  { id: 'limit', name: 'Limit erreicht', hint: 'Pausiert, bis das Limit zurückgesetzt ist', variants: ['limit-1', 'limit-2', 'limit-3', 'limit-4', 'limit-5'] },
  { id: 'error', name: 'Fehler', hint: 'Etwas ist schiefgelaufen', variants: ['error-1', 'error-2', 'error-3', 'error-6', 'error-7', 'error-5', 'error-8', 'error-9', 'error-4'] },
]
