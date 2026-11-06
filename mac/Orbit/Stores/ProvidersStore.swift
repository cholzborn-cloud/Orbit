import AppKit
import Foundation

// Zustand des Abschnitts „Anbieter“. Geheime Werte werden nie gehalten: sie gehen direkt an den Dienst,
// danach merkt sich der Store nur, WELCHES Feld gesetzt wurde.
@MainActor @Observable
final class ProvidersStore {
    private let client: ServiceClient
    private let openURL: (URL) -> Bool

    private(set) var providers: Load<[ProviderItem]> = .idle
    // Namen gesetzter Felder je Anbieter (nie Werte).
    private(set) var savedKeys: [String: Set<String>] = [:]
    private(set) var busy: Set<String> = []
    private(set) var results: [String: String] = [:]
    private(set) var errors: [String: String] = [:]

    init(client: ServiceClient, openURL: @escaping (URL) -> Bool = ProvidersStore.openInSafari) {
        self.client = client
        self.openURL = openURL
    }

    // Die Anmeldung öffnet einen Safari-Tab (Consti, 05.11.2026); ohne Safari der Standardbrowser.
    nonisolated static func openInSafari(_ url: URL) -> Bool {
        guard let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") else { return NSWorkspace.shared.open(url) }
        NSWorkspace.shared.open([url], withApplicationAt: safari, configuration: NSWorkspace.OpenConfiguration())
        return true
    }

    // Nur die Liste; kein Anbieter wird dabei angesprochen.
    func load() async {
        if providers.value == nil { providers = .loading }
        do { providers = .loaded(try await client.providers().providers) } catch {
            let m = SettingsStore.message(error); providers = .failed(m.text, offline: m.offline)
        }
    }

    func isSet(_ provider: ProviderItem, key: String) -> Bool {
        savedKeys[provider.id]?.contains(key) == true || !provider.missing.contains(key) && provider.configured
    }

    func save(_ provider: ProviderItem, key: String, value: String) async {
        await run(provider.id) {
            try await self.client.setProviderConfig(id: provider.id, key: key, value: value)
            self.savedKeys[provider.id, default: []].insert(key)
            await self.load()
        }
    }

    // Nur die Werte speichern, die eingegeben wurden, dann zur Anmeldung weitergehen.
    func install(_ provider: ProviderItem, values: [(String, String)]) async {
        for (key, value) in values where !value.isEmpty { await save(provider, key: key, value: value) }
        if let fresh = providers.value?.first(where: { $0.id == provider.id }), fresh.configured { await connect(fresh) }
    }

    func connect(_ provider: ProviderItem) async {
        await run(provider.id) {
            let response = try await self.client.connectProvider(id: provider.id)
            if let text = response.url, let url = URL(string: text), url.scheme == "https" || url.scheme == "http" {
                if !self.openURL(url) { self.errors[provider.id] = "Der Browser konnte nicht geöffnet werden." }
            }
            await self.load()
        }
    }

    func testRead(_ provider: ProviderItem) async {
        await run(provider.id) {
            let response = try await self.client.readProvider(id: provider.id)
            if response.ok { self.results[provider.id] = response.text } else { self.errors[provider.id] = response.text }
        }
    }

    func disconnect(_ provider: ProviderItem) async {
        await run(provider.id) {
            try await self.client.deleteProvider(id: provider.id)
            self.savedKeys[provider.id] = nil
            await self.load()
        }
    }

    private func run(_ id: String, _ work: () async throws -> Void) async {
        busy.insert(id); errors[id] = nil; results[id] = nil
        defer { busy.remove(id) }
        do { try await work() } catch { errors[id] = SettingsStore.message(error).text }
    }
}
