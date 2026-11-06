import Foundation
import Observation

// Verbindet die Karten mit dem Dienst: Entscheidungen und Antworten senden, Fehler als Text behalten, Stopp.
// Der Stand offener Freigaben kommt aus `EventsStore.interactions`.
@MainActor @Observable
final class CardCenter {
    let client: ServiceClient
    let events: EventsStore
    // Läuft gerade eine Entscheidung (Freigabe- oder Rückfrage-ID)? Verhindert doppeltes Senden.
    private(set) var busy: Set<String> = []
    // Fehlertext der letzten fehlgeschlagenen Entscheidung je ID (bleibt an der Karte stehen).
    private(set) var errors: [String: String] = [:]
    private(set) var stopped: Set<String> = []

    init(client: ServiceClient, events: EventsStore) {
        self.client = client
        self.events = events
    }

    var interactions: InteractionBoard { events.interactions }

    func decide(_ approvalId: String, _ decision: ServiceClient.ApprovalDecision) async {
        guard busy.insert(approvalId).inserted else { return }
        errors[approvalId] = nil
        defer { busy.remove(approvalId) }
        do { try await client.decide(approvalId: approvalId, decision) }
        catch { errors[approvalId] = error.localizedDescription }
    }

    // `nil` = alle Fragen überspringen. Gibt zurück, ob der Dienst die Antwort angenommen hat.
    func answer(_ questionId: String, answers: [QuestionAnswer]?) async -> String? {
        guard busy.insert(questionId).inserted else { return nil }
        defer { busy.remove(questionId) }
        do { try await client.answer(questionId: questionId, answers: answers); return nil }
        catch { return error.localizedDescription }
    }

    // Stopp bricht den ganzen Baum ab (Dienst: Unteraufträge laufen im selben Turn).
    func stop(chatId: String) async {
        stopped.insert(chatId)
        try? await client.stop(chatId: chatId)
    }
}
