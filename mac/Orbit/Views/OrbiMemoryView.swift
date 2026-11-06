import SwiftUI

// Gedächtnis eines Orbis im Seitenpanel: Einträge lesen und einzeln löschen, Träumer ein-/ausschalten.
// Im Stil der Bibliothek (Karten card/border, kleine graue Beschriftungen); neue Werte stehen nur in Theme.
struct OrbiMemoryView: View {
    let model: AppModel
    let bot: Bot
    @State private var memory: MemoryModel
    @State private var open: String?
    // Eintrag ändern (Phase 5): Entwurf von Beschreibung und Text, Fehler des Dienstes.
    @State private var editing: String?
    @State private var draftDescription = ""
    @State private var draftBody = ""
    @State private var editError: String?
    @State private var trashError: String?
    @Environment(\.staticRendering) private var staticRendering

    init(model: AppModel, bot: Bot) {
        self.model = model
        self.bot = bot
        _memory = State(initialValue: MemoryModel(botId: bot.id, service: model.client))
    }

    private static let dateFormat: Date.FormatStyle = .dateTime.day().month(.abbreviated).year().locale(Locale(identifier: "de_DE"))

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            Text("Gedächtnis").font(Theme.Fonts.geist(Theme.Fonts.size16, .semibold))
            Text("Das merkt sich \(bot.name) für sich. Was alle angeht, steht im Brain.")
                .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            if memory.loading && memory.list == nil { HStack(spacing: Theme.Metrics.pt8) { Spinner(size: Theme.Metrics.pt14); Text("Gedächtnis laden …") } }
            if let error = memory.error {
                InlineAlert(text: error)
                Button("Erneut versuchen") { Task { await memory.load() } }.buttonStyle(.card(.outline))
            }
            if memory.isEmpty {
                Text("Noch nichts gemerkt.").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground).padding(.vertical, Theme.Metrics.pt12)
            }
            ForEach(memory.entries) { entry in row(entry) }
            trashSection
            dreamerSection
            heartbeatSection
            Button("Aktualisieren") { Task { await memory.load() } }.buttonStyle(.card(.outline)).disabled(memory.loading)
        }
        .task(id: bot.id) { if !staticRendering { await memory.load() } }
        .onChange(of: model.botStore.memoryRevision) { _, _ in if !staticRendering { Task { await memory.load() } } }
    }

    private func row(_ entry: MemoryEntry) -> some View {
        let expanded = open == entry.name
        return VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            Button { open = expanded ? nil : entry.name } label: {
                HStack(alignment: .top, spacing: Theme.Metrics.pt12) {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt6) {
                        Text(entry.name).font(Theme.Fonts.geist(Theme.Fonts.size13, .medium)).lineLimit(1)
                        if !entry.description.isEmpty {
                            Text(entry.description).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                                .lineLimit(expanded ? nil : 2).fixedSize(horizontal: false, vertical: true)
                        }
                        Text(meta(entry)).font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground)
                    }
                    Spacer(minLength: Theme.Metrics.pt0)
                    Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(expanded ? "aufgeklappt" : "zugeklappt")
            if expanded {
                if editing == entry.name {
                    editor(entry)
                } else {
                    if !entry.body.isEmpty { Text(entry.body).font(Theme.Fonts.small).fixedSize(horizontal: false, vertical: true).textSelection(.enabled) }
                    if !entry.source.isEmpty {
                        Text("Quelle: \(entry.source)").font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: Theme.Metrics.pt8) {
                        Button("Ändern") { startEditing(entry) }.buttonStyle(.card(.outline))
                        Button("Eintrag löschen") { model.botStore.requestDelete(.memory(botId: bot.id, name: entry.name, orbi: bot.name)) }
                            .buttonStyle(.card(.destructive)).environment(\.webButtonFill, true)
                    }
                }
            }
        }
        .padding(Theme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Metrics.pt10))
        .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt10).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
    }

    private func startEditing(_ entry: MemoryEntry) {
        draftDescription = entry.description
        draftBody = entry.body
        editError = nil
        editing = entry.name
    }

    // Ändern gilt als von dir gesagt; der Dienst prüft Länge, Zugangsdaten und ob der Orbi den Eintrag inzwischen selbst geändert hat.
    private func editor(_ entry: MemoryEntry) -> some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            Text("Beschreibung (eine Zeile)").font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground)
            TextField("", text: $draftDescription).webInput().accessibilityLabel("Beschreibung")
            Text("Text").font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground)
            TextField("", text: $draftBody, axis: .vertical).lineLimit(3...10).webInput(multiline: true).accessibilityLabel("Text")
            if let editError { InlineAlert(text: editError) }
            HStack(spacing: Theme.Metrics.pt8) {
                Button("Speichern") {
                    Task {
                        editError = await memory.edit(entry, description: draftDescription, body: draftBody)
                        if editError == nil { editing = nil }
                    }
                }
                .buttonStyle(.card(.primary)).disabled(memory.busy != nil)
                Button("Abbrechen") { editing = nil; editError = nil }.buttonStyle(.card(.outline))
            }
        }
    }

    // Gelöschte Einträge, solange der Dienst sie aufgehoben hat.
    @ViewBuilder private var trashSection: some View {
        if !memory.trash.isEmpty {
            Divider()
            Text("Gelöscht").font(Theme.Fonts.bodyMedium)
            Text("Hier kannst du Einträge zurückholen, die gelöscht wurden.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
            ForEach(memory.trash) { entry in
                HStack(alignment: .top, spacing: Theme.Metrics.pt12) {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt4) {
                        Text(entry.name).font(Theme.Fonts.geist(Theme.Fonts.size13, .medium)).lineLimit(1)
                        if !entry.description.isEmpty {
                            Text(entry.description).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: Theme.Metrics.pt0)
                    Button("Zurückholen") { Task { trashError = await memory.restore(entry.name) } }.buttonStyle(.card(.outline)).disabled(memory.busy != nil)
                }
                .padding(Theme.Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Metrics.pt10))
                .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt10).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
            }
            if let trashError { InlineAlert(text: trashError) }
        }
    }

    // Heartbeat: der Orbi meldet sich höchstens einmal am Tag leise von selbst und schweigt, wenn sich nichts geändert hat.
    @ViewBuilder private var heartbeatSection: some View {
        if let heartbeat = memory.heartbeat {
            Divider()
            HStack {
                Text("Heartbeat").font(Theme.Fonts.bodyMedium)
                Spacer(minLength: Theme.Metrics.pt8)
                Toggle("Heartbeat", isOn: Binding(get: { heartbeat.enabled }, set: { value in Task { await memory.setHeartbeat(value) } }))
                    .labelsHidden().toggleStyle(WebSwitchStyle()).disabled(memory.heartbeatSwitching)
            }
            Text("\(bot.name) schaut alle \(heartbeat.everyMinutes) Minuten nach, solange du am Mac bist (\(heartbeat.from) bis \(heartbeat.to) Uhr). Er meldet sich höchstens einmal am Tag und schweigt, wenn sich nichts geändert hat.")
                .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            if let error = memory.heartbeatError { InlineAlert(text: error) }
        }
    }

    private func meta(_ entry: MemoryEntry) -> String {
        [entry.typeLabel, entry.stated ? "Von dir gesagt" : entry.originLabel, entry.date.map { $0.formatted(Self.dateFormat) }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder private var dreamerSection: some View {
        if let dreamer = memory.dreamer {
            Divider()
            HStack {
                Text("Träumer").font(Theme.Fonts.bodyMedium)
                Spacer(minLength: Theme.Metrics.pt8)
                Toggle("Träumer", isOn: Binding(get: { dreamer.enabled }, set: { value in Task { await memory.setDreamer(value) } }))
                    .labelsHidden().toggleStyle(WebSwitchStyle()).disabled(memory.switching)
            }
            Text("Räumt nachts das Gedächtnis auf: Doppeltes zusammenführen, Veraltetes entfernen. Neues erfindet er nie.")
                .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            if let error = memory.dreamerError { InlineAlert(text: error) }
            if let last = dreamer.lastRunAt {
                Text("Zuletzt: \(last.formatted(Self.dateFormat))").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
            }
            if !dreamer.changes.isEmpty {
                Text("Änderungen").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                ForEach(dreamer.changes.prefix(8)) { change in
                    Text("\(change.actionLabel): \(change.name)" + (change.at.map { " · \($0.formatted(Self.dateFormat))" } ?? ""))
                        .font(Theme.Fonts.small).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
