import Foundation
import Observation

// Rücksetzzeit der Anbieter-Limits für den Limit-Zustand der Figuren (GET /v1/usage): „wartet bis 14:30 Uhr“.
// Die Zeit kommt vom Anbieter des Chat-Modells; ohne bekannte Zeit bleibt es beim Text „Limit erreicht, wartet“.
@MainActor @Observable
final class LimitStore {
    static let shared = LimitStore()

    var client: ServiceClient?
    // Nutzungsanbieter (claude, codex, antigravity) → späteste Rücksetzzeit seiner ausgeschöpften Fenster.
    private(set) var resets: [String: Date] = [:]
    private(set) var fetchedAt = Date.distantPast

    // Nur Selbsttest und Screenshot-Szenen.
    func simulate(resets: [String: Date]) { self.resets = resets; fetchedAt = Date() }

    // Lädt höchstens einmal je 30 s neu; bei Fehlern wird keine veraltete Rücksetzzeit angezeigt.
    func refresh() async {
        guard let client, Date().timeIntervalSince(fetchedAt) > 30 else { return }
        fetchedAt = Date()
        guard let usage = try? await client.usage() else { resets = [:]; return }
        resets = UsageText.limitResets(from: usage)
    }

    // „wartet bis …“ für ein Chat-Modell (Anbieter laut Modellkatalog, sonst am Modellnamen erkannt).
    func waitsText(modelProvider: String?, modelId: String, now: Date = Date()) -> String? {
        let provider = modelProvider.map(UsageProvider.usageProvider(forModelProvider:)) ?? UsageText.provider(forModelId: modelId)
        guard let provider else { return nil }
        return UsageText.waitsUntil(resets[provider], now: now)
    }
}
