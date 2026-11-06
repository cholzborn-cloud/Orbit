import SwiftUI

// Markdown der Antworten: Codeblöcke (```) als Monospace-Fläche, übrige Absätze über AttributedString(markdown:).
struct MarkdownText: View {
    let text: String
    @Environment(\.mentionDirectory) private var directory

    var body: some View {
        // Figma Antwort-Blase (26:10482): Lücke 6 zwischen Blöcken.
        VStack(alignment: .leading, spacing: Theme.Metrics.pt6) {
            ForEach(Array(Self.cachedBlocks(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .code(let code):
                    // Figma Code-Block (26:10461): glass, Rand border 0,5, r8, innen 10, Code 12/18.
                    Text(code)
                        .font(Theme.Fonts.mono(Theme.Metrics.pt12)).lineHeight(.exact(points: Theme.Metrics.pt18))
                        .textSelection(.enabled)
                        .padding(Theme.Metrics.pt10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.Palette.glass, in: .rect(cornerRadius: Theme.Radius.md))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
                case .prose(let prose):
                    let rich = MentionRichText.text(prose, directory: directory)
                    (rich ?? Text(Self.attributed(prose)))
                        .tint(rich == nil ? nil : Theme.Palette.foreground)
                        .font(Theme.Fonts.message).lineHeight(.exact(points: Theme.Fonts.bubbleLine))   // wie Grok Bot: 15/22
                        .textSelection(.enabled)
                    ForEach(Array(Self.links(in: prose).enumerated()), id: \.offset) { _, link in
                        ChatLinkCard(link: link)
                    }
                case .link(let link):
                    ChatLinkCard(link: link)
                }
            }
        }
    }

    enum Block: Equatable {
        case prose(String)
        case code(String)
        case link(ChatLink)
    }

    // Auch ein noch offener Codeblock (Streaming) gilt schon als Code.
    static func blocks(in text: String) -> [Block] {
        var blocks: [Block] = []
        var prose: [Substring] = []
        var code: [Substring] = []
        var inCode = false
        func flushProse() {
            let joined = prose.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { blocks.append(.prose(joined)) }
            prose = []
        }
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if inCode { blocks.append(.code(code.joined(separator: "\n"))); code = [] }
                else { flushProse() }
                inCode.toggle()
            } else if inCode {
                code.append(line)
            } else if let link = ChatLink.parse(String(line)) {
                flushProse()
                blocks.append(.link(link))
            } else {
                prose.append(line)
            }
        }
        if inCode { blocks.append(.code(code.joined(separator: "\n"))) } else { flushProse() }
        return blocks
    }

    // Gemerkt je Text: Zeilen, die beim Scrollen wieder erscheinen, und fertige Antworten werden nicht neu geparst. Nicht absatzweise:
    // im Inline-Modus reichen `**`, `` ` `` und Links über Leerzeilen hinweg.
    static func attributed(_ text: String) -> AttributedString {
        if let hit = Cache.texts.object(forKey: text as NSString) { return hit.value }
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        let value = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        Cache.texts.setObject(Box(value), forKey: text as NSString)
        return value
    }

    static func cachedBlocks(_ text: String) -> [Block] {
        if let hit = Cache.blocks.object(forKey: text as NSString) { return hit.value }
        let value = blocks(in: text)
        Cache.blocks.setObject(Box(value), forKey: text as NSString)
        return value
    }

    private static func links(in prose: String) -> [ChatLink] {
        if let hit = Cache.links.object(forKey: prose as NSString) { return hit.value }
        let value = ChatLink.inlineLinks(in: prose)
        Cache.links.setObject(Box(value), forKey: prose as NSString)
        return value
    }

    private final class Box<Value>: NSObject {
        let value: Value
        init(_ value: Value) { self.value = value }
    }

    // NSCache räumt bei Speicherdruck selbst auf; die Grenzen halten ihn auch sonst klein.
    @MainActor private enum Cache {
        static let texts = limited(NSCache<NSString, Box<AttributedString>>(), 2000)
        static let blocks = limited(NSCache<NSString, Box<[Block]>>(), 1000)
        static let links = limited(NSCache<NSString, Box<[ChatLink]>>(), 1000)
        static func limited<Value>(_ cache: NSCache<NSString, Box<Value>>, _ count: Int) -> NSCache<NSString, Box<Value>> { cache.countLimit = count; return cache }
    }

}


private struct ChatLinkCard: View {
    let link: ChatLink
    @State private var hover = false

    var body: some View {
        Link(destination: link.url) {
            HStack(spacing: Theme.Spacing.xs) {
                Image(systemName: link.symbol).font(.system(size: Theme.Metrics.pt14))
                Text(link.title).font(Theme.Fonts.body).lineLimit(1)
            }
            .foregroundStyle(Theme.Palette.linkNeutral)
            .frame(height: Theme.Metrics.pt24)
            .background(hover ? Theme.Palette.secondaryHover : .clear, in: .rect(cornerRadius: Theme.Radius.md))
            .contentShape(.rect(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(link.url.absoluteString)
    }
}
