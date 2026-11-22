import Foundation

struct SSEEvent: Equatable, Sendable {
    let data: String
    // AI-SDK-Strom endet mit `data: [DONE]`.
    var isDone: Bool { data == "[DONE]" }
}

// Server-Sent Events (Turn, /stream, /v1/events): Ereignisse enden mit einer Leerzeile, Kommentare (": keepalive") entfallen.
// Chunks dürfen an beliebiger Stelle geteilt ankommen, auch mitten in einem UTF-8-Zeichen.
struct SSEParser: Sendable {
    private var buffer = Data()

    mutating func feed(_ chunk: Data) -> [SSEEvent] {
        buffer.append(chunk)
        var events: [SSEEvent] = []
        while let range = Self.separator(in: buffer) {
            let block = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            if let event = Self.event(from: block) { events.append(event) }
        }
        return events
    }

    // Erste Leerzeile ("\n\n" oder "\r\n\r\n").
    private static func separator(in data: Data) -> Range<Data.Index>? {
        let lf = Data([0x0A, 0x0A]), crlf = Data([0x0D, 0x0A, 0x0D, 0x0A])
        let a = data.range(of: lf), b = data.range(of: crlf)
        switch (a, b) {
        case let (a?, b?): return a.lowerBound < b.lowerBound ? a : b
        case let (a?, nil): return a
        case let (nil, b?): return b
        case (nil, nil): return nil
        }
    }

    private static func event(from block: Data) -> SSEEvent? {
        guard let text = String(data: block, encoding: .utf8) else { return nil }
        let lines = text.split(whereSeparator: \.isNewline).compactMap { line -> String? in
            guard line.hasPrefix("data:") else { return nil }
            let value = line.dropFirst(5)
            return String(value.hasPrefix(" ") ? value.dropFirst() : value)
        }
        return lines.isEmpty ? nil : SSEEvent(data: lines.joined(separator: "\n"))
    }
}
