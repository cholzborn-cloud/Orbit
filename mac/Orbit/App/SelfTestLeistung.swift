import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-leistung`: misst Flüssigkeit ohne Dienst und ohne Modell. Ein Ersatz-Dienst (URLProtocol) liefert Verlauf und
// einen SSE-Strom; der Chat steht in einem unsichtbaren Fenster. Gemessen: Hänger des Hauptthreads (Verzögerung eines Hauptthread-Blocks,
// alle 2 ms von einem Hintergrund-Thread angestoßen), Zeit bis der Chat steht und Zahl der Verlaufsänderungen beim Streamen.
@MainActor
enum SelfTestLeistung {
    struct Lag: Encodable { let samples: Int; let p50: Double; let p95: Double; let max: Double; let over16: Int }
    struct Result: Encodable { let name: String; let ms: Double; let lag: Lag; let detail: String }

    static func run() async -> Int32 {
        let history = Int(ProcessInfo.processInfo.environment["ORBIT_PERF_HISTORY"] ?? "") ?? 300
        let deltas = Int(ProcessInfo.processInfo.environment["ORBIT_PERF_DELTAS"] ?? "") ?? 400
        FakeService.store.reset(chats: ["perf-a": history, "perf-b": history])
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeService.self]
        configuration.httpMaximumConnectionsPerHost = 64
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:4399")!, session: URLSession(configuration: configuration), tokenOverride: { "perf" })
        let store = ChatStore(client: client)

        let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 1100, height: 720), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.alphaValue = 0.01
        window.orderFront(nil)
        var results: [Result] = []

        func show(_ chatId: String) -> ChatSession {
            let session = store.session(for: chatId)
            let view = ChatView(title: "Perf", subtitle: "", state: .calm, locked: false, session: session, avatar: { _ in Color.clear },
                                onPill: {}, members: [], senderNames: [], orbiState: { _ in .calm }, orbi: { _ in nil })
                .id(chatId)
                .environment(\.figuresStatic, true)
            window.contentView = NSHostingView(rootView: AnyView(view))
            return session
        }
        func settle() async {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try? await Task.sleep(for: .milliseconds(30))
        }

        // Steht der Verlauf ganz unten? (größte Scrollfläche im Fenster)
        func bottomText() -> String {
            func scrollViews(_ view: NSView) -> [NSScrollView] { (view as? NSScrollView).map { [$0] } ?? [] + view.subviews.flatMap(scrollViews) }
            guard let content = window.contentView, let scroll = scrollViews(content).max(by: { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }),
                  let document = scroll.documentView else { return "Scrollfläche nicht gefunden" }
            let gap = document.frame.height - scroll.contentView.documentVisibleRect.maxY
            return gap <= 2 ? "steht unten" : "NICHT unten (\(Int(gap)) pt darüber)"
        }

        func traceText() -> String {
            func scrollViews(_ view: NSView) -> [NSScrollView] { (view as? NSScrollView).map { [$0] } ?? [] + view.subviews.flatMap(scrollViews) }
            return scrollViews(window.contentView!).map { "doc \(Int($0.documentView?.frame.height ?? 0)) vis \(Int($0.contentView.documentVisibleRect.minY))-\(Int($0.contentView.documentVisibleRect.maxY)) frame \(Int($0.frame.height))" }.joined(separator: " | ")
        }
        // Chat öffnen (Laden, Dekodieren, erstes Layout), danach ein zweiter Chat und zurück zum ersten (Sitzung schon geladen).
        for (name, chatId) in [("Chat öffnen (neu)", "perf-a"), ("Chatwechsel (anderer Chat, neu)", "perf-b"), ("Chatwechsel (zurück, geladen)", "perf-a")] {
            let probe = LagProbe()
            probe.start()
            let start = ContinuousClock.now
            let session = show(chatId)
            while session.loadState != .loaded { try? await Task.sleep(for: .milliseconds(1)) }
            await settle()
            let ms = (ContinuousClock.now - start).milliseconds
            let early = bottomText()
            if ProcessInfo.processInfo.environment["ORBIT_PERF_TRACE"] != nil {
                for _ in 0..<12 { try? await Task.sleep(for: .milliseconds(30)); print(name, traceText()) }
            }
            await session.waitUntilIdle()
            try? await Task.sleep(for: .milliseconds(300))
            results.append(Result(name: name, ms: ms, lag: probe.stop(), detail: "\(session.messages.count) Nachrichten geladen von \(history), sofort: \(early), nach 0,3 s: \(bottomText())"))
        }

        // Streaming: eine Antwort mit `deltas` Textstücken im Abstand von 4 ms (schnelles Modell).
        let session = store.session(for: "perf-a")
        FakeService.store.armStream(chatId: "perf-a", deltas: deltas, intervalMs: 4)
        let changes = ChangeCounter()
        changes.track(session)
        let probe = LagProbe()
        probe.start()
        let start = ContinuousClock.now
        session.attach()
        await session.waitUntilIdle()
        let ms = (ContinuousClock.now - start).milliseconds
        try? await Task.sleep(for: .milliseconds(100))
        results.append(Result(name: "Streaming \(deltas) Chunks", ms: ms, lag: probe.stop(),
                              detail: "\(session.receivedChunks) Chunks, \(changes.count) Verlaufsänderungen, Text \(session.lastAssistant?.text.count ?? 0) Zeichen"))

        // Ganz nach oben scrollen: die nächste ältere Seite kommt dazu (Nachladen beim Hochscrollen).
        do {
            func scrollViews(_ view: NSView) -> [NSScrollView] { (view as? NSScrollView).map { [$0] } ?? [] + view.subviews.flatMap(scrollViews) }
            let before = session.messages.count
            let probe = LagProbe()
            probe.start()
            let start = ContinuousClock.now
            for _ in 0..<3 {
                if let scroll = scrollViews(window.contentView!).max(by: { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }) {
                    scroll.contentView.scroll(to: .zero)
                    scroll.reflectScrolledClipView(scroll.contentView)
                }
                let deadline = ContinuousClock.now + .seconds(2)
                let goal = session.messages.count + 1
                while session.messages.count < goal, ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(10)) }
                try? await Task.sleep(for: .milliseconds(100))
            }
            results.append(Result(name: "Hochscrollen (3x ganz nach oben)", ms: (ContinuousClock.now - start).milliseconds, lag: probe.stop(),
                                  detail: "\(before) → \(session.messages.count) Nachrichten, ältere übrig: \(session.hasOlder)"))
        }

        struct Report: Encodable { let history: Int; let results: [Result] }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(Report(history: history, results: results)) { print(String(decoding: data, as: UTF8.self)) }
        return 0
    }

    // Zählt Änderungen an `session.messages` (je Änderung baut SwiftUI den Verlauf neu auf).
    private final class ChangeCounter: @unchecked Sendable {
        var count = 0
        @MainActor func track(_ session: ChatSession) {
            withObservationTracking { _ = session.messages } onChange: { [self] in
                count += 1
                Task { @MainActor in self.track(session) }
            }
        }
    }

    // Hintergrund-Thread stößt alle 2 ms einen Block auf dem Hauptthread an und misst, wie lange er warten musste.
    private final class LagProbe: @unchecked Sendable {
        private let lock = NSLock()
        private var samples: [Double] = []
        private var running = true

        func start() {
            Thread.detachNewThread { [self] in
                while lock.withLock({ running }) {
                    let begin = DispatchTime.now().uptimeNanoseconds
                    let done = DispatchSemaphore(value: 0)
                    DispatchQueue.main.async {
                        let lag = Double(DispatchTime.now().uptimeNanoseconds - begin) / 1e6
                        self.lock.withLock { self.samples.append(lag) }
                        done.signal()
                    }
                    done.wait()
                    usleep(2000)
                }
            }
        }

        func stop() -> Lag {
            let sorted = lock.withLock { running = false; return samples.sorted() }
            func at(_ q: Double) -> Double { sorted.isEmpty ? 0 : (sorted[min(sorted.count - 1, Int(Double(sorted.count) * q))] * 10).rounded() / 10 }
            return Lag(samples: sorted.count, p50: at(0.5), p95: at(0.95), max: at(1), over16: sorted.filter { $0 > 16.7 }.count)
        }
    }
}

final class SelfTestLeistungDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestLeistung.run()) }
    }
}

// Ersatz-Dienst für den Messtest: Verlauf (mit `limit`/`before` wie orbitd) und ein vorbereiteter SSE-Strom; alles andere 404.
final class FakeService: URLProtocol {
    private struct Unchecked<T>: @unchecked Sendable { let value: T }
    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var chats: [String: [[String: Any]]] = [:]
        private var streams: [String: (deltas: Int, intervalMs: Int)] = [:]

        func reset(chats counts: [String: Int]) {
            lock.withLock {
                chats = counts.mapValues { count in (0..<count).map { Self.message(index: $0) } }
                streams = [:]
            }
        }
        func armStream(chatId: String, deltas: Int, intervalMs: Int) { lock.withLock { streams[chatId] = (deltas, intervalMs) } }
        func takeStream(_ chatId: String) -> (deltas: Int, intervalMs: Int)? { lock.withLock { streams.removeValue(forKey: chatId) } }
        func messages(_ chatId: String) -> [[String: Any]] { lock.withLock { chats[chatId] ?? [] } }
        func append(_ chatId: String, _ message: [String: Any]) { lock.withLock { chats[chatId, default: []].append(message) } }

        static func message(index: Int) -> [String: Any] {
            let user = index.isMultiple(of: 2)
            let text = user
                ? "Frage \(index): Kannst du mir **kurz** erklären, wie das mit `Swift` und *Nebenläufigkeit* funktioniert?"
                : (0..<3).map { p in "Absatz \(p) zu Antwort \(index): Ein Satz mit **fett**, *kursiv* und `Code`. " + String(repeating: "Noch mehr erklärender Text hier. ", count: 6) }.joined(separator: "\n\n")
                    + (index % 10 == 1 ? "\n\n```swift\nlet x = \(index)\nprint(x)\n```" : "")
            return ["id": "m\(index)", "role": user ? "user" : "assistant", "parts": [["type": "text", "text": text]],
                    "metadata": ["createdAt": 1_700_000_000_000 + Double(index) * 60_000]]
        }
    }
    static let store = Store()
    private var cancelled = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { cancelled = true }

    override func startLoading() {
        guard let url = request.url else { return }
        let parts = url.path.split(separator: "/").map(String.init)
        if parts.count == 4, parts[1] == "chats", parts[3] == "messages", request.httpMethod == "GET" {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            var list = Self.store.messages(parts[2])
            var body: [String: Any] = [:]
            if let limit = query.first(where: { $0.name == "limit" })?.value.flatMap(Int.init) {
                if let before = query.first(where: { $0.name == "before" })?.value, let end = list.firstIndex(where: { $0["id"] as? String == before }) {
                    list = Array(list[..<end])
                }
                body["hasMore"] = list.count > limit
                list = Array(list.suffix(limit))
            }
            body["messages"] = list
            respond(status: 200, json: body)
        } else if parts.count == 4, parts[1] == "chats", parts[3] == "stream", let stream = Self.store.takeStream(parts[2]) {
            sse(chatId: parts[2], deltas: stream.deltas, intervalMs: stream.intervalMs)
        } else if parts.count == 4, parts[1] == "chats", parts[3] == "stream" {
            respond(status: 204, json: nil)
        } else {
            respond(status: 404, json: ["error": "Nicht gefunden."])
        }
    }

    private func respond(status: Int, json: [String: Any]?) {
        let headers = ["Content-Type": "application/json"]
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if let json, let data = try? JSONSerialization.data(withJSONObject: json) { client?.urlProtocol(self, didLoad: data) }
        client?.urlProtocolDidFinishLoading(self)
    }

    // Antwort aus Textstücken: Wörter mit Markdown, alle 30 Stücke ein neuer Absatz, in der Mitte ein Codeblock.
    private func sse(chatId: String, deltas: Int, intervalMs: Int) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        let box = Unchecked(value: self)
        Thread.detachNewThread {
            let me = box.value
            let id = "live-\(UUID().uuidString)"
            func send(_ object: [String: Any]) {
                guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
                me.client?.urlProtocol(me, didLoad: Data("data: ".utf8) + data + Data("\n\n".utf8))
            }
            send(["type": "start", "messageId": id])
            send(["type": "text-start", "id": "t1"])
            var text = ""
            for index in 0..<deltas where !me.cancelled {
                let delta = index == deltas / 2 ? "\n\n```swift\nlet y = 1\n```\n\n" : (index % 30 == 29 ? "Ende.\n\n" : ["Wort ", "**fett** ", "*kursiv* ", "`code` "][index % 4])
                text += delta
                send(["type": "text-delta", "id": "t1", "delta": delta])
                usleep(useconds_t(intervalMs * 1000))
            }
            send(["type": "text-end", "id": "t1"])
            send(["type": "finish"])
            Self.store.append(chatId, ["id": id, "role": "assistant", "parts": [["type": "text", "text": text]]])
            me.client?.urlProtocol(me, didLoad: Data("data: [DONE]\n\n".utf8))
            me.client?.urlProtocolDidFinishLoading(me)
        }
    }
}
