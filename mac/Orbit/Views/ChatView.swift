import SwiftUI

struct ChatView<Avatar: View>: View {
    private func headerAvatar(_ size: CGFloat) -> Avatar { avatar(size) }

    let title: String
    let subtitle: String
    // Zustand der Figur(en) dieses Chats: steht als Text im Kopf, der Ring um die Figur kommt dazu.
    let state: OrbiState
    // Eingabe gesperrt, solange ein Turn läuft (eigener oder von einem anderen Auslöser im selben Chat).
    let locked: Bool
    let session: ChatSession
    // Figur im Kopf in der gegebenen Größe (wächst und schrumpft mit dem Scrollen).
    @ViewBuilder let avatar: (CGFloat) -> Avatar
    // Kopf-Pille: klappt das rechte Panel auf und zu.
    let onPill: () -> Void
    // Teilnehmer des Gruppenchats (leer im Direktchat) und alle Orbi-Namen für den „[Name]:“-Präfix.
    let members: [Bot]
    let senderNames: [String]
    // Zustand eines Orbis (für die Figur an der letzten Antwort).
    let orbiState: (Bot) -> OrbiState
    // Antwortender Orbi je Nachricht (Direktchat: immer derselbe).
    let orbi: (ChatMessage) -> Bot?
    // Alle Orbis (Karten von Übergaben zeigen das Ziel mit seiner Figur).
    var allBots: [Bot] = []
    // Farbe der eigenen Blasen: Farbe des Orbis, bei Gruppen die Grundfarbe (Web: userColor).
    var userHex: String?
    // Orbi des Direktchats (Gruppe: der gewählte Teilnehmer): trägt die Figur der Schreibblase.
    var direct: Bot?
    // Phase 3: laufender Schritt aus den Ereignissen (Label für die Live-Zeile).
    var liveStep: StepBoard.Step?
    // Lauf D: kurze Systemzeile des Dienstes (Wiederholung, Handlungsbedarf).
    var notice: SystemNotice?
    // Hintergrund-Helfer dieses Chats (laufen weiter, auch wenn der Turn fertig ist) und ihr Stopp.
    var helpers: [TaskBoard.Helper] = []
    var onStopHelper: (String) -> Void = { _ in }
    @State private var atBottom = true
    // Folgt dem Ende des Verlaufs, solange der Nutzer nicht selbst weggescrollt hat (neue Karten und Text wachsen nach dem Layout).
    @State private var stick = true
    @State private var dropTargeted = false
    // Breitenänderung (Fenster, Panel) bricht Text neu um und verschiebt den Scroll: kurz nicht als Hochscrollen werten.
    @State private var maxScroll: CGFloat = 0
    @State private var frozenUntil = Date.distantPast
    @State private var settleUntil = Date.distantPast
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var tailAnchor: String?
    @State private var interacting = false
    @State private var animateArrivals = false
    // Neue Antwort kam, während der Nutzer weggescrollt war: Punkt am „Nach unten“-Knopf (Figma 26:11835).
    @State private var newBelow = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(CardCenter.self) private var center: CardCenter?
    @Environment(\.staticRendering) private var staticRendering

    private var rootCards: [PendingInteraction] { center?.interactions.rootCards(forChat: session.chatId) ?? [] }
    // Gestoppt: eigener Stopp oder gestoppte Gruppenrunde.
    private var showsStopped: Bool { !session.isRunning && (session.stopRequested || center?.interactions.wasRoundStopped(chatId: session.chatId) == true) }

    private var limitText: String? {
        guard state == .limit else { return nil }
        let composer = session.composer
        return LimitStore.shared.waitsText(modelProvider: composer.selectedModel?.provider, modelId: composer.modelId)
    }

    var body: some View {
        // Pille oben als Overlay über dem Verlauf (durchsichtig); die Eingabe bleibt unten.
        ZStack(alignment: .top) {
            // Der Verlauf läuft hinter der Eingabe durch (wie Grok Bot): kein fester Streifen, nur das Feld selbst ist deckend.
            content.frame(maxHeight: .infinity)
            bottomBar.frame(maxHeight: .infinity, alignment: .bottom)
            ChatHeaderView(title: title, state: state, limitText: limitText, avatar: { size in headerAvatar(size) }, onPill: onPill)
                .padding(.top, Theme.Layout.chatTop)
        }
        // Fragebogen gleitet ein und aus (Web: slide-in-from-bottom-3), der Verlauf darüber springt nicht.
        .animation(reduceMotion ? nil : Theme.Motion.enter.animation, value: openAsk?.toolCallId)
        .animation(reduceMotion ? nil : Theme.Motion.enter.animation, value: rootCards.map(\.id))
        .animation(reduceMotion ? nil : Theme.Motion.enter.animation, value: helpers.map(\.id))
        .background(Theme.Palette.background)
        .task(id: state == .limit) { if state == .limit && !staticRendering { await LimitStore.shared.refresh() } }
        // Dateien lassen sich überall im Chat ablegen (Web: globalDrop); der Rahmen zeigt das Ziel.
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { session.composer.addDropped($0) }
        // Figma Drop-Rahmen (26:13787): Rand 1, r10, Einzug 6.
        .overlay { if dropTargeted { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.ring, lineWidth: Theme.Metrics.pt1).padding(Theme.Metrics.pt6).allowsHitTesting(false) } }
        .task(id: session.chatId) {
            animateArrivals = false
            if !staticRendering { await session.load() }
            await Task.yield()
            if !Task.isCancelled { animateArrivals = true }
        }
        .onChange(of: members.map(\.id), initial: true) { _, _ in
            session.members = members.map { GroupText.Member(id: $0.id, name: $0.name) }
            // Antwortender Orbi: gewählt oder, wenn nichts (mehr) gilt, der erste (Hauptorbi zuerst, wie im Dienst).
            if !members.isEmpty, !members.contains(where: { $0.id == session.botId }) { session.botId = members[0].id }
        }
    }

    // Alles unter dem Verlauf: Karten anderer Orbis, Kennenlern-Hinweis, Live-Zeile und Eingabe. Durchsichtig, der Verlauf scrollt dahinter.
    private var bottomBar: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            VStack(spacing: Theme.Metrics.pt0) {
            // Fragen und Freigaben anderer Orbis dieses Auftrags: stehen hier, nicht im Chat des Fragenden.
            if !rootCards.isEmpty {
                ScrollView { RootCardsView(cards: rootCards, isGroup: !members.isEmpty).padding(.top, Theme.Spacing.sm) }
                    .fixedSize(horizontal: false, vertical: true).frame(maxHeight: Theme.Metrics.pt360)
                    .inColumn()
                    .transition(.opacity)
            }
            if session.onboardingBotId != nil {
                HStack(spacing: Theme.Spacing.sm) {
                    Text(onboardingHint).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                    Button("Überspringen") { session.skipOnboarding() }
                        .buttonStyle(.plain).font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.foreground)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, Theme.Spacing.xs)
                .inColumn()
                .probe("onboarding-skip")
            }
            if !helpers.isEmpty {
                VStack(spacing: Theme.Metrics.pt4) {
                    ForEach(helpers) { helper in
                        HelperStatusRow(helper: helper, bot: allBots.first { $0.id == helper.botId }) { onStopHelper(helper.id) }
                    }
                }
                .padding(.leading, Theme.Metrics.pt12).padding(.bottom, Theme.Metrics.pt8)
                .inColumn().transition(.opacity)
            }
            // Live-Zeile fest über der Eingabe (Figma 143:51801, 148:90635): links 12 eingerückt, Abstand 8 zur Eingabe.
            // Der Orb erscheint in jedem Chat, in dem der Orbi arbeitet (auch Automation oder Übergabe), nicht nur beim eigenen Senden.
            if session.isRunning || state == .working {
                LiveStatusBar(label: workStatus, bot: statusBot, waiting: waitingForUser)
                    .padding(.leading, Theme.Metrics.pt12).padding(.bottom, Theme.Metrics.pt8)
                    .inColumn().transition(.opacity)
            }
            }
            .barFade()
            // Eingabe gesperrt, solange ein Turn läuft: der eigene oder einer, den ein anderer Auslöser im Chat gestartet hat.
            ComposerView(session: session, members: members, directName: direct?.name, locked: locked).inColumn()
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
    }

    @ViewBuilder private var content: some View {
        switch session.loadState {
        case .idle, .loading:
            StatusMessage(title: "Lädt …", detail: nil, retry: nil).padding(.top, headerInset)
        case .failed(let message):
            StatusMessage(title: "Verlauf konnte nicht geladen werden", detail: message) {
                Task { await session.load() }
            }.padding(.top, headerInset)
        case .loaded:
            conversation
        }
    }

    private var headerInset: CGFloat { Theme.Layout.chatTop + Theme.Layout.header + Theme.Layout.headerGap }

    @State private var viewportHeight: CGFloat = 0
    @State private var barHeight: CGFloat = 0

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Figma: 2 zwischen Zeilen, 10 beim Absenderwechsel (sonstige Zeilen wie Live-Zeile und Hinweise ebenfalls 10).
                // Lazy: nur sichtbare Zeilen werden gebaut und beim Streamen neu geprüft, auch in langen Chats.
                LazyVStack(alignment: .leading, spacing: Theme.Layout.rowGap) {
                    if session.hasOlder {
                        // Oben angekommen: die nächste ältere Seite laden (der Dienst liefert den Verlauf seitenweise).
                        Color.clear.frame(height: Theme.Metrics.pt1).onAppear { loadOlder(proxy) }
                    }
                    if session.messages.isEmpty && !session.isRunning {
                        // Figma Onboarding 6 (171:129728): oben 28, 14 Medium und 14 Regular mit Zeilenhöhe 20.
                        VStack(spacing: Theme.Spacing.xs) {
                            Text("Noch keine Nachrichten").font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.foreground)
                            Text("Stell eine Frage, um zu starten.").font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
                        }
                        .frame(maxWidth: .infinity).padding(.top, Theme.Metrics.pt28)
                    }
                    let lastAnswer = session.lastAssistant?.id
                    let runs = RowRuns(session.messages) { orbi($0)?.id }
                    let repeats = OrbiLine.repeatedIds(in: session.messages)
                    let tailStart = tailAnchor.flatMap { id in session.messages.firstIndex { $0.id == id } } ?? max(0, session.messages.count - Self.measuredTail)
                    ForEach(session.messages[..<tailStart]) { message in if !repeats.contains(message.id) { row(message, lastAnswer: lastAnswer, runs: runs) } }
                    // Das Ende als ein fest gemessener Block: unten gibt es keine geschätzten Höhen, Sprünge nach unten landen genau.
                    VStack(alignment: .leading, spacing: Theme.Layout.rowGap) {
                        ForEach(session.messages[tailStart...]) { message in if !repeats.contains(message.id) { row(message, lastAnswer: lastAnswer, runs: runs) } }
                        if let notice { SystemNoticeView(notice: notice).transition(.opacity) }
                        if session.interrupted != nil, !session.isRunning, state != .working {
                            InterruptedHintView(busy: session.resuming,
                                                resume: { Task { await session.resumeInterrupted() } },
                                                dismiss: { Task { await session.dismissInterrupted() } })
                                .transition(.opacity)
                        }
                        if showsStopped {
                            Text("gestoppt").font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground).padding(.leading, Theme.Spacing.xxl)
                        }
                        if let error = session.error {
                            // Figma 143:52194 (K18): Fehlerzeile ohne Orbi-Figur.
                            ErrorCard(message: error, retrying: session.retrying, retry: { session.retry() }, dismiss: { session.clearError() })
                        }
                        Color.clear.frame(height: Theme.Metrics.pt1).id("bottom")
                    }
                }
                .inColumn()
                .padding(.top, headerInset)
                // Platz für die durchsichtige Eingabe: das Ende steht über ihr, Älteres scrollt dahinter durch.
                .padding(.bottom, barHeight)
                .probe("chat-column")
                // Kurzer Verlauf: die neueste Nachricht sitzt unten am Eingabefeld, nicht oben im leeren Fenster.
                .frame(maxWidth: .infinity, minHeight: viewportHeight, alignment: .bottom)
                // Web: neue Zeilen blenden 300 ms ease-out ein und gleiten 8 pt von unten.
                .animation(reduceMotion || !animateArrivals ? nil : Theme.Motion.enter.animation, value: session.messages.last?.id)
                .animation(reduceMotion ? nil : Theme.Motion.enter.animation, value: showsTyping)
                .animation(reduceMotion ? nil : Theme.Motion.enter.animation, value: openAsk?.toolCallId)
            }
            // Ans echte Ende statt zu einer Kennung: in der Lazy-Liste sind Höhen über dem sichtbaren Teil nur geschätzt.
            .scrollPosition($position)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .onScrollGeometryChange(for: CGFloat.self) { max(0, $0.contentOffset.y) } action: { old, offset in
                guard Date() >= frozenUntil else { return }
                // Nach oben bewegt (Rad, Trackpad, Scrollbalken): nicht mehr mitlaufen. Nach unten bis ans Ende: wieder mitlaufen.
                if offset < old - 1, maxScroll - offset > Theme.Metrics.pt48 { stick = false }
                if offset > old, atBottom { stick = true }
            }
            .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height - $0.containerSize.height } action: { _, value in maxScroll = value }
            .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.height } action: { _, value in viewportHeight = value }
            // Die Eingabe unten wird höher (mehrzeilig, Anhänge, Hinweise): wer unten stand, bleibt unten.
            .onChange(of: barHeight) { old, value in
                if value > old, stick, !interacting, session.jumpTarget == nil { position.scrollTo(edge: .bottom) }
            }
            .onScrollPhaseChange { _, phase in interacting = phase == .interacting }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { _ in frozenUntil = Date().addingTimeInterval(Theme.Motion.geometryFreeze) }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - Theme.Metrics.pt48
            } action: { _, nearBottom in
                atBottom = nearBottom
                if nearBottom { stick = true; newBelow = false }
            }
            .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { old, new in
                guard new > old || Date() < settleUntil, stick, !interacting, session.jumpTarget == nil else { return }
                position.scrollTo(edge: .bottom)
            }
            // Folgt der Antwort nur, wenn der Nutzer unten steht; wer hochgescrollt hat, wird nicht zurückgeholt.
            // Nur eine neue letzte Nachricht zählt (nicht jedes Textstück): wachsender Text folgt über die Inhaltshöhe oben.
            .onChange(of: session.messages.last?.id) {
                guard let last = session.messages.last else { return }
                // Eigene neue Nachricht: immer zum neuesten Punkt, auch wenn hochgescrollt war.
                if last.role == .assistant, !atBottom { newBelow = true }
                if last.role == .user { scrollDown(proxy, force: true) } else { scrollDown(proxy) }
            }
            .overlay(alignment: .bottom) {
                if !atBottom {
                    Button { scrollDown(proxy, force: true, animated: true) } label: {
                        Image(systemName: "arrow.down").font(.system(size: Theme.Fonts.size14, weight: .medium)).foregroundStyle(Theme.Palette.foreground)
                    }
                    .buttonStyle(ScrollBottomStyle())
                    .overlay(alignment: .topTrailing) {
                        // Figma 26:11835: Punkt 8 Orbi-Farbe, Rand background 1,5, oben rechts.
                        if newBelow {
                            Circle().fill(Theme.Palette.primary).frame(width: Theme.Metrics.pt8, height: Theme.Metrics.pt8)
                                .overlay(Circle().strokeBorder(Theme.Palette.background, lineWidth: Theme.Metrics.pt1_5))
                                .allowsHitTesting(false)
                        }
                    }
                    .padding(.bottom, barHeight + Theme.Spacing.sm).transition(.opacity).probe("scroll-bottom")
                    .accessibilityLabel("Nach ganz unten")
                }
            }
            .animation(reduceMotion ? nil : Theme.Motion.hover.animation, value: atBottom)
            .onChange(of: session.isRunning) { scrollDown(proxy) }
            .onAppear { pinBottom(proxy) }
            .onChange(of: session.jumpTarget, initial: true) { _, _ in jump(proxy) }
            .onChange(of: session.loadState) { if session.loadState == .loaded { pinBottom(proxy) }; jump(proxy) }
        }
    }

    // Ältere Nachrichten bleiben lazy, ab dem Öffnen die letzten `measuredTail` und alles Neue stehen im gemessenen Endblock.
    // Der Anfang hängt an einer Nachricht (`tailAnchor`), damit Neues keine Zeile zwischen Block und Lazy-Teil verschiebt (kein Flackern).
    private static var measuredTail: Int { 10 }

    @ViewBuilder private func row(_ message: ChatMessage, lastAnswer: String?, runs: RowRuns) -> some View {
        let bot = orbi(message)
        let isLast = message.id == lastAnswer
        // Nur die letzte Antwort trägt die lebende Figur mit Zustand, ältere sind still.
        MessageRow(
            message: message, orbi: bot, senderNames: senderNames, state: isLast ? (bot.map(orbiState) ?? .calm) : .calm, live: isLast,
            chatId: session.chatId, running: isLast && (session.isRunning || state == .working), bots: allBots, userHex: userHex,
            reactions: session.reactions, onReact: message.isLine ? nil : { emoji, key in session.react(emoji, to: key) },
            onRetryAutomation: { session.retryAutomation(id: $0) },
            retryingAutomation: message.metadata?.automation.map { session.automationRetries.ids.contains($0.automationId) } ?? false,
            onReply: { text, replyTo in session.replyTarget = ChatMessage(id: replyTo, role: message.role, parts: [.text(text)]) },
            joinsPrevious: runs.joins.contains(message.id), endsRun: !runs.continued.contains(message.id))
            .equatable()
            .padding(.top, runs.senderChanges.contains(message.id) ? Theme.Layout.senderGap - Theme.Layout.rowGap : Theme.Metrics.pt0)
            .background {
                // Suchtreffer: Fläche in der Ringfarbe, blendet nach gut 2 s wieder aus.
                RoundedRectangle(cornerRadius: Theme.Radius.xl).fill(Theme.Palette.ring.opacity(0.14)).padding(-Theme.Spacing.sm)
                    .opacity(session.highlighted == message.id ? 1 : 0)
                    .animation(reduceMotion ? nil : .easeOut(duration: Theme.Motion.highlight), value: session.highlighted)
            }
            .transition(enter)
    }

    private func timestamp(_ message: ChatMessage) -> Date? {
        (message.metadata?.startedAt ?? message.metadata?.createdAt).map { Date(timeIntervalSince1970: $0 / 1000) }
    }

    // Chat öffnen: die Ansicht beginnt schon unten (`defaultScrollAnchor`); ein einziger Sprung nach dem ersten Layout sichert das ab.
    // Später wachsende Zeilen zieht das Mitlaufen über die Inhaltshöhe nach (nicht bei Suchtreffern, nicht nach Hochscrollen).
    private func pinBottom(_ proxy: ScrollViewProxy) {
        let messages = session.messages
        if !messages.isEmpty { tailAnchor = messages[max(0, messages.count - Self.measuredTail)].id }
        guard session.jumpTarget == nil else { return }
        settleUntil = Date().addingTimeInterval(Theme.Motion.pinSettle)
        frozenUntil = max(frozenUntil, settleUntil)
        stick = true
        scrollDown(proxy, force: true)
    }

    // Suchtreffer: nach dem ersten Layout (und dem Scroll nach unten) zur Nachricht springen. Fehlt sie, bleibt der Chat unten.
    private func jump(_ proxy: ScrollViewProxy) {
        guard let target = session.jumpTarget, session.loadState == .loaded else { return }
        session.clearJump()
        Task {
            try? await Task.sleep(for: .seconds(Theme.Motion.jumpDelay))
            // Liegt der Treffer vor der geladenen Seite, erst ältere Seiten nachladen.
            guard await session.reveal(target) else { return }
            await Task.yield()
            withAnimation(reduceMotion ? nil : Theme.Motion.headerSnap.animation) { proxy.scrollTo(target, anchor: .center) }
            session.highlight(target)
        }
    }

    // Ältere Seite voranstellen; wer oben liest, behält die bisher oberste Nachricht an ihrem Platz (unten Stehende bleiben unten).
    private func loadOlder(_ proxy: ScrollViewProxy) {
        guard let anchor = session.messages.first?.id else { return }
        Task {
            guard await session.loadOlder(), !stick else { return }
            frozenUntil = Date().addingTimeInterval(Theme.Motion.geometryFreeze)
            await Task.yield()
            proxy.scrollTo(anchor, anchor: .top)
        }
    }

    // Erst nach dem Layout scrollen, sonst fehlt die neue Höhe.
    private func scrollDown(_ proxy: ScrollViewProxy, force: Bool = false, animated: Bool = false) {
        guard stick || force else { return }
        Task {
            await Task.yield()
            if animated && !reduceMotion { withAnimation(Theme.Motion.headerSnap.animation) { position.scrollTo(edge: .bottom) } }
            else { position.scrollTo(edge: .bottom) }
        }
    }

    // Offene Rückfrage der letzten Antwort: die Karte steht als Nachricht im Verlauf (ToolCardView).
    private var openAsk: ToolPart? {
        guard let last = session.messages.last, last.role == .assistant else { return nil }
        for part in last.parts.reversed() {
            guard case .tool(let tool) = part, tool.name == ToolName.ask, tool.state == .inputAvailable else { continue }
            // Offen nur, solange der Turn wartet: läuft er oder kennt der Dienst die Rückfrage noch.
            return session.isRunning || center?.interactions.question(toolCallId: tool.toolCallId) != nil ? tool : nil
        }
        return nil
    }

    private var showsTyping: Bool { session.isRunning || state == .working }

    // Genau eine Zeile: Label des laufenden Schritts aus dem Dienst; zwischen zwei Schritten, was gerade passiert.
    private var workStatus: String {
        if waitingForUser { return "Wartet auf deine Antwort" }
        if let label = liveStep?.label { return label }
        let last = session.messages.last { !$0.isLine }
        return LiveLabel.fallback(lastPart: last?.role == .assistant ? last?.parts.last : nil)
    }

    // Der Orbi wartet auf Consti: offene Rückfrage oder offene Freigabe in der letzten Antwort.
    private var waitingForUser: Bool {
        guard let last = session.messages.last(where: { !$0.isLine }), last.role == .assistant else { return false }
        return last.tools.contains { $0.state == .approvalRequested || ($0.name == ToolName.ask && $0.state == .inputAvailable) }
    }

    // Figur der Live-Zeile: der Orbi des Schritts, sonst der antwortende des Chats.
    private var statusBot: Bot? {
        allBots.first { $0.id == liveStep?.botId } ?? members.first { $0.id == session.botId } ?? members.first ?? direct
    }

    // Hauptorbi: führt durchs Kennenlernen (Fragen, Vorschläge für Orbis); jeder andere Orbi stellt sich nur vor.
    private var onboardingHint: String {
        (direct?.isMain ?? false) ? "Dein Hauptorbi lernt dich kennen." : "Dein neuer Orbi stellt sich vor."
    }

    private var enter: AnyTransition { .opacity.combined(with: .offset(y: Theme.Motion.enterOffset)) }

}

extension View {
    // Zeilen über der durchsichtigen Eingabe (Live-Zeile, Hinweise, Karten): weicher Verlauf aus der Fensterfarbe dahinter,
    // reicht bis hinter das Feld, damit Text über durchlaufenden Blasen lesbar bleibt. Ohne solche Zeilen bleibt alles durchsichtig.
    func barFade() -> some View {
        background {
            LinearGradient(colors: [Theme.Palette.background.opacity(0), Theme.Palette.background], startPoint: .top, endPoint: .center)
                .padding(.top, -Theme.Spacing.lg).padding(.bottom, -Theme.Metrics.pt12)
                .allowsHitTesting(false)
        }
    }
}

// Eine Spalte für Kopf, Verlauf und Eingabe: höchstens `Theme.Layout.column` breit, mittig, schmaler Rand im kleinen Fenster.
extension View {
    func inColumn() -> some View {
        frame(maxWidth: Theme.Layout.column).padding(.horizontal, Theme.Layout.columnGutter).frame(maxWidth: .infinity)
    }
}

// „Nach ganz unten“ (Figma 26:11824): Kreis 28, Fläche popover, Rand border 0,5, Hover secondaryHover, Pfeil 14.
private struct ScrollBottomStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Label(configuration: configuration) }
    private struct Label: View {
        let configuration: ButtonStyleConfiguration
        @State private var hover = false
        var body: some View {
            configuration.label
                .frame(width: Theme.Metrics.pt28, height: Theme.Metrics.pt28)
                .background(hover ? Theme.Palette.secondaryHover : Theme.Palette.popover, in: .circle)
                .overlay(Circle().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
                .contentShape(.circle)
                .onHover { hover = $0 }
                .animation(Theme.Motion.hover.animation, value: hover)
        }
    }
}
