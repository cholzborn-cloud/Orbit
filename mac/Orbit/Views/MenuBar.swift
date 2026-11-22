import AppKit
import SwiftUI

// Symbol in der Menüleiste: zeigt, ob ein Orbi arbeitet oder auf dich wartet, und bleibt auch ohne Fenster da.
enum MenuBarIcon {
    // Planet mit Ring (Schablonenbild, das System färbt es); ein Punkt oben rechts: arbeitet (gefüllt) oder wartet (Ring).
    static func image(working: Bool, waiting: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: Theme.Metrics.pt18, height: Theme.Metrics.pt18), flipped: false) { rect in
            NSColor.black.setStroke(); NSColor.black.setFill()
            let shape = NSBezierPath(ovalIn: NSRect(x: Theme.Metrics.pt4_5, y: Theme.Metrics.pt4_5, width: Theme.Metrics.pt9, height: Theme.Metrics.pt9)); shape.lineWidth = 1.5; shape.stroke()
            let ring = NSBezierPath(ovalIn: NSRect(x: Theme.Metrics.pt1_5, y: Theme.Metrics.pt6_8, width: Theme.Metrics.pt15, height: Theme.Metrics.pt4_4)); ring.lineWidth = 1.2
            var tilt = AffineTransform(); tilt.translate(x: Theme.Metrics.pt9, y: Theme.Metrics.pt9); tilt.rotate(byDegrees: 22); tilt.translate(x: -Theme.Metrics.pt9, y: -Theme.Metrics.pt9)
            ring.transform(using: tilt); ring.stroke()
            if working || waiting {
                let dot = NSBezierPath(ovalIn: NSRect(x: Theme.Metrics.pt12_2, y: Theme.Metrics.pt12_2, width: Theme.Metrics.pt5, height: Theme.Metrics.pt5))
                if working { dot.fill() } else { dot.lineWidth = 1.4; dot.stroke() }
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}

struct MenuBarLabel: View {
    let model: AppModel

    var body: some View {
        let states = model.botStore.orbis.map { model.state(forBot: $0) }
        let needsYou = model.events.needsYouCount
        // Neben dem Symbol die Zahl der Dinge, die dich brauchen (Freigaben, Rückfragen); ohne sie nur das Symbol.
        HStack(spacing: Theme.Metrics.pt2) {
            Image(nsImage: MenuBarIcon.image(working: states.contains(.working), waiting: states.contains(.waiting) || needsYou > 0))
            if needsYou > 0 { Text("\(needsYou)") }
        }
        .accessibilityLabel(needsYou > 0 ? "Orbit, \(needsYou) brauchen dich" : "Orbit")
    }
}

struct MenuBarContent: View {
    let model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let orbis = model.botStore.orbis
        Text(model.events.connected ? "Dienst läuft" : "Dienst nicht erreichbar")
        Divider()
        if orbis.isEmpty {
            Text("Noch keine Orbis")
        }
        ForEach(orbis) { bot in
            let state = model.state(forBot: bot)
            Button("\(bot.name) · \(state == .calm ? "ruhig" : state.caption)") { show(.bot(bot.id)) }
        }
        Divider()
        Button("Orbit öffnen") { show(nil) }
        Divider()
        // Beendet nur die App; der Dienst läuft weiter (Automationen, laufende Aufgaben).
        Button("Orbit beenden") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }

    private func show(_ selection: AppModel.Selection?) {
        if let selection { model.selection = selection }
        openWindow(id: "main")
        NSApp.activate()
    }
}
