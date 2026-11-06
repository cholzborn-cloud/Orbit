import AppKit
import SwiftUI

// Suche nach components/sidebar-search.tsx: Suchfeld in der Seitenleiste (Pille 36, Kürzel ⌘K), Ergebnisfenster darunter
// (384 breit, höchstens 320 hoch, Rand, popover, Schatten) und die Palette (⌘K, Dialog 384, 1/3 von oben).

private func hitTime(_ date: Date, now: Date = .now) -> String {
    let calendar = Calendar(identifier: .gregorian)
    func format(_ pattern: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_DE")
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
    // Figma 49:15812 ff.: heute „09:42“, gestern „gestern“, diese Woche Wochentag kurz („Mo“), sonst „T.M.“.
    if calendar.isDateInToday(date) { return format("HH:mm") }
    if calendar.isDateInYesterday(date) { return "gestern" }
    if let week = calendar.dateInterval(of: .weekOfYear, for: now), week.contains(date) {
        return String(format("EEE").prefix(2))
    }
    return format("d.M.")
}

// Treffertext mit Markierung (Web: mark bg-primary/20, text-foreground, rounded-sm).
func markedSnippet(_ snippet: String) -> AttributedString {
    var result = AttributedString()
    for part in SearchSnippet.parts(snippet) {
        var piece = AttributedString(part.text)
        // Figma „Trefferzeile“ (49:15830): Treffer in Medium statt farbiger Markierung.
        if part.marked { piece.font = Theme.Fonts.geist(Theme.Fonts.size11, .medium); piece.foregroundColor = Theme.Palette.foreground }
        result += piece
    }
    return result
}

// Zeile eines Treffers: Figur 28, Name 14/500, Zeit 12 muted, Snippet 12 muted (höchstens 40 hoch).
struct SearchHitRow: View {
    let hit: SearchHit
    let active: Bool
    var radius: CGFloat = Theme.Radius.md
    var onHover: (() -> Void)?
    let onSelect: () -> Void

    // Figma „Trefferzeile“ (49:15830): Kopf mit Figur 20, Name 12 Regular, Zeit 11 muted; darunter Snippet 11 über die volle Breite
    // (höchstens 2 Zeilen); innen 6/8, Abstand 3, r8; aktiv secondaryHover.
    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt3) {
                HStack(spacing: Theme.Metrics.pt8) {
                    OrbiAvatar(name: hit.chatName ?? "Chat", avatar: hit.avatar, colorHex: hit.color, size: Theme.Metrics.pt20)
                    Text(hit.chatName ?? "Chat").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.foreground).lineLimit(1)
                    Spacer(minLength: Theme.Metrics.pt0)
                    Text(hitTime(hit.createdAt)).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                }
                Text(markedSnippet(hit.snippet)).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground)
                    .lineLimit(2).frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? Theme.Palette.secondaryHover : .clear, in: .rect(cornerRadius: radius))
            .contentShape(.rect(cornerRadius: radius))
        }
        .buttonStyle(.plain)
        .onHover { if $0 { onHover?() } }
        .accessibilityLabel("\(hit.chatName ?? "Chat"): \(SearchSnippet.plain(hit.snippet))")
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}

// Zustandszeilen unter dem Feld (Web: px-3 py-2 text-sm muted; Fehler destruktiv).
struct SearchStatusLines: View {
    let search: SearchStore
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            if search.loading { line("Suche …", icon: "circle.dotted") }
            if search.building { line("Suchindex wird aufgebaut …", icon: "arrow.clockwise") }
            // Fehler: Figma „Suche gerade nicht möglich“; Fehler beim Öffnen eines Treffers behält den Dienst-Text.
            if search.error != nil { line("Suche gerade nicht möglich", icon: "exclamationmark.circle") }
            else if let error = search.openError { line(error, icon: "exclamationmark.circle") }
            if search.emptyResult { line("Keine Treffer für „\(search.query.trimmingCharacters(in: .whitespacesAndNewlines))“", icon: "magnifyingglass") }
            // Kopfzeile (49:15861): „N Treffer in Chats“, 11 Medium.
            if !search.results.isEmpty { header(search.results.count) }
        }
    }

    private func header(_ count: Int) -> some View {
        Text(count == 1 ? "1 Treffer" : "\(count) Treffer in Chats").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium))
            .foregroundStyle(Theme.Palette.mutedForeground)
            .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt28).frame(maxWidth: .infinity, alignment: .leading)
    }

    // Figma „Such-Status“ (49:15860): Zeile 28, innen 8, Abstand 6, Symbol 12 + Text 11 muted (auch bei Fehler grau).
    private func line(_ text: String, icon: String) -> some View {
        HStack(spacing: Theme.Metrics.pt6) {
            Image(systemName: icon).font(.system(size: Theme.Metrics.pt12))
            Text(text).font(Theme.Fonts.caption)
        }
        .foregroundStyle(Theme.Palette.mutedForeground)
        .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt28).frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

// Suchfeld in der Kopfzeile der Seitenleiste.
struct SidebarSearchField: View {
    let model: AppModel
    @FocusState private var focused: Bool
    @State private var hover = false
    @State private var monitor: Any?
    @State private var host = WindowBox()

    // Figma „Liste Suchfeld“ (50:15564): 24 hoch, Kapsel, innen 8, Symbol 12 muted, Abstand 6, Regular 12; normal secondary,
    // Hover secondaryHover, fokussiert/getippt field mit Rand border 0,5; Löschen-Symbol 12.
    var body: some View {
        @Bindable var search = model.search
        let active = focused || !search.query.isEmpty
        ZStack(alignment: .leading) {
            Image(systemName: "magnifyingglass").font(.system(size: Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground).padding(.leading, Theme.Metrics.pt8)
            if search.fieldActive {
                TextField("Suche", text: $search.query, prompt: Text("Suche").foregroundStyle(Theme.Palette.mutedForeground))
                    .textFieldStyle(.plain).font(Theme.Fonts.small)
                    .focused($focused).focusEffectDisabled()
                    .padding(.leading, Theme.Metrics.pt26).padding(.trailing, Theme.Metrics.pt26)
                    .onKeyPress(.downArrow) { search.move(1); return .handled }
                    .onKeyPress(.upArrow) { search.move(-1); return .handled }
                    .onKeyPress(.escape) { search.dismissed = true; focused = false; return .handled }
                    .onSubmit { model.openSearchHit(search.active) }
                    .onAppear { focused = true }
                    .accessibilityLabel("Chats und Nachrichten durchsuchen")
            } else {
                // Ohne Textfeld kann SwiftUI den Fokus hier nicht von selbst ablegen; erst der Klick macht daraus das Feld.
                Text(search.query.isEmpty ? "Suche" : search.query).font(Theme.Fonts.small).lineLimit(1)
                    .foregroundStyle(search.query.isEmpty ? Theme.Palette.mutedForeground : Theme.Palette.foreground)
                    .padding(.leading, Theme.Metrics.pt26).padding(.trailing, Theme.Metrics.pt26)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .contentShape(.rect)
                    .onTapGesture { search.activateField() }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel("Chats und Nachrichten durchsuchen")
            }
            HStack {
                Spacer(minLength: Theme.Metrics.pt0)
                if !search.query.isEmpty {
                    Button { search.query = ""; search.activateField(); focused = true } label: {
                        Image(systemName: "xmark").font(.system(size: Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground)
                            .frame(width: Theme.Metrics.pt12, height: Theme.Metrics.pt12).contentShape(.rect)
                    }
                    .buttonStyle(.plain).padding(.trailing, Theme.Metrics.pt8).accessibilityLabel("Suche leeren")
                }
            }
        }
        .frame(height: Theme.Metrics.pt24)
        .background(active ? Theme.Palette.field : (hover ? Theme.Palette.secondaryHover : Theme.Palette.secondary), in: .capsule)
        .overlay { if active { Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) } }
        .webFocusRing(focused, radius: Theme.Metrics.pt18)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: focused || hover)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { search.fieldFrame = $0 }
        .onChange(of: focused) { _, now in search.fieldFocusChanged(now) }
        .background(WindowReader(box: host))
        .onAppear(perform: install)
        .onDisappear { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil }
        .probe("sidebar-search")
    }

    // Klick daneben (auch auf leere Fläche, die AppKit sonst nicht als Fokuswechsel zählt): Feld abgeben, Treffer schließen.
    private func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
            guard let window = event.window, let content = window.contentView else { return event }
            let p = event.locationInWindow
            let point = CGPoint(x: p.x, y: content.bounds.height - p.y)
            MainActor.assumeIsolated { if window === host.window { model.search.windowClick(at: point) } }
            return event
        }
    }
}

// Eingeklappt: nur das Suchsymbol (Web: Knopf rund 40), öffnet die Palette.
struct SearchIconButton: View {
    let model: AppModel
    var body: some View {
        Button { model.search.paletteOpen = true } label: { SidebarIconLabel(systemName: "magnifyingglass", size: Theme.Metrics.pt24, rail: true) }
            .buttonStyle(.plain).accessibilityLabel("Suche")
    }
}

// Ergebnisfenster unter dem Feld: erscheint, sobald etwas getippt ist; Klick daneben oder Esc schließt es.
struct SearchPopover: View {
    let model: AppModel

    var body: some View {
        let search = model.search
        GeometryReader { box in
            let origin = CGPoint(x: min(search.fieldFrame.minX, max(Theme.Metrics.pt8, box.size.width - Theme.Metrics.pt384 - Theme.Metrics.pt8)), y: search.fieldFrame.maxY + Theme.Metrics.pt8)
            ScrollView {
                // Figma „Ergebnisfenster“ (49:15915): innen 8, Zeilenabstand 2, r14, popover, Rand border 0,5, kein Schatten.
                VStack(spacing: Theme.Metrics.pt2) {
                    SearchStatusLines(search: search)
                    ForEach(Array(search.results.enumerated()), id: \.element.id) { index, hit in
                        SearchHitRow(hit: hit, active: index == search.active, onHover: { search.active = index }) { model.openSearchHit(index) }
                    }
                }
                .padding(Theme.Metrics.pt8)
            }
            .scrollIndicators(.never)
            .frame(width: min(Theme.Metrics.pt384, box.size.width - Theme.Metrics.pt32))
            .frame(maxHeight: Theme.Metrics.pt320)
            .fixedSize(horizontal: false, vertical: true)
            .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Menu.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.Menu.radius).strokeBorder(Theme.Palette.border, lineWidth: Theme.Menu.border))
            .foregroundStyle(Theme.Palette.popoverForeground)
            .probe("search-popover")
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { search.popoverFrame = $0 }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.leading, origin.x).padding(.top, origin.y)
        }
        .onDisappear { model.search.popoverFrame = .zero }
    }
}

// Palette (⌘K): Eingabe, darunter Chats oder Treffer. Dialog 384 breit, r 14, Oberkante bei einem Drittel der Fensterhöhe.
struct SearchPalette: View {
    let model: AppModel
    @FocusState private var focused: Bool
    @State private var chatActive = 0

    private var chats: [Bot] { model.botStore.orbis }

    var body: some View {
        @Bindable var search = model.search
        GeometryReader { box in
            VStack(spacing: Theme.Metrics.pt0) {
                // Figma „Palette“ (49:15964): Eingabezeile 40 hoch, innen 14, Abstand 8, Symbol 14, Text 13; darunter Linie border 0,5.
                HStack(spacing: Theme.Metrics.pt8) {
                    Image(systemName: "magnifyingglass").font(.system(size: Theme.Metrics.pt14)).opacity(0.5)
                    TextField("Chats und Nachrichten suchen…", text: $search.query, prompt: Text("Chats und Nachrichten suchen…").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).font(Theme.Fonts.subhead)
                        .focused($focused).focusEffectDisabled()
                        .onKeyPress(.downArrow) { step(1); return .handled }
                        .onKeyPress(.upArrow) { step(-1); return .handled }
                        .onKeyPress(.escape) { model.search.reset(); return .handled }
                        .onSubmit { choose() }
                        .accessibilityLabel("Suche")
                }
                .padding(.horizontal, Theme.Metrics.pt14).frame(height: Theme.Metrics.pt40)
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)
                ScrollView {
                    VStack(spacing: Theme.Metrics.pt2) {
                        if search.hasQuery {
                            SearchStatusLines(search: search)
                            ForEach(Array(search.results.enumerated()), id: \.element.id) { index, hit in
                                SearchHitRow(hit: hit, active: index == search.active, onHover: { search.active = index }) { model.openSearchHit(index) }
                            }
                        } else if chats.isEmpty {
                            Text("Keine Chats gefunden.").font(Theme.Fonts.body).padding(.vertical, Theme.Metrics.pt24).frame(maxWidth: .infinity)
                        } else {
                            Text("Chats").font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.mutedForeground)
                                .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt6).frame(maxWidth: .infinity, alignment: .leading)
                            ForEach(Array(chats.enumerated()), id: \.element.id) { index, bot in chatRow(bot, active: index == chatActive, index: index) }
                        }
                    }
                    .padding(Theme.Metrics.pt8)
                }
                .scrollIndicators(.never)
                .frame(maxHeight: Theme.Metrics.pt288)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: min(Theme.Metrics.pt384, box.size.width - Theme.Metrics.pt32))
            .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Radius.xl))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xl).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            .foregroundStyle(Theme.Palette.popoverForeground)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.top, box.size.height / 3)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
            .probe("search-palette")
        }
        .onAppear { focused = true; chatActive = 0 }
    }

    private func chatRow(_ bot: Bot, active: Bool, index: Int) -> some View {
        Button { open(bot) } label: {
            HStack(spacing: Theme.Metrics.pt8) {
                // Wie die Trefferzeile (S30): Figur 20, Name 12, innen 6/8, r8, aktiv secondaryHover.
                OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt20)
                Text(bot.name).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.foreground).lineLimit(1)
                Spacer(minLength: Theme.Metrics.pt0)
            }
            .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt6)
            .background(active ? Theme.Palette.secondaryHover : .clear, in: .rect(cornerRadius: Theme.Radius.md))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { if $0 { chatActive = index } }
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }

    private func open(_ bot: Bot) {
        model.selection = .bot(bot.id)
        model.search.reset()
    }

    private func step(_ delta: Int) {
        if model.search.hasQuery { model.search.move(delta) } else { chatActive = min(max(0, chatActive + delta), max(0, chats.count - 1)) }
    }

    private func choose() {
        if model.search.hasQuery { model.openSearchHit(model.search.active) }
        else if chats.indices.contains(chatActive) { open(chats[chatActive]) }
    }
}
