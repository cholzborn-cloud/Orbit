import Foundation

// Fehler der Selbsttests und Screenshot-Läufe (deutscher Text für die Ausgabe).
struct SpikeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

extension Duration {
    var milliseconds: Double { Double(components.seconds) * 1000 + Double(components.attoseconds) / 1e15 }
}
