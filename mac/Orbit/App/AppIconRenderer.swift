import AppKit
import CoreGraphics

// Fertige Entwürfe für das App-Symbol: Form, Blickrichtung, Neigung, Lage und Größe sind festgelegt, einfarbiger Hintergrund;
// änderbar sind nur Orbi-Farbe und Hintergrundfarbe (Einstellungen › Darstellung › App-Symbol).
struct AppIconDesign: Identifiable, Sendable {
    let id: String
    let name: String
    let shape: OrbiShape
    var color: String? = nil          // Orbi-Farbe des Entwurfs (nil = Originalfarbe der Form)
    let background: String            // Hintergrund des Entwurfs
    var gazeX = 0, gazeY = 0          // -1 links/oben, 1 rechts/unten
    var tilt = 0                      // -1 nach links, 1 nach rechts geneigt
    var posX = 0.0, posY = 0.0        // Verschiebung in Kachelbreiten
    var size = 1.0

    static let all: [AppIconDesign] = [
        .init(id: "aufblick", name: "Aufblick", shape: .strobi, background: "#dbe4ff", gazeX: -1, gazeY: -1, tilt: 1),
        .init(id: "neugier", name: "Neugier", shape: .citrus, background: "#1f2937", gazeX: 1, gazeY: 0, tilt: -1),
        .init(id: "sonne", name: "Sonne", shape: .sunee, background: "#1e3a8a", size: 0.84),
        .init(id: "wolke", name: "Wolke", shape: .cloudee, color: "#ffffff", background: "#7dd3fc", gazeX: 1, gazeY: 1, size: 0.92),
        .init(id: "gucker", name: "Gucker", shape: .kirby, background: "#fbcfe8", gazeY: -1, posY: 0.2, size: 1.2),
        .init(id: "spaeher", name: "Späher", shape: .cubee, background: "#fde047", gazeX: -1, gazeY: 1, tilt: 1, posX: 0.18, posY: -0.16, size: 1.35),
        .init(id: "tropfen", name: "Tropfen", shape: .tropi, background: "#0f172a", gazeY: -1, tilt: 1),
        .init(id: "raute", name: "Raute", shape: .rauti, background: "#f5d0fe", gazeX: -1, gazeY: 1, tilt: -1),
        .init(id: "teddy", name: "Teddy", shape: .mopsi, background: "#166534", size: 1.05),
        .init(id: "nova", name: "Nova", shape: .nova, background: "#fed7aa", gazeX: 1, gazeY: -1, tilt: 1),
        .init(id: "schwarz", name: "Schwarz", shape: .grokbot, background: "#fafafa", size: 1.1),
        .init(id: "dreieck", name: "Dreieck", shape: .trixi, background: "#fecaca", gazeX: -1, gazeY: -1, tilt: 1),
    ]
    static func named(_ id: String) -> AppIconDesign { all.first { $0.id == id } ?? all[0] }
}

// Wahl: Entwurf plus eigene Orbi- und Hintergrundfarbe (nil = die des Entwurfs).
struct AppIconConfig: Codable, Equatable, Sendable {
    var design = "aufblick"
    var colorHex: String?
    var backgroundHex: String?

    static let standard = AppIconConfig()
}

// `Orbit --app-icon <Ordner>` zeichnet das Standard-Symbol (großer Orbi, nach rechts geneigt, Blick links oben) in allen Größen des Symbolsatzes.
// Kachel nach dem macOS-Raster (824 von 1024, Schatten darunter), Orbi aus der Lab-Engine wie in der App.
@MainActor
enum AppIconRenderer {
    static let sizes: [(String, Int)] = [
        ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32), ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256), ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
    ]

    // Einfarbige Hintergründe zur Auswahl: erst Neutrale (Weiß, Hellgrau, Nachtblau, Schwarz), dann kräftige Farben nach dem Farbkreis.
    static let backgroundColors = ["#ffffff", "#cbd5e1", "#0f172a", "#111111", "#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"]

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

    // Ausdruck des Orbis im Symbol: Blickrichtung, Neigung, größere Augen fürs kleine Bild.
    private static func expression(_ d: AppIconDesign) -> AvatarExpression {
        var e = AvatarEngine.shared.definition(d.shape).neutral
        e.v[0] = Double(-d.gazeY) * 15
        e.v[1] = Double(d.gazeX) * 17
        e.v[2] = Double(d.tilt) * 16
        let up = d.gazeY < 0 ? -6.0 : d.gazeY > 0 ? 8.0 : 0   // Augen im Gesicht nach oben/unten
        e.v[10] += up; e.v[11] += up
        e.v[3] = 26; e.v[4] = 26; e.v[5] = 60; e.v[6] = 60
        e.v[7] = max(e.v[7], 38) < 60 ? 38 : e.v[7]
        return e
    }

    static func image(_ config: AppIconConfig, side px: Int) -> CGImage? {
        let design = AppIconDesign.named(config.design)
        let colorHex = config.colorHex ?? design.color
        let look = colorHex.map { OrbiLook(avatar: design.shape.rawValue, colorHex: $0) } ?? OrbiLook(shape: design.shape)
        let geometry = AvatarEngine.shared.geometry(shape: design.shape, expression: expression(design), blink: 1, fine: true)
        let size = CGSize(width: px, height: px)
        let background = config.backgroundHex ?? design.background
        return FigureRenderer.image(size: size, scale: 1) { draw($0, side: CGFloat(px), look: look, geometry: geometry, design: design, background: background) }
    }

    static func nsImage(_ config: AppIconConfig, side: Int = 512) -> NSImage? {
        image(config, side: side).map { NSImage(cgImage: $0, size: NSSize(width: side, height: side)) }
    }

    private static func color(_ hex: String) -> CGColor {
        let c = FigurePalette.rgb(hex: hex) ?? .init(r: 0.9, g: 0.9, b: 1)
        return CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }

    private static func draw(_ g: CGContext, side: CGFloat, look: OrbiLook, geometry: AvatarGeometry, design: AppIconDesign, background: String) {
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
        let figure = tile * 0.9 * design.size * min(1, 250 / extent)
        let c = FigureRenderer.engineScale * figure / 80          // Engine-Einheit → Punkt
        let dx = CGFloat(design.posX) * tile - bounds.midX * c
        let dy = CGFloat(design.posY) * tile - bounds.midY * c + tile * 0.015
        g.translateBy(x: rect.midX - figure / 2 + dx, y: rect.midY - figure / 2 + dy)
        FigureRenderer.draw(g, size: CGSize(width: figure, height: figure), look: look, geometry: geometry)
        g.restoreGState()
    }
}
