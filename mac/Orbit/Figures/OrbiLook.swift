import Foundation

// Augenform nach Wahl im Anpassungsmenü; ohne Wahl zeichnet die Figur die Augen ihres Web-SVGs.
enum EyeShape: String, CaseIterable, Sendable { case round, square, triangle }
enum Accessory: String, CaseIterable, Sendable { case none, cap, glasses, sunglasses, headphones }

// Anpassung der Figur im Dienst (`bots.look`, plan/API.md); fehlende Felder = Standard.
struct BotLook: Codable, Hashable, Sendable {
    var eyes: String?
    var accessory: String?
    var cheeks: Bool?
    var gaze: Double?
    var reaction: Double?
}

// Die Avatare: die Vorlagen des Avatar-Labs (Strobi bis Onee) plus Rauti, Trixi, Tropi, Mopsi und Pfeili aus dessen Grundformen.
// Einfarbig; Umrisse und Augen berechnet die Lab-Engine (AvatarEngine), Daten in AvatarAnimData (scripts/avatar-lab).
enum OrbiShape: String, CaseIterable, Sendable {
    case strobi, freddy, citrus, nova, grokbot, sunee, kirby, cloudee, cubee, onee, rauti, trixi, tropi, mopsi, dosi

    // Alte Planetennamen im Dienst werden einem Avatar zugeordnet; unbekannte Namen stabil per Hash.
    private static let legacy: [String: OrbiShape] = [
        "erdi": .strobi, "marsi": .cubee, "sati": .onee, "jupi": .citrus, "mondi": .freddy,
        "veni": .kirby, "nepi": .trixi, "urani": .rauti, "pluti": .nova, "universi": .sunee,
    ]

    init(avatar: String) {
        let name = avatar.lowercased()
        if let exact = OrbiShape(rawValue: name) ?? Self.legacy[name] { self = exact; return }
        var hash: UInt32 = 0
        for scalar in avatar.unicodeScalars { hash = hash &* 31 &+ scalar.value }
        self = Self.allCases[Int(hash % UInt32(Self.allCases.count))]
    }

    // Name wie in der Vorlage; zugleich der Vorschlag für den Orbi-Namen.
    var displayName: String { self == .grokbot ? "Grok bot" : rawValue.prefix(1).uppercased() + rawValue.dropFirst() }

    // Name im Dienst (`bots.avatar`).
    var serviceName: String { rawValue }

    // Farbton, Stärke und Hex je Avatar (Körperfarbe der Vorlage).
    private static let paletteNames: [OrbiShape: String] = [
        .strobi: "blau",
        .freddy: "braun",
        .citrus: "gelborange",
        .nova: "tuerkis",
        .grokbot: "grau",
        .sunee: "limette",
        .kirby: "pink",
        .cloudee: "weiss",
        .cubee: "rot",
        .onee: "himmel",
        .rauti: "indigo",
        .trixi: "violett",
        .tropi: "gruen",
        .mopsi: "fuchsia",
        .dosi: "orange",
    ]
    var paletteColor: Theme.OrbiColor { Theme.OrbiColor.all.first { $0.name == Self.paletteNames[self] }! }
    var defaultHue: Double { FigureColor.hueAndSaturation(hex: baseHex)!.hue }
    var defaultSaturation: Double { FigureColor.hueAndSaturation(hex: baseHex)!.saturation }
    var baseHex: String { paletteColor.lightHex }

    // Vorlagen mit weißen Augen (Freddy, Grok bot): Augen bleiben bis zu hellen Körpern weiß.
    var lightEyes: Bool { self == .freddy || self == .grokbot }
}

// Aussehen einer Figur. Farbton und Stärke kommen aus der Orbi-Farbe des Dienstes ("#rrggbb"); fehlt sie, gilt die Grundfarbe.
// Augenform und Merkmal hängen an der Form (Tabelle der Design-Vorgaben); Zubehör und Wangen folgen mit 4a-2.
struct OrbiLook: Equatable, Sendable {
    static let defaultGaze = 1.0
    static let defaultReaction = 0.11

    var shape: OrbiShape
    // Farbton (Grad) und Stärke (Prozent, 20 bis 90) in HSL; ändert man sie, gilt die daraus gemischte Farbe statt der gespeicherten.
    var hue: Double { didSet { customColor = true; exactHex = nil } }
    var saturation: Double { didSet { customColor = true; exactHex = nil } }
    private var customColor = false
    private var exactHex: String?  // Farbe des Dienstes, unverändert gezeichnet (wie das Web)
    var eyes: EyeShape?      // nil = Augenform der Form
    var accessory: Accessory = .none
    var cheeks = false
    var gaze = OrbiLook.defaultGaze           // Blickstärke 0 bis 1
    var reaction = OrbiLook.defaultReaction   // Reaktionszeit der Pupille in Sekunden

    init(shape: OrbiShape, hue: Double? = nil, saturation: Double? = nil) {
        self.shape = shape
        self.hue = hue ?? shape.defaultHue
        self.saturation = max(20, min(90, saturation ?? shape.defaultSaturation))
        customColor = hue != nil || saturation != nil
    }

    // Körperfarbe: die gespeicherte Farbe des Dienstes, sonst die aus Farbton und Stärke, sonst die Grundfarbe.
    var bodyHex: String { exactHex ?? (customColor ? serviceColorHex : shape.baseHex) }

    init(avatar: String, colorHex: String?, look: BotLook? = nil) {
        let shape = OrbiShape(avatar: avatar)
        let parsed = FigureColor.hueAndSaturation(hex: colorHex)
        self.init(shape: shape, hue: parsed?.hue, saturation: parsed?.saturation)
        if parsed != nil, let colorHex { exactHex = colorHex.lowercased() }
        if let look {
            eyes = look.eyes.flatMap(EyeShape.init(rawValue:))
            accessory = look.accessory.flatMap(Accessory.init(rawValue:)) ?? .none
            cheeks = look.cheeks ?? false
            gaze = max(0, min(1, look.gaze ?? Self.defaultGaze))
            reaction = max(0.04, min(0.4, look.reaction ?? Self.defaultReaction))
        }
    }

    // Für den Dienst: nur abweichende Felder, nil = alles Standard.
    var serviceLook: BotLook? {
        let look = BotLook(
            eyes: eyes?.rawValue, accessory: accessory == .none ? nil : accessory.rawValue, cheeks: cheeks ? true : nil,
            gaze: gaze == Self.defaultGaze ? nil : gaze, reaction: reaction == Self.defaultReaction ? nil : reaction)
        return look == BotLook() ? nil : look
    }

    // Farbe als "#rrggbb" für den Dienst: Farbton und Stärke als HSL-Sättigung bei Helligkeit 57. Beim Lesen (`init(avatar:colorHex:)`)
    // kommen dieselben Werte zurück; erst das Zeichnen nimmt die Sättigung mal 0,92.
    var serviceColorHex: String {
        let (r, g, b) = hslToRGB(hue, saturation, 57)
        func hex(_ v: Double) -> String { String(format: "%02x", Int((max(0, min(1, v)) * 255).rounded())) }
        return "#\(hex(r))\(hex(g))\(hex(b))"
    }

    // Farbton des Körpers im OKLCH-Raum (Körper: HSL-Helligkeit 57 wie beim Zeichnen).
    var oklchHue: Double {
        let (r, g, b) = hslToRGB(hue, saturation * 0.92, 57)
        return FigureColor.oklchHue(r: r, g: g, b: b)
    }
}

// Doppelgänger-Regel: gleiche Form und OKLCH-Farbton-Abstand unter 28 Grad gilt als zu ähnlich.
enum Similarity {
    static let threshold = 28.0

    // Kleinster Abstand auf dem Farbkreis (Grad): 350° und 10° liegen 20° auseinander.
    static func hueDistance(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return min(d, 360 - d)
    }

    static func isTwin(_ a: OrbiLook, _ b: OrbiLook) -> Bool {
        a.shape == b.shape && hueDistance(a.oklchHue, b.oklchHue) < threshold
    }

    // Nächste freie Farbe: der HSL-Farbton mit dem größten Mindestabstand (OKLCH) zu allen anderen Figuren derselben Form
    // (`others` enthält nur die anderen, nicht die Figur selbst); bei gleichem Abstand gewinnt der Farbton, der dem bisherigen am nächsten liegt.
    static func nextFreeHue(for look: OrbiLook, among others: [OrbiLook]) -> Double {
        let same = others.filter { $0.shape == look.shape }
        guard !same.isEmpty else { return look.hue }
        var best = look.hue, bestDistance = -1.0, bestShift = 360.0
        for step in 0..<360 {
            let hue = Double(step)
            let candidate = OrbiLook(shape: look.shape, hue: hue, saturation: look.saturation)
            let distance = same.map { hueDistance(candidate.oklchHue, $0.oklchHue) }.min() ?? 180
            let shift = hueDistance(hue, look.hue)
            if distance > bestDistance + 0.5 || (abs(distance - bestDistance) <= 0.5 && shift < bestShift) {
                best = hue; bestDistance = distance; bestShift = shift
            }
        }
        return best
    }
}
