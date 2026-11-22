import Foundation

// `Orbit --selftest`: Dienst starten oder nutzen, Orbis und Chats laden, JSON ausgeben. Ohne Fenster und Dock-Symbol.
@MainActor
enum SelfTest {
    struct Report: Encodable {
        struct Service: Encodable { let url: String; let startedByApp: Bool }
        struct Orbi: Encodable { let id: String; let name: String; let job: String; let isMain: Bool; let chatId: String }
        struct GroupInfo: Encodable { let id: String; let name: String; let members: Int }
        struct Chat: Encodable { let id: String; let memberCount: Int; let lastMessageAt: Date }
        let ok: Bool
        let service: Service
        let orbis: [Orbi]
        let gruppen: [GroupInfo]
        let chats: [Chat]
        let sseParser: Bool
    }

    static func run() async -> Int32 {
        let model = AppModel()
        defer { model.shutdown() }
        do {
            try await model.service.ensureRunning()
            let bots = try await model.client.bots()
            let chats = try await model.client.chats()
            let report = Report(
                ok: true,
                service: .init(url: model.client.baseURL.absoluteString, startedByApp: model.service.startedByApp),
                orbis: ((bots.main.map { [$0] } ?? []) + bots.bots).map {
                    .init(id: $0.id, name: $0.name, job: $0.job, isMain: $0.isMain, chatId: $0.chatId)
                },
                gruppen: bots.groups.map { .init(id: $0.id, name: $0.name, members: $0.members.count) },
                chats: chats.chats.map { .init(id: $0.id, memberCount: $0.memberCount, lastMessageAt: $0.lastMessageAt) },
                sseParser: parserWorks()
            )
            print(try encode(report))
            return report.sseParser ? 0 : 1
        } catch {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"\(error.localizedDescription)\"}\n".utf8))
            return 1
        }
    }

    private static func encode(_ value: some Encodable) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    // Chunks an beliebiger Stelle geteilt, Kommentar, Mehrzeilen und [DONE].
    private static func parserWorks() -> Bool {
        var parser = SSEParser()
        let input = ": keepalive\n\ndata: {\"type\":\"start\"}\n\ndata: a\ndata: b\r\n\r\ndata: [DONE]\n\n"
        var events: [SSEEvent] = []
        for byte in Data(input.utf8) { events += parser.feed(Data([byte])) }
        return events == [SSEEvent(data: "{\"type\":\"start\"}"), SSEEvent(data: "a\nb"), SSEEvent(data: "[DONE]")]
            && events.last?.isDone == true
    }
}
