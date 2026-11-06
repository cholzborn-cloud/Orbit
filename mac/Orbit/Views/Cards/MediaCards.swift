import AppKit
import SwiftUI

// Websuche-Quellenkarte (Web: components/search/web-search-card.tsx).
struct WebSearchCardView: View {
    enum Phase: Equatable { case running, done, failed(String) }
    let info: WebSearchInfo
    let phase: Phase
    var opened = false
    @State private var open = true
    @State private var showSources = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch phase {
        case .running:
            HStack(spacing: Theme.Spacing.sm) {
                PulsingSymbols(symbols: ["globe", "magnifyingglass"])
                Text("Suche läuft … \(info.query)").font(Theme.Fonts.geist(Theme.Metrics.pt14)).lineLimit(1)
            }
            .foregroundStyle(Theme.Palette.mutedForeground)
            .padding(.horizontal, Theme.Spacing.md).frame(minHeight: Theme.Metrics.pt44)
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
            .webCardWidth()
            .accessibilityElement(children: .combine)
        case .failed(let message):
            Text(message).font(Theme.Fonts.geist(Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.destructive)
                .padding(.horizontal, Theme.Spacing.md).padding(.vertical, Theme.Spacing.sm)
                .cardSurface(stroke: Theme.Palette.destructive.opacity(0.4), fill: Theme.Palette.destructive.opacity(0.05))
                .webCardWidth()
        case .done:
            VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                Button { open.toggle() } label: {
                    HStack(spacing: Theme.Spacing.sm) {
                        Image(systemName: "magnifyingglass").font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.mutedForeground)
                        Text("Websuche: \(info.query)").font(Theme.Fonts.geist(Theme.Metrics.pt14, .medium)).lineLimit(1)
                        Spacer(minLength: Theme.Metrics.pt0)
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground)
                    }
                    .padding(.horizontal, Theme.Spacing.md).frame(minHeight: Theme.Metrics.pt44).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? "aufgeklappt" : "zugeklappt")
                if open {
                    Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt1)
                    VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                        if let answer = info.answer, !answer.isEmpty { MarkdownText(text: answer) }
                        if !info.sources.isEmpty { sources.padding(.bottom, Theme.Metrics.pt16) }
                        if info.answer?.isEmpty != false, info.sources.isEmpty {
                            Text("Keine Treffer.").font(Theme.Fonts.geist(Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.mutedForeground)
                        }
                    }
                    .padding(Theme.Spacing.md)
                }
            }
            .foregroundStyle(Theme.Palette.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.pt1)
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
            .webCardWidth()
        }
    }

    private var sources: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Button { showSources.toggle() } label: {
                HStack(spacing: Theme.Spacing.xs) {
                    Text("Quellen (\(info.sources.count))").font(Theme.Fonts.geist(Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.primary)
                    Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt10)).foregroundStyle(Theme.Palette.primary).rotationEffect(.degrees(showSources || opened ? 180 : 0))
                }
            }
            .buttonStyle(.plain)
            if showSources || opened {
                ForEach(Array(info.sources.enumerated()), id: \.offset) { _, source in
                    Button { openURL(source.url) } label: {
                        HStack(spacing: Theme.Spacing.sm) {
                            Image(systemName: "book").font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.mutedForeground)
                            Text(source.title).font(Theme.Fonts.geist(Theme.Metrics.pt14)).lineLimit(1)
                            Spacer(minLength: Theme.Metrics.pt0)
                            Text(source.domain).font(Theme.Fonts.geist(Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                        }
                        .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt6)
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .help(source.url.absoluteString)
                    .accessibilityLabel("\(source.title), \(source.domain)")
                }
            }
        }
    }
}

// Zwei Symbole, die ruhig pulsieren (mit „Bewegung reduzieren“ und im Standbild still).
struct PulsingSymbols: View {
    let symbols: [String]
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            ForEach(symbols, id: \.self) { Image(systemName: $0).font(.system(size: Theme.Metrics.pt14)) }
        }
        .opacity(dim ? 0.4 : 1)
        .onAppear {
            guard !reduceMotion, !staticRendering else { return }
            withAnimation(Theme.Motion.easeInOut.animation.repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityHidden(true)
    }
}

// Bildkarte (Web: components/images/generated-image.tsx): Platzhalter beim Erstellen, Bild, Fehler.
struct ImageCardView: View {
    enum Phase: Equatable { case loading, ready(Data), failed(String), missing, omitted }
    let phase: Phase
    var size = "1024x1024"
    var prompt = ""
    @State private var hover = false
    @Environment(\.overlay) private var overlay
    @Environment(\.screenAction) private var screenAction

    var body: some View {
        switch phase {
        case .loading:
            // Figma 143:52251-Reihe „wird erstellt“: nur Fläche 360 × 240, r12, ohne Text.
            RoundedRectangle(cornerRadius: Theme.Metrics.pt12).fill(Theme.Palette.muted)
                .frame(width: Theme.Metrics.pt360, height: Theme.Metrics.pt240)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
            .accessibilityLabel("Bild wird erstellt")
        case .failed(let message):
            errorBox(message)
        case .missing:
            errorBox("Bild wurde nicht fertig.")
        case .omitted:
            Text("Bild nicht weitergegeben.").font(Theme.Fonts.geist(Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground)
        case .ready(let data):
            if let image = NSImage(data: data) {
                // Natürliche Größe, höchstens die Spaltenbreite (Web: `w-full max-w-full` im schrumpfenden Block).
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
                    .frame(maxWidth: min(image.size.width, Theme.Metrics.pt360), alignment: .leading)   // Figma: höchstens 360 breit
                    .clipShape(.rect(cornerRadius: Theme.Metrics.pt12))   // Figma Bild fertig (143:52220): r12
                    // Web: Hover Deckkraft 90 % (150 ms), Klick öffnet den Vollbild-Dialog.
                    .opacity(hover ? 0.9 : 1)
                    .onHover { hover = $0 }
                    .animation(Theme.Motion.hover.animation, value: hover)
                    .onTapGesture { overlay?.viewer = .init(image: image, alt: String(prompt.prefix(120)), filename: Self.filename(prompt)) }
                    .onAppear { if screenAction == "viewer", overlay?.viewer == nil { overlay?.viewer = .init(image: image, alt: String(prompt.prefix(120)), filename: Self.filename(prompt)) } }
                    .accessibilityLabel("\(String(prompt.prefix(120))) vergrößern")
                    .accessibilityAddTraits([.isImage, .isButton])
            } else {
                errorBox("Das Bild lässt sich nicht anzeigen.")
            }
        }
    }

    private func errorBox(_ text: String) -> some View {
        // Figma Bild-Fehler: eine Zeile, Symbol 14, Text 13/18 destructive, ohne Knopf.
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.circle").font(.system(size: Theme.Metrics.pt14))
            Text(text).font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt18))
        }
        .foregroundStyle(Theme.Palette.destructive)
        .padding(.vertical, Theme.Metrics.pt4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    // Dateiname wie im Web: Prompt klein, nur a–z/0–9 mit Bindestrichen, höchstens 50 Zeichen, .jpg.
    static func filename(_ prompt: String) -> String {
        let slug = prompt.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return (slug.isEmpty ? "generiertes-bild" : String(slug.prefix(50))) + ".jpg"
    }

}

// Vollansicht (Figma 143:52251): Fläche card, Ring glassRing 0,5, r16, Innenabstand 8; nur Herunterladen und Schließen (28, r8, Symbol 14)
// oben rechts, Bild r10; hell oder dunkel nach Thema.
struct ImageViewerView: View {
    let viewer: OverlayCenter.Viewer
    let close: () -> Void
    // Der Dialog fokussiert beim Öffnen den ersten Knopf.
    @FocusState private var downloadFocused: Bool

    var body: some View {
        GeometryReader { box in
            ZStack(alignment: .topTrailing) {
                Image(nsImage: viewer.image).resizable().aspectRatio(contentMode: .fit).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipShape(.rect(cornerRadius: Theme.Metrics.pt10))
                    .accessibilityLabel(viewer.alt)
                HStack(spacing: Theme.Metrics.pt4) {
                    button("arrow.down.to.line", "Herunterladen") {
                        if let url = save(to: FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                    }
                    .focused($downloadFocused)
                    button("xmark", "Schließen", action: close).keyboardShortcut(.cancelAction)
                }
                .padding(Theme.Metrics.pt8)
            }
            .padding(Theme.Metrics.pt8)
            // Die Dialogebene hält 16 pt Rand: 96 % × 94 % beziehen sich wie im Web auf das ganze Fenster.
            .frame(width: (box.size.width + Theme.MediaViewer.viewportPadding) * Theme.MediaViewer.widthFraction, height: (box.size.height + Theme.MediaViewer.viewportPadding) * Theme.MediaViewer.heightFraction)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Metrics.pt16))
            .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt16).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))
            .frame(width: box.size.width, height: box.size.height)
        }
        .onAppear { downloadFocused = true }
    }

    private func button(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.foreground) }
            .buttonStyle(ViewerButtonStyle())
            .help(label)
            .accessibilityLabel(label)
    }

    private func save(to directory: URL) -> URL? {
        guard let tiff = viewer.image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let data = rep.representation(using: .jpeg, properties: [:]) else { return nil }
        let url = directory.appending(path: viewer.filename)
        do { try data.write(to: url); return url } catch { return nil }
    }
}

private struct ViewerButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { ViewerButtonBody(configuration: configuration) }
}

private struct ViewerButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hover = false
    @Environment(\.isFocused) private var focused
    var body: some View {
        configuration.label
            .frame(width: Theme.Metrics.pt28, height: Theme.Metrics.pt28)
            .background(hover ? Theme.Palette.secondaryHover : .clear, in: .rect(cornerRadius: Theme.Metrics.pt8))
            .overlay { if focused { RoundedRectangle(cornerRadius: Theme.Metrics.pt8).strokeBorder(Theme.Palette.ring, lineWidth: Theme.Metrics.pt1) } }
            .webFocusRing(focused, radius: Theme.Metrics.pt8)
            .focusEffectDisabled()
            .contentShape(.rect)
            .offset(y: configuration.isPressed ? Theme.Motion.pressOffset : 0)
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover)
    }
}
