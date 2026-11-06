import Foundation
import Observation

// Ein offener Chat: Verlauf, laufender Turn, Senden, Stopp, Wiederanhängen. Läuft auch weiter, wenn der Chat nicht angezeigt wird.
@MainActor @Observable
final class ChatSession {
    enum Defaults {
        static let model = "claude-sonnet-5-5"
        static let effort: String? = "medium"
    }

    let chatId: String
    private let client: ServiceClient
    private(set) var messages: [ChatMessage] = []
    private(set) var loadState: LoadState = .idle
    private(set) var isRunning = false
    // Der Nutzer hat gesendet: Seitenleiste sortiert den Chat nach oben.
    @ObservationIgnored var onActivity: (() -> Void)?
    private(set) var error: String?
    private(set) var retrying = false
    private(set) var automationRetries = AutomationRetries()
    var draft = ""
    var replyTarget: ChatMessage?
    // Sprungziel (Suchtreffer, Lauf): die Ansicht scrollt zur Nachricht und hebt sie kurz hervor.
    private(set) var jumpTarget: String?
    private(set) var highlighted: String?
    // Modell, Stufe, Freigabemodus, Kontext, Slash-Skill und Anhänge des Composers.
    let composer: ComposerModel
    var model: String {
        get { composer.effectiveModelId }
        set { composer.modelId = newValue }
    }
    var effort: String? {
        get { composer.effort }
        set { composer.effort = newValue }
    }
    // Gruppenchat: antwortender Orbi (nil = Dienst wählt).
    var botId: String?
    // Mitglieder des Gruppenchats (für @Name); leer im Direktchat.
    var members: [GroupText.Member] = []
    // Im Eingabefeld gewählte @-Markierungen: beim Senden wird aus `@Name` der Verweis `@[Name](orbi:<id>)`.
    var pickedMentions: [MentionTarget] = []
    // Ruhiger Hinweis über dem Eingabefeld, z. B. „Gruppe antwortet noch“ (kein Fehler).
    private(set) var notice: String?
    // Stopp wurde gedrückt: Anzeige „gestoppt“, bis die nächste Nachricht gesendet wird.
    private(set) var stopRequested = false
    // Phase 3: Reaktionen des Chats (Verlauf laden, Ereignis `reaction`, eigene Reaktion sofort) und Onboarding dieses Chats.
    private(set) var reactions = ReactionBoard()
    private(set) var onboardingBotId: String?
    private var streamTask: Task<Void, Never>?
    private var lastSent: ChatMessage?
    private var deltaCount = 0

    init(chatId: String, client: ServiceClient) {
        self.chatId = chatId
        self.client = client
        composer = ComposerModel(chatId: chatId, client: client)
    }

    // Anzahl verarbeiteter Chunks des letzten Turns (Selbsttest: Streaming belegt).
    var receivedChunks: Int { deltaCount }
    // Der Dienst meldet Modell-Limits nur als Fehlertext (gleiche Muster wie lib/chat/error-text.ts); eine eigene Kennung gibt es nicht.
    var isLimited: Bool {
        error?.range(of: #"\b429\b|rate.?limit|too many requests|Limit des Modells"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
    // Zeilen „gesendet an/von“ sind keine Antworten des Orbis (keine lebende Figur, kein Info-Popover).
    // Eine eigene Zeile „gesendet an @B“ arbeitet oder wartet noch (nicht gehalten): Stopp im Root-Chat bricht alle Orbis des Auftrags ab.
    var hasActiveLines: Bool {
        messages.contains { message in
            guard let line = message.orbiLine else { return false }
            return line.direction == .out && line.kind == .message && line.isActive && !line.held
        }
    }
    var lastAssistant: ChatMessage? { messages.last { $0.role == .assistant && !$0.isLine } }

    // Verlauf und Reaktionen in einem Aufruf. Seitenweise: so viele neueste Nachrichten wie geladen sind (alles Sichtbare wird aufgefrischt,
    // z. B. Status älterer Zeilen), höchstens 200; davor schon Geladenes bleibt (zusammengeführt).
    private func fetchHistory() async throws -> [ChatMessage] {
        let response = try await client.history(chatId: chatId, limit: min(max(Self.pageSize, messages.count), Self.refreshLimit))
        reactions = ReactionBoard(response.reactions)
        interrupted = response.interrupted
        let merged = messages.mergingLatest(response.messages)
        // Ohne Überlappung (mehr Neues als eine Seite) beginnt die Liste mit der Seite, sonst bleibt der bekannte Anfang.
        if merged.count == response.messages.count { hasOlder = response.hasMore }
        return merged
    }

    static let pageSize = 40
    static let refreshLimit = 200
    // Es gibt ältere Nachrichten im Dienst, die noch nicht geladen sind (Nachladen beim Hochscrollen).
    private(set) var hasOlder = false
    private var loadingOlder = false

    // Ältere Seite vor der ersten geladenen Nachricht voranstellen. Gibt zurück, ob etwas dazukam.
    @discardableResult
    func loadOlder() async -> Bool {
        guard hasOlder, !loadingOlder, let first = messages.first else { return false }
        loadingOlder = true
        defer { loadingOlder = false }
        guard let response = try? await client.history(chatId: chatId, limit: Self.pageSize, before: first.id) else { return false }
        let known = Set(messages.map(\.id))
        let older = response.messages.filter { !known.contains($0.id) }
        hasOlder = response.hasMore && !older.isEmpty
        guard !older.isEmpty else { return false }
        messages.insert(contentsOf: older, at: 0)
        return true
    }

    // Suchtreffer weiter oben: ältere Seiten nachladen, bis die Nachricht da ist (höchstens `maxPages`).
    func reveal(_ messageId: String, maxPages: Int = 50) async -> Bool {
        var pages = 0
        while !messages.contains(where: { $0.id == messageId }), pages < maxPages, await loadOlder() { pages += 1 }
        return messages.contains { $0.id == messageId }
    }

    // Phase 5: Arbeit, die ein Neustart des Dienstes angehalten hat. „Weiter“ startet den Turn mit deiner letzten Nachricht neu.
    private(set) var interrupted: InterruptedInfo?
    private(set) var resuming = false
    @ObservationIgnored var onResumed: ((String) -> Void)?

    func resumeInterrupted() async {
        guard let info = interrupted, !resuming else { return }
        resuming = true
        defer { resuming = false }
        do {
            try await client.resume(chatId: chatId, runId: info.runId)
            interrupted = nil
            onResumed?(chatId)
            if let stored = try? await fetchHistory() { messages = stored }
            attach()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func dismissInterrupted() async {
        guard let info = interrupted else { return }
        interrupted = nil
        try? await client.resume(chatId: chatId, runId: info.runId, dismiss: true)
    }

    // MARK: Reaktionen

    // Consti reagiert (PUT); dieselbe Reaktion noch einmal nimmt sie zurück (DELETE). Sofort sichtbar, bei Fehler zurückgenommen.
    func react(_ emoji: String, to messageId: String) {
        let previous = reactions.mine(for: messageId)
        let remove = previous == emoji
        reactions.set(messageId: messageId, actor: ReactionBoard.userActor, emoji: remove ? nil : emoji, at: Date().timeIntervalSince1970 * 1000)
        Task {
            do {
                if remove { try await client.removeReaction(chatId: chatId, messageId: messageId) }
                else { try await client.react(chatId: chatId, messageId: messageId, emoji: emoji) }
            } catch {
                reactions.set(messageId: messageId, actor: ReactionBoard.userActor, emoji: previous)
                notice = "Die Reaktion konnte nicht gesendet werden."
            }
        }
    }

    // Ereignis `reaction`: Änderung sofort übernehmen, den Stand danach vom Dienst holen.
    func applyReaction(messageId: String, actor: String, emoji: String?) {
        reactions.set(messageId: messageId, actor: actor, emoji: emoji, at: Date().timeIntervalSince1970 * 1000)
        Task { if let list = try? await client.reactions(chatId: chatId) { reactions = ReactionBoard(list) } }
    }

    // MARK: Onboarding

    // Nach dem Anlegen eines Orbis: ein Turn mit `onboarding: true` ohne Nachricht (nur im leeren Chat, nur einmal).
    func startOnboarding(botId: String) async {
        guard onboardingBotId == nil else { return }
        onboardingBotId = botId
        await load()
        // Lädt die Ansicht gerade selbst, wartet dieser Aufruf kurz mit (sonst überschriebe der Verlauf die Antwort).
        var waited = 0
        while loadState == .loading, waited < 100 { try? await Task.sleep(for: .milliseconds(50)); waited += 1 }
        await waitUntilIdle()
        guard loadState == .loaded, messages.isEmpty, !isRunning else { onboardingBotId = nil; return }
        run { client, session in
            try client.onboardingRequest(chatId: session.chatId, botId: botId, model: session.composer.effectiveModelId)
        } onBusy: { session in
            session.onboardingBotId = nil
            return true
        }
    }

    // „Überspringen“: der Dienst markiert das Onboarding als erledigt; ein laufender Onboarding-Turn wird beendet.
    func skipOnboarding() {
        guard let botId = onboardingBotId else { return }
        onboardingBotId = nil
        let wasRunning = isRunning
        Task {
            try? await client.skipOnboarding(botId: botId)
            if wasRunning { try? await client.stop(chatId: chatId) }
        }
    }

    func onboardingFinished() { onboardingBotId = nil }

    func jump(to messageId: String) { jumpTarget = messageId }
    func clearJump() { jumpTarget = nil }

    func highlight(_ messageId: String) {
        highlighted = messageId
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.2))
            if self?.highlighted == messageId { self?.highlighted = nil }
        }
    }

    // Nur einmal je Sitzung: ein zweiter Aufruf (Chat wieder geöffnet) würde die gerade gestreamte Antwort durch den gespeicherten
    // Verlauf ersetzen, und eine wartende Freigabe oder Rückfrage verschwände, bis wieder ein Chunk kommt.
    // Der Verlauf bleibt je Chat im Speicher (ChatStore hält die Sitzung): erneutes Öffnen zeigt ihn sofort und gleicht nur still ab.
    func load() async {
        if loadState == .loaded { await sync(live: false); return }
        guard loadState != .loading else { return }
        loadState = .loading
        do {
            messages = try await fetchHistory()
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
            return
        }
        attach()
    }

    // Läuft im Dienst gerade ein Turn dieses Chats, wird er von Anfang an wiedergegeben und läuft live weiter.
    func attach() {
        guard streamTask == nil else { return }
        run { client, session in
            try client.attachRequest(chatId: session.chatId)
        }
    }

    // Ein anderer Auslöser (Automation, Übergabe) hat in diesem Chat etwas getan: gespeicherten Verlauf nachladen und einen laufenden
    // Turn live mitlesen (`live`; ein beendeter Turn wird nicht noch einmal wiedergegeben). Läuft hier selbst ein Turn, bleibt alles beim Strom.
    func sync(live: Bool = true) async {
        guard loadState == .loaded, streamTask == nil, !retrying else { return }
        if let stored = try? await fetchHistory(), streamTask == nil, !retrying { messages = stored }
        if live && !retrying { attach() }
    }

    // Sendet Text, die Anhänge und den gewählten Skill des Composers. Ohne Text und ohne Anhang passiert nichts.
    func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = composer.attachments.map { FilePart(mediaType: $0.mediaType, url: $0.dataURL, filename: $0.filename) }
        guard !text.isEmpty || !files.isEmpty, !isRunning, !retrying, composer.canSend else { return }
        // Web prüft die 2-MB-Grenze erst beim Senden; Eingabe und Anhänge bleiben erhalten.
        if let big = AttachmentRules.oversize(composer.attachments) {
            composer.showAttachError(AttachmentRules.Failure.tooBigToSend(name: big.filename).text)
            return
        }
        let skill = composer.skill.map { SkillRef(name: $0.name, source: $0.source) }
        // Gewählte @Name werden zu Verweisen auf die Orbi-Id; der Dienst löst getippte Klartext-@Name beim Speichern selbst auf.
        var message = ChatMessage.user(Mentions.encode(text, picked: pickedMentions), files: files, skill: skill)
        let target = replyTarget
        if let target {
            message.metadata?.replyTo = target.id
            message.metadata?.replyQuote = ReplyQuote(role: target.role.rawValue, text: String(target.text.prefix(600)))
        }
        let restore = draft
        messages.append(message)
        onActivity?()
        lastSent = message
        draft = ""
        replyTarget = nil
        pickedMentions = []
        notice = nil
        stopRequested = false
        // Eine normale Nachricht beendet das Onboarding (der Dienst zählt sie als Überspringen).
        onboardingBotId = nil
        composer.consume()
        start(message: message, regenerate: false, restore: restore)
    }

    // Fehlerkarte: war die Frage schon gespeichert, wird die Antwort neu erzeugt, sonst die Frage noch einmal gesendet.
    func retry() {
        guard !isRunning, !retrying, let sent = lastSent ?? messages.last(where: { $0.role == .user && !$0.isLine }) else { return }
        retrying = true
        Task {
            defer { retrying = false }
            let stored: [ChatMessage]
            do { stored = try await fetchHistory() }
            catch { self.error = error.localizedDescription; return }
            guard !isRunning else { return }
            // Zeilen „gesendet an/von“ zählen nicht: Es geht um die letzte echte Nachricht.
            if stored.contains(where: { $0.id == sent.id }), let last = stored.last(where: { $0.role == .user && !$0.isLine }) {
                messages = stored
                start(message: last, regenerate: true)
            } else {
                messages = stored
                messages.append(sent)
                start(message: sent, regenerate: false)
            }
        }
    }

    func retryAutomation(id: String) {
        guard !isRunning, automationRetries.begin(id) else { return }
        Task {
            defer { automationRetries.end(id) }
            do { _ = try await client.runAutomation(id: id); await sync() }
            catch { self.error = error.localizedDescription }
        }
    }

    // „Verlauf leeren“: der Dienst hat alles gelöscht. Die Sitzung bleibt (die offene Ansicht hängt an ihr und lädt nicht neu), nur leer.
    func cleared() {
        detach()
        messages = []
        reactions = ReactionBoard()
        hasOlder = false
        interrupted = nil
        replyTarget = nil
        error = nil
        stopRequested = false
    }

    func clearError() { error = nil }
    func clearNotice() { notice = nil }

    // Nur Selbsttest und Screenshot-Szenen: zeigt den Fehlertext eines Modell-Limits.
    func simulate(error text: String) { error = text }

    func simulate(messages: [ChatMessage], running: Bool = false) {
        self.messages = messages
        loadState = .loaded
        isRunning = running
    }

    // Stopp bricht den Turn und, im Root- oder Gruppenchat, alle Orbis des Auftrags ab (Dienst: `POST /v1/chats/:id/stop`).
    // Nach dem Stopp: endet der Strom nicht binnen `stopGrace`, hört die App auf mitzulesen und lädt den Verlauf (Anzeige hängt nie auf „läuft“).
    // Erreicht der Stopp den Dienst nicht, steht das als Fehler im Chat statt still verschluckt.
    func stop() {
        stopRequested = true
        let running = streamTask
        Task {
            do { try await client.stop(chatId: chatId) }
            catch {
                self.error = "Stoppen hat nicht geklappt: \(error.localizedDescription)"
                return
            }
            try? await Task.sleep(for: stopGrace)
            guard let running, streamTask == running else { return }
            running.cancel()
            streamTask = nil
            isRunning = false
            if let stored = try? await fetchHistory() { messages = stored }
        }
    }
    var stopGrace: Duration = .seconds(5)

    // Beendet nur das Mitlesen (App schließt); der Turn läuft im Dienst weiter.
    // freeze: für Screenshots, die Anzeige bleibt im Zustand "läuft" stehen.
    func detach(freeze: Bool = false) {
        streamTask?.cancel()
        streamTask = nil
        isRunning = freeze
    }

    // Stoppt den Turn im Dienst und wartet, bis er beendet ist (Aufräumen nach Tests).
    func stopRemote() async throws {
        try await client.stop(chatId: chatId)
    }

    // Wartet bis der laufende Turn zu Ende gelesen ist.
    func waitUntilIdle() async {
        await streamTask?.value
    }

    private func start(message: ChatMessage, regenerate: Bool, restore: String? = nil) {
        if regenerate, let index = messages.lastIndex(where: { !$0.isLine }), messages[index].role == .assistant { messages.remove(at: index) }
        run { client, session in
            try client.turnRequest(
                chatId: session.chatId, message: message, model: session.composer.effectiveModelId, effort: session.composer.effort,
                botId: session.botId,
                context: session.composer.context, skill: message.metadata?.skill, modelPinned: session.composer.pinnedForSend, regenerate: regenerate)
        } onBusy: { session in
            // Gruppenrunde oder anderer Turn belegt den Chat (409): Nachricht und Eingabe zurückgeben, ruhiger Hinweis statt Fehler.
            guard let restore else { return false }
            session.messages.removeAll { $0.id == message.id }
            session.draft = restore
            // Zitat zurück, wie es gewählt war (eine einzelne Blase, nicht die ganze Antwort).
            if let replyId = message.metadata?.replyTo, let quote = message.metadata?.replyQuote {
                session.replyTarget = ChatMessage(id: replyId, role: ChatRole(rawValue: quote.role) ?? .assistant, parts: [.text(quote.text)])
            }
            session.notice = session.members.isEmpty ? "Der Chat ist gerade belegt. Versuche es gleich noch einmal." : "Die Gruppe antwortet noch. Versuche es danach noch einmal."
            return true
        }
    }

    // `onBusy` antwortet auf 409: true = behandelt (kein Anhängen an den laufenden Turn).
    private func run(_ makeRequest: @escaping @MainActor (ServiceClient, ChatSession) async throws -> URLRequest,
                     onBusy: (@MainActor (ChatSession) -> Bool)? = nil) {
        guard streamTask == nil else { return }
        isRunning = true
        error = nil
        deltaCount = 0
        streamTask = Task { [client] in
            let feed = ChunkFeed()
            do {
                let request = try await makeRequest(client, self)
                // Höchstens ein Verlaufs-Update je Bild (~30 je Sekunde), egal wie schnell die Chunks kommen.
                let pump = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: Self.frame)
                        self.publish(feed)
                    }
                }
                defer { pump.cancel() }
                let status = try await client.stream(request, into: feed)
                publish(feed)
                if status == 204, feed.count == 0 { isRunning = false; streamTask = nil; return }
                if let text = feed.result.errorText { error = text }
            } catch is CancellationError {
            } catch let failure as ServiceError where failure.isBusy {
                // Ein anderer Turn läuft schon: statt Fehler an ihn anhängen.
                streamTask = nil
                isRunning = false
                if onBusy?(self) == true { return }
                attach()
                return
            } catch {
                self.error = error.localizedDescription
            }
            publish(feed)
            isRunning = false
            streamTask = nil
            // Das Onboarding läuft über mehrere Turns (Antwort auf eine Auswahlkarte setzt fort): es endet durch das Ereignis `onboarding`, eine eigene Nachricht oder Überspringen.
            let assembler = feed.result
            if !Task.isCancelled, let stored = try? await fetchHistory() {
                messages = stored
                // Der Verlauf kennt die Markierung nicht; sie bleibt an der gestoppten Antwort.
                if assembler.aborted, let id = assembler.message?.id, let index = messages.firstIndex(where: { $0.id == id }) {
                    messages[index].stopped = true
                }
            }
        }
    }

    static let frame: Duration = .milliseconds(33)

    private func publish(_ feed: ChunkFeed) {
        let (changed, count) = feed.take()
        if deltaCount != count { deltaCount = count }
        for message in changed { messages.upsert(message) }
    }
}

extension ServiceError {
    var isBusy: Bool { if case .busy = self { true } else { false } }
}
