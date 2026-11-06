import CoreGraphics
import SwiftUI

// Zeichnet die Umrisse der Lab-Engine. Raum wie bisher: 100er-Sicht (Mitte 50, 50), die Kugel (240 Engine-Einheiten) ist 68 breit;
// `margin` = Rand in Einheiten der 80 breiten Sicht für Satelliten und Schwebebewegung.
extension FigureRenderer {
    // Ruhebild ohne Animation (Kacheln, Screenshots): neutraler Ausdruck des Avatars.
    @MainActor static func drawNeutral(_ g: CGContext, size: CGSize, look: OrbiLook, margin: Double = 0, blink: Double = 1) {
        var pose = OrbiBehavior.still(.idle)
        pose.blink = 1 - blink
        draw(g, size: size, look: look, geometry: FigureLayerView.geometry(look: look, pose: pose, fine: true), margin: margin)
    }

    static let engineScale = 68.0 / 240.0

    // Artifact-Maß (Kugel Radius 42 von 100) auf die Engine-Kugel (Radius 34) umrechnen; Drehpunkt der Neigung ist der Fuß der Kugel.
    static let poseScale = 34.0 / 42.0
    static let poseFoot = 84.0

    static func draw(_ g: CGContext, size: CGSize, look: OrbiLook, geometry: AvatarGeometry, margin: Double = 0, pose: OrbiPose? = nil) {
        let palette = FigurePalette(look: look)
        let region = 80 + 2 * margin
        let s = min(size.width, size.height) / region
        g.saveGState()
        g.scaleBy(x: s, y: s)
        g.translateBy(x: margin - 10, y: margin - 10)
        let c = engineScale
        let toSVG = CGAffineTransform(translationX: 50, y: 50).scaledBy(x: c, y: c)
        if let pose {
            // Körper bewegen: Verschiebung, Neigung um den Fuß, Stauchung und Größe wie im Artifact.
            g.saveGState()
            g.translateBy(x: 50 + pose.x * poseScale, y: poseFoot + pose.y * poseScale)
            g.rotate(by: pose.tilt * .pi / 180)
            g.scaleBy(x: pose.sx * pose.sc, y: pose.sy * pose.sc)
            g.translateBy(x: -50, y: -poseFoot)
        }

        // Körper (Umrisse hinten, Kopf), Augen (am Kopf beschnitten), Umrisse vorn.
        let body = palette.color(fill: look.shape.baseHex, opacity: nil)
        g.setFillColor(body)
        func fill(_ p: CGPath) { var t = toSVG; if let moved = p.copy(using: &t) { g.addPath(moved); g.fillPath() } }
        geometry.back.forEach(fill)
        fill(geometry.head)

        var eyes: [CGPoint] = [], sizes: [CGSize] = []
        for (path, visible) in [(geometry.left, geometry.leftVisible), (geometry.right, geometry.rightVisible)] {
            var t = toSVG
            guard let moved = path.copy(using: &t) else { continue }
            let box = moved.boundingBox
            guard !box.isNull, box.width > 0 else { continue }
            eyes.append(CGPoint(x: box.midX, y: box.midY)); sizes.append(box.size)
            guard visible else { continue }
            if let shape = look.eyes {
                customEye(g, shape: shape, center: CGPoint(x: box.midX, y: box.midY), height: box.height / max(0.3, geometry.blink), blink: geometry.blink)
            } else {
                g.saveGState()
                var h = toSVG
                if let clip = geometry.head.copy(using: &h) { g.addPath(clip); g.clip() }
                g.addPath(moved)
                g.setFillColor(palette.color(fill: "#0f172a", opacity: nil))
                g.fillPath()
                g.restoreGState()
            }
            // Glanzpunkt: große glänzende Augen beim Strahlen.
            if let pose, pose.shine > 0.02 {
                let r = max(1.2, box.width * 0.2)
                g.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: pose.shine * geometry.blink))
                g.fillEllipse(in: CGRect(x: box.midX + box.width * 0.15 - r, y: box.midY - box.height * 0.19 - r, width: 2 * r, height: 2 * r))
            }
        }
        g.setFillColor(body)
        geometry.front.forEach(fill)

        // Wangen und Zubehör
        var bounds = CGRect.null
        for p in geometry.back + [geometry.head] + geometry.front {
            var t = toSVG
            if let moved = p.copy(using: &t) { bounds = bounds.union(moved.boundingBox) }
        }
        if eyes.count == 2, !bounds.isNull {
            let k = max(0.4, min(1.6, (sizes[0].height / max(0.3, geometry.blink)) / 14))
            overlays(g, look: look, eyes: eyes, k: k, bounds: bounds)
        }
        if let pose {
            g.restoreGState()
            decorations(g, pose: pose)
        }
        g.restoreGState()
    }

    private static let sparkColors = ["#fde047", "#f9a8d4", "#67e8f9", "#ffffff", "#a7f3d0"]

    private static func color(_ hex: String) -> CGColor {
        let c = FigurePalette.rgb(hex: hex) ?? FigurePalette.RGB(r: 1, g: 1, b: 1)
        return CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }

    // Zeichen, die nicht mit dem Körper mitgehen: Funken, oranger Kreis (wartet), blauer Punkt (fertig), beide mit dünnem schwarzem Rand unten rechts.
    private static func decorations(_ g: CGContext, pose: OrbiPose) {
        let k = poseScale
        func at(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: 50 + (x - 50) * k, y: 50 + (y - 50) * k) }
        for s in pose.sparks {
            let u = s.life / s.span
            let p = at(s.x, s.y)
            g.saveGState()
            g.translateBy(x: p.x, y: p.y)
            g.rotate(by: u * .pi)
            let sc = s.scale * (1 - u) * k
            g.scaleBy(x: sc, y: sc)
            let star = CGMutablePath()
            let pts: [(Double, Double)] = [(0, -5), (1.4, -1.4), (5, 0), (1.4, 1.4), (0, 5), (-1.4, 1.4), (-5, 0), (-1.4, -1.4)]
            for (i, q) in pts.enumerated() { if i == 0 { star.move(to: CGPoint(x: q.0, y: q.1)) } else { star.addLine(to: CGPoint(x: q.0, y: q.1)) } }
            star.closeSubpath()
            g.addPath(star)
            g.setFillColor(color(sparkColors[s.color % sparkColors.count]))
            g.fillPath()
            g.restoreGState()
        }

    }

    // Augenform nach Wahl im Anpassungsmenü: weißer Rahmen und dunkle Pupille um die Augenmitte (Eisgrad wie bisher).
    private static func customEye(_ g: CGContext, shape: EyeShape, center: CGPoint, height: Double, blink: Double) {
        let k = max(0.4, min(1.6, height / 14))
        g.saveGState()
        g.translateBy(x: center.x, y: center.y)
        g.scaleBy(x: k, y: k * blink)
        g.translateBy(x: -8, y: -8)
        let outline: CGPath
        switch shape {
        case .round:
            outline = CGPath(ellipseIn: CGRect(x: 1, y: 1, width: 14, height: 14), transform: nil)
        case .square:
            outline = CGPath(roundedRect: CGRect(x: 3, y: 0.6, width: 10, height: 14.8), cornerWidth: 5, cornerHeight: 5, transform: nil)
        case .triangle:
            outline = triangle(CGPoint(x: 8, y: 8), 15, radius: 3)
        }
        g.addPath(outline); g.setFillColor(NSColor(Theme.Palette.orbiAuge).cgColor); g.fillPath()
        g.restoreGState()
    }

    private static func triangle(_ c: CGPoint, _ w: Double, radius r: Double) -> CGPath {
        let pts = [CGPoint(x: c.x - w / 2, y: c.y - w * 0.46), CGPoint(x: c.x + w / 2, y: c.y - w * 0.46), CGPoint(x: c.x, y: c.y + w * 0.5)]
        let p = CGMutablePath()
        for i in 0..<3 {
            let a = pts[(i + 2) % 3], b = pts[i], d = pts[(i + 1) % 3]
            let la = hypot(a.x - b.x, a.y - b.y), ld = hypot(d.x - b.x, d.y - b.y)
            let p1 = CGPoint(x: b.x + (a.x - b.x) / la * r, y: b.y + (a.y - b.y) / la * r)
            let p2 = CGPoint(x: b.x + (d.x - b.x) / ld * r, y: b.y + (d.y - b.y) / ld * r)
            if i == 0 { p.move(to: p1) } else { p.addLine(to: p1) }
            p.addQuadCurve(to: p2, control: b)
        }
        p.closeSubpath()
        return p
    }

    // Wangen und Zubehör im 100er-Raum, an den Augenmitten und am Körperrahmen ausgerichtet.
    private static func overlays(_ g: CGContext, look: OrbiLook, eyes: [CGPoint], k: Double, bounds b: CGRect) {
        let ink = FigureRenderer.ink
        let gear = Theme.Figure.gear
        let tri = look.shape == .trixi || look.shape == .tropi
        if look.cheeks {
            g.setFillColor(Theme.Figure.cheek)
            for e in eyes { g.fillEllipse(in: CGRect(x: e.x - 4.5 * k - 1, y: e.y + 7 * k, width: 9 * k, height: 5.5 * k)) }
        }
        switch look.accessory {
        case .glasses:
            g.setStrokeColor(ink); g.setLineWidth(2.2); g.setLineCap(.round)
            for e in eyes { g.strokeEllipse(in: CGRect(x: e.x - 10 * k, y: e.y - 11.5 * k, width: 20 * k, height: 23 * k)) }
            g.move(to: CGPoint(x: eyes[0].x + 10 * k, y: eyes[0].y - 1)); g.addQuadCurve(to: CGPoint(x: eyes[1].x - 10 * k, y: eyes[1].y - 1), control: CGPoint(x: (eyes[0].x + eyes[1].x) / 2, y: eyes[0].y - 3))
            g.strokePath()
        case .sunglasses:
            for e in eyes {
                g.addPath(CGPath(roundedRect: CGRect(x: e.x - 10.5 * k, y: e.y - 8 * k, width: 21 * k, height: 16 * k), cornerWidth: 5.5 * k, cornerHeight: 5.5 * k, transform: nil))
                g.setFillColor(ink); g.fillPath()
                g.addPath(CGPath(roundedRect: CGRect(x: e.x - 7 * k, y: e.y - 5.5 * k, width: 6 * k, height: 2.5 * k), cornerWidth: 1.2 * k, cornerHeight: 1.2 * k, transform: nil))
                g.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.35)); g.fillPath()
            }
            g.setStrokeColor(ink); g.setLineWidth(2.2); g.setLineCap(.round)
            g.move(to: CGPoint(x: eyes[0].x + 10.5 * k, y: eyes[0].y - 3)); g.addQuadCurve(to: CGPoint(x: eyes[1].x - 10.5 * k, y: eyes[1].y - 3), control: CGPoint(x: (eyes[0].x + eyes[1].x) / 2, y: eyes[0].y - 5))
            g.strokePath()
        case .cap:
            let top = b.minY + 2
            g.scope {
                g.about(52, top) { g.rotate(by: -8 * .pi / 180) }
                g.setFillColor(gear)
                g.fillEllipse(in: CGRect(x: 52 - 15, y: top - 4.5, width: 30, height: 9))
            }
            g.setFillColor(gear)
            g.fillEllipse(in: CGRect(x: 50 - 3, y: top - 9, width: 6, height: 6))
        case .headphones:
            let h = (tri ? 0.34 : 0.5) * b.width
            let cx = b.midX, cy = tri ? b.midY + 6 : b.midY
            g.setStrokeColor(gear); g.setLineWidth(3.5); g.setLineCap(.round)
            g.addArc(center: CGPoint(x: cx, y: cy), radius: h, startAngle: .pi, endAngle: 0, clockwise: false)
            g.strokePath()
            g.setFillColor(gear)
            for x in [cx - h, cx + h] { g.addPath(CGPath(roundedRect: CGRect(x: x - 3.5, y: cy - 6, width: 7, height: 13), cornerWidth: 3, cornerHeight: 3, transform: nil)); g.fillPath() }
        case .none: break
        }
    }
}
