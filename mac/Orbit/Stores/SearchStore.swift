import Foundation
import Observation

// Chatsuche (Web: components/sidebar-search.tsx): Suchfeld in der Seitenleiste mit Ergebnisfenster und die Palette (⌘K).
// Eingabe wird 250 ms entprellt; solange der Dienst den Index aufbaut, fragt die Suche alle 2,5 s nach.
@MainActor @Observable
final class SearchStore {
    var query = "" {
        didSet {
            guard query != oldValue else { return }
            active = 0
            dismissed = false
            schedule()
        }
    }
    private(set) var results: [SearchHit] = []
    private(set) var loading = false
    private(set) var building = false
    private(set) var error: String?
    // Markierter Treffer (Pfeiltasten, Enter).
    var active = 0
    // Ergebnisfenster am Suchfeld per Klick daneben oder Esc geschlossen.
    var dismissed = false
    var paletteOpen = false
    // Rahmen des Suchfelds im Fensterraum (für die Lage des Ergebnisfensters) und des offenen Ergebnisfensters (sonst leer).
    var fieldFrame: CGRect = .zero
    var popoverFrame: CGRect = .zero
    // Der Dienst findet den Chat des Treffers nicht in der Orbi-Liste (gelöscht).
    var openError: String?

    private let client: ServiceClient
    private var task: Task<Void, Never>?

    init(client: ServiceClient) { self.client = client }

    var hasQuery: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var emptyResult: Bool { hasQuery && !loading && !building && error == nil && results.isEmpty }

    private func schedule() {
        task?.cancel()
        openError = nil
        guard hasQuery else {
            results = []; loading = false; building = false; error = nil
            return
        }
        let text = query
        task = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            while !Task.isCancelled, let self {
                await self.run(text)
                guard building, !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(2500))
            }
        }
    }

    // Eine Anfrage; Treffer und Zustand gelten nur, solange der Suchtext noch derselbe ist.
    func run(_ text: String) async {
        loading = true
        defer { if query == text { loading = false } }
        do {
            let response = try await client.search(text.trimmingCharacters(in: .whitespacesAndNewlines))
            guard query == text else { return }
            results = response.results
            building = response.indexing
            error = nil
            active = min(active, max(0, results.count - 1))
        } catch {
            guard query == text else { return }
            results = []
            building = false
            self.error = error is ServiceError ? error.localizedDescription : "Die Suche ist gerade nicht verfügbar."
        }
    }

    func move(_ step: Int) {
        guard !results.isEmpty else { return }
        active = min(max(0, active + step), results.count - 1)
    }

    func reset() {
        task?.cancel()
        query = ""
        paletteOpen = false
        dismissed = true
    }

    // Suchfeld der Seitenleiste: Das Textfeld gibt es nur, solange die Suche gewollt aktiv ist (Klick hinein). Sonst steht dort ein
    // gleich aussehendes Etikett. Grund: SwiftUI legt den Tastaturfokus bei jedem Fokusverlust auf das erste Textfeld im Fenster,
    // und das war die Suche oben links; jeder Klick in die Seitenleiste fokussierte sie wieder.
    private(set) var fieldActive = false
    private(set) var fieldFocused = false
    func activateField() {
        fieldActive = true
        dismissed = false
    }
    // Chat in der Seitenleiste gewählt: Suchfeld oben gibt den Fokus ab.
    func resignField() {
        dismissed = true
        fieldActive = false
    }
    // Klick im Fenster (Fensterraum) außerhalb von Feld und Ergebnisfenster: Treffer schließen, Feld gibt den Fokus ab, Eingabe bleibt.
    func windowClick(at point: CGPoint) {
        guard !fieldFrame.contains(point), !popoverFrame.contains(point) else { return }
        resignField()
    }
    // Fokus verlassen (Klick woanders, Esc, Tab): das Textfeld verschwindet wieder, die Eingabe bleibt stehen.
    func fieldFocusChanged(_ focused: Bool) {
        fieldFocused = focused
        if focused { dismissed = false } else { fieldActive = false }
    }
}
