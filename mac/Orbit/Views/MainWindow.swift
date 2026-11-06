import SwiftUI

struct MainWindow: View {
    @Namespace private var firstOrbiNamespace
    @Environment(\.staticRendering) private var staticRendering
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        // Eigene Zweispalten-Anordnung statt NavigationSplitView: Seitenleiste und Detail folgen den Theme-Farben
        // und lassen sich unsichtbar rendern (Screenshot-Modus).
        let modal = model.sheet != nil || model.botStore.pendingDelete != nil || model.overlay.viewer != nil || model.newSkillName != nil
            || model.automations.form != nil || model.automations.deleting != nil || model.search.paletteOpen || model.desktopFullscreen != nil
        // Erster Start ohne Orbi: Onboarding füllt das Fenster, die Seitenleiste gibt es erst danach.
        let onboarding = model.showsOnboarding
        HStack(spacing: Theme.Metrics.pt0) {
            // Seitenleiste über die ganze Höhe, auch hinter den Ampelknöpfen. Web: Breite 303 ↔ Schiene (+ Linie), 300 ms cubic-bezier(.32,.72,0,1).
            if !onboarding {
            SidebarView(model: model)
                .frame(width: model.sidebarCollapsed ? TopBarMetrics.railWidth : model.sidebarWidth)
                // S35/B8: eckig, Linie 0,5 rechts (Seitenleiste: border, Schiene: sidebar-border).
                .overlay(alignment: .trailing) { Rectangle().fill(model.sidebarCollapsed ? Theme.Palette.sidebarBorder : Theme.Palette.border).frame(width: Theme.Metrics.pt0_5) }
                .probe("sidebar")
                .overlay(alignment: .trailing) { if !model.sidebarCollapsed { SidebarResizeHandle(model: model) } }
            }
            DetailView(model: model)
                .clipped()
        }
        .background(Theme.Palette.background)
        .overlay {
            if onboarding {
                if model.setupIntroDone { OnboardingView(model: model) } else { SetupIntroView(model: model) }
            }
        }
        .environment(\.onboardingNamespace, firstOrbiNamespace)
        .animation(reduceMotion ? nil : Theme.Motion.sidebar.animation, value: model.sidebarCollapsed)
        // Web: backdrop-blur-xs (4 px) hinter offenen Dialogen.
        .blur(radius: modal ? Theme.Spacing.xs : Theme.Metrics.pt0)
        .animation(Theme.Motion.pop.animation, value: modal)
        .overlay { dialogs }
        .overlay { if model.search.hasQuery, !model.search.dismissed, !model.search.paletteOpen, !model.sidebarCollapsed { SearchPopover(model: model) } }
        // ⌘K öffnet und schließt die Palette (Web: Tastenkürzel auf Fensterebene).
        .background {
            Button("Suche öffnen") { model.search.paletteOpen.toggle(); if !model.search.paletteOpen { model.search.reset() } }
                .keyboardShortcut("k", modifiers: .command).opacity(0).frame(width: Theme.Metrics.pt0, height: Theme.Metrics.pt0).accessibilityHidden(true)
        }
        .coordinateSpace(name: "orbit-window")
        .onChange(of: model.wantsSetupIntro) { _, wants in
            if wants { openSettings(); model.wantsSetupIntro = false }
        }
        .font(Theme.Fonts.body)
        .environment(\.orbiOpenBots, model.openBotIds)
        // Esc stoppt einen Lauf nur, wenn darüber nichts offen ist, das Esc schließen soll (Dialog, Bild, Menü, Suchergebnisse).
        .environment(\.escapeStopsTurn, !modal && model.overlay.menu == nil && !(model.search.hasQuery && !model.search.dismissed))
        // @-Markierungen: Orbis kennen, Klick öffnet den Direktchat (kein neuer Chat).
        .environment(\.mentionDirectory, MentionDirectory(bots: model.botStore.orbis) { id in model.selection = .bot(id) })
        .environment(\.openURL, OpenURLAction { url in
            guard let id = MentionRichText.orbiId(from: url) else { return .systemAction }
            model.selection = .bot(id)
            return .handled
        })
        // Akzent wie im Web (ChatAccent): Farbe des offenen Orbis, bei Gruppen und ohne Auswahl das Standard-Design.
        .onChange(of: model.selection, initial: true) { _, selection in
            if let chatId = model.openChatId { model.events.acknowledge(chatId: chatId) }   // „fertig“ ist gesehen
            // Auch der Chat eines Automationslaufs gehört einem Orbi und trägt dessen Farbe.
            let botId: String? = switch selection { case .bot(let id): id; case .run(_, let id): id; default: nil }
            if let botId, let bot = model.botStore.bot(id: botId) {
                AccentStore.shared.set(hex: bot.color ?? Theme.orbiBaseColors[bot.avatar.lowercased()])
            } else {
                AccentStore.shared.set(hex: nil)
            }
        }
        .environment(model.cards)
        .overlay { OverlayLayer(center: model.overlay) }
        .environment(\.overlay, model.overlay)
        .environment(\.screenAction, model.screenAction)
        .environment(\.openNewSkill, NewSkillAction { model.newSkillName = $0 })
        .frame(minWidth: Theme.Metrics.pt720, minHeight: Theme.Metrics.pt480)
        .onAppear { if !staticRendering { model.windowOpened() } }
        .ignoresSafeArea(.container, edges: .top)   // Inhalt reicht bis zur Fensterkante, keine Leiste über der Seitenleiste
    }

    // Dialoge (Anlegen, Bearbeiten, Gruppe) und Bestätigungen (Löschen, Verlauf leeren) über dem Fenster wie im Web.
    // Der Dienstfehler einer Bestätigung steht in ihr als Hinweis, nie still.
    private var dialogs: some View {
        ZStack {
            DialogLayer(visible: model.sheet != nil, onDismiss: { model.sheet = nil }) {
                if let sheet = model.sheet {
                    Group {
                        switch sheet {
                        case .newBot: BotSheet(model: model, bot: nil, tab: .profile)
                        case .editBot(let id, let tab):
                            if let bot = model.botStore.bot(id: id) { BotSheet(model: model, bot: bot, tab: tab) }
                        case .newGroup: GroupSheet(model: model, group: nil)
                        }
                    }
                    .id(sheet.id)
                }
            }
            DialogLayer(visible: model.newSkillName != nil, onDismiss: { model.newSkillName = nil }) {
                if let name = model.newSkillName { NewSkillDialog(store: model.settings, name: name, onClose: { model.newSkillName = nil }).id(name) }
            }
            // Nur der Schließen-Knopf schließt den Computer im Vollbild: Esc und Klicks daneben gehen nicht verloren (Web: disablePointerDismissal).
            DialogLayer(visible: model.desktopFullscreen != nil, onDismiss: {}) {
                if let id = model.desktopFullscreen, let bot = model.botStore.bot(id: id) { DesktopFullscreen(model: model, session: model.desktops.session(for: bot)).id(id) }
            }
            DialogLayer(visible: model.search.paletteOpen, onDismiss: { model.search.reset() }) {
                if model.search.paletteOpen { SearchPalette(model: model).frame(maxWidth: .infinity, maxHeight: .infinity) }
            }
            DialogLayer(visible: model.automations.form != nil, onDismiss: { model.automations.form = nil }) {
                if let editing = model.automations.form { AutomationSheet(model: model, editing: editing).id(editing?.id ?? "new") }
            }
            DialogLayer(visible: model.automations.deleting != nil, onDismiss: { model.automations.deleting = nil }) {
                if let item = model.automations.deleting {
                    AlertDialogView(title: "Endgültig löschen?", message: "„\(item.automation.name)“ und der Verlauf werden dauerhaft entfernt.", action: "Löschen",
                                    onCancel: { model.automations.deleting = nil }, onConfirm: { Task { await model.automations.deleteForever(item) } })
                }
            }
            DialogLayer(visible: model.botStore.pendingDelete != nil, onDismiss: cancelConfirm) {
                if let target = model.botStore.pendingDelete {
                    AlertDialogView(title: target.title, message: target.message, action: target.action, error: model.deleteError, busy: model.deleteBusy,
                                    onCancel: cancelConfirm, onConfirm: { Task { await model.confirmDelete(target) } })
                }
            }
        }
    }

    private func cancelConfirm() {
        guard !model.deleteBusy else { return }
        model.botStore.cancelDelete()
        model.deleteError = nil
    }
}

private struct AutomationSheet: View {
    let model: AppModel
    @State private var form: AutomationFormModel

    init(model: AppModel, editing: AutomationItem?) {
        self.model = model
        _form = State(initialValue: AutomationFormModel(editing: editing, firstBotId: (model.botStore.orbis.first { $0.isMain } ?? model.botStore.orbis.first)?.id ?? ""))
    }

    var body: some View { AutomationFormView(model: model, form: form, onClose: { model.automations.form = nil }) }
}

private struct BotSheet: View {
    let model: AppModel
    let bot: Bot?
    @State private var editor: BotEditorModel

    init(model: AppModel, bot: Bot?, tab: BotEditorModel.Tab) {
        self.model = model
        self.bot = bot
        _editor = State(initialValue: BotEditorModel(editing: bot, others: model.botStore.orbis, tab: tab))
    }

    var body: some View {
        BotEditorView(
            editor: editor, onSave: { Task { await model.save(editor) } }, onCancel: { model.sheet = nil },
            onDelete: bot.map { bot in { model.sheet = nil; model.botStore.requestDelete(.bot(bot)) } })
    }
}

private struct GroupSheet: View {
    let model: AppModel
    let group: OrbiGroup?
    @State private var editor: GroupEditorModel

    init(model: AppModel, group: OrbiGroup?) {
        self.model = model
        self.group = group
        _editor = State(initialValue: GroupEditorModel(editing: group))
    }

    var body: some View {
        GroupEditorView(
            editor: editor, orbis: model.botStore.orbis, onSave: { Task { await model.save(editor) } }, onCancel: { model.sheet = nil },
            onDelete: group.map { group in { model.sheet = nil; model.botStore.requestDelete(.group(group)) } })
    }
}

// Rechte Seite: Chat des gewählten Orbis oder der Gruppe.
private struct DetailView: View {
    let model: AppModel
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        switch model.selection {
        case .bot(let id):
            if let bot = model.botStore.orbis.first(where: { $0.id == id }) { directChat(bot: bot, chatId: bot.chatId, subtitle: bot.job) }
        case .run(let chatId, let botId):
            // Chat eines Laufs: wie der Direktchat des Orbis, der Kopf nennt den Anlass.
            if let bot = model.botStore.bot(id: botId) { directChat(bot: bot, chatId: chatId, subtitle: "Automation") }
        case .group(let id):
            if let group = model.botStore.groups.first(where: { $0.id == id }) {
                let orbis = model.botStore.orbis
                let state = model.state(forGroup: group.id)
                // Teilnehmer mit Namen: Neuere Dienste liefern sie mit, sonst aus der Orbi-Liste.
                // Hauptorbi zuerst: so wählt auch der Dienst den Antwortenden, wenn niemand bestimmt ist.
                let members = group.members.compactMap { member in orbis.first { $0.id == member.id } }
                    .sorted { $0.isMain && !$1.isMain }
                SidePanelContainer(model: model) {
                ChatView(
                    title: group.name, subtitle: group.members.count == 1 ? "1 Orbi" : "\(group.members.count) Orbis", state: state,
                    locked: model.isLocked(chatId: group.id), session: model.chatStore.session(for: group.id),
                    avatar: { size in AvatarStack(members: group.members, size: size, role: .header) },
                    onPill: { model.togglePanel() },
                    members: members, senderNames: orbis.map(\.name), orbiState: { model.state(forBot: $0) },
                    orbi: { message in orbis.first { $0.id == message.metadata?.botId } }, allBots: orbis,
                    userHex: nil,
                    liveStep: model.events.steps.current(forChat: group.id), notice: model.events.notices.notice(forChat: group.id),
                    helpers: model.events.tasks.helpers(forChat: group.id), onStopHelper: { model.events.stopHelper(id: $0) })
                // Nur die Chat-Ansicht beginnt je Chat neu (Scrollstand, Mitlaufen); Container und Panel-Rahmen bleiben stehen.
                .id(group.id)
                } panel: {
                    GroupSidePanel(model: model, group: group).id(group.id)
                }
            }
        case nil:
            // Figma Startbildschirm (157:100637): Figur → Titel 20, Titel „Orbit“ 20 Semi Bold, Titel → Hinweis 6.
            VStack(spacing: Theme.Metrics.pt0) {
                OrbiAvatar(name: "Orbit", avatar: "strobi", colorHex: nil, size: Theme.Metrics.pt80, role: .empty)   // B5: Figma Bildschirm 3: 80
                    .padding(.bottom, Theme.Metrics.pt20)
                Text("Orbit").font(Theme.Fonts.geist(Theme.Fonts.size20, .semibold)).foregroundStyle(Theme.Palette.foreground)
                VStack(spacing: Theme.Metrics.pt0) {
                    if model.botStore.canCreateFirstOrbi {
                        Text("Lege deinen ersten Orbi an.").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground)
                        Button("Ersten Orbi erstellen") { model.sheet = .newBot }.buttonStyle(.card(.primary)).padding(.top, Theme.Spacing.md)
                    } else if case .failed = model.botStore.state {
                        Text("Die Orbis konnten nicht geladen werden.").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground)
                    } else if model.botStore.state != .loaded {
                        Text("Orbis werden geladen …").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground)
                    } else {
                        Text("Wähle links einen Orbi oder eine Gruppe.").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground)
                    }
                }
                .padding(.top, Theme.Metrics.pt6)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.Palette.background)
        }
    }

    @ViewBuilder private func directChat(bot: Bot, chatId: String, subtitle: String) -> some View {
        let state = model.state(chatId: chatId, botId: bot.id)
        SidePanelContainer(model: model) {
            ChatView(
                title: bot.name, subtitle: subtitle, state: state, locked: model.isLocked(chatId: chatId), session: model.chatStore.session(for: chatId),
                avatar: { size in OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: size, botId: bot.id, role: .header) },
                onPill: { model.togglePanel() },
                members: [], senderNames: [], orbiState: { model.state(forBot: $0) }, orbi: { _ in bot }, allBots: model.botStore.orbis,
                userHex: bot.color ?? Theme.orbiBaseColors[bot.avatar.lowercased()], direct: bot,
                liveStep: model.events.steps.current(forChat: chatId), notice: model.events.notices.notice(forChat: chatId),
                    helpers: model.events.tasks.helpers(forChat: chatId), onStopHelper: { model.events.stopHelper(id: $0) })
            // Nur die Chat-Ansicht beginnt je Chat neu (Scrollstand, Mitlaufen); Container und Panel-Rahmen bleiben stehen.
            .id(chatId)
        } panel: {
            BotSidePanel(model: model, bot: bot).id(bot.id)
        }
        // Phase 3 Korrektur: Ein Orbi, dessen Onboarding noch offen ist (auch einer, den der Hauptorbi angelegt hat), startet es beim ersten Öffnen seines leeren Chats.
        .task(id: chatId) {
            if !staticRendering && bot.onboardingDone == false { model.startOnboarding(botId: bot.id, chatId: chatId) }
            // Routinen (Mitteilungen nennen ihren Namen) lud bisher das stets gebaute Panel bei jedem Wechsel; zugeklappt lädt sie hier.
            if !staticRendering && !model.panelOpen { await model.automations.load() }
        }
    }
}

// Ziehgriff am Rand der Seitenleiste: breiter und schmaler ziehen, ohne dass sie sich dabei schließt.
private struct SidebarResizeHandle: View {
    let model: AppModel
    @State private var start: CGFloat?

    var body: some View {
        Color.clear.frame(width: Theme.Metrics.pt9).contentShape(.rect)
            .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            .gesture(DragGesture(minimumDistance: Theme.Metrics.pt1, coordinateSpace: .global)
                .onChanged { drag in
                    let base = start ?? model.sidebarWidth
                    start = base
                    var t = Transaction(); t.disablesAnimations = true
                    withTransaction(t) { model.setSidebarWidth(base + drag.translation.width) }
                }
                .onEnded { _ in start = nil })
            .accessibilityHidden(true)
    }
}

// Höhe der Zeile oben in der Seitenleiste (Ampelknöpfe, Umschalter, „Neu“) und Breiten: Ampelknöpfe brauchen ca. 86 pt,
// die eingeklappte Schiene ist deshalb breiter als früher.
enum TopBarMetrics { static let height: CGFloat = Theme.Metrics.pt52; static let controlsInset: CGFloat = Theme.Metrics.pt74; static let railWidth: CGFloat = Theme.Layout.rail; static let lightsX: CGFloat = Theme.Metrics.pt14 }   // Figma 50:19806: Ampeln ab x 14, „Orbit“ ab x 74
