import SwiftUI

// Übergabe-Zeile (Figma 02/teil-11, 7.1 „Chat Übergabe-Zeile“: Regular 12, Lücke 8): kleine Figur des anderen Orbis, daneben ein Satz, der den Stand nennt
// („Nachricht gesendet an Nova“, „Nova wartet auf deine Antwort“, „Nova ist fertig“). Läuft es, schimmert der Text; Fehler stehen rot im Text.
// Kein Statuswort und kein Blau. Ein Klick klappt die Nachricht auf. Gespeichert vom Dienst, kein Modellaufruf.
struct OrbiLineRow: View {
    let line: OrbiLine
    @Environment(\.mentionDirectory) private var directory
    @State private var open = false

    private var bot: Bot? { directory?.bot(id: line.peer.id) }
    // Der Orbi wurde gelöscht (nur bekannt, wenn die Orbi-Liste da ist).
    private var gone: Bool { !line.peer.isGroup && directory != nil && bot == nil }

    var body: some View {
        VStack(alignment: .center, spacing: Theme.Spacing.sm) {
            header
                .onTapGesture { open.toggle() }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(line.title) \(line.peer.name), \(line.statusText)")
                .accessibilityValue(open ? "aufgeklappt" : "zugeklappt")
                .accessibilityAddTraits(.isButton)
            if open {
                Text(line.displayText)
                    .font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Fonts.smallLine))
                    .foregroundStyle(Theme.Palette.mutedForeground)
                    .textSelection(.enabled)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: Theme.Metrics.pt560)
            }
        }
        // Consti 06.11.: mittig im Chat wie Systemhinweise und „Gemerkt“.
        .frame(maxWidth: .infinity, alignment: .center)
        .probe("orbi-line")
    }

    private var header: some View {
        HStack(spacing: Theme.Spacing.sm) {
            peerFigure
            sentence
        }
        .font(Theme.Fonts.small)
        .lineLimit(1)
        .contentShape(.rect)
    }

    private var peerName: String { bot?.name ?? line.peer.name }

    @ViewBuilder private var sentence: some View {
        let phrase = line.phrase
        switch phrase.style {
        case .shimmer:
            ShimmerText(text: phrase.prefix + peerName + phrase.suffix)
        case .failure:
            Text(phrase.prefix + peerName + phrase.suffix).foregroundStyle(Theme.Palette.destructive)
        case .plain:
            HStack(spacing: Theme.Metrics.pt0) {
                if !phrase.prefix.isEmpty { Text(phrase.prefix).foregroundStyle(Theme.Palette.mutedForeground) }
                nameView
                if !phrase.suffix.isEmpty { Text(phrase.suffix).foregroundStyle(Theme.Palette.mutedForeground) }
            }
        }
    }

    @ViewBuilder private var peerFigure: some View {
        if line.peer.isGroup {
            Image(systemName: "person.2").font(.system(size: Theme.Metrics.pt11)).foregroundStyle(Theme.Palette.mutedForeground).frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
        } else if gone {
            Circle().fill(Theme.Palette.mutedForeground.opacity(0.4)).frame(width: Theme.Metrics.pt14, height: Theme.Metrics.pt14).frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
        } else {
            OrbiAvatar(name: line.peer.name, avatar: bot?.avatar ?? line.peer.avatar, colorHex: bot?.color ?? line.peer.color, look: bot?.look, state: line.figureState, size: Theme.Metrics.pt20, live: true, follow: false, role: .status)
        }
    }

    // Figma 26:11313 (C36): ganzer Satz muted, der Name bleibt klickbar.
    @ViewBuilder private var nameView: some View {
        let name = peerName
        if gone {
            Text(name).strikethrough().foregroundStyle(Theme.Palette.mutedForeground)
        } else if !line.peer.isGroup, let directory {
            Button { directory.open(line.peer.id) } label: { Text(name).foregroundStyle(Theme.Palette.mutedForeground) }
                .buttonStyle(.plain).help("Chat mit \(name) öffnen")
        } else {
            Text(name).foregroundStyle(Theme.Palette.mutedForeground)
        }
    }
}
