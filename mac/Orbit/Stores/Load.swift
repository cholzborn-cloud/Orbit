import Foundation

// Laden, Fehler und Offline; Fehler stehen als deutscher Text im Reiter, nie still.
enum Load<Value> {
    case idle, loading
    case loaded(Value)
    case failed(String, offline: Bool)

    var value: Value? { if case .loaded(let value) = self { value } else { nil } }
    var isLoading: Bool { if case .loading = self { true } else { false } }
    var failure: (message: String, offline: Bool)? { if case .failed(let message, let offline) = self { (message, offline) } else { nil } }
}
