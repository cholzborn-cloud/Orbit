import SwiftUI

// Rückfragen und Freigaben von Orbis, die im Auftrag dieses Chats arbeiten, aber in einem anderen Chat (Phase 2, Punkt 7):
// Karte mit Absender (Figur, Name), beantwortet wird im Chat, in dem Consti schrieb; die Antwort geht an den fragenden Orbi.
// Wiederverwendet ApprovalCardView und AskPanelHost. Hinfällige Karten (aborted/expired) fehlen im Stand und verschwinden.
struct RootCardsView: View {
    let cards: [PendingInteraction]
    var isGroup = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            ForEach(cards) { card in RootInteractionCard(card: card, isGroup: isGroup).id(card.id) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Offene Fragen anderer Orbis")
    }
}

struct RootInteractionCard: View {
    let card: PendingInteraction
    var isGroup = false
    @Environment(CardCenter.self) private var center: CardCenter?
    @Environment(\.mentionDirectory) private var directory

    private var sender: PendingInteraction.Sender? { card.from }
    private var senderName: String { sender?.name ?? directory?.bot(id: card.botId)?.name ?? "Ein Orbi" }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            header
            switch card.kind {
            case .approval:
                ApprovalCardView(botName: senderName, tool: card.tool, input: card.input, text: card.text, detail: card.detail, reason: card.reason, neutral: isGroup, phase: .open(expiresAt: nil),
                                 busy: center?.busy.contains(card.id) == true, error: center?.errors[card.id]) { decision in
                    guard let center else { return }
                    Task { await center.decide(card.id, decision) }
                }
                .probe("root-approval-card")
            case .ask:
                // Die Rückfrage-ID ist die Werkzeug-ID (wie in ToolCards).
                AskPanelHost(tool: ToolPart(toolCallId: card.id, name: ToolName.ask, state: .inputAvailable, input: card.input), chatId: card.chatId, neutral: isGroup)
                    .probe("root-ask-card")
            }
        }
    }

    // Absender: Figur, Name, kurzer Satz.
    private var header: some View {
        let bot = directory?.bot(id: sender?.id ?? card.botId)
        return HStack(spacing: Theme.Spacing.sm) {
            OrbiAvatar(name: senderName, avatar: sender?.avatar ?? bot?.avatar, colorHex: sender?.color ?? bot?.color, look: bot?.look, size: Theme.Metrics.pt24, live: false, follow: false)
            Text(senderName).font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.foreground)
            Text(card.kind == .ask ? "hat eine Frage" : "braucht deine Freigabe").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }
}
