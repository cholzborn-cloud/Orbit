import AppKit
import SwiftUI

// Wo eine Karte steht: Chat, antwortender Orbi, ob der Turn dieser Nachricht gerade läuft, bekannte Orbis (für Übergaben).
struct CardContext {
    var chatId: String
    var botName: String
    var live: Bool
    var bots: [Bot] = []
    var isGroup = false
}

// Wählt je Werkzeug die passende Karte (Web: ToolCall in components/tool-call.tsx).
struct ToolCardView: View {
    let tool: ToolPart
    let context: CardContext
    var by: String?
    var writing = false
    @Environment(CardCenter.self) private var center: CardCenter?

    private var expired: Bool { tool.approvalId.map { center?.interactions.resolved[$0] == "expired" } == true }

    var body: some View {
        // Eine wartende Freigabe geht jeder Werkzeugkarte vor (auch bei Übergabe und Rückfrage), wie im Web.
        if tool.state == .approvalRequested || expired {
            ApprovalCardHost(tool: tool, context: context).probe("approval-card")
        } else {
            card
        }
    }

    @ViewBuilder private var card: some View {
        switch tool.name {
        case ToolName.ask:
            if let result = tool.askResult {
                AskSummaryView(result: result).probe("ask-card")
            } else if tool.state == .inputAvailable, context.live || center?.interactions.question(toolCallId: tool.toolCallId) != nil {
                // Offene Frage steht wie eine Nachricht des Orbis im Verlauf.
                AskPanelHost(tool: tool, chatId: context.chatId, neutral: context.isGroup).id(tool.toolCallId).probe("ask-panel")
            } else {
                Label(tool.state == .outputError ? "Frage nicht beantwortet" : "\(context.botName) wartet auf deine Antwort", systemImage: "questionmark.bubble")
                    .font(Theme.Fonts.geist(Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground)
            }
        case ToolName.handoff:
            HandoffCardHost(tool: tool, context: context, by: by, writing: writing).probe("handoff-card")
        case "share_file", "create_pdf", "create_word":
            if tool.state == .outputAvailable {
                if let filename = tool.output?["filename"]?.string,
                   let mediaType = tool.output?["mediaType"]?.string,
                   let encoded = tool.output?["data"]?.string,
                   let size = tool.output?["size"]?.number,
                   let data = Data(base64Encoded: encoded), size == Double(data.count), data.count <= 5 * 1024 * 1024 {
                    SharedFileView(file: FilePart(mediaType: mediaType, url: "data:\(mediaType);base64,\(encoded)", filename: filename))
                } else if !context.live || tool.output?["data"] != nil {
                    InlineAlert(text: "Die Datei konnte nicht angezeigt werden.")
                }
            } else if tool.state == .outputError || tool.state == .outputDenied {
                InlineAlert(text: tool.state == .outputDenied ? "Datei wurde nicht freigegeben." : "Die Datei konnte nicht bereitgestellt werden.")
            }

        case "show_screen":
            if tool.state == .outputAvailable,
               let encoded = tool.output?["image"]?.string,
               encoded.utf8.count <= 7 * 1024 * 1024,
               let data = Data(base64Encoded: encoded), data.count <= 5 * 1024 * 1024 {
                ImageCardView(phase: .ready(data), prompt: "Bildschirm")
            } else if tool.state == .outputError || (tool.state == .outputAvailable && (!context.live || tool.output?["image"] != nil)) {
                InlineAlert(text: "Der Bildschirm konnte nicht angezeigt werden.")
            }
        case ToolName.image:
            if context.live && tool.output?["ok"]?.bool == true && tool.output?["data"] == nil {
                EmptyView()
            } else {
                switch tool.imageResult {
                case .image(let data, _): ImageCardView(phase: .ready(data), size: tool.imageSize, prompt: tool.imagePrompt).probe("image")
                case .failed(let message): ImageCardView(phase: .failed(message)).probe("error-card")
                case .omitted: ImageCardView(phase: .omitted)
                case nil:
                    if tool.state == .outputError { ImageCardView(phase: .failed(tool.errorText ?? "Bild wurde nicht fertig.")) }
                    else if context.live { ImageCardView(phase: .loading, size: tool.imageSize) }
                    else { ImageCardView(phase: .missing) }
                }
            }
        default:
            if tool.state == .outputError || tool.state == .outputDenied || tool.output?["error"]?.string != nil {
                InlineAlert(text: tool.state == .outputDenied ? "Aktion wurde abgelehnt." : (tool.errorText ?? tool.output?["error"]?.string ?? "Die Aufgabe konnte nicht abgeschlossen werden."))
            }
        }
    }
}

// Freigabekarte mit Live-Stand: offen mit Verfall, abgelaufen oder nicht mehr offen.
struct ApprovalCardHost: View {
    let tool: ToolPart
    let context: CardContext
    @Environment(CardCenter.self) private var center: CardCenter?

    var body: some View {
        // Sekundentakt nur, solange die Karte offen ist (Verfallsanzeige).
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let phase = self.phase(now: timeline.date)
            let pending = tool.approvalId.flatMap { center?.interactions.pending[$0] }
            ApprovalCardView(
                botName: context.botName, tool: tool.name, input: tool.input, text: pending?.text, detail: pending?.detail, reason: pending?.reason, neutral: context.isGroup, phase: phase, now: timeline.date,
                busy: tool.approvalId.map { center?.busy.contains($0) == true } ?? false,
                error: tool.approvalId.flatMap { center?.errors[$0] }
            ) { decision in
                guard let id = tool.approvalId, let center else { return }
                Task { await center.decide(id, decision) }
            }
        }
    }

    private func phase(now: Date) -> ApprovalPhase {
        guard let center else { return .gone }
        return ApprovalPhase.resolve(tool: tool, board: center.interactions, live: context.live, now: now)
    }
}

// Alte Übergabekarte (nur gespeicherte Verläufe, Werkzeug `handoff`); verschachtelte Schritte und Übergaben des Ziels stehen im aufgeklappten Teil.
struct HandoffCardHost: View {
    let tool: ToolPart
    let context: CardContext
    var by: String?
    var writing = false
    @Environment(CardCenter.self) private var center: CardCenter?

    var body: some View {
        let info = HandoffInfo(tool)
        let phase = HandoffPhase.make(tool: tool, info: info, live: context.live)
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            if phase.kind == .failed { InlineAlert(text: phase.error ?? "Die Übergabe ist fehlgeschlagen.") }
            ForEach(Array(info.parts.enumerated()), id: \.offset) { _, part in
                if case .tool(let nested) = part, nested.isVisibleInChat {
                    ToolCardView(tool: nested, context: CardContext(chatId: context.chatId, botName: phase.target, live: context.live, bots: context.bots), by: phase.target)
                } else if case .file(let file) = part {
                    SharedFileView(file: file)
                }
            }
        }
    }
}

// Fragebogen über dem Eingabefeld: sendet die Antworten an den Dienst; der Turn läuft im selben Strom weiter.
struct AskPanelHost: View {
    let tool: ToolPart
    let chatId: String
    var neutral = false
    @Environment(CardCenter.self) private var center: CardCenter?
    @State private var model: AskPanelModel
    // Nach der Antwort verschwindet der Fragebogen sofort (Web: Werkzeugausgabe sofort lokal), nicht erst mit dem Strom.
    @State private var answered = false

    init(tool: ToolPart, chatId: String, neutral: Bool = false) {
        self.tool = tool
        self.chatId = chatId
        self.neutral = neutral
        _model = State(initialValue: AskPanelModel(questions: tool.askQuestions))
    }

    var body: some View {
        if !answered { AskPanelView(model: model, onSubmit: { send($0) }, onSkip: { send(nil) }, neutral: neutral) }
    }

    private func send(_ answers: [QuestionAnswer]?) {
        guard let center, !model.sending else { return }
        model.sending = true
        model.error = nil
        Task {
            // Fehler (nicht mehr offen, abgelaufen, ungültig) bleiben am Fragebogen stehen, nie still.
            if let message = await center.answer(tool.toolCallId, answers: answers) { model.error = message } else { answered = true }
            model.sending = false
        }
    }
}

// Dateikarte (Datei-Zeile): Symbol, Name, Typ und Größe. Klick öffnet harmlose Typen (PDF, Bild, Text, Office) aus einer Temp-Kopie,
// alles andere und der Pfeil sichern über den Sichern-Dialog. Die Daten werden erst auf Klick geschrieben.
struct SharedFileView: View {
    let file: FilePart
    @State private var error: String?
    @State private var hover = false

    private var data: Data? {
        guard let comma = file.url.firstIndex(of: ","), file.url.hasPrefix("data:"),
              let data = Data(base64Encoded: String(file.url[file.url.index(after: comma)...])), data.count <= 5 * 1024 * 1024 else { return nil }
        return data
    }

    var body: some View {
        let name = FileCardRules.safeName(file.filename)
        let canOpen = FileCardRules.canOpen(filename: name)
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            // Figma 03/teil-14 „Datei-Zeile“ (7.1: 40 hoch, innen 10, Lücke 10, Name Regular 12, Zweitzeile Regular 11 muted): einfaches Dateisymbol ohne Kachel,
            // Download erst beim Überfahren. In der Box mit feinem Rand (0,5), beim Überfahren graue Fläche.
            HStack(spacing: Theme.Metrics.pt10) {
                Image(systemName: FileCardRules.symbol(mediaType: file.mediaType, filename: name)).font(.system(size: Theme.Metrics.pt16, weight: .light))
                    .foregroundStyle(Theme.Palette.foreground).frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
                VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    Text(name).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.foreground).lineLimit(1).truncationMode(.middle)
                    Text([FileCardRules.kind(mediaType: file.mediaType, filename: name), data.map { AttachmentRules.formatBytes($0.count) }].compactMap { $0 }.joined(separator: " · "))
                        .font(Theme.Fonts.geist(Theme.Metrics.pt11)).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                }
                Spacer(minLength: Theme.Spacing.md)
                Button { Task { await save() } } label: {
                    Image(systemName: "arrow.down.to.line").font(.system(size: Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground).frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24).contentShape(.rect)
                }
                .buttonStyle(.plain).opacity(hover ? 1 : 0).accessibilityLabel("\(name) sichern")
            }
            .padding(.horizontal, Theme.Metrics.pt10).frame(minHeight: Theme.Metrics.pt40).frame(maxWidth: Theme.Metrics.pt340, alignment: .leading)
            .background(hover ? Theme.Palette.secondaryHover : Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            .contentShape(.rect)
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover)
            .onTapGesture { if canOpen { open(name) } else { Task { await save() } } }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("\(name), \(canOpen ? "öffnen" : "sichern")")
            .probe("file-card")
            if let error { InlineAlert(text: error) }
        }
    }

    private func open(_ name: String) {
        error = nil
        guard let data else { error = "Die Datei konnte nicht gelesen werden."; return }
        do {
            let dir = FileManager.default.temporaryDirectory.appending(path: "Orbit-Dateien").appending(path: UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appending(path: name)
            try data.write(to: url, options: .atomic)
            NSWorkspace.shared.open(url)
        } catch { self.error = "Die Datei konnte nicht geöffnet werden: \(error.localizedDescription)" }
    }

    private func save() async {
        error = nil
        guard let data else { error = "Die Datei konnte nicht gelesen werden."; return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = FileCardRules.safeName(file.filename)
        guard await panel.begin() == .OK, let url = panel.url else { return }
        do { try data.write(to: url, options: .atomic); NSWorkspace.shared.activateFileViewerSelecting([url]) }
        catch { self.error = "Die Datei konnte nicht gespeichert werden: \(error.localizedDescription)" }
    }
}
