import CoreGraphics
import SwiftUI

extension CGContext {
    func scope(_ body: () -> Void) { saveGState(); body(); restoreGState() }
    func about(_ x: Double, _ y: Double, _ body: () -> Void) { translateBy(x: x, y: y); body(); translateBy(x: -x, y: -y) }
}

// Farben wie `tint()` in components/tinted-avatar.tsx: Körperfarbe ersetzt die Grundfarbe der Form; helle Körper bekommen dunkle statt weißer Tupfer.
struct FigurePalette {
    let shape: OrbiShape
    let body: RGB
    private let hsl: (h: Double, s: Double, l: Double)

    struct RGB: Equatable { var r: Double, g: Double, b: Double }

    init(look: OrbiLook) {
        shape = look.shape
        body = Theme.OrbiColor.lookup(hex: look.bodyHex).flatMap { NSColor($0.color).usingColorSpace(.sRGB) }.map { RGB(r: $0.redComponent, g: $0.greenComponent, b: $0.blueComponent) } ?? Self.rgb(hex: look.bodyHex) ?? Self.rgb(hex: look.shape.baseHex)!
        hsl = Self.toHSL(body)
    }

    func color(fill: String, opacity: Double?) -> CGColor {
        let hex = fill.lowercased()
        if hex == shape.baseHex { return Self.cg(body) }
        // Dunkle Körper bekommen helle Augen.
        if hex == "#0f172a" { return NSColor(Theme.Palette.orbiAuge).cgColor }
        if (hex == "#fff" || hex == "#ffffff"), opacity != nil, hsl.l > 0.78 { return CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.18) }
        let c = Self.rgb(hex: hex) ?? RGB(r: 0, g: 0, b: 0)
        return CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }

    static func rgb(hex: String) -> RGB? {
        var h = hex.lowercased()
        guard h.hasPrefix("#") else { return nil }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return RGB(r: Double((v >> 16) & 0xFF) / 255, g: Double((v >> 8) & 0xFF) / 255, b: Double(v & 0xFF) / 255)
    }
    private static func cg(_ c: RGB) -> CGColor { CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1) }
    private static func distance(_ a: RGB, _ b: RGB) -> Double {
        hypot(hypot((a.r - b.r) * 255, (a.g - b.g) * 255), (a.b - b.b) * 255)
    }
    private static func toHSL(_ c: RGB) -> (h: Double, s: Double, l: Double) {
        let mx = max(c.r, c.g, c.b), mn = min(c.r, c.g, c.b), d = mx - mn
        let l = (mx + mn) / 2
        let s = d == 0 ? 0 : d / (1 - abs(2 * l - 1))
        var h = 0.0
        if d != 0 { h = mx == c.r ? ((c.g - c.b) / d).truncatingRemainder(dividingBy: 6) : mx == c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4 }
        return ((h * 60 + 360).truncatingRemainder(dividingBy: 360), s, l)
    }
    private static func fromHSL(h: Double, s: Double, l: Double) -> RGB {
        let (r, g, b) = hslToRGB(h, s * 100, l * 100)
        return RGB(r: r, g: g, b: b)
    }
}

// Zeichnen der Figuren: AvatarRenderer.swift (Umrisse der Lab-Engine).
enum FigureRenderer {
    static let ink = CGColor(srgbRed: 0.059, green: 0.090, blue: 0.165, alpha: 1)   // #0f172a, Augen
}

extension FigureRenderer {
    // Bitmap (Ursprung oben links) als CGImage, BGRA vormultipliziert: Core Animation muss nichts umrechnen.
    static func image(size: CGSize, scale: CGFloat, space: CGColorSpace? = nil, _ draw: (CGContext) -> Void) -> CGImage? {
        let w = Int(size.width * scale), h = Int(size.height * scale)
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        guard w > 0, h > 0, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                                space: space ?? CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info) else { return nil }
        ctx.translateBy(x: 0, y: CGFloat(h)); ctx.scaleBy(x: scale, y: -scale)
        ctx.setAllowsAntialiasing(true); ctx.interpolationQuality = .high
        draw(ctx)
        return ctx.makeImage()
    }
}
