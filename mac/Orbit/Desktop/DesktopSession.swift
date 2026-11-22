import AppKit
import CoreGraphics
import Foundation
import Observation

// Sitzung zum Computer eines Orbis (Web: „Computer“-Reiter im Seitenpanel). Holt die signierte Adresse vom Dienst (startet die Sandbox
// bei Bedarf, kann dauern), verbindet per RFB und hält Bild, Zeigerform und Zustand für die Ansicht. Die Adresse steht nie in Texten.
@MainActor @Observable
final class DesktopSession {
    enum State: Equatable {
        case idle
        // Adresse wird geholt: Sandbox startet gegebenenfalls (Text wechselt nach 2 s von „Verbindet“ zu „Computer startet“).
        case preparing
        case connecting
        case connected
        case noComputer(String)
        case offline(String)
        case failed(String)
        // Verbindung stand und riss ab; `retryIn` = Sekunden bis zum nächsten automatischen Versuch (nil = aufgegeben).
        case disconnected(String, retryIn: Int?)
    }

    let botId: String
    let botName: String
    private(set) var state = State.idle
    private(set) var frame: CGImage?
    private(set) var size = CGSize.zero
    private(set) var cursor: CursorShape?
    // Hinweis unter dem Bild (z. B. Zeichen außerhalb Latin-1 in der Zwischenablage).
    var notice: String?
    private(set) var preparingSince = Date.distantPast
    // Ergebnis der letzten Größenänderung (0 Erfolg, sonst Code des Servers); nil = keine versucht.
    private(set) var resizeResult: Int?
    private(set) var framesShown = 0

    private let client: ServiceClient
    var clipboard: ClipboardBridge
    private var rfb: RFBSession?
    private var pump: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var idleStop: Task<Void, Never>?
    private var userStopped = true
    private var attempts = 0
    private var lastClipboardCount = -1
    private var gotFrame = false
    // Jeder Verbindungsversuch trägt eine Nummer; Reste eines abgebrochenen Versuchs ändern nichts mehr.
    private var generation = 0
    // Pause zwischen automatischen Versuchen (Sekunden). Die Adresse gilt 1 h, bei Abbruch wird eine neue geholt.
    static let retryDelays = [2, 5, 10]

    init(botId: String, botName: String, client: ServiceClient, clipboard: ClipboardBridge = .system) {
        self.botId = botId
        self.botName = botName
        self.client = client
        self.clipboard = clipboard
    }

    var isLive: Bool { state == .connected }
    var interactive: Bool { state == .connected }

    // MARK: Lebenslauf

    // Ansicht erscheint: verbinden, falls nicht schon verbunden.
    func activate() {
        idleStop?.cancel(); idleStop = nil
        switch state {
        case .idle, .failed, .disconnected(_, retryIn: nil), .offline: connect()
        default: break
        }
    }

    // Ansicht verschwindet: nach 30 s ohne Ansicht trennen (die Sandbox läuft weiter, Daytona stoppt sie nach 15 Minuten Ruhe selbst).
    func deactivate() {
        idleStop?.cancel()
        idleStop = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            self?.disconnect()
        }
    }

    func connect() {
        guard rfb == nil, pump == nil else { return }
        retry?.cancel(); retry = nil
        userStopped = false
        state = .preparing
        preparingSince = .now
        gotFrame = false
        generation += 1
        let mine = generation
        pump = Task { [weak self] in await self?.start(mine) }
    }

    func reconnect() {
        attempts = 0
        teardown()
        connect()
    }

    func disconnect() {
        userStopped = true
        retry?.cancel(); retry = nil
        teardown()
        state = .idle
        frame = nil
        size = .zero
        cursor = nil
    }

    private func teardown() {
        generation += 1
        pump?.cancel(); pump = nil
        rfb?.close(); rfb = nil
    }

    private func start(_ mine: Int) async {
        let url: URL
        do {
            url = try await client.desktopURL(botId: botId)
        } catch {
            guard !Task.isCancelled, generation == mine else { return }
            let message = error.localizedDescription
            if let service = error as? ServiceError, case .offline = service { state = .offline(message) }
            else if message.contains("keinen Computer") { state = .noComputer(message) }
            else { state = .failed(message) }
            pump = nil
            return
        }
        guard !Task.isCancelled, generation == mine else { return }
        guard let socketURL = RFBSession.websocketURL(from: url) else { state = .failed("Die Adresse des Computers ist ungültig."); pump = nil; return }
        state = .connecting
        let session = RFBSession(url: socketURL)
        rfb = session
        let runner = Task { await session.run() }
        for await event in session.events {
            guard !Task.isCancelled, generation == mine else { break }
            handle(event)
        }
        runner.cancel()
        if generation == mine { pump = nil }
    }

    private func handle(_ event: RFBEvent) {
        switch event {
        case .connected(let width, let height, _):
            size = CGSize(width: width, height: height)
            syncClipboardToComputer(force: true)
        case .frame(let wrapper):
            frame = wrapper.image
            size = CGSize(width: wrapper.image.width, height: wrapper.image.height)
            framesShown += 1
            if !gotFrame { gotFrame = true; attempts = 0; state = .connected }
        case .cursor(let shape):
            cursor = shape.width > 0 && shape.height > 0 ? shape : nil
        case .cutText(let text):
            guard !text.isEmpty else { return }
            clipboard.write(text)
            lastClipboardCount = clipboard.changeCount()
        case .size(let width, let height, let reason, let result):
            size = CGSize(width: width, height: height)
            if reason == 1 { resizeResult = result }
        case .closed(let failure):
            rfb?.close(); rfb = nil
            guard !userStopped else { return }
            if gotFrame { scheduleRetry(failure.message) } else { state = .failed(failure.message) }
        }
    }

    // Automatisch neu verbinden (neue Adresse), mit wachsender Wartezeit; nach drei Versuchen bleibt „Wiederverbinden“.
    private func scheduleRetry(_ message: String) {
        guard attempts < Self.retryDelays.count else { state = .disconnected(message, retryIn: nil); return }
        let delay = Self.retryDelays[attempts]
        attempts += 1
        state = .disconnected(message, retryIn: delay)
        retry = Task { [weak self] in
            for left in stride(from: delay, to: 0, by: -1) {
                guard !Task.isCancelled else { return }
                self?.state = .disconnected(message, retryIn: left)
                try? await Task.sleep(for: .seconds(1))
            }
            guard !Task.isCancelled, let self else { return }
            pump = nil
            connect()
        }
    }

    // MARK: Eingabe

    func pointer(x: Int, y: Int, buttons: UInt8) { rfb?.pointer(x: x, y: y, buttons: buttons) }
    func key(_ keysym: UInt32, down: Bool) { rfb?.key(keysym, down: down) }

    // Zwischenablage Mac → Computer. Ohne `force` nur, wenn sie sich seit dem letzten Abgleich geändert hat.
    func syncClipboardToComputer(force: Bool = false) {
        let count = clipboard.changeCount()
        guard force || count != lastClipboardCount, let text = clipboard.read(), !text.isEmpty else { lastClipboardCount = count; return }
        lastClipboardCount = count
        let lost = rfb?.clipboard(text) ?? 0
        notice = lost > 0 ? "Zwischenablage: \(lost) \(lost == 1 ? "Zeichen" : "Zeichen") außerhalb von Latin-1 wurden durch „?“ ersetzt." : nil
    }

    // Größe des Desktops ändern (SetDesktopSize); das Ergebnis steht in `resizeResult`. false = der Server bietet es nicht an.
    @discardableResult
    func requestSize(width: Int, height: Int) async -> Bool {
        resizeResult = nil
        return await rfb?.requestDesktopSize(width: width, height: height) ?? false
    }

    var statistics: (bytes: Int, updates: Int) {
        get async { await rfb?.statistics() ?? (0, 0) }
    }

    func snapshot() async -> PixelBuffer? { await rfb?.snapshot() }

    // Selbsttest: Zustand und Bild ohne Netz setzen (Screenshot-Szenen).
    func simulate(state: State, frame: CGImage? = nil, size: CGSize = .zero) {
        self.state = state
        self.frame = frame
        self.size = size
        preparingSince = .now
    }

    // Text zum Zustand (Web hat keinen; nativ gestaltet: Spinner mit Text).
    func progressText(now: Date = .now) -> String {
        state == .preparing && now.timeIntervalSince(preparingSince) > 2 ? "Computer startet …" : "Verbindet …"
    }
}

// Sitzungen je Orbi (eine pro Computer), bleiben beim Wechseln von Chat und Reiter erhalten.
@MainActor @Observable
final class DesktopStore {
    private var sessions: [String: DesktopSession] = [:]
    private let client: ServiceClient
    var clipboard: ClipboardBridge = .system

    init(client: ServiceClient) { self.client = client }

    func session(for bot: Bot) -> DesktopSession {
        if let existing = sessions[bot.id] { return existing }
        let session = DesktopSession(botId: bot.id, botName: bot.name, client: client, clipboard: clipboard)
        sessions[bot.id] = session
        return session
    }

    func existing(botId: String) -> DesktopSession? { sessions[botId] }

    func remove(botId: String) {
        sessions[botId]?.disconnect()
        sessions[botId] = nil
    }

    func shutdown() { sessions.values.forEach { $0.disconnect() } }
}
