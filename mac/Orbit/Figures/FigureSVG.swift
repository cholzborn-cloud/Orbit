import CoreGraphics
import Foundation

// Pfade der Lab-Engine (M, L, C, A, Z) als CGPath lesen; die Engine liefert absolute Befehle, Bögen als SVG-Endpunktform.
// Pfadlesen für M m L l H h V v Q q C c A a Z z.
enum SVGPath {
    static func numbers(_ text: String) -> [Double] {
        var out: [Double] = []
        var buf = ""
        var seenDot = false
        func flush() { if let v = Double(buf) { out.append(v) }; buf = ""; seenDot = false }
        let chars = Array(text)
        for (i, ch) in chars.enumerated() {
            if ch.isNumber { buf.append(ch) }
            else if ch == "." { if seenDot { flush() }; seenDot = true; buf.append(ch) }
            else if ch == "-" || ch == "+" { if !buf.isEmpty, !(i > 0 && (chars[i - 1] == "e" || chars[i - 1] == "E")) { flush() }; buf.append(ch) }
            else if ch == "e" || ch == "E" { buf.append(ch) }
            else { flush() }
        }
        flush()
        return out
    }

    // Schnelles Lesen auf Bytes (die Engine liefert pro Bild Tausende Zahlen).
    static func parse(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var cur = CGPoint.zero, start = CGPoint.zero
        var bytes = Array(d.utf8)
        bytes.append(0)
        var i = 0
        var nums: [Double] = []
        nums.reserveCapacity(8)

        func number() -> Double? {
            while bytes[i] == 32 || bytes[i] == 44 || bytes[i] == 10 || bytes[i] == 9 { i += 1 }
            var j = i
            if bytes[j] == 45 || bytes[j] == 43 { j += 1 }
            var intPart = 0.0, hasDigits = false
            while bytes[j] >= 48 && bytes[j] <= 57 { intPart = intPart * 10 + Double(bytes[j] - 48); j += 1; hasDigits = true }
            var frac = 0.0, scale = 0.1
            if bytes[j] == 46 {
                j += 1
                while bytes[j] >= 48 && bytes[j] <= 57 { frac += Double(bytes[j] - 48) * scale; scale *= 0.1; j += 1; hasDigits = true }
            }
            guard hasDigits else { return nil }
            var value = intPart + frac
            if bytes[j] == 101 || bytes[j] == 69 {   // Exponent
                var k = j + 1, neg = false
                if bytes[k] == 45 { neg = true; k += 1 } else if bytes[k] == 43 { k += 1 }
                var e = 0
                while bytes[k] >= 48 && bytes[k] <= 57 { e = e * 10 + Int(bytes[k] - 48); k += 1 }
                value *= pow(10, Double(neg ? -e : e)); j = k
            }
            if bytes[i] == 45 { value = -value }
            i = j
            return value
        }

        while bytes[i] != 0 {
            let ch = bytes[i]
            if ch == 32 || ch == 44 || ch == 10 || ch == 9 { i += 1; continue }
            guard (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) else { break }
            i += 1
            nums.removeAll(keepingCapacity: true)
            while let v = number() { nums.append(v) }
            let rel = ch >= 97
            let a = nums
            func p(_ x: Double, _ y: Double) -> CGPoint { rel ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y) }
            switch ch & ~32 {
            case 77: // M
                var k = 0
                while k + 1 < a.count {
                    let pt = p(a[k], a[k + 1])
                    if k == 0 { path.move(to: pt); start = pt } else { path.addLine(to: pt) }
                    cur = pt; k += 2
                }
            case 76: // L
                var k = 0
                while k + 1 < a.count { cur = p(a[k], a[k + 1]); path.addLine(to: cur); k += 2 }
            case 72: for v in a { cur = CGPoint(x: rel ? cur.x + v : v, y: cur.y); path.addLine(to: cur) }   // H
            case 86: for v in a { cur = CGPoint(x: cur.x, y: rel ? cur.y + v : v); path.addLine(to: cur) }   // V
            case 81: // Q
                var k = 0
                while k + 3 < a.count {
                    let c = p(a[k], a[k + 1]), e = p(a[k + 2], a[k + 3])
                    path.addQuadCurve(to: e, control: c); cur = e; k += 4
                }
            case 67: // C
                var k = 0
                while k + 5 < a.count {
                    let c1 = p(a[k], a[k + 1]), c2 = p(a[k + 2], a[k + 3]), e = p(a[k + 4], a[k + 5])
                    path.addCurve(to: e, control1: c1, control2: c2); cur = e; k += 6
                }
            case 65: // A
                var k = 0
                while k + 6 < a.count {
                    let e = p(a[k + 5], a[k + 6])
                    arc(path, from: cur, rx: a[k], ry: a[k + 1], rotation: a[k + 2], large: a[k + 3] != 0, sweep: a[k + 4] != 0, to: e)
                    cur = e; k += 7
                }
            case 90: path.closeSubpath(); cur = start   // Z
            default: break
            }
        }
        return path
    }

    // SVG-Bogen (Endpunktform) → Mittelpunktform → Kreisbogen mit Skalierung.
    private static func arc(_ path: CGMutablePath, from p1: CGPoint, rx rxIn: Double, ry ryIn: Double, rotation: Double, large: Bool, sweep: Bool, to p2: CGPoint) {
        var rx = abs(rxIn), ry = abs(ryIn)
        guard rx > 0, ry > 0, p1 != p2 else { path.addLine(to: p2); return }
        let phi = rotation * .pi / 180
        let dx = (p1.x - p2.x) / 2, dy = (p1.y - p2.y) / 2
        let x1 = cos(phi) * dx + sin(phi) * dy, y1 = -sin(phi) * dx + cos(phi) * dy
        let lambda = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let sign = large == sweep ? -1.0 : 1.0
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        let coef = sign * sqrt(max(0, num / den))
        let cxp = coef * rx * y1 / ry, cyp = -coef * ry * x1 / rx
        let cx = cos(phi) * cxp - sin(phi) * cyp + (p1.x + p2.x) / 2
        let cy = sin(phi) * cxp + cos(phi) * cyp + (p1.y + p2.y) / 2
        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
        var delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi }
        if sweep, delta < 0 { delta += 2 * .pi }
        let t = CGAffineTransform(translationX: cx, y: cy).rotated(by: phi).scaledBy(x: rx, y: ry)
        path.addArc(center: .zero, radius: 1, startAngle: theta1, endAngle: theta1 + delta, clockwise: delta < 0, transform: t)
    }
}
