import AppKit
import SwiftUI

// Figma 151:93975: jede Nachricht hat ihre eigene Zeile über die volle Spaltenbreite. Eigene rechts, Antwort (Figur, Name, Blase) links;
// beide höchstens halb so breit wie die Spalte, gehen also nie über die Mitte und überlappen sich nie. Langer Text bricht um.
private extension View {
    func messageWidth(alignment: HorizontalAlignment) -> some View { MessageWidth(trailing: alignment == .trailing) { self } }
}

// Der Inhalt passt sich seinem Text an, er wird nie auf die Höchstbreite gestreckt.
private struct MessageWidth: Layout {
    var trailing: Bool

    private func limit(_ full: CGFloat) -> CGFloat { full * Theme.Layout.messageShare }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let view = subviews.first else { return .zero }
        guard let full = proposal.width else { return view.sizeThatFits(.unspecified) }
        return CGSize(width: full, height: view.sizeThatFits(ProposedViewSize(width: limit(full), height: nil)).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let view = subviews.first else { return }
        let size = view.sizeThatFits(ProposedViewSize(width: limit(bounds.width), height: nil))
        let x = trailing ? bounds.maxX - size.width : bounds.minX
        view.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading, proposal: ProposedViewSize(width: size.width, height: size.height))
    }
}

// Kind 0 = Inhalt (höchstens 60 % der Breite, am Rand), Kind 1 = Aktionsleiste daneben; volle Zeilenbreite.
private struct MessageSideBar: Layout {
    var trailing: Bool
    private var gap: CGFloat { Theme.Metrics.pt6 }   // Figma: Blase ↔ Aktionsleiste 6 (C21)
    private func limit(_ full: CGFloat) -> CGFloat { full * Theme.Layout.messageShare }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        let actions = subviews.count > 1 ? subviews[1].sizeThatFits(.unspecified) : .zero
        guard let full = proposal.width else {
            let size = content.sizeThatFits(.unspecified)
            return CGSize(width: size.width + (actions.width > 0 ? gap + actions.width : 0), height: max(size.height, actions.height))
        }
        let size = content.sizeThatFits(ProposedViewSize(width: limit(full), height: nil))
        return CGSize(width: full, height: max(size.height, actions.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let content = subviews.first else { return }
        let size = content.sizeThatFits(ProposedViewSize(width: limit(bounds.width), height: nil))
        let actions = subviews.count > 1 ? subviews[1].sizeThatFits(.unspecified) : .zero
        let contentX = trailing ? bounds.maxX - size.width : bounds.minX
        let contentY = bounds.minY + (bounds.height - size.height) / 2
        content.place(at: CGPoint(x: contentX, y: contentY), anchor: .topLeading, proposal: ProposedViewSize(width: size.width, height: size.height))
        guard subviews.count > 1 else { return }
        let actionsX = trailing ? contentX - gap - actions.width : contentX + size.width + gap
        let actionsY = bounds.minY + (bounds.height - actions.height) / 2
        subviews[1].place(at: CGPoint(x: actionsX, y: actionsY), anchor: .topLeading, proposal: ProposedViewSize(width: actions.width, height: actions.height))
    }
}

// Gleiche Eingaben, gleiche Zeile; Rückrufe zählen nicht (sie wirken über die Sitzung auf dieselbe Nachricht). So rendert ein Stream-Chunk
// oder ein Scrollschritt nur die Zeile, die sich ändert, nicht den ganzen Verlauf (gemessen, siehe plan/STATUS.md 04.11.2026).
extension MessageRow: Equatable {
    nonisolated static func == (a: Self, b: Self) -> Bool {
        a.message == b.message && a.orbi == b.orbi && a.senderNames == b.senderNames && a.state == b.state && a.live == b.live
            && a.chatId == b.chatId && a.running == b.running && a.bots == b.bots && a.userHex == b.userHex && a.reactions == b.reactions && a.retryingAutomation == b.retryingAutomation
            && a.joinsPrevious == b.joinsPrevious && a.endsRun == b.endsRun
    }
}

// Eine Blase mit eigener Aktionsleiste daneben: Überfahren zeigt nur die Aktionen dieser Blase, nicht die der ganzen Antwort.
private struct BubbleHover<Content: View, Bar: View>: View {
    let trailing: Bool
    let content: Content
    let bar: (Bool) -> Bar
    @State private var hover = false

    init(trailing: Bool, @ViewBuilder content: () -> Content, @ViewBuilder bar: @escaping (Bool) -> Bar) {
        self.trailing = trailing
        self.content = content()
        self.bar = bar
    }

    var body: some View {
        MessageSideBar(trailing: trailing) {
            content
            bar(hover)
        }
        .onHover { hover = $0 }
    }
}

// Eigene Nachricht: Farbe des Orbis (Web: bubbleStyle). Antwort: graue Blase, Figur des antwortenden Orbis links.
struct MessageRow: View {
    let message: ChatMessage
    let orbi: Bot?
    // Namen der Orbis: ein „[Name]: “ am Anfang einer Antwort wird nicht angezeigt (Gruppenverlauf).
    var senderNames: [String] = []
    var state: OrbiState = .calm
    var live = false
    // Karten: Chat, ob der Turn dieser Antwort läuft, bekannte Orbis (Übergaben).
    var chatId = ""
    var running = false
    var bots: [Bot] = []
    var userHex: String?
    // Phase 3: Reaktionen dieses Chats; `onReact(emoji, blase)` setzt oder nimmt Constis Reaktion auf eine Blase (nil = nicht möglich).
    var reactions = ReactionBoard()
    var onReact: ((String, String) -> Void)?
    var onRetryAutomation: ((String) -> Void)?
    var retryingAutomation = false
    // Antworten auf eine Blase: Text (ohne „[Name]:“, @-Markierungen als @Name) und Bezug für den Dienst (`ChatMessage.bubbleParts`).
    var onReply: ((String, String) -> Void)?
    // Folge gleicher Absender (Figma 118:21521 ff.): setzt diese Blase an die vorige an (kleine Ecke oben); letzte Blase der Folge trägt den Avatar.
    var joinsPrevious = false
    var endsRun = true
    @Environment(\.mentionDirectory) private var directory
    @Environment(\.staticRendering) private var staticRendering
    @Environment(\.screenAction) private var screenAction

    // Antworten ohne sichtbaren Inhalt (nur Denken oder Werkzeuge, leer gestoppt) bekommen keine Zeile; Werkzeuge zeigt die App nie.
    // Eine Reaktion allein ergibt ebenfalls keine Zeile.
    private var hasContent: Bool { message.stopped || (!message.isSilent && message.hasBubbleContent) }
    private func reactionItems(_ key: String) -> () -> [WebMenuItem] {
        { onReact.map { react in ReactionMenu.items(mine: reactions.mine(for: key), onPick: { react($0, key) }) } ?? [] }
    }

    // Consti 05.11.: die Pille sitzt an der unteren äußeren Ecke der Blase (eigene rechts unten, Orbi links unten), ragt 8 in die Blase.
    private func reactionBadge(_ key: String) -> some View {
        ReactionPills(groups: reactions.groups(for: key), bots: bots)
            .alignmentGuide(.bottom) { $0[.top] + Theme.Metrics.pt8 }
    }
    // 14 Platz unter der Blase (Pille 22 ragt 8 in die Blase).
    private func reactionSpace(_ key: String) -> CGFloat { reactions.groups(for: key).isEmpty ? Theme.Metrics.pt0 : Theme.Metrics.pt14 }
    private var isGroup: Bool { !senderNames.isEmpty }

    var body: some View {
        if let line = message.orbiLine {
            OrbiLineRow(line: line)
        } else if let notice = message.notice, !hasContent {
            SystemNoticeView(notice: notice)
        } else if message.role == .user {
            VStack(alignment: .trailing, spacing: Theme.Metrics.pt8) {
                ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
                    if case .file(let file) = part { UserFileView(file: file).messageWidth(alignment: .trailing) }
                }
                if let auto = message.metadata?.automation {
                    AutomationRunCard(name: auto.name, run: auto, retry: onRetryAutomation.map { action in { action(auto.automationId) } }, retrying: retryingAutomation)
                        .messageWidth(alignment: .trailing)
                }
                else if let auto = AutomationTag.parse(message.text) { AutomationRunCard(name: auto.name, prompt: auto.prompt).messageWidth(alignment: .trailing) }
                else if !message.text.isEmpty {
                    let text = Mentions.plain(message.text)
                    BubbleHover(trailing: true) {
                        VStack(alignment: .trailing, spacing: Theme.Spacing.xs) {
                            if let quote = message.metadata?.replyQuote { quotePreview(quote) }
                            userBubble.overlay(alignment: .bottomTrailing) { reactionBadge(message.id) }   // äußere untere Ecke: eigene Blase rechts unten
                        }
                    } bar: { hover in actions(text: text, key: message.id, replyTo: message.id, hover: hover) }
                    .padding(.bottom, reactionSpace(message.id))
                    .webContextMenu(screenName: "kontext-nachricht", reactionItems(message.id))
                    .accessibilityActions { if let onReply { Button("Antworten") { onReply(text, message.id) } } }
                }
            }
        } else if hasContent {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
              // Figma 26:10485: „abgebrochen“ 11 muted direkt unter der Blase, Lücke 4, bündig (eingerückt nur neben einem Avatar).
              VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                // Figma 26:10493 (C14): Gruppe, Name 11 Medium muted über der ersten Blase einer Folge, links 12 eingerückt, Lücke 2.
                if isGroup && !joinsPrevious {
                    Text(orbi?.name ?? "Gelöschter Orbi").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.mutedForeground)
                        .padding(.leading, Theme.Metrics.pt32 + Theme.Metrics.pt12).padding(.bottom, Theme.Metrics.pt2)
                        .messageWidth(alignment: .leading)
                }
                // Antwort ohne Blase (nur Datei oder Karte): Reaktion und Rechtsklick gelten der ganzen Antwort.
                if message.bubbleKeys.isEmpty {
                    answerRows
                        .overlay(alignment: .bottomLeading) { reactionBadge(message.id) }
                        .padding(.bottom, reactionSpace(message.id))
                        .webContextMenu(screenName: "kontext-nachricht", reactionItems(message.id))
                } else {
                    answerRows
                }
                // Web: StoppedLabel „abgebrochen“ (11 pt) und Tokenschätzung beim Streamen (≈ 4 Zeichen je Token).
                if message.stopped { Text("abgebrochen").font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground).padding(.leading, isGroup ? Theme.Metrics.pt32 : Theme.Metrics.pt0).padding(.top, Theme.Metrics.pt4).messageWidth(alignment: .leading) }
              }
                if let notice = message.notice { SystemNoticeView(notice: notice) }
            }
        }
    }

    // Avatar 24 nur an der letzten Blase der Folge, sonst Platz 24 (Figma 26:10568). Gelöschter Orbi (kein Bot): neutraler Platzhalter.
    @ViewBuilder private func avatarSlot(last: Bool) -> some View {
        if isGroup {
            if endsRun && last {
                OrbiAvatar(name: orbi?.name ?? "Gelöschter Orbi", avatar: orbi?.avatar, colorHex: orbi?.color, look: orbi?.look, size: Theme.Metrics.pt24, follow: false)
                    .padding(.bottom, Theme.Metrics.pt2)
            } else {
                Color.clear.frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
            }
        }
    }

    // Text einer Blase für Kopieren und Zitat.
    private func bubbleText(_ part: MessagePart) -> String {
        if case .text(let text) = part { return Mentions.plain(GroupText.stripSenderTag(text, names: senderNames)) }
        if case .tool(let tool) = part, let say = tool.sayText { return Mentions.plain(GroupText.stripSenderTag(say, names: senderNames)) }
        return ""
    }

    private var userBubble: some View {
        let bubbleText = isGroup ? Theme.Palette.foreground : Theme.Palette.bubbleOwnForeground
        return VStack(alignment: .leading, spacing: Theme.Metrics.pt4) {
            // Figma 26:10418 (C5): Skill-Chip in der Blase, 20 hoch, innen 0/8, Lücke 4, glassActive, sparkles 11, 11 Medium in Blasentextfarbe.
            if let skill = message.metadata?.skill {
                HStack(spacing: Theme.Metrics.pt4) {
                    Image(systemName: "sparkles").font(.system(size: Theme.Metrics.pt11))
                    Text("/\(skill.name)").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium))
                }
                .foregroundStyle(bubbleText)
                .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt20)
                .background(Theme.Palette.glassActive, in: Capsule())
                .accessibilityLabel("Skill \(skill.name)")
            }
            (MentionRichText.text(message.text, directory: directory, nameColor: bubbleText) ?? Text(MarkdownText.attributed(message.text)))
                .tint(bubbleText)
                .font(Theme.Fonts.message).lineHeight(.exact(points: Theme.Fonts.bubbleLine))
                .foregroundStyle(bubbleText)
                .textSelection(.enabled)
        }
        .padding(.horizontal, Theme.Layout.bubblePaddingH).padding(.vertical, Theme.Layout.bubblePaddingV)
        .background(isGroup ? Theme.Palette.accentNeutral : Theme.Palette.accentBubble, in: AssistantBubbleShape(trailing: true, joinsPrevious: joinsPrevious))
        .probe("bubble-user")
    }

    private func isCenteredLine(_ part: MessagePart) -> Bool {
        guard case .tool(let tool) = part, tool.sayText == nil else { return false }
        return tool.memorySaved || tool.name == ToolName.handoff || tool.undoTarget(botId: message.metadata?.botId) != nil
    }

    private func isBubble(_ part: MessagePart) -> Bool {
        if case .text = part { return part.isVisibleText }
        if case .tool(let tool) = part { return tool.sayText != nil }
        return false
    }

    // Text als graue Blase, Werkzeuge als eigene Karten dazwischen (wie im Web), der Jev-Block steht vor der Antwort.
    // Jede Blase ist eine eigene Zeile mit eigener Aktionsleiste und eigenen Reaktionen (Schlüssel: `ChatMessage.bubbleKeys`).
    @ViewBuilder private var answerRows: some View {
        let visible = message.answerParts(botId: message.metadata?.botId)
        let keys = message.bubbleKeys
        let replyIds = message.bubbleParts
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            if orbi == nil && !isGroup {
                Text("Gelöschter Orbi").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.mutedForeground)
                    .messageWidth(alignment: .leading)
            }
            ForEach(Array(visible.enumerated()), id: \.element.offset) { index, item in
                let part = item.element
                // Folge-Ecken: eine Blase direkt nach einer Blase (auch der vorigen Nachricht desselben Absenders) setzt klein an.
                let joins = index == 0 ? joinsPrevious : isBubble(visible[index - 1].element)
                let last = index == visible.count - 1
                if let key = keys[item.offset], let replyTo = replyIds[item.offset] {
                    let text = bubbleText(part)
                    BubbleHover(trailing: false) {
                        HStack(alignment: .bottom, spacing: Theme.Metrics.pt8) {
                            avatarSlot(last: last)
                            partView(part, joins: joins).overlay(alignment: .bottomLeading) { reactionBadge(key) }   // Antwort: äußere untere Ecke (links unten)
                        }
                    } bar: { hover in
                        actions(text: text, key: key, replyTo: replyTo, hover: hover).opacity(running ? 0 : 1).allowsHitTesting(!running)
                    }
                    .padding(.bottom, reactionSpace(key))
                    .webContextMenu(screenName: "kontext-nachricht", reactionItems(key))
                    .accessibilityActions { if let onReply, !running { Button("Antworten") { onReply(text, replyTo) } } }
                } else if isCenteredLine(part) {
                    // Consti 06.11.: Übergaben, „Gemerkt“, Rückgängig-Zeilen und Systemhinweise stehen mittig im Chat.
                    partView(part, joins: joins).frame(maxWidth: .infinity)
                } else {
                    HStack(alignment: .bottom, spacing: Theme.Metrics.pt8) {
                        avatarSlot(last: last)
                        partView(part, joins: joins)
                    }
                    .messageWidth(alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder private func partView(_ part: MessagePart, joins: Bool) -> some View {
        switch part {
        case .text(let text):
            MarkdownText(text: GroupText.stripSenderTag(text, names: senderNames))
                .padding(.horizontal, Theme.Layout.bubblePaddingH).padding(.vertical, Theme.Layout.bubblePaddingV)
                .foregroundStyle(Theme.Palette.bubbleReplyForeground)
                .background(Theme.Palette.bubbleReply, in: AssistantBubbleShape(joinsPrevious: joins))
                .overlay(AssistantBubbleShape(joinsPrevious: joins).stroke(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
                .probe("bubble-assistant")
        case .tool(let tool):
            // Zwischennachricht (`say`): eigene Blase; `react` nie sichtbar.
            if let say = tool.sayText { SayBubble(text: GroupText.stripSenderTag(say, names: senderNames), date: tool.sayDate, joinsPrevious: joins) }
            else if tool.memorySaved { MemorySavedLine() }
            else if let target = tool.undoTarget(botId: message.metadata?.botId) { UndoLine(target: target, toolCallId: tool.toolCallId) }
            else { ToolCardView(tool: tool, context: cardContext) }
        case .file(let file):
            SharedFileView(file: file)
        default: EmptyView()
        }
    }

    private func quotePreview(_ quote: ReplyQuote) -> some View {
        Text(Mentions.plain(quote.text)).font(Theme.Fonts.small).lineLimit(2)
            .foregroundStyle(Theme.Palette.mutedForeground)
            .padding(Theme.Spacing.sm)
            .background(Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Radius.md))
    }

    private func actions(text: String, key: String, replyTo: String, hover: Bool) -> some View {
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(spacing: Theme.Metrics.pt2) {
            if let onReact {
                WebMenuButton(screenName: "menu-reaktion", items: { ReactionMenu.items(mine: reactions.mine(for: key), onPick: { onReact($0, key) }) }, label: { _ in
                    Image(systemName: "face.smiling").font(.system(size: Theme.Metrics.pt13)).foregroundStyle(Theme.Palette.mutedForeground).frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24).contentShape(.rect)
                }).accessibilityLabel("Reagieren")
            }
            if let onReply, hasText {
                Button { onReply(text, replyTo) } label: { Image(systemName: "arrowshape.turn.up.left").font(.system(size: Theme.Metrics.pt13)) }
                    .buttonStyle(.web(.ghost, .iconXS)).accessibilityLabel("Antworten")
            }
            if hasText {
                MoreAction(text: text, meta: message.metadata ?? ChatMetadata())
            }
        }
        .fixedSize()
        .opacity(hover || (staticRendering && screenAction?.hasPrefix("aktionen-") == true) ? 1 : 0)
        .allowsHitTesting(hover)
        .animation(Theme.Motion.hover.animation, value: hover)
    }

    private var cardContext: CardContext {
        CardContext(chatId: chatId, botName: orbi?.name ?? "Gelöschter Orbi", live: running, bots: bots, isGroup: isGroup)
    }
}

// Zwischennachricht (`say`): graue Antwort-Blase; Kopieren, Antworten und Reagieren stehen in ihrer eigenen Aktionsleiste (MessageRow).
struct SayBubble: View {
    let text: String
    let date: Date?
    var joinsPrevious = false

    var body: some View {
        MarkdownText(text: text)
            .padding(.horizontal, Theme.Layout.bubblePaddingH).padding(.vertical, Theme.Layout.bubblePaddingV)
            .background(Theme.Palette.bubbleReply, in: AssistantBubbleShape(joinsPrevious: joinsPrevious))
            .overlay(AssistantBubbleShape(joinsPrevious: joinsPrevious).stroke(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            .probe("bubble-say")
    }
}

// „⋯“ an einer Antwort: Menü „Info, Kopieren“ (Menü-Familie über das Overlay statt System-Popover); „Info“ zeigt an derselben Stelle die Infokarte.
private struct MoreAction: View {
    let text: String
    let meta: ChatMetadata
    @Environment(\.overlay) private var overlay
    @State private var frame: CGRect = .zero

    var body: some View {
        WebMenuButton(alignment: .trailing, screenName: "menu-nachricht-mehr", items: {
            [WebMenuItem(title: "Info", icon: "info.circle", action: showInfo),
             WebMenuItem(title: "Kopieren", icon: "doc.on.doc", action: copyText)]
        }) { open in
            Image(systemName: "ellipsis").font(.system(size: Theme.Metrics.pt13))
                .foregroundStyle(open ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24).contentShape(.rect)
        }
        .accessibilityLabel("Weitere Aktionen")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { frame = $0 }
    }

    private func showInfo() {
        overlay?.menu = .init(anchor: frame, items: [], alignment: .trailing, custom: AnyView(MessageInfoCard(rows: InfoText.compactRows(meta))), customWidth: Theme.Metrics.pt208)
    }

    private func copyText() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

struct MessageInfoCard: View {
    let rows: [(String, String)]
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Info").font(Theme.Fonts.bodyMedium)
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                ForEach(rows, id: \.0) { row in
                    if row.1.count > 22 {
                        VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                            Text(row.0).foregroundStyle(Theme.Palette.mutedForeground)
                            Text(row.1).fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        HStack(alignment: .firstTextBaseline, spacing: Theme.Metrics.pt12) {
                            Text(row.0).foregroundStyle(Theme.Palette.mutedForeground)
                            Text(row.1).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                }
            }
            .font(Theme.Fonts.small)
        }
        // Fläche, Rand und Ecken kommen vom Menü (menuSurface); Text sitzt wie Menüzeilen 14 vom Rand.
        .padding(Theme.Menu.rowPaddingH)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Blasenform (Figma 26:10430, 26:10477, 118:21521 ff.): Ecken 21, unten an der Absenderseite 5 (eigene rechts, Antwort links).
// Folgt die Blase einer Blase desselben Absenders, ist auch die obere Ecke an der Absenderseite 5.
struct AssistantBubbleShape: Shape {
    var trailing = false
    var joinsPrevious = false

    // Wie Grok Bot: alle Ecken gleich rund, keine Sprechblasen-Spitze (`joinsPrevious` ändert die Form nicht mehr).
    // Eigene Blase r18: einzeilig (36 hoch) wird sie zur Pille wie bei Grok.
    func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: min(trailing ? Theme.Radius.bubble : Theme.Radius.bubbleReply, rect.height / 2), style: .continuous).path(in: rect)
    }
}

// Schreibblase wie TypingBubble im Web: Figur 24 und graue Blase mit drei Punkten.
struct ThinkingBubble: View {
    let orbi: Bot?

    var body: some View {
        HStack(alignment: .bottom, spacing: Theme.Metrics.pt8) {
            OrbiAvatar(name: orbi?.name ?? "Orbi", avatar: orbi?.avatar, colorHex: orbi?.color, look: orbi?.look, size: Theme.Metrics.pt24, follow: false)
                .padding(.bottom, Theme.Metrics.pt2)
            TypingDots()
                .foregroundStyle(Theme.Palette.foreground)
                .padding(.horizontal, Theme.Metrics.pt16).padding(.vertical, Theme.Metrics.pt10)
                .background(Theme.Palette.secondary, in: AssistantBubbleShape())
        }
        .messageWidth(alignment: .leading)
    }
}

// Datei in der eigenen Nachricht (Web: FileCard): Bild als Vorschau (Klick = Vollbild), sonst Karte mit Name, Typ und Größe.
struct UserFileView: View {
    let file: FilePart
    @Environment(\.overlay) private var overlay
    @State private var hover = false

    private var data: Data? {
        guard let comma = file.url.firstIndex(of: ","), file.url.hasPrefix("data:") else { return nil }
        return Data(base64Encoded: String(file.url[file.url.index(after: comma)...]))
    }

    var body: some View {
        let name = file.filename ?? "Datei"
        if file.mediaType.hasPrefix("image/"), let data, let image = NSImage(data: data) {
            Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: Theme.Metrics.pt320)
                .clipShape(.rect(cornerRadius: Theme.Radius.xl))   // C40: r14, ohne Rand
                .onTapGesture { overlay?.viewer = .init(image: image, alt: name, filename: name) }
                .accessibilityLabel("Bild \(name)").accessibilityAddTraits(.isButton)
        } else {
            // Figma Anhang in Blase, Datei (26:11372): innen 8, Lücke 10, r14, card, Rand border 0,5; Name 12 Medium, Info 11 muted; Hover secondaryHover.
            HStack(spacing: Theme.Metrics.pt10) {
                Image(systemName: FileCardRules.symbol(mediaType: file.mediaType, filename: file.filename)).font(.system(size: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.bubbleOwnForeground)
                    .frame(width: Theme.Metrics.pt36, height: Theme.Metrics.pt36).background(Theme.Palette.accentBubble, in: .rect(cornerRadius: Theme.Metrics.pt4))   // C40: Kachel 36 r4
                VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    Text(name).font(Theme.Fonts.smallMedium).lineLimit(1).truncationMode(.middle)
                    Text([FileCardRules.kind(mediaType: file.mediaType, filename: file.filename), data.map { AttachmentRules.formatBytes($0.count) }].compactMap { $0 }.joined(separator: " · "))
                        .font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                }
            }
            .padding(Theme.Metrics.pt8).frame(maxWidth: Theme.Metrics.pt240, alignment: .leading)   // C40: höchstens 240
            .background(hover ? Theme.Palette.secondaryHover : Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.xl))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xl).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover)
            .accessibilityElement(children: .combine)
        }
    }
}
