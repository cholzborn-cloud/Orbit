import AppKit
import SwiftUI

// Orbis für @-Markierungen: Anzeige in Nachrichten, Auswahl im Eingabefeld. Der Klick öffnet den 1:1-Chat des Orbis (kein neuer Chat).
struct MentionDirectory {
    var bots: [Bot]
    var open: (String) -> Void

    var targets: [MentionTarget] { bots.map { MentionTarget(id: $0.id, name: $0.name, avatar: $0.avatar, color: $0.color) } }
    func bot(id: String) -> Bot? { bots.first { $0.id == id } }
}

extension EnvironmentValues {
    @Entry var mentionDirectory: MentionDirectory?
}

// Kleines Standbild der Figur für den Fließtext (ein Text kann keine lebende Figur enthalten).
@MainActor enum MentionAvatarImage {
    private static var cache: [String: NSImage] = [:]

    static func image(for bot: Bot, size: CGFloat = Theme.Metrics.pt16) -> NSImage {
        let key = "\(bot.avatar)|\(bot.color ?? "")|\(bot.look.map { "\($0)" } ?? "")|\(size)"
        if let cached = cache[key] { return cached }
        let look = OrbiLook(avatar: bot.avatar, colorHex: bot.color, look: bot.look)
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            FigureRenderer.drawNeutral(context, size: rect.size, look: look)
            return true
        }
        cache[key] = image
        return image
    }
}

extension MentionAvatarImage {
    // Neutrale Platzhalterfigur für gelöschte Orbis (Figma 26:10381, 14).
    static func placeholder(size: CGFloat) -> NSImage {
        NSImage(size: NSSize(width: size, height: size), flipped: true) { rect in
            NSColor(Theme.Palette.mutedForeground).withAlphaComponent(Theme.Opacity.disabled).setFill()
            NSBezierPath(ovalIn: rect).fill()
            return true
        }
    }
}

// Text mit @-Markierungen: Orbi mit Mini-Figur und Name in Textfarbe, ohne Pille; gelöscht oder unbekannt: Platzhalterfigur, Name grau, ohne Link.
@MainActor enum MentionRichText {
    static func scheme(_ id: String) -> URL? { URL(string: "orbit-orbi://open?id=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)") }

    static func orbiId(from url: URL) -> String? {
        guard url.scheme == "orbit-orbi", let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        return items.first { $0.name == "id" }?.value
    }

    // nil, wenn der Text keine Markierung enthält (dann bleibt es beim gewöhnlichen Markdown).
    static func text(_ text: String, directory: MentionDirectory?, nameColor: Color = Theme.Palette.foreground) -> Text? {
        let segments = Mentions.segments(in: text, targets: directory?.targets ?? [])
        guard segments.contains(where: { if case .mention = $0 { true } else { false } }) else { return nil }
        var result = Text("")
        for segment in segments {
            switch segment {
            case .text(let value):
                result = Text("\(result)\(Text(MarkdownText.attributed(value)))")
            case .mention(let id, let name, let known):
                var label = AttributedString(name)
                if known, let bot = directory?.bot(id: id) {
                    label.link = scheme(id)
                    label.foregroundColor = nameColor
                    let figure = Text(Image(nsImage: MentionAvatarImage.image(for: bot, size: Theme.Metrics.pt14))).baselineOffset(-3)   // Figma @-Markierung 26:10382: Figur 14
                    result = Text("\(result)\(figure) \(Text(label))")
                } else {
                    label.foregroundColor = Theme.Palette.mutedForeground
                    let figure = Text(Image(nsImage: MentionAvatarImage.placeholder(size: Theme.Metrics.pt14))).baselineOffset(-3)   // Figma 26:10381: neutrale Figur 14
                    result = Text("\(result)\(figure) \(Text(label))")
                }
            }
        }
        return result
    }
}

// Auswahlliste über der Eingabeleiste (Figma 02/teil-10): alle Orbis, Filter beim Tippen, Pfeil-Fokus grau.
struct MentionMenuView: View {
    let items: [MentionTarget]
    let bots: [Bot]
    let selected: Int
    let choose: (MentionTarget) -> Void

    var body: some View {
        // Menü-Familie (Theme.Menu): Fläche, Rand, Ecken und Zeilen wie alle Menüs; wächst mit dem Inhalt.
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            if items.isEmpty {
                Text("Kein Orbi gefunden").font(Theme.Menu.title).foregroundStyle(Theme.Palette.mutedForeground)
                    .padding(.horizontal, Theme.Menu.rowPaddingH).frame(height: Theme.Menu.rowHeight)
            }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                MentionMenuRow(item: item, look: bots.first { $0.id == item.id }?.look, selected: index == selected) { choose(item) }
            }
        }
        .frame(minWidth: Theme.Menu.minWidth).fixedSize(horizontal: true, vertical: false)
        .menuSurface()
        .accessibilityElement(children: .contain).accessibilityLabel("Orbis")
    }
}

private struct MentionMenuRow: View {
    let item: MentionTarget
    let look: BotLook?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            let avatar = OrbiAvatar(name: item.name, avatar: item.avatar, colorHex: item.color, look: look, size: Theme.Metrics.pt20, live: false, follow: false)
            MenuRowLabel(item: WebMenuItem(title: item.name, leading: AnyView(avatar)) {}, lit: selected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
