import SwiftUI
import CoreText

// Figma-Tokens: plan/design/variablen-vollstaendig.json und tokens.dtcg.json.
enum Theme {
    enum Palette {
        static let background = Color("background")
        static let foreground = Color("foreground")
        static let sidebar = Color("sidebar")
        static let sidebarForeground = Color("sidebar-foreground")
        static let sidebarAccent = Color("sidebar-accent")
        static let sidebarBorder = Color("sidebar-border")
        static let card = Color("card")
        static let cardForeground = Color("card-foreground")
        static let popover = Color("popover")
        static let secondary = Color("secondary")
        static let secondaryForeground = Color("secondary-foreground")
        static let secondaryHover = Color("secondary-hover")
        // Zweitfläche auf Karten (Figma `secondary`/`secondary-hover`, 04/teil-1 und teil-2): hell wie secondary, dunkel eine Stufe
        // über der Karte (#2a2a2a/#3a3a3a = vorhandene Dunkelwerte secondary-hover/input), sonst verschwinden Nummern, Pillen und Zweit-Knöpfe auf #1f1f1f.
        static let secondaryRaised = Color("secondary-raised")
        static let secondaryRaisedHover = Color("secondary-raised-hover")
        static let filterSelected = foreground.opacity(0.15)
        static let muted = Color("muted")
        static let mutedForeground = Color("muted-foreground")
        static let accentNeutral = Color("accent-neutral")
        static let border = Color("border")
        static let input = Color("input")
        static var ring: Color { AccentStore.shared.accent?.color ?? Color("ring") }
        static var primary: Color { AccentStore.shared.accent?.color ?? Color("primary") }
        static var primaryForeground: Color { AccentStore.shared.accent?.onColor ?? Color("primary-foreground") }
        static let destructive = Color("destructive")
        static let destructiveSoft = Color("destructive-soft")
        static let field = Color("field")
        // Rand der Eingabeleiste: wie Grok Bot deutlich heller als die Fläche (dunkel ≈ weiß 25 % über background).
        static let fieldBorder = Color("field-border")
        static let colorPickerSpectrum: [Color] = [.red, .yellow, .green, .cyan, .blue, .purple, .red]
        static let glass = Color("glass")
        static let glassHover = Color("glass-hover")
        static let glassRing = Color("glass-ring")
        static let glassActive = Color("glass-active")
        static let scrim = Color("scrim")
        static var chipSelected: Color { AccentStore.shared.accent?.color ?? Color("chip-selected") }
        static var chipSelectedForeground: Color { AccentStore.shared.accent?.onColor ?? Color("chip-selected-foreground") }
        static let bubbleReply = Color("bubble-reply")
        static let bubbleReplyForeground = Color("bubble-reply-foreground")
        static var bubbleOwnForeground: Color { AccentStore.shared.accent?.onColor ?? Color("bubble-own-foreground") }
        static var accentForeground: Color { AccentStore.shared.accent?.onColor ?? Color("accent-foreground") }
        static let track = Color("track")
        static let thumb = Color("thumb")
        static let stage = Color("stage")
        static var accent: Color { AccentStore.shared.accent?.color ?? Color("accent") }
        static var accentBubble: Color { AccentStore.shared.accent?.color ?? Color("accent-bubble") }
        static var link: Color { AccentStore.shared.accent?.color ?? Color("link") }
        static let segmentThumb = Color("segment-thumb")
        static let linkNeutral = Color("link-neutral")
        static let orbiAuge = Color("orbi-auge")
        static let statusSuccess = Color("status-success")
        static let statusWarning = Color("status-warning")
        static let statusInfo = Color("status-info")
        static let statusCaution = Color("status-caution")
        static let statusDanger = Color("status-danger")
        static let statusStar = Color("status-star")
        static let statusBadge = Color("status-badge")
        static let popoverForeground = foreground
        static var sidebarPrimary: Color { primary }
        static var sidebarPrimaryForeground: Color { primaryForeground }
        static let sidebarAccentForeground = sidebarForeground
        static var sidebarRing: Color { ring }
        static let shadow = Color.black
        static let swatchRing = foreground
        static let viewerForeground = Color.white
        static let viewerSecondaryForeground = Color.white.opacity(0.7)
        static let viewerBackground = Color.black.opacity(0.95)
        static let viewerBorder = Color.white.opacity(0.1)
        static let viewerHover = Color.white.opacity(0.15)
        static let maskOpaque = Color.black

        static func dynamic(light: Color, dark: Color) -> Color {
            Color(nsColor: NSColor(name: nil) { appearance in
                appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light)
            })
        }
    }

    struct OrbiColor: Sendable {
        let name, lightHex, darkHex, bubbleLightHex, bubbleDarkHex: String
        var displayName: String {
            switch name {
            case "weiss": "Weiß"
            case "gelborange": "Gelb-orange"
            case "gruen": "Grün"
            case "tuerkis": "Türkis"
            case "himmel": "Himmelblau"
            default: name.capitalized
            }
        }
        var color: Color { Color("orbi-" + name) }
        var bubble: Color { Color("orbi-bubble-" + name) }
        static let all: [OrbiColor] = [
            .init(name: "weiss", lightHex: "#ffffff", darkHex: "#ffffff", bubbleLightHex: "#76767a", bubbleDarkHex: "#76767a"),
            .init(name: "braun", lightHex: "#906538", darkHex: "#996e42", bubbleLightHex: "#906538", bubbleDarkHex: "#996e42"),
            .init(name: "rot", lightHex: "#df363c", darkHex: "#e84447", bubbleLightHex: "#db3239", bubbleDarkHex: "#dc373d"),
            .init(name: "orange", lightHex: "#df6521", darkHex: "#e87031", bubbleLightHex: "#c45102", bubbleDarkHex: "#c65203"),
            .init(name: "gelborange", lightHex: "#cf811e", darkHex: "#e9993a", bubbleLightHex: "#a76500", bubbleDarkHex: "#aa6703"),
            .init(name: "limette", lightHex: "#9bc636", darkHex: "#a5d046", bubbleLightHex: "#607f01", bubbleDarkHex: "#618102"),
            .init(name: "gruen", lightHex: "#43a561", darkHex: "#5ac078", bubbleLightHex: "#078741", bubbleDarkHex: "#138844"),
            .init(name: "tuerkis", lightHex: "#43a191", darkHex: "#55b5a4", bubbleLightHex: "#0d8374", bubbleDarkHex: "#198576"),
            .init(name: "himmel", lightHex: "#199ecd", darkHex: "#32b3e6", bubbleLightHex: "#017ea7", bubbleDarkHex: "#0880a8"),
            .init(name: "blau", lightHex: "#3378ec", darkHex: "#3e82f4", bubbleLightHex: "#2b70e4", bubbleDarkHex: "#2f72e3"),
            .init(name: "indigo", lightHex: "#5a62ed", darkHex: "#626df5", bubbleLightHex: "#5a62ed", bubbleDarkHex: "#5d67ef"),
            .init(name: "violett", lightHex: "#8152eb", darkHex: "#895df3", bubbleLightHex: "#8152eb", bubbleDarkHex: "#8558ee"),
            .init(name: "fuchsia", lightHex: "#bf3bdb", darkHex: "#c849e4", bubbleLightHex: "#b934d5", bubbleDarkHex: "#ba39d6"),
            .init(name: "pink", lightHex: "#de3a8e", darkHex: "#e74897", bubbleLightHex: "#d42f86", bubbleDarkHex: "#d43587"),
            .init(name: "grau", lightHex: "#6b7585", darkHex: "#7d8797", bubbleLightHex: "#64748b", bubbleDarkHex: "#66707f"),
        ]
        static func lookup(hex: String) -> OrbiColor? {
            all.first { [$0.lightHex, $0.darkHex].contains(hex.lowercased()) }
        }
    }

    // Standardfarbe je Form: Farbe des Orbis ohne eigene Wahl. Alte Planetennamen laufen über ihre neue Form.
    static let orbiBaseColors: [String: String] = Dictionary(
        uniqueKeysWithValues: ["erdi", "marsi", "sati", "jupi", "mondi", "veni", "nepi", "urani", "pluti", "universi"].map { ($0, OrbiShape(avatar: $0).baseHex) }
            + OrbiShape.allCases.map { ($0.rawValue, $0.baseHex) })

    // --radius: 0.625rem (10 pt); abgeleitete Stufen wie im @theme-Block.
    enum Radius {
        static let base: CGFloat = 10
        static let sm = base * 0.6
        static let md = base * 0.8
        static let lg = base
        static let xl = base * 1.4
        static let xl2 = base * 1.8
        static let xl3 = base * 2.2
        static let bubble: CGFloat = 18
        // Antwort-Blase wie Grok Bot (Referenz 05.11.2026 ausgemessen: r16, alle Ecken gleich).
        static let bubbleReply: CGFloat = 16
        // Eingabefeld und Ausklappfeld (Figma „Grundteile“ 6:13745, 6:13685: r12).
        static let field: CGFloat = 12
        // Marktplatz-Kachel (Figma 192:18885: r12).
        static let tile: CGFloat = 12
        // Seitenleisten-Zeile (Figma „Seitenleiste-Orbi“ 26:10956: r12) und Hauptorbi-Karte (49:16212: r16).
        static let row: CGFloat = 12
        static let mainCard: CGFloat = 16
        // Checkbox-Kasten (Figma 6:13922: r5).
        static let checkbox: CGFloat = 5
        // Eingabeleiste (Figma „Chat Eingabeleiste“: r24).
        static let pill: CGFloat = 24
        static let full: CGFloat = 999
    }

    // Menüs: eine Familie für alle Popover- und Kontextmenüs, nach dem dunklen Grok-Bot-Menü (Consti, 06.11.2026).
    // Rand bis Hover-Fläche `padding`, Hover-Fläche bis Symbol `rowPaddingH`: Inhalt sitzt 14 vom Rand; Hover-Ecken konzentrisch.
    enum Menu {
        static let radius: CGFloat = 15
        static let padding: CGFloat = 6
        static let rowPaddingH: CGFloat = 8
        static let rowHeight: CGFloat = 35
        static let tallRowHeight: CGFloat = 50
        static let rowRadius: CGFloat = radius - padding
        static let iconSize: CGFloat = 17
        static let iconFrame: CGFloat = 20
        static let iconWeight: Font.Weight = .light
        static let gap: CGFloat = 10
        static let chevronSize: CGFloat = 12
        static let checkSize: CGFloat = 13
        static let separatorInsetV: CGFloat = 5
        static let separatorInsetH: CGFloat = rowPaddingH
        static let minWidth: CGFloat = 220
        // Menüs mit eigenem Inhalt und längeren Zeilen (Plus-Menü der Eingabe mit Modellwahl).
        static let wideWidth: CGFloat = 300
        static let border: CGFloat = 0.5
        static let destructiveHover: Double = 0.15
        static let title = Fonts.geist(15)
        static let titleSelected = Fonts.geist(15, .medium)
        static let subtitle = Fonts.geist(13)
        static let value = Fonts.geist(14)
    }

    enum Layout {
        static let topBar: CGFloat = 52
        static let rail: CGFloat = 88   // Figma layout/rail 88, damit die Ampeln oben mittig sitzen
        static let sidebarMin: CGFloat = 240
        static let sidebar: CGFloat = 240
        static let sidebarMax: CGFloat = 480
        static let panelMax: CGFloat = 520
        static let windowMinWidth: CGFloat = 720
        static let windowMinHeight: CGFloat = 480
        static let imageMax: CGFloat = 320
        // Nachrichtenspalte (Figma 640, Consti 04.11.2026 abends: bis 1040). Einzige Stellschraube: Kopf, Verlauf und Eingabe folgen ihr.
        static let column: CGFloat = 1040
        // Werte unten aus der Grok-Bot-Referenz ausgemessen (orbit-darkmode-reference-grokbot-2026-11-05.png, 2×): Spaltenrand 16,
        // Blasen bis gut zwei Drittel der Breite, 4 zwischen Blasen, 12 beim Absenderwechsel, Blase innen 12/7.
        static let columnGutter: CGFloat = 16   // Rand links und rechts der Spalte
        static let messageShare: CGFloat = 0.675   // 702 bei voller Spalte
        static let rowGap: CGFloat = 4          // zwischen Zeilen
        static let senderGap: CGFloat = 12      // beim Absenderwechsel
        static let bubblePaddingH: CGFloat = 12
        static let bubblePaddingV: CGFloat = 7
        static let composerBottom: CGFloat = 12 // Eingabe ↔ Fensterrand
        static let composerControl: CGFloat = 28 // Plus und Senden: Kreise 28
        static let composerTextInset: CGFloat = 30 // Text beginnt wie bei Grok 45 nach dem Feldrand (30 + Innenränder des Editors)
        // Einstellungen (neu 06.11.2026, Aufbau wie die macOS-Systemeinstellungen): Seitenleiste, Inhalt mittig, Gruppen aus Zeilen.
        static let settingsSidebar: CGFloat = 200
        static let settingsContent: CGFloat = 680   // Inhaltsbreite der Formular-Seiten (Marktplatz nutzt die volle Breite)
        static let settingsRow: CGFloat = 44        // Mindesthöhe einer Zeile
        static let settingsNavRow: CGFloat = 32     // Eintrag der Seitenleiste
        static let settingsGroupGap: CGFloat = 24   // zwischen Gruppen einer Seite
        static let settingsPadding: CGFloat = 32    // Rand um den Inhalt
        static let chatTop: CGFloat = 16        // Innenabstand oben über der Overlay-Pille
        static let header: CGFloat = 47         // Overlay-Kopf über dem Verlauf (Pille 41)
        static let headerGap: CGFloat = 12      // Abstand unter der Pille zum ersten Inhalt
        static let pill: CGFloat = 41           // Kopf-Pille, voll gerundet, Innenabstand 6/20/6/10
        static let liveRow: CGFloat = 20        // Live-Zeile über der Eingabe
        static let railItemWidth: CGFloat = 48   // Icon-Eintrag der Schiene 48 × 32 (S29)
        static let renameFieldWidth: CGFloat = 150   // Umbenennen-Feld in der Zeile 150 × 22 (S32)
        static let renameFieldHeight: CGFloat = 22
        static let mainBoxWidth: CGFloat = 96    // Kasten um Hauptorbi geöffnet 96 × 91 (S11)
        static let sidebarControls: CGFloat = 32 // Knopfzeile im Seitenleisten-Kopf (220 × 32 bei 240 Breite, Rand 10)
    }

    enum Metrics {
        static let pt18_4: CGFloat = 18.4
        static let pt9_2: CGFloat = 9.2
        static let pt183: CGFloat = 183
        static let pt95: CGFloat = 95
        static let pt4_5: CGFloat = 4.5
        static let pt6_8: CGFloat = 6.8
        static let pt12_2: CGFloat = 12.2
        static let pt19: CGFloat = 19

        static let pt4_4: CGFloat = 4.4
        static let pt7: CGFloat = 7
        static let pt9: CGFloat = 9
        static let pt19_25: CGFloat = 19.25
        static let pt22_4: CGFloat = 22.4
        static let pt21: CGFloat = 21
        static let pt23: CGFloat = 23
        static let pt196: CGFloat = 196
        static let pt27: CGFloat = 27
        static let pt38: CGFloat = 38
        static let pt46: CGFloat = 46
        static let pt47: CGFloat = 47
        static let pt58: CGFloat = 58
        static let pt66: CGFloat = 66
        static let pt74: CGFloat = 74
        static let pt76: CGFloat = 76
        static let pt78: CGFloat = 78
        static let pt86: CGFloat = 86
        static let pt90: CGFloat = 90
        static let pt92: CGFloat = 92
        static let pt112: CGFloat = 112
        static let pt132: CGFloat = 132
        static let pt140: CGFloat = 140
        static let pt208: CGFloat = 208
        static let pt256: CGFloat = 256
        static let pt288: CGFloat = 288
        static let pt384: CGFloat = 384
        static let pt512: CGFloat = 512
        static let pt576: CGFloat = 576
        static let pt768: CGFloat = 768

        static let pt0: CGFloat = 0
        static let pt0_5: CGFloat = 0.5
        static let pt1: CGFloat = 1
        static let pt1_5: CGFloat = 1.5
        static let pt2: CGFloat = 2
        static let pt3: CGFloat = 3
        static let pt4: CGFloat = 4
        static let pt5: CGFloat = 5
        static let pt6: CGFloat = 6
        static let pt8: CGFloat = 8
        static let pt10: CGFloat = 10
        static let pt11: CGFloat = 11
        static let pt12: CGFloat = 12
        static let pt12_8: CGFloat = 12.8
        static let pt13: CGFloat = 13
        static let pt14: CGFloat = 14
        static let pt15: CGFloat = 15
        static let pt16: CGFloat = 16
        static let pt18: CGFloat = 18
        static let pt20: CGFloat = 20
        static let pt22: CGFloat = 22
        static let pt24: CGFloat = 24
        static let pt26: CGFloat = 26
        static let pt28: CGFloat = 28
        static let pt30: CGFloat = 30
        static let pt32: CGFloat = 32
        static let pt34: CGFloat = 34
        static let pt36: CGFloat = 36
        static let pt40: CGFloat = 40
        static let pt44: CGFloat = 44
        static let pt48: CGFloat = 48
        static let pt50: CGFloat = 50
        static let pt52: CGFloat = 52
        static let pt56: CGFloat = 56
        static let pt60: CGFloat = 60
        static let pt62: CGFloat = 62
        static let pt64: CGFloat = 64
        static let pt72: CGFloat = 72
        static let pt80: CGFloat = 80
        static let pt88: CGFloat = 88
        static let pt96: CGFloat = 96
        static let pt100: CGFloat = 100
        static let pt110: CGFloat = 110
        static let pt120: CGFloat = 120
        static let pt128: CGFloat = 128
        static let pt144: CGFloat = 144
        static let pt160: CGFloat = 160
        static let pt170: CGFloat = 170
        static let pt180: CGFloat = 180
        static let pt190: CGFloat = 190
        static let pt192: CGFloat = 192
        static let pt200: CGFloat = 200
        static let pt220: CGFloat = 220
        static let pt240: CGFloat = 240
        static let pt260: CGFloat = 260
        static let pt280: CGFloat = 280
        static let pt300: CGFloat = 300
        static let pt320: CGFloat = 320
        static let pt340: CGFloat = 340
        static let pt360: CGFloat = 360
        static let pt380: CGFloat = 380
        static let pt400: CGFloat = 400
        static let pt420: CGFloat = 420
        static let pt440: CGFloat = 440
        static let pt448: CGFloat = 448
        static let pt460: CGFloat = 460
        static let pt480: CGFloat = 480
        static let pt500: CGFloat = 500
        static let pt520: CGFloat = 520
        static let pt560: CGFloat = 560
        static let pt600: CGFloat = 600
        static let pt640: CGFloat = 640
        static let pt680: CGFloat = 680
        static let pt700: CGFloat = 700
        static let pt720: CGFloat = 720
        static let pt760: CGFloat = 760
        static let pt780: CGFloat = 780
        static let pt800: CGFloat = 800
        static let pt900: CGFloat = 900
        static let pt960: CGFloat = 960
        static let pt1000: CGFloat = 1000
        static let pt1040: CGFloat = 1040
        static let pt1120: CGFloat = 1120
        static let pt1100: CGFloat = 1100
        static let pt1200: CGFloat = 1200
    }

    enum PluginStore {
        static let windowWidth: CGFloat = 1040
        static let windowHeight: CGFloat = 780
        static let cardWidth: CGFloat = 320
        static let cardHeight: CGFloat = 112
        static let logoSize: CGFloat = 28
        static let logoFrame: CGFloat = 42
        static let borderWidth: CGFloat = 1
    }

    // Deckkraft deaktivierter Grundteile (Figma „Grundteile“: Knopf, Feld, Schalter, Checkbox, Menüeintrag 40 %, Icon-Knopf 35 %).
    enum Opacity {
        static let disabled = 0.4
        static let iconDisabled = 0.35
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    // Bewegung der Web-UI, gemessen per document.getAnimations() (plan/archiv/PARITY.md). Jede Kurve auch als Funktion für Bildfolgen im Selbsttest.
    enum MediaViewer {
        static let widthFraction: CGFloat = 0.96
        static let heightFraction: CGFloat = 0.94
        static let viewportPadding: CGFloat = 32
    }

    enum Onboarding {
        static let sparkleScale: CGFloat = 0.6
        static let sparkleDimOpacity = 0.5
        static let sparkleCurve: CGFloat = 0.22
        static let sparkles: [(x: CGFloat, y: CGFloat, size: CGFloat, color: Color, delay: Double)] = [
            (-0.30, -0.36, 0.13, .yellow.opacity(0.85), 0), (0.02, -0.44, 0.11, .purple.opacity(0.45), 0.3), (0.38, -0.20, 0.10, .cyan.opacity(0.6), 0.6),
            (0.46, 0.02, 0.10, .yellow.opacity(0.85), 0.9), (0.30, 0.26, 0.12, .pink.opacity(0.6), 0.2), (0.06, 0.44, 0.09, .mint.opacity(0.7), 0.5),
            (-0.26, 0.32, 0.14, .yellow.opacity(0.85), 0.8), (-0.42, 0.04, 0.10, .purple.opacity(0.45), 0.1), (-0.40, -0.16, 0.08, .mint.opacity(0.7), 0.7),
            (0.24, -0.36, 0.08, .pink.opacity(0.6), 0.4),
        ]
    }

    enum Motion {
        static let onboardingSparkle = Animation.easeInOut(duration: 1.1).repeatForever(autoreverses: true)
        static let figureTransition = 0.6
        static let figureGazeReturn = 1.6
        static let selectedGazeDuration = 0.7...0.9
        static let workingGazeDuration = 0.55...0.8
        static let gazeInterval = 1.2...2.5
        static let doneHopInterval = 1.3...1.9
        static let typingDotDuration = 1.2
        static let shimmerPeriod = 4.0
        static let shimmerSweep = 1.4
        static let jevPulseDuration = 1.2
        static let skeletonDuration = 1.0
        static let copyFeedbackDuration = 1.5
        static let pulsePeriod = 2.0
        static let sweepPeriod = 5.0
        static let pulse = Curve(x1: 0.4, y1: 0, x2: 0.6, y2: 1, duration: 1)
        static let copyFeedback = 1.5
        static let highlight = 0.4
        static let geometryFreeze = 0.25
        // Nach dem Öffnen eines Chats: so lange folgen Höhenänderungen (Zeilen messen sich nach) dem Ende, solange niemand scrollt.
        static let pinSettle = 0.7
        static let jumpDelay = 0.2
        struct Curve: Sendable {
            let x1, y1, x2, y2: Double
            let duration: Double
            var animation: Animation { .timingCurve(x1, y1, x2, y2, duration: duration) }
            // Fortschritt zur Zeit t (Sekunden) wie CSS cubic-bezier.
            func value(at t: Double) -> Double {
                let u = min(1, max(0, t / duration))
                var s = u
                for _ in 0..<12 {
                    let x = bez(s, x1, x2) - u
                    let d = (bez(s + 1e-4, x1, x2) - bez(s - 1e-4, x1, x2)) / 2e-4
                    if abs(x) < 1e-6 || d == 0 { break }
                    s = min(1, max(0, s - x / d))
                }
                return bez(s, y1, y2)
            }
            private func bez(_ s: Double, _ a: Double, _ b: Double) -> Double {
                3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s
            }
        }
        // Farbwechsel, Hover, Deckkraft der Aktionen (Tailwind transition, 150 ms).
        static let hover = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.15)
        // Menüs, Selects, Dialoge auf/zu (tw-animate, 100 ms ease).
        static let pop = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.1)
        // Einblenden der Marke (animate-in fade-in duration-300, ease).
        static let fadeIn = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.3)
        // Tooltip (tw-animate Standard, 150 ms ease).
        static let tooltip = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.15)
        // Rechtes Panel (380 ms) und Seitenleiste (300 ms): cubic-bezier(.32,.72,0,1).
        static let panel = Curve(x1: 0.32, y1: 0.72, x2: 0, y2: 1, duration: 0.38)
        static let sidebar = Curve(x1: 0.32, y1: 0.72, x2: 0, y2: 1, duration: 0.3)
        // Markierung im Segment-Reiter (200 ms ease-out).
        static let tab = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.2)
        // Neue Nachricht (300 ms ease-out, 8 pt von unten).
        static let enter = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.3)
        static let enterOffset: CGFloat = 8
        // Kopf rastet nach dem Loslassen ein (easeOut kubisch).
        static let headerSnap = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 0.3)
        // Kurven der Orbi-Keyframes (CSS ease-in-out / ease-out), je Abschnitt angewendet.
        static let easeInOut = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1, duration: 1)
        static let easeOutCSS = Curve(x1: 0, y1: 0, x2: 0.58, y2: 1, duration: 1)
        // Schreib-Punkte (typing-dot): 1,2 s ease-in-out, Versatz 160 ms; „arbeitet…“-Punkte (orbi-dot): 1,2 s, Versatz 200 ms.
        static let typingDot = Keyframes(stops: [(0, [0, 0.35]), (0.3, [-3, 1]), (0.6, [0, 0.35]), (1, [0, 0.35])], curve: easeInOut)
        static let workingDot = Keyframes(stops: [(0, [0.25]), (0.4, [1]), (0.8, [0.25]), (1, [0.25])], curve: easeInOut)
        // Vor Ablauf der Verzögerung gilt wie in CSS (ohne fill-mode) der Grundstil: an Ort und voll sichtbar.
        static func dot(_ frames: Keyframes, at t: Double, delay: Double) -> [Double] {
            if t < delay { return frames.stops[0].value.count == 2 ? [0, 1] : [1] }
            return frames.sample((t - delay).truncatingRemainder(dividingBy: typingDotDuration) / typingDotDuration)
        }
        // Gedrückter Knopf: 1 pt tiefer.
        static let pressOffset: CGFloat = 1
    }

    // Farben der gezeichneten Orbi-Figuren (Core Graphics, aus dem Planeten-Prototyp). Zustände stehen als Text (kein Ring, kein Abzeichen).
    enum Figure {
        static func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> CGColor {
            CGColor(srgbRed: r, green: g, blue: b, alpha: a)
        }
        static let ink = rgb(27.0 / 255, 29.0 / 255, 42.0 / 255)
        static let white = rgb(1, 1, 1)
        static let gear = rgb(42.0 / 255, 45.0 / 255, 62.0 / 255)      // Mütze, Kopfhörer
        static let cheek = rgb(1, 128.0 / 255, 143.0 / 255, 0.24)
        static let stage = rgb(0, 0, 0)                   // Bühne im Anpassungsmenü
    }

    // Zustandsfarben der Werkzeugzeilen (Tailwind 600er-Stufen wie components/ai-elements/tool.tsx); nie allein, immer mit Text/Symbol.
    enum Status {
        static let success = Color("status-success")
        static let warning = Color("status-warning")
        static let info = Color("status-info")
        static let caution = Color("status-caution")
        static let danger = Color("status-danger")
        static let star = Color("status-star")
        static let badge = Color("status-badge")
        // Status-Punkt der Seitenleiste (blau = info): rechts in der Zeile, eingeklappt oben rechts am Orbi (Phase 5, plan/DESIGN-SYSTEM.md).
        static let dotSize: CGFloat = 12
        static let dotRing: CGFloat = 2    // Rand in Seitenleistenfarbe, damit der Punkt am Orbi sauber absetzt
        // Figma S8/A6: Punkt in der Zeile 8 ohne Ring, an der Schiene 11 mit Rand 2; „fertig“ erscheint 2,3 s nach dem Wechsel mit kurzem Aufspringen.
        static let dotSizeRow: CGFloat = 8
        static let dotSizeRail: CGFloat = 11
        static let doneDelay: Double = 2.3
        static let popAnimation = Animation.spring(response: 0.32, dampingFraction: 0.5)
    }

    // Champagner-Gold der höchsten Denktiefe (Max): dieselben Stufen wie `.effort-gold` in app/globals.css.
    enum Gold {
        static let stops: [Gradient.Stop] = [
            .init(color: Color(red: 176.0 / 255, green: 141.0 / 255, blue: 74.0 / 255), location: 0),      // #b08d4a
            .init(color: Color(red: 201.0 / 255, green: 164.0 / 255, blue: 92.0 / 255), location: 0.30),   // #c9a45c
            .init(color: Color(red: 1.0, green: 244.0 / 255, blue: 214.0 / 255), location: 0.46),     // #fff4d6
            .init(color: Color(red: 243.0 / 255, green: 213.0 / 255, blue: 143.0 / 255), location: 0.54),   // #f3d58f
            .init(color: Color(red: 201.0 / 255, green: 164.0 / 255, blue: 92.0 / 255), location: 0.70),   // #c9a45c
            .init(color: Color(red: 176.0 / 255, green: 141.0 / 255, blue: 74.0 / 255), location: 1),      // #b08d4a
        ]
        static let thumb = Color(red: 232.0 / 255, green: 199.0 / 255, blue: 122.0 / 255)                   // #e8c77a (Griff und Glühen)
        static let period = 3.2
    }

    // SF Pro wie in Figma vorgesehen; Geist Mono bleibt für Code.
    // Größen und Zeilenhöhen sind die Tailwind-Stufen der Web-UI (text-xs 12/16, text-sm 14/20, text-base 16/24).
    enum Fonts {
        static let size10_5: CGFloat = 10.5
        static let symbol = Font.system(size: 12)
        static let size72: CGFloat = 72
        static let size64: CGFloat = 64
        static let size56: CGFloat = 56
        static let size52: CGFloat = 52
        static let size48: CGFloat = 48
        static let size40: CGFloat = 40
        static let size36: CGFloat = 36
        static let size32: CGFloat = 32
        static let size30: CGFloat = 30
        static let size28: CGFloat = 28
        static let size24: CGFloat = 24
        static let size20: CGFloat = 20
        static let size18: CGFloat = 18
        static let size17: CGFloat = 17
        static let size16: CGFloat = 16
        static let size15: CGFloat = 15
        static let size14: CGFloat = 14
        static let size13: CGFloat = 13
        static let size12_8: CGFloat = 12.8
        static let size12: CGFloat = 12
        static let size11: CGFloat = 11
        static let size10: CGFloat = 10
        enum Reference {
            static let body: CGFloat = 17
            static let bodyLine: CGFloat = 22
            static let callout: CGFloat = 15
            static let subhead: CGFloat = 13
            static let caption: CGFloat = 11
            static let title: CGFloat = 20
            static let largeTitle: CGFloat = 24
        }
        // Kompatibler Aufrufname; alle Oberflächen verwenden SF Pro.
        static func geist(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight)
        }
        static let headline = geist(17)
        static let callout = geist(15)
        static let subhead = geist(13)
        static let caption = geist(11)
        static let body = geist(14)
        static let bodyMedium = geist(14, .medium)
        static let small = geist(12)
        static let smallMedium = geist(12, .medium)
        static let title = geist(16, .semibold)
        static let brand = geist(18, .semibold)
        static let largeTitle = geist(24, .semibold)
        static let mono = Font.custom("Geist Mono", size: 13)
        // Blasen- und Eingabetext wie Grok Bot: 15 auf Zeilenhöhe 22.
        static let message = geist(15)
        // Seitentitel der Einstellungen.
        static let settingsTitle = geist(20, .semibold)
        static func mono(_ size: CGFloat) -> Font { .custom("Geist Mono", size: size) }

        // Zeilenhöhen der Web-UI (px): Mehrzeiliger Text bekommt den Abstand über lineSpacing (Schrifthöhe aus Geist).
        static let bodyLine: CGFloat = 20
        static let smallLine: CGFloat = 16
        static let titleLine: CGFloat = 24
        // Blasentext (Figma 26:10384, 26:10449): 14/22.
        static let bubbleLine: CGFloat = 22

        static func lineSpacing(size: CGFloat, line: CGFloat) -> CGFloat {
            let font = NSFont.systemFont(ofSize: size)
            return max(0, line - (font.ascender - font.descender + font.leading))
        }
    }

    // Geist liegt als Datei im Bundle und wird beim Start des Prozesses registriert (alle Modi, auch Selbsttests).
    static func registerFonts() {
        for name in ["Geist-Variable", "GeistMono-Variable"] {
            if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }
}

extension Color {
    // Orbi-Farben kommen als "#rrggbb" aus dem Dienst (Datenwert, kein fester Farbwert im Code).
    init?(serviceHex hex: String?) {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16)
        else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

// Akzentfarbe des geöffneten Chats (Web: ChatAccent). Nur auf dem Hauptthread geschrieben; Lesen in Views wird beobachtet.
@Observable final class AccentStore: @unchecked Sendable {
    struct Accent {
        let color: Color
        let onColor: Color
        let bubbleText: Color
    }

    static let shared = AccentStore()
    private(set) var accent: Accent?

    // hex = "#rrggbb" oder nil (Standard-Design).
    func set(hex: String?) { accent = Self.make(hex: hex) }

    static func make(hex: String?) -> Accent? {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        let r = Double((value >> 16) & 0xFF) / 255, g = Double((value >> 8) & 0xFF) / 255, b = Double(value & 0xFF) / 255
        func lin(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        let luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        let plain = 0.299 * r + 0.587 * g + 0.114 * b
        return Accent(
            color: Theme.OrbiColor.lookup(hex: hex)?.bubble ?? Color(red: r, green: g, blue: b),
            onColor: Theme.OrbiColor.lookup(hex: hex) != nil ? .white : luminance > 0.4 ? Color(white: 0.102) : .white,   // wie onColor() im Web (#1a1a1a oder weiß)
            bubbleText: Theme.OrbiColor.lookup(hex: hex) != nil ? .white : plain > 0.6 ? Color(white: 0.0667) : .white)    // wie bubbleStyle() im Web (#111 oder weiß)
    }
}

// Keyframes wie CSS @keyframes: Abschnitt für Abschnitt mit eigener Kurve (animation-timing-function gilt je Abschnitt).
struct Keyframes: Sendable {
    let stops: [(at: Double, value: [Double])]
    let curve: Theme.Motion.Curve
    func sample(_ phase: Double) -> [Double] {
        let p = min(1, max(0, phase))
        guard let j = stops.firstIndex(where: { $0.at >= p }) else { return stops.last!.value }
        if j == 0 { return stops[0].value }
        let a = stops[j - 1], b = stops[j]
        let k = curve.value(at: (p - a.at) / max(1e-9, b.at - a.at) * curve.duration)
        return zip(a.value, b.value).map { $0 + ($1 - $0) * k }
    }
}
