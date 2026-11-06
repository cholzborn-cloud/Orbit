import Foundation

// Gespeicherte Zeile „Nachricht gesendet an / von @Orbi“ (plan/API.md, „Nachrichten zwischen Orbis“): ein Teil `data-orbi-message`.
// Reine Anzeige, kein Modellaufruf. Alle Felder werden tolerant gelesen: eine Lücke verwirft nie die ganze Nachricht.
struct OrbiLine: Hashable, Sendable, Decodable {
    enum Direction: String, Sendable { case out, `in` }
    enum Kind: String, Sendable { case message, reply }
    // `arbeitet`, `wartet`, `fertig`, `fehlgeschlagen`, `unklar` (Dienst); unbekannte Werte gelten als `unklar`.
    enum Status: String, Sendable { case working = "arbeitet", waiting = "wartet", done = "fertig", failed = "fehlgeschlagen", unclear = "unklar" }

    struct Peer: Hashable, Sendable {
        var id: String
        var name: String
        // Leer = Gruppe (kein Avatar).
        var avatar: String
        var color: String?
        var isGroup: Bool { avatar.isEmpty }
    }

    // Längere Texte werden in der Anzeige gekürzt (der Dienst begrenzt Antworten auf rund 1500 Zeichen).
    static let maxDisplayCharacters = 1500

    var linkId: String
    var direction: Direction
    var kind: Kind
    var peer: Peer
    var text: String
    var priority: Bool
    var held: Bool
    var queued: Bool
    var status: Status
    var createdAt: Double?

    private enum Keys: String, CodingKey { case linkId, direction, kind, peer, text, priority, held, queued, status, createdAt }
    private struct PeerBody: Decodable {
        let id: String?
        let name: String?
        let avatar: String?
        let color: String?
    }

    init(linkId: String = "", direction: Direction, kind: Kind, peer: Peer, text: String, priority: Bool = true, held: Bool = false,
         queued: Bool = false, status: Status, createdAt: Double? = nil) {
        self.linkId = linkId; self.direction = direction; self.kind = kind; self.peer = peer; self.text = text
        self.priority = priority; self.held = held; self.queued = queued; self.status = status; self.createdAt = createdAt
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        linkId = (try? c.decodeIfPresent(String.self, forKey: .linkId)) ?? ""
        direction = (try? c.decodeIfPresent(String.self, forKey: .direction)).flatMap(Direction.init(rawValue:)) ?? .out
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)).flatMap(Kind.init(rawValue:)) ?? .message
        let body = try? c.decodeIfPresent(PeerBody.self, forKey: .peer)
        peer = Peer(id: body?.id ?? "", name: body?.name ?? "Orbi", avatar: body?.avatar ?? "", color: body?.color)
        text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? ""
        priority = (try? c.decodeIfPresent(Bool.self, forKey: .priority)) ?? true
        held = (try? c.decodeIfPresent(Bool.self, forKey: .held)) ?? false
        queued = (try? c.decodeIfPresent(Bool.self, forKey: .queued)) ?? false
        status = (try? c.decodeIfPresent(String.self, forKey: .status)).flatMap(Status.init(rawValue:)) ?? .unclear
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
    }

    // „Nachricht gesendet an“ / „Nachricht von“ / „Antwort gesendet an“ / „Antwort von“ (der Name folgt als @-Markierung).
    var title: String {
        direction == .out ? "Nachricht gesendet an" : "Nachricht von"
    }

    // Statuswort hinter der Zeile. `held` und `queued` gehen dem Status vor, solange nichts Endgültiges feststeht.
    var statusText: String {
        switch status {
        case .done: return "fertig"
        case .failed: return "fehlgeschlagen"
        case .unclear: return "unklar"
        case .waiting: return "wartet auf dich"
        case .working:
            if held { return "gehalten" }
            if queued { return "in der Warteschlange" }
            return "arbeitet"
        }
    }

    // Satz der Übergabe-Zeile nach Figma 02/teil-11: der Status steht im Text, der Name sitzt zwischen Anfang und Ende.
    struct Phrase: Equatable, Sendable {
        enum Style: Sendable { case plain, shimmer, failure }
        var prefix: String
        var suffix: String
        var style: Style
    }

    // Consti 06.11.: nur noch „Nachricht gesendet an …“ und „Nachricht von …“ (auch für Antworten), kein „ist fertig“, kein „Antwort von“.
    // Gilt auch für alte gespeicherte Zeilen, die Daten bleiben unverändert. Läuft es, schimmert der Satz; Fehler rot.
    var phrase: Phrase {
        let idle = held || queued
        switch (direction, status) {
        case (.out, .failed): return Phrase(prefix: "Nachricht an ", suffix: " fehlgeschlagen", style: .failure)
        case (.out, .working) where !idle, (.out, .waiting): return Phrase(prefix: "Nachricht gesendet an ", suffix: "", style: .shimmer)
        case (.out, _): return Phrase(prefix: "Nachricht gesendet an ", suffix: "", style: .plain)
        case (.in, .failed): return Phrase(prefix: "Nachricht von ", suffix: " fehlgeschlagen", style: .failure)
        case (.in, _): return Phrase(prefix: "Nachricht von ", suffix: "", style: .plain)
        }
    }

    // Gleiche Zeile direkt hintereinander (z. B. Nachricht und Antwort desselben Orbis): nur die erste zeigen.
    static func repeatedIds(in messages: [ChatMessage]) -> Set<String> {
        var hidden: Set<String> = []
        var previous: OrbiLine?
        for message in messages {
            let line = message.orbiLine
            if let line, let previous, previous.direction == line.direction, previous.peer.id == line.peer.id,
               previous.phrase.prefix == line.phrase.prefix, line.phrase.style != .failure {
                hidden.insert(message.id)
            }
            previous = line
        }
        return hidden
    }

    var isActive: Bool { status == .working || status == .waiting }
    var isFailure: Bool { status == .failed }
    var figureState: OrbiState {
        if status == .waiting { return .waiting }
        if status == .working && !held && !queued { return .working }
        return .calm
    }

    // Aufklapptext: höchstens ~1500 Zeichen, gekürzt mit Auslassung.
    var displayText: String {
        guard text.count > Self.maxDisplayCharacters else { return text }
        return String(text.prefix(Self.maxDisplayCharacters)) + " …"
    }
}
