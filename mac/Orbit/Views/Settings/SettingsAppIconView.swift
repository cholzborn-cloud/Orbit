import SwiftUI

// Abschnitt „App-Symbol“ unter Darstellung: fertige Entwürfe, an denen nur Orbi-Farbe und Hintergrundfarbe änderbar sind.
struct SettingsAppIconView: View {
    @State private var icons = AppIconStore.shared

    private var config: AppIconConfig { icons.config }
    private var design: AppIconDesign { AppIconDesign.named(config.design) }

    // Figma „Darstellung · App-Symbol“: eine Gruppe mit Zeilen: Vorschau mit Name, Entwurf, Orbi-Farbe, Hintergrund.
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            VStack(spacing: Theme.Metrics.pt0) {
                HStack(spacing: Theme.Metrics.pt14) {   // Figma 143:55496: Symbol 64, Abstand 14
                    preview
                    Text("App-Symbol").font(Theme.Fonts.bodyMedium)
                    Spacer(minLength: Theme.Metrics.pt0)
                }.padding(Theme.Metrics.pt12)
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)   // Figma 143:55502: Linie 0,5
                VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
                    Text("Entwurf").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                    // K65 (143:55505): Kacheln 40, Abstand 10, Umbruch.
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: Theme.Metrics.pt40, maximum: Theme.Metrics.pt40), spacing: Theme.Metrics.pt10)], alignment: .leading, spacing: Theme.Metrics.pt10) {
                        ForEach(AppIconDesign.all) { d in tile(d) }
                    }
                }.padding(Theme.Metrics.pt12).frame(maxWidth: .infinity, alignment: .leading)
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)   // Figma 143:55502: Linie 0,5
                row("Orbi-Farbe") {
                    swatch(selected: config.colorHex == nil, label: "Farbe des Entwurfs") { icons.update { $0.colorHex = nil } } content: {
                        Circle().strokeBorder(Theme.Palette.foreground.opacity(0.4), style: StrokeStyle(lineWidth: Theme.Metrics.pt1, dash: [3, 2]))
                            .overlay { Image(systemName: "nosign").font(.system(size: Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground) }
                    }
                    ForEach(BotEditorModel.colorPresets, id: \.self) { hex in
                        swatch(selected: config.colorHex == hex, label: hex) { icons.update { $0.colorHex = hex } } content: { Circle().fill(Color(serviceHex: hex) ?? Theme.Palette.muted).overlay(Circle().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5)) }
                    }
                    picker(hex: config.colorHex, known: BotEditorModel.colorPresets, fallback: design.shape.baseHex) { hex in icons.update { $0.colorHex = hex } }
                }
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)   // Figma 143:55502: Linie 0,5
                row("Hintergrund") {
                    swatch(selected: config.backgroundHex == nil, label: "Hintergrund des Entwurfs") { icons.update { $0.backgroundHex = nil } } content: {
                        Circle().fill(Color(serviceHex: design.background) ?? Theme.Palette.muted).overlay { Circle().strokeBorder(Theme.Palette.foreground.opacity(0.3), lineWidth: Theme.Metrics.pt1) }
                    }
                    ForEach(AppIconRenderer.backgroundColors, id: \.self) { hex in
                        swatch(selected: config.backgroundHex == hex, label: hex) { icons.update { $0.backgroundHex = hex } } content: {
                            Circle().fill(Color(serviceHex: hex) ?? Theme.Palette.muted).overlay { Circle().strokeBorder(Theme.Palette.foreground.opacity(0.25), lineWidth: Theme.Metrics.pt1) }
                        }
                    }
                    picker(hex: config.backgroundHex, known: AppIconRenderer.backgroundColors, fallback: design.background) { hex in icons.update { $0.backgroundHex = hex } }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            Text("Das Symbol erscheint im Dock und im App-Wechsler; im Finder und im Launchpad bleibt das Standardsymbol.")
                .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            // K65: Zurücksetzen immer sichtbar, mit Symbol; ohne eigene Änderung ausgegraut.
            Button { icons.reset() } label: {
                HStack(spacing: Theme.Metrics.pt6) { Image(systemName: "arrow.counterclockwise"); Text("Standardsymbol wiederherstellen") }
            }
            .buttonStyle(.card(.outline)).disabled(!icons.isCustom)
        }
    }

    // Die Farbfelder umbrechen, damit auch schmale Einstellungsfenster vollständig sichtbar bleiben.
    private func row(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            Text(title).font(Theme.Fonts.body)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: Theme.Metrics.pt26), spacing: Theme.Metrics.pt8)], alignment: .leading, spacing: Theme.Metrics.pt8) {
                content()
            }
        }.padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt8)
    }

    private var preview: some View {
        Group {
            if let image = AppIconRenderer.nsImage(config, side: 256) { Image(nsImage: image).resizable().interpolation(.high) } else { Color.clear }
        }
        .frame(width: Theme.Metrics.pt64, height: Theme.Metrics.pt64)
        .accessibilityLabel("Vorschau des App-Symbols")
    }

    private func group(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            Text(title).font(Theme.Fonts.bodyMedium)
            content()
        }
    }

    // Entwurf mit den eigenen Farben, wenn er gewählt ist, sonst mit seinen eigenen.
    private func tile(_ d: AppIconDesign) -> some View {
        let selected = d.id == config.design
        let shown = selected ? config : AppIconConfig(design: d.id)
        return Button { icons.update { $0.design = d.id } } label: {
            Group {
                if let image = AppIconRenderer.nsImage(shown, side: 96) { Image(nsImage: image).resizable().interpolation(.high) } else { Color.clear }
            }
            .padding(Theme.Metrics.pt2)
            .frame(width: Theme.Metrics.pt40, height: Theme.Metrics.pt40)
            .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt12).strokeBorder(selected ? Theme.Palette.foreground : .clear, lineWidth: Theme.Metrics.pt1_5))   // Figma 143:55505: Ring foreground 1,5
        }
        .buttonStyle(.plain)
        .webTooltip(d.name)
        .accessibilityLabel(d.name)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func swatch(selected: Bool, label: String, action: @escaping () -> Void, @ViewBuilder content: () -> some View) -> some View {
        Button(action: action) {
            content().frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
                .overlay { Circle().strokeBorder(Theme.Palette.primary, lineWidth: Theme.Metrics.pt2).padding(-Theme.Metrics.pt3).opacity(selected ? 1 : 0) }
                .padding(Theme.Metrics.pt3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    // Eigene Farbe: Regenbogen-Punkt mit unsichtbarem Farbwähler darüber.
    private func picker(hex: String?, known: [String], fallback: String, set: @escaping (String?) -> Void) -> some View {
        swatch(selected: hex != nil && !known.contains(hex!), label: "Eigene Farbe", action: {}) {
            Circle().fill(AngularGradient(colors: Theme.Palette.colorPickerSpectrum, center: .center))
                .overlay {
                    ColorPicker("Eigene Farbe", selection: Binding(get: { Color(serviceHex: hex ?? fallback) ?? Theme.Palette.muted }, set: { c in if let h = FigureColor.hex(c) { set(h) } }), supportsOpacity: false)
                        .labelsHidden().opacity(0.015)
                }
        }
    }
}
