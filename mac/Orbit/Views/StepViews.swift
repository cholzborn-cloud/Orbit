import SwiftUI

// Live-Zeile während der Arbeit (Figma 02/teil-3 und teil-12, Maße DESIGN-SYSTEM 7.1 „Chat Live-Zeile“: 24 hoch, Lücke 8, Regular 13, Farbe „fest“):
// kleine Orbi-Figur mit Arbeits-Animation, rechts grauer Text, über den ein Schimmer läuft. Kein Blau (Blau gilt nur für Punkte in der Seitenleiste).
// Das Label kommt aus dem Dienst (aus dem Code, nie vom Modell); der Text wechselt weich. Wartet der Orbi auf Consti, steht der Text still.
struct LiveStatusBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let label: String
    let bot: Bot?
    var waiting = false

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            OrbiAvatar(name: bot?.name ?? "Orbi", avatar: bot?.avatar, colorHex: bot?.color, look: bot?.look, state: waiting ? .waiting : .working, size: Theme.Metrics.pt20, live: !waiting, follow: false, role: .status)
                .frame(width: Theme.Layout.liveRow, height: Theme.Layout.liveRow)
            Group {
                if waiting { Text(label).foregroundStyle(Theme.Palette.mutedForeground) } else { ShimmerText(text: label, reverse: true) }
            }
            // Ein Text, kein Austausch per id: wechselnde Labels standen sonst während der Überblendung doppelt da.
            .font(Theme.Fonts.geist(Theme.Fonts.size13)).lineHeight(.exact(points: Theme.Metrics.pt18)).lineLimit(1)   // Figma Live-Zeile 143:51758: 13/18
        }
        .frame(maxWidth: .infinity, minHeight: Theme.Layout.liveRow, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .probe("live-status")
    }
}

// Hintergrund-Helfer unter der Live-Zeile: Figur, Titel und letzter Schritt, Stopp je Helfer.
// Steht auch nach dem Ende des Turns, solange der Helfer weiterarbeitet (er blockiert den Chat nicht).
struct HelperStatusRow: View {
    let helper: TaskBoard.Helper
    let bot: Bot?
    let stop: () -> Void

    private var text: String { [helper.title, helper.progress].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            OrbiAvatar(name: bot?.name ?? "Orbi", avatar: bot?.avatar, colorHex: bot?.color, look: bot?.look, state: .working, size: Theme.Metrics.pt20, live: false, follow: false, role: .status)
                .frame(width: Theme.Layout.liveRow, height: Theme.Layout.liveRow)
            Text(text).font(Theme.Fonts.geist(Theme.Fonts.size13)).lineHeight(.exact(points: Theme.Metrics.pt18)).lineLimit(1)
                .foregroundStyle(Theme.Palette.mutedForeground)
            Spacer(minLength: Theme.Spacing.sm)
            Button("Stoppen", action: stop).buttonStyle(.pill(.outline)).accessibilityLabel("Helfer „\(helper.title)“ stoppen")
        }
        .frame(maxWidth: .infinity, minHeight: Theme.Layout.liveRow, alignment: .leading)
        .accessibilityElement(children: .combine)
        .probe("helper-status")
    }
}

// Systemzeile (Figma 26:11342 „Systemhinweis“, Regular 12, Lücke 6, mittig), vier Arten:
// Info (Symbol + muted), Warnung (nur Text muted), Fehler (Alert-Symbol + destructive), Unterbrochen (siehe InterruptedHintView).
// Einen Knopf (Zweit-Pille 24) gibt es nur, wenn der Aufrufer schon eine Aktion hat; der Dienst liefert nur den Text.
struct SystemNoticeView: View {
    let notice: SystemNotice
    var actionLabel: String?
    var action: (() -> Void)?

    private enum Style { case info, warning, error }
    // Wiederholung = Warnung; Handlungsbedarf und Fehler = Fehler.
    private var style: Style {
        switch notice.kind {
        case .info: .info
        case .retry: .warning
        case .action, .error: .error
        }
    }

    var body: some View {
        HStack(spacing: Theme.Metrics.pt6) {
            if style != .warning { Image(systemName: style == .error ? "exclamationmark.circle" : "info.circle").font(.system(size: Theme.Metrics.pt13)) }
            Text(notice.text).font(Theme.Fonts.small).lineLimit(2).multilineTextAlignment(.center)
            if let actionLabel, let action { Button(actionLabel, action: action).buttonStyle(.pill(.outline)) }
        }
        .foregroundStyle(style == .error ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
        .padding(.horizontal, Theme.Spacing.xs)
        .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt23)
        .accessibilityElement(children: .combine)
        .probe("system-notice")
    }
}

// Unterbrochene Arbeit bleibt sichtbar und kann fortgesetzt oder verworfen werden (Figma 26:11342, Art „Unterbrochen“:
// Pause-Symbol, Text muted, Zweit-Pillen).
struct InterruptedHintView: View {
    let busy: Bool
    let resume: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: Theme.Metrics.pt6) {
            Image(systemName: "pause.circle").font(.system(size: Theme.Metrics.pt13))
            Text(InterruptedInfo.text).font(Theme.Fonts.small)
            Button(busy ? "Wird fortgesetzt …" : "Weiter", action: resume).buttonStyle(.pill(.outline)).disabled(busy)
            Button("Verwerfen", action: dismiss).buttonStyle(.pill(.outline)).disabled(busy)
        }
        .foregroundStyle(Theme.Palette.mutedForeground)
        .padding(.vertical, Theme.Spacing.xs)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .probe("interrupted-hint")
    }
}

// Kleine Zeile unter der Antwort, wenn ein Orbi etwas dauerhaft gemerkt hat (Werkzeug memory_save erfolgreich).
// Rückgängig gemachte Werkzeug-Ergebnisse (je toolCallId), bleibt beim Neuaufbau der Zeilen in der Lazy-Liste erhalten.
@MainActor @Observable
final class UndoCenter {
    static let shared = UndoCenter()
    private(set) var done: Set<String> = []
    private(set) var busy: Set<String> = []
    private(set) var errors: [String: String] = [:]

    func undo(_ target: UndoTarget, toolCallId: String, client: ServiceClient) async {
        busy.insert(toolCallId); errors[toolCallId] = nil
        defer { busy.remove(toolCallId) }
        struct Body: Encodable { let kind: String; let orbiId: String }
        do {
            _ = try await client.data(for: try client.request("/v1/undo", method: "POST", body: try JSONEncoder().encode(Body(kind: target.kind, orbiId: target.entityId))))
            done.insert(toolCallId)
        } catch { errors[toolCallId] = error.localizedDescription }
    }
}

// Sofort wirksame Selbständerung (Routine, Orbi, Profil): kurze Zeile wie „Gemerkt ✓“ mit Rückgängig.
struct UndoLine: View {
    let target: UndoTarget
    let toolCallId: String
    @Environment(CardCenter.self) private var cards: CardCenter?
    private var center: UndoCenter { .shared }

    // Gleiche Form wie Systemhinweis (Figma 26:11342): Symbol 13, Lücke 6, Text 12 muted, Zweit-Pille, mittig.
    var body: some View {
        HStack(spacing: Theme.Metrics.pt6) {
            Image(systemName: center.done.contains(toolCallId) ? "arrow.uturn.backward.circle" : "checkmark.circle").font(.system(size: Theme.Metrics.pt13))
            if center.done.contains(toolCallId) {
                Text("\(target.label) · rückgängig gemacht")
            } else {
                Text(target.label)
                if let cards {
                    Button(center.busy.contains(toolCallId) ? "Macht rückgängig …" : "Rückgängig") {
                        Task { await center.undo(target, toolCallId: toolCallId, client: cards.client) }
                    }
                    .buttonStyle(.pill(.outline))
                    .disabled(center.busy.contains(toolCallId))
                }
                if let error = center.errors[toolCallId] { Text(error).foregroundStyle(Theme.Palette.destructive) }
            }
        }
        .font(Theme.Fonts.small)
        .foregroundStyle(Theme.Palette.mutedForeground)
        .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt23)
        .accessibilityElement(children: .contain)
        .probe("undo-line")
    }
}

struct MemorySavedLine: View {
    var body: some View {
        // Consti 06.11.: „Erinnerung aktualisiert“, Form wie Systemhinweis.
        HStack(spacing: Theme.Metrics.pt6) {
            Image(systemName: "checkmark.circle").font(.system(size: Theme.Metrics.pt13))
            Text("Erinnerung aktualisiert")
        }
        .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
            .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt23)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Erinnerung aktualisiert")
            .probe("memory-saved")
    }
}
