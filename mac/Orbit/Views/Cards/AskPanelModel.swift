import Observation

// Zustand des Fragebogens (Web: components/chat/ask-panel.tsx), eine Frage je Seite. Reine Logik, einzeln prüfbar.
@MainActor @Observable
final class AskPanelModel {
    let questions: [AskQuestion]
    private(set) var page = 0
    private(set) var picked: [[String]]
    var custom = ""
    var sending = false
    var error: String?

    init(questions: [AskQuestion]) {
        self.questions = questions
        picked = questions.map { _ in [] }
    }

    var question: AskQuestion? { questions.indices.contains(page) ? questions[page] : nil }
    var isLast: Bool { page == questions.count - 1 }
    private var typed: String { custom.trimmingCharacters(in: .whitespacesAndNewlines) }

    // Aktuelle Wahl: bei Mehrfachauswahl kommt die eigene Antwort dazu (ohne Doppelte), sonst ersetzt sie die Wahl.
    var choice: [String] {
        guard let question else { return [] }
        let current = picked[page]
        guard question.allowsCustom else { return current }
        if question.multiple { return typed.isEmpty || current.contains(typed) ? current : current + [typed] }
        return typed.isEmpty ? current : [typed]
    }

    var buttonTitle: String {
        guard let question else { return "" }
        if choice.isEmpty { return "Überspringen" }
        return (isLast ? "Senden" : "Weiter") + (question.multiple ? " (\(choice.count))" : "")
    }

    func isPicked(_ label: String) -> Bool { picked[page].contains(label) }

    func choose(_ label: String) {
        guard let question else { return }
        if !question.multiple { custom = "" }
        if question.multiple {
            if let index = picked[page].firstIndex(of: label) { picked[page].remove(at: index) } else { picked[page].append(label) }
        } else {
            picked[page] = [label]
        }
    }

    func select(_ label: String) -> [QuestionAnswer]? {
        guard let question, question.options.contains(where: { $0.label == label }), !sending else { return nil }
        choose(label)
        return question.multiple ? nil : advance()
    }

    func select(number: Int) -> [QuestionAnswer]? {
        guard let question, question.options.indices.contains(number - 1) else { return nil }
        return select(question.options[number - 1].label)
    }

    // Eintippen ersetzt bei Einzelwahl die gewählte Zeile.
    func customChanged() {
        if question?.multiple == false, !custom.isEmpty { picked[page] = [] }
    }

    func choose(number: Int) {
        guard let question, question.options.indices.contains(number - 1) else { return }
        choose(question.options[number - 1].label)
    }

    func previous() { if page > 0 { page -= 1; custom = "" } }
    func nextPage() { if page < questions.count - 1 { page += 1; custom = "" } }

    // „Weiter“/„Senden“: übernimmt die Wahl; nach der letzten Frage liefert es die Antworten für den Dienst.
    func advance() -> [QuestionAnswer]? {
        picked[page] = choice
        custom = ""
        if !isLast { page += 1; return nil }
        return result
    }

    var result: [QuestionAnswer] {
        zip(questions, picked).map { QuestionAnswer(question: $0.question, answers: $1) }
    }
}
