import AppKit
import SwiftUI
import Foundation

// Farbmathematik der Figuren: HSL (Zeichnen, wie im Prototyp) und OKLCH (Abstand für die Doppelgänger-Regel).
func hslToRGB(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
    let hh = ((h.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
    let s = max(0, min(100, s)) / 100, l = max(0, min(100, l)) / 100
    let c = (1 - abs(2 * l - 1)) * s
    let x = c * (1 - abs((hh / 60).truncatingRemainder(dividingBy: 2) - 1))
    let m = l - c / 2
    let (r, g, b): (Double, Double, Double)
    switch hh {
    case ..<60: (r, g, b) = (c, x, 0)
    case ..<120: (r, g, b) = (x, c, 0)
    case ..<180: (r, g, b) = (0, c, x)
    case ..<240: (r, g, b) = (0, x, c)
    case ..<300: (r, g, b) = (x, 0, c)
    default: (r, g, b) = (c, 0, x)
    }
    return (r + m, g + m, b + m)
}

enum FigureColor {
    // "#rrggbb" aus dem Dienst → Farbton (Grad) und Sättigung (Prozent) in HSL.
    // Farbe aus dem Farbwähler als "#rrggbb" (sRGB) für den Dienst.
    static func hex(_ color: Color) -> String? {
        guard let c = NSColor(color).usingColorSpace(.sRGB) else { return nil }
        let v = [c.redComponent, c.greenComponent, c.blueComponent].map { Int((min(1, max(0, $0)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", v[0], v[1], v[2])
    }

    static func hueAndSaturation(hex: String?) -> (hue: Double, saturation: Double)? {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        let r = Double((value >> 16) & 0xFF) / 255, g = Double((value >> 8) & 0xFF) / 255, b = Double(value & 0xFF) / 255
        let maxC = max(r, g, b), minC = min(r, g, b), d = maxC - minC
        let l = (maxC + minC) / 2
        let s = d == 0 ? 0 : d / (1 - abs(2 * l - 1))
        var h = 0.0
        if d != 0 {
            h = maxC == r ? ((g - b) / d).truncatingRemainder(dividingBy: 6) : maxC == g ? (b - r) / d + 2 : (r - g) / d + 4
        }
        return ((h * 60 + 360).truncatingRemainder(dividingBy: 360), s * 100)
    }

    // Farbton im OKLCH-Raum (Grad) einer sRGB-Farbe.
    static func oklchHue(r: Double, g: Double, b: Double) -> Double {
        func lin(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        let (lr, lg, lb) = (lin(r), lin(g), lin(b))
        let l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
        let m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
        let s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
        let a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
        let bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
        return (atan2(bb, a) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }
}
