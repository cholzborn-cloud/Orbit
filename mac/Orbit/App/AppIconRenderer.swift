import AppKit
import CoreGraphics

// Fertige App-Symbole: Figur, Blickrichtung und Hintergrund sind je Entwurf festgelegt (nicht einstellbar). Wählbar sind nur der Entwurf
// und optional eine Orbi- und Hintergrundfarbe, die dann für alle Entwürfe gleich gilt. Neigung und Größe legt der Renderer einheitlich fest.
struct AppIconDesign: Identifiable, Sendable {
    let id: String
    let name: String
    let shape: OrbiShape
    let background: String
    var gazeX = 0, gazeY = 0          // -1 links/oben, 1 rechts/unten

    static let all: [AppIconDesign] = [
        .init(id: "aufblick", name: "Aufblick", shape: .strobi, background: "#dbe4ff", gazeX: -1, gazeY: -1),
        .init(id: "sonne", name: "Sonne", shape: .sunee, background: "#1e3a8a"),
        .init(id: "wolke", name: "Wolke", shape: .cloudee, background: "#7dd3fc", gazeX: 1, gazeY: 1),
        .init(id: "gucker", name: "Gucker", shape: .kirby, background: "#fbcfe8", gazeY: -1),
        .init(id: "teddy", name: "Teddy", shape: .mopsi, background: "#166534"),
        .init(id: "nova", name: "Nova", shape: .nova, background: "#fed7aa", gazeX: 1, gazeY: -1),
    ]
    static func named(_ id: String) -> AppIconDesign { all.first { $0.id == id } ?? all[0] }
}

// Wahl: Entwurf plus optional eigene Orbi- und Hintergrundfarbe (nil = die des Entwurfs).
struct AppIconConfig: Codable, Equatable, Sendable {
    var design = "aufblick"
    var colorHex: String?
    var backgroundHex: String?

    static let standard = AppIconConfig()

    init(design: String = "aufblick", colorHex: String? = nil, backgroundHex: String? = nil) {
        self.design = design; self.colorHex = colorHex; self.backgroundHex = backgroundHex
    }

    // Auch ältere Einstellungen lesen sich ohne Fehler.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = (try? c.decode(String.self, forKey: .design)) ?? "aufblick"
        design = AppIconDesign.all.contains { $0.id == id } ? id : "aufblick"
        colorHex = try? c.decode(String.self, forKey: .colorHex)
        backgroundHex = try? c.decode(String.self, forKey: .backgroundHex)
    }
}

// `Orbit --app-icon <Ordner>` zeichnet das Standard-Symbol (Strobi, Blick links oben) in allen Größen des Symbolsatzes.
// Kachel nach dem macOS-Raster (824 von 1024, Schatten darunter), Orbi aus der Lab-Engine wie in der App.
@MainActor
enum AppIconRenderer {
    static let sizes: [(String, Int)] = [
        ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32), ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256), ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
    ]

    // Wenige Hintergründe zur Auswahl: Weiß, Nachtblau und vier kräftige Farben.
    static let orbiColors = ["#3b82f6", "#ef4444", "#f97316", "#22c55e", "#8b5cf6", "#ec4899"]
    static let backgroundColors = ["#ffffff", "#0f172a", "#ef4444", "#facc15", "#22c55e", "#3b82f6"]

    static func run(directory: String) -> Int32 {
        let dir = URL(fileURLWithPath: directory)
        do { try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) } catch { return 1 }
        for (name, px) in sizes {
            guard let image = image(.standard, side: px), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { return 1 }
            do { try png.write(to: dir.appending(path: name)) } catch { return 1 }
        }
        print("App-Symbol: \(dir.path)")
        return 0
    }

    // Ausdruck des Orbis im Symbol: Blickrichtung, Kopf leicht gegen die Blickrichtung geneigt, größere Augen fürs kleine Bild.
    private static func expression(_ c: AppIconDesign) -> AvatarExpression {
        var e = AvatarEngine.shared.definition(c.shape).neutral
        e.v[0] = Double(-c.gazeY) * 15
        e.v[1] = Double(c.gazeX) * 17
        e.v[2] = Double(-c.gazeX) * 16
        let up = c.gazeY < 0 ? -6.0 : c.gazeY > 0 ? 8.0 : 0   // Augen im Gesicht nach oben/unten
        e.v[10] += up; e.v[11] += up
        e.v[3] = 26; e.v[4] = 26; e.v[5] = 60; e.v[6] = 60
        e.v[7] = max(e.v[7], 38) < 60 ? 38 : e.v[7]
        return e
    }

    // Einheitliche Größe je Figur (Anteil der Kachel), damit schmale und breite Figuren gleich viel Platz füllen.
    private static func scale(_ shape: OrbiShape) -> Double {
        switch shape {
        case .sunee: 0.84
        case .cloudee: 0.92
        case .kirby: 1.0
        case .cubee: 0.98
        case .mopsi: 1.0
        case .grokbot: 1.0
        default: 1
        }
    }

    static func image(_ config: AppIconConfig, side px: Int) -> CGImage? {
        let design = AppIconDesign.named(config.design)
        let shape = design.shape
        let look = config.colorHex.map { OrbiLook(avatar: shape.rawValue, colorHex: $0) } ?? OrbiLook(shape: shape)
        let geometry = AvatarEngine.shared.geometry(shape: shape, expression: expression(design), blink: 1, fine: true)
        let size = CGSize(width: px, height: px)
        let background = config.backgroundHex ?? design.background
        return FigureRenderer.image(size: size, scale: 1) { draw($0, side: CGFloat(px), look: look, geometry: geometry, size: scale(shape), background: background) }
    }

    static func nsImage(_ config: AppIconConfig, side: Int = 512) -> NSImage? {
        image(config, side: side).map { NSImage(cgImage: $0, size: NSSize(width: side, height: side)) }
    }

    private static func color(_ hex: String) -> CGColor {
        let c = FigurePalette.rgb(hex: hex) ?? .init(r: 0.9, g: 0.9, b: 1)
        return CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }

    private static func draw(_ g: CGContext, side: CGFloat, look: OrbiLook, geometry: AvatarGeometry, size designSize: Double, background: String) {
        let tile = side * 824 / 1024
        let rect = CGRect(x: (side - tile) / 2, y: (side - tile) / 2, width: tile, height: tile)
        let path = CGPath(roundedRect: rect, cornerWidth: tile * 0.225, cornerHeight: tile * 0.225, transform: nil)
        g.saveGState()
        g.setShadow(offset: CGSize(width: 0, height: -side * 0.012), blur: side * 0.03, color: CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.3))
        g.addPath(path); g.setFillColor(color(background)); g.fillPath()
        g.restoreGState()
        g.saveGState()
        g.addPath(path); g.clip()
        // Orbi: Rahmen des Umrisses messen (Satelliten, Wolken), passend einpassen, dann Größe und Lage anwenden.
        var bounds = CGRect.null
        for p in geometry.back + [geometry.head] + geometry.front { bounds = bounds.union(p.boundingBox) }
        let extent = max(bounds.width, bounds.height, 1)
        let figure = tile * 0.9 * designSize * min(1, 250 / extent)
        let c = FigureRenderer.engineScale * figure / 80          // Engine-Einheit → Punkt
        let dx = -bounds.midX * c
        let dy = -bounds.midY * c + tile * 0.015
        g.translateBy(x: rect.midX - figure / 2 + dx, y: rect.midY - figure / 2 + dy)
        FigureRenderer.draw(g, size: CGSize(width: figure, height: figure), look: look, geometry: geometry)
        g.restoreGState()
    }
}
