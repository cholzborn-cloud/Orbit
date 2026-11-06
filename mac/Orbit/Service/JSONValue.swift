import Foundation

// Freie JSON-Werte für Werkzeug-Eingaben und -Ausgaben (die Form hängt vom Werkzeug ab).
enum JSONValue: Hashable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { object[key] } else { nil }
    }

    var string: String? { if case .string(let value) = self { value } else { nil } }
    var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
    var number: Double? { if case .number(let value) = self { value } else { nil } }
    var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }

    // Lesbarer, eingerückter Text; Schlüssel wie token/password/secret/key werden verdeckt (Vertrauensgrenze, wie `safeInput` im Web).
    func prettyRedacted() -> String {
        let data = (try? Self.encoder.encode(redacted())) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private func redacted() -> JSONValue {
        switch self {
        case .array(let items): .array(items.map { $0.redacted() })
        case .object(let object):
            .object(object.reduce(into: [:]) { result, pair in
                result[pair.key] = pair.key.range(of: "token|password|secret|key", options: [.regularExpression, .caseInsensitive]) != nil
                    ? .string("••••••") : pair.value.redacted()
            })
        default: self
        }
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()
}
