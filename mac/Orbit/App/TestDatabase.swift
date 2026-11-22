import Foundation
import SQLite3

// Zugriff auf die Datenbankkopie der Tests (ORBIT_DATA_DIR): Nachrichten von Orbis in Chats schreiben, Spalten prüfen.
// Verweigert die echte Datenbank: ohne ORBIT_DATA_DIR oder mit dem Standardordner passiert nichts.
final class TestDatabase {
    private var handle: OpaquePointer?

    static var isTestCopy: Bool {
        guard let path = ProcessInfo.processInfo.environment["ORBIT_DATA_DIR"], !path.isEmpty else { return false }
        let standard = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/Orbit").standardizedFileURL.path
        return URL(fileURLWithPath: path).standardizedFileURL.path != standard
    }

    init() throws {
        guard Self.isTestCopy else { throw SpikeError("Nur gegen eine Datenbankkopie (ORBIT_DATA_DIR) erlaubt.") }
        let url = ServiceClient.defaultDataDirectory.appending(path: "orbit.sqlite")
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else { throw SpikeError("Datenbankkopie lässt sich nicht öffnen.") }
        sqlite3_busy_timeout(handle, 5000)
    }

    deinit { sqlite3_close(handle) }

    func exec(_ sql: String) throws {
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(handle, sql, nil, nil, &message) == SQLITE_OK else {
            let text = message.map { String(cString: $0) } ?? "unbekannt"
            sqlite3_free(message)
            throw SpikeError("SQL: \(text)")
        }
    }

    func scalar(_ sql: String) -> String? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { return nil }
        return String(cString: text)
    }

    private func quote(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "''") + "'" }

    // Antwort eines Orbis (oder eines längst gelöschten) in einen Chat schreiben.
    func addAssistantMessage(chatId: String, botId: String, text: String) throws {
        let position = Int(scalar("select coalesce(max(position), -1) + 1 from chat_messages where chat_id = \(quote(chatId))") ?? "0") ?? 0
        let parts = "[{\"type\":\"text\",\"text\":\(jsonString(text))}]"
        let metadata = "{\"botId\":\(jsonString(botId))}"
        try exec("insert into chat_messages (chat_id, id, role, parts, metadata, position) values (\(quote(chatId)), \(quote(UUID().uuidString)), 'assistant', \(quote(parts)), \(quote(metadata)), \(position))")
    }

    func addUserMessage(chatId: String, text: String) throws {
        let position = Int(scalar("select coalesce(max(position), -1) + 1 from chat_messages where chat_id = \(quote(chatId))") ?? "0") ?? 0
        let parts = "[{\"type\":\"text\",\"text\":\(jsonString(text))}]"
        try exec("insert into chat_messages (chat_id, id, role, parts, position) values (\(quote(chatId)), \(quote(UUID().uuidString)), 'user', \(quote(parts)), \(position))")
    }

    // Nachricht samt Suchindex-Zeile (der Dienst legt sie sonst beim Speichern an): `id` der Nachricht wird zurückgegeben.
    @discardableResult
    func addIndexedMessage(chatId: String, role: String = "user", text: String) throws -> String {
        let id = UUID().uuidString
        let position = Int(scalar("select coalesce(max(position), -1) + 1 from chat_messages where chat_id = \(quote(chatId))") ?? "0") ?? 0
        let parts = "[{\"type\":\"text\",\"text\":\(jsonString(text))}]"
        try exec("insert into chat_messages (chat_id, id, role, parts, position) values (\(quote(chatId)), \(quote(id)), \(quote(role)), \(quote(parts)), \(position))")
        try exec("insert into chat_messages_index (id, user_id, chat_id, role, body) values (\(quote(chatId + ":" + id)), 'local', \(quote(chatId)), \(quote(role)), \(quote(text)))")
        return id
    }

    private func jsonString(_ text: String) -> String {
        (try? String(decoding: JSONSerialization.data(withJSONObject: [text]), as: UTF8.self))
            .map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }
}
