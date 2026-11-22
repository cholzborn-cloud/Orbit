import CoreGraphics
import Foundation

// Verbindung zum VNC-Websocket der Sandbox (wss, Pfad /websockify, Unterprotokoll binary). Ein Ping-Frame beendet die Verbindung
// (plan/API.md): Lebenszeichen nur über RFB-Nachrichten. Die signierte Adresse enthält ein Token: sie steht in keiner Ausgabe.

enum RFBFailure: Error, Sendable, Equatable {
    case timeout(connecting: Bool)
    case closed
    case network(String)
    case server(String)
    case refused(String)

    var message: String {
        switch self {
        case .timeout(let connecting): connecting ? "Der Computer antwortet nicht." : "Der Computer antwortet nicht mehr."
        case .closed: "Die Verbindung zum Computer wurde beendet."
        case .network(let text), .server(let text), .refused(let text): text
        }
    }
}

enum RFBEvent: Sendable {
    case connected(width: Int, height: Int, name: String)
    case frame(FrameImage)
    case cursor(CursorShape)
    case cutText(String)
    case size(width: Int, height: Int, reason: Int, result: Int)
    case closed(RFBFailure)
}

actor RFBSession {
    nonisolated let events: AsyncStream<RFBEvent>
    private nonisolated let eventSink: AsyncStream<RFBEvent>.Continuation
    private nonisolated let outbox: AsyncStream<Data>
    private nonisolated let outSink: AsyncStream<Data>.Continuation
    private let url: URL
    private var urlSession: URLSession?
    private var task: URLSessionWebSocketTask?
    private var decoder: RFBDecoder?
    private var handshakeBuffer = Data()
    private var lastReceive = ContinuousClock.now
    private var started = ContinuousClock.now
    private var running = false
    private var finished = false
    private(set) var bytesReceived = 0
    private(set) var updates = 0

    // Abstand der Lebenszeichen und Frist ohne jede Antwort.
    static let keepAlive: Duration = .seconds(10)
    static let silence: Duration = .seconds(35)

    init(url: URL) {
        self.url = url
        (events, eventSink) = AsyncStream<RFBEvent>.makeStream(bufferingPolicy: .unbounded)
        (outbox, outSink) = AsyncStream<Data>.makeStream(bufferingPolicy: .unbounded)
    }

    // Websocket-Adresse aus der signierten noVNC-Adresse: das Token steckt im Host, Pfad und Abfrage ersetzt der Websocket-Pfad.
    static func websocketURL(from desktop: URL) -> URL? {
        guard var parts = URLComponents(url: desktop, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = "wss"
        parts.path = "/websockify"
        parts.query = nil
        return parts.url
    }

    // MARK: Eingabe (aus beliebigem Kontext, in Reihenfolge)

    nonisolated func send(_ bytes: [UInt8]) { outSink.yield(Data(bytes)) }
    nonisolated func pointer(x: Int, y: Int, buttons: UInt8) { send(RFBMessage.pointer(x: x, y: y, buttons: buttons)) }
    nonisolated func key(_ keysym: UInt32, down: Bool) { send(RFBMessage.key(keysym, down: down)) }
    // Gibt die Zahl der Zeichen zurück, die in Latin-1 nicht vorkommen.
    @discardableResult
    nonisolated func clipboard(_ text: String) -> Int {
        let message = RFBMessage.clipboard(text)
        send(message.bytes)
        return message.lost
    }
    nonisolated func close() {
        outSink.finish()
        eventSink.finish()
        Task { await self.shutdown() }
    }

    func requestDesktopSize(width: Int, height: Int) -> Bool {
        guard let screen = decoder?.screen else { return false }
        send(RFBMessage.setDesktopSize(width: width, height: height, screenId: screen.id, flags: screen.flags))
        return true
    }

    func requestFullUpdate() {
        guard let framebuffer = decoder?.framebuffer else { return }
        send(RFBMessage.updateRequest(incremental: false, width: framebuffer.width, height: framebuffer.height))
    }

    // Bild nach einem vollständigen Update (wartet höchstens 3 s, bis keines mehr halb angewendet ist).
    func snapshot() async -> PixelBuffer? {
        for _ in 0..<60 where decoder?.isIdle == false { try? await Task.sleep(for: .milliseconds(50)) }
        return decoder?.framebuffer.snapshot()
    }
    func statistics() -> (bytes: Int, updates: Int) { (bytesReceived, updates) }

    private func shutdown() {
        finished = true
        task?.cancel(with: .goingAway, reason: nil)
        urlSession?.invalidateAndCancel()
        task = nil
        urlSession = nil
    }

    // MARK: Lauf

    // Verbindet, spricht den Handshake und liest bis zum Ende; meldet jedes Ende genau einmal als `.closed`.
    func run() async {
        guard !running else { return }
        running = true
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration)
        urlSession = session
        // noVNC/websockify sprechen das Unterprotokoll "binary".
        let socket = session.webSocketTask(with: url, protocols: ["binary"])
        socket.maximumMessageSize = 64 << 20
        task = socket
        socket.resume()
        started = .now
        lastReceive = .now

        let writer = Task { [outbox] in
            for await data in outbox {
                do { try await socket.send(.data(data)) } catch { return }
            }
        }
        let watchdog = Task { await self.watch() }
        let failure = await loop(socket)
        writer.cancel()
        watchdog.cancel()
        shutdown()
        eventSink.yield(.closed(failure))
        eventSink.finish()
    }

    private func loop(_ socket: URLSessionWebSocketTask) async -> RFBFailure {
        do {
            try await handshake(socket)
            while !Task.isCancelled && !finished {
                let message = try await socket.receive()
                guard case .data(let data) = message else { return .server("Der Computer sendet unerwartete Daten.") }
                lastReceive = .now
                bytesReceived += data.count
                guard let decoder else { return .closed }
                for item in try decoder.feed(data) { handle(item, decoder) }
            }
            return .closed
        } catch let failure as RFBFailure {
            return failure
        } catch let error as RFBError {
            return .server(error.localizedDescription)
        } catch {
            if finished { return .closed }
            // Die URLError-Beschreibung nennt die Adresse nicht, trotzdem nur die Art der Störung weitergeben.
            return .network(Self.describe(error))
        }
    }

    static func describe(_ error: Error) -> String {
        guard let urlError = error as? URLError else { return "Die Verbindung zum Computer ist abgebrochen." }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed: return "Keine Netzwerkverbindung zum Computer."
        case .timedOut: return "Der Computer antwortet nicht."
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed: return "Der Computer ist nicht erreichbar."
        case .badServerResponse, .cannotParseResponse, .userAuthenticationRequired, .userCancelledAuthentication: return "Der Computer hat die Verbindung abgelehnt."
        default: return "Die Verbindung zum Computer ist abgebrochen."
        }
    }

    private func handle(_ item: RFBDecoded, _ decoder: RFBDecoder) {
        switch item {
        case .updateFinished:
            updates += 1
            if decoder.takeDirty(), let image = decoder.framebuffer.makeImage() { eventSink.yield(.frame(FrameImage(image: image))) }
            send(RFBMessage.updateRequest(incremental: true, width: decoder.framebuffer.width, height: decoder.framebuffer.height))
        case .cursor(let shape): eventSink.yield(.cursor(shape))
        case .cutText(let text, _): eventSink.yield(.cutText(text))
        case .size(let width, let height, let reason, let result):
            eventSink.yield(.size(width: width, height: height, reason: reason, result: result))
            // Nach einer neuen Größe das ganze Bild neu anfordern.
            send(RFBMessage.updateRequest(incremental: false, width: width, height: height))
        case .bell: break
        }
    }

    // Lebenszeichen alle 10 s (1×1, nicht inkrementell: der Server antwortet sofort); ohne jede Antwort 35 s lang gilt die Verbindung als tot.
    private func watch() async {
        var lastBeat = ContinuousClock.now
        while !Task.isCancelled && !finished {
            try? await Task.sleep(for: .seconds(1))
            let now = ContinuousClock.now
            if decoder == nil, now - started > .seconds(25) { fail(.timeout(connecting: true)); return }
            if decoder != nil {
                if now - lastReceive > Self.silence { fail(.timeout(connecting: false)); return }
                if now - lastBeat >= Self.keepAlive {
                    lastBeat = now
                    send(RFBMessage.updateRequest(incremental: false, width: 1, height: 1))
                }
            }
        }
    }

    private func fail(_ failure: RFBFailure) {
        guard !finished else { return }
        finished = true
        task?.cancel(with: .goingAway, reason: nil)
        // Die Lese-Schleife endet mit einem Fehler und meldet `.closed(.closed)`; die Ursache soll erhalten bleiben.
        eventSink.yield(.closed(failure))
        eventSink.finish()
    }

    // MARK: Handshake (RFB 3.8, Sicherheitsart None, geteilte Sitzung)

    private func read(_ count: Int, _ socket: URLSessionWebSocketTask) async throws -> Data {
        while handshakeBuffer.count < count {
            guard case .data(let data) = try await socket.receive() else { throw RFBFailure.server("Der Computer sendet unerwartete Daten.") }
            lastReceive = .now
            bytesReceived += data.count
            handshakeBuffer.append(data)
        }
        let out = handshakeBuffer.prefix(count)
        handshakeBuffer = Data(handshakeBuffer.dropFirst(count))
        return Data(out)
    }

    private func handshake(_ socket: URLSessionWebSocketTask) async throws {
        let version = String(decoding: try await read(12, socket), as: UTF8.self)
        guard version.hasPrefix("RFB ") else { throw RFBFailure.server("Das ist kein VNC-Server.") }
        try await socket.send(.data(Data("RFB 003.008\n".utf8)))
        let count = Int(try await read(1, socket)[0])
        if count == 0 {
            let length = try await read(4, socket).reduce(0) { $0 << 8 | Int($1) }
            let reason = String(decoding: try await read(min(length, 512), socket), as: UTF8.self)
            throw RFBFailure.refused("Der Computer lehnt die Verbindung ab: \(reason)")
        }
        let types = Array(try await read(count, socket))
        guard types.contains(1) else { throw RFBFailure.refused("Der Computer verlangt eine Anmeldung, die Orbit nicht kennt.") }
        try await socket.send(.data(Data([1])))
        let result = try await read(4, socket).reduce(0) { $0 << 8 | Int($1) }
        guard result == 0 else { throw RFBFailure.refused("Der Computer lehnt die Verbindung ab.") }
        try await socket.send(.data(Data([1])))
        let init1 = try await read(24, socket)
        let width = Int(init1[0]) << 8 | Int(init1[1]), height = Int(init1[2]) << 8 | Int(init1[3])
        let nameLength = init1.suffix(4).reduce(0) { $0 << 8 | Int($1) }
        let name = String(decoding: try await read(min(nameLength, 256), socket), as: UTF8.self)
        let framebuffer = RFBDecoder(width: width, height: height)
        decoder = framebuffer
        try await socket.send(.data(Data(RFBMessage.pixelFormat)))
        try await socket.send(.data(Data(RFBMessage.encodings())))
        try await socket.send(.data(Data(RFBMessage.updateRequest(incremental: false, width: width, height: height))))
        eventSink.yield(.connected(width: width, height: height, name: name))
        // Reste des Handshake-Puffers gehören schon dem Bildstrom.
        if !handshakeBuffer.isEmpty {
            let rest = handshakeBuffer
            handshakeBuffer = Data()
            for item in try framebuffer.feed(rest) { handle(item, framebuffer) }
        }
    }
}
