import AppKit
import CoreGraphics
import Foundation

// Eingabe für den Computer eines Orbis: Tasten auf X11-Keysyms, Zeigerposition im Bild. Reine Funktionen, getestet in OrbitTests.
enum DesktopKeys {
    // Unicode-Zeichen als Keysym: ASCII und Latin-1 direkt, alles andere als 0x01000000 + Codepunkt (Umlaute und € sind im Spike belegt).
    static func keysym(forScalar value: UInt32) -> UInt32? {
        switch value {
        case 0x20...0x7E, 0xA0...0xFF: value
        case 0x100...0x10FFFF where !(0xD800...0xDFFF).contains(value) && value != 0xFFFF: 0x0100_0000 + value
        default: nil
        }
    }

    // Sondertasten nach macOS-Tastencode.
    static let special: [UInt16: UInt32] = [
        36: 0xFF0D, 76: 0xFF8D, 48: 0xFF09, 51: 0xFF08, 53: 0xFF1B, 117: 0xFFFF,
        123: 0xFF51, 126: 0xFF52, 124: 0xFF53, 125: 0xFF54, 115: 0xFF50, 119: 0xFF57, 116: 0xFF55, 121: 0xFF56, 114: 0xFF63,
        122: 0xFFBE, 120: 0xFFBF, 99: 0xFFC0, 118: 0xFFC1, 96: 0xFFC2, 97: 0xFFC3, 98: 0xFFC4, 100: 0xFFC5, 101: 0xFFC6, 109: 0xFFC7, 103: 0xFFC8, 111: 0xFFC9,
    ]

    // Umschalt und Steuerung gehen als eigene Tasten hinüber. Befehl (Cmd) gilt als Strg, weil Linux-Programme Strg+C/V/X/A/Z nutzen
    // (Festlegung 4e, Consti kann sie ändern). Wahl (Option) wird nie als Alt gesendet: sie setzt Zeichen zusammen (@, [, ], {, }, |, ~, \).
    static let modifiers: [UInt16: UInt32] = [56: 0xFFE1, 60: 0xFFE2, 59: 0xFFE3, 62: 0xFFE4, 55: 0xFFE3, 54: 0xFFE4]

    // Kürzel mit Befehl, die macOS oder Orbit selbst behalten (Beenden, Fenster, Verbergen, Einstellungen, Seitenleiste, Suche, Fensterwechsel).
    static let reserved: Set<String> = ["q", "w", "m", "h", ",", "b", "k", "\t", "`"]

    // Latin-1-Prüfung für die Zwischenablage: Anzahl der Zeichen, die verloren gehen.
    static func lostInLatin1(_ text: String) -> Int { text.unicodeScalars.filter { $0.value > 255 }.count }
}

// Lage des Bilds im Fenster: Seitenverhältnis bleibt, Rest ist Rand.
enum DesktopGeometry {
    static func fit(content: CGSize, in container: CGSize) -> CGRect {
        guard content.width > 0, content.height > 0, container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / content.width, container.height / content.height)
        let size = CGSize(width: content.width * scale, height: content.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2, width: size.width, height: size.height)
    }

    // Punkt im Fenster (Ursprung oben links) → Pixel im Bild. Außerhalb des Bilds wird auf den Rand gedrückt (Ziehen über den Rand hinaus).
    static func remote(_ point: CGPoint, content: CGSize, in container: CGSize) -> (x: Int, y: Int)? {
        let rect = fit(content: content, in: container)
        guard rect.width > 0 else { return nil }
        let x = (point.x - rect.minX) / rect.width * content.width
        let y = (point.y - rect.minY) / rect.height * content.height
        return (min(max(0, Int(x)), Int(content.width) - 1), min(max(0, Int(y)), Int(content.height) - 1))
    }
}

// Zugriff auf die Zwischenablage des Macs; der Selbsttest ersetzt ihn, damit die echte nicht verändert wird.
@MainActor
final class ClipboardBridge {
    var read: () -> String?
    var write: (String) -> Void
    var changeCount: () -> Int

    init(read: @escaping () -> String?, write: @escaping (String) -> Void, changeCount: @escaping () -> Int) {
        self.read = read; self.write = write; self.changeCount = changeCount
    }

    static let system = ClipboardBridge(
        read: { NSPasteboard.general.string(forType: .string) },
        write: { text in NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string) },
        changeCount: { NSPasteboard.general.changeCount })

    // Nur im Speicher (Selbsttest).
    static func memory() -> ClipboardBridge {
        var text: String?
        var count = 0
        return ClipboardBridge(read: { text }, write: { text = $0; count += 1 }, changeCount: { count })
    }
}
