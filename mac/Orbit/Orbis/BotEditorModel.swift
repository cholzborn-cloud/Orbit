import Foundation
import Observation

// Zustand des Orbi-Dialogs (Anlegen und Bearbeiten) mit allen Feldern des Web-Dialogs plus Anpassung der Figur.
@MainActor @Observable
final class BotEditorModel {
    enum Tab: String, CaseIterable, Identifiable {
        case profile = "Form", look = "Personalisieren"
        var id: String { rawValue }
    }

    // Farbvorschläge wie im Web-Dialog (components/bot-dialog.tsx); „Original“ = Grundfarbe.
    static let colorPresets = Theme.OrbiColor.all.map(\.lightHex)

    let editing: Bot?
    var tab: Tab
    var shape: OrbiShape { didSet { if shape != oldValue { shapeChanged(from: oldValue) } } }
    private(set) var customColor: Bool
    var hue: Double
    var saturation: Double
    var name: String
    var isMain: Bool
    var job: String
    var eyes: EyeShape?
    var accessory: Accessory
    var cheeks: Bool
    var gaze: Double
    var reaction: Double
    var error: String?
    var saving = false
    // Hinweis, wenn die Farbe automatisch vorgeschlagen wurde.
    private(set) var suggestionNote: String?
    let others: [Bot]
    // Gewähltes Farbfeld: wird unverändert gespeichert (wie im Web), bis Regler oder Vorschlag die Farbe ändern.
    private var exactHex: String?

    init(editing: Bot?, others: [Bot], tab: Tab = .profile) {
        self.editing = editing
        self.others = others.filter { $0.id != editing?.id }
        self.tab = tab
        let look = editing.map { OrbiLook(avatar: $0.avatar, colorHex: $0.color, look: $0.look) } ?? OrbiLook(shape: .strobi)
        shape = look.shape
        customColor = editing?.color != nil
        exactHex = editing?.color
        hue = look.hue
        saturation = look.saturation
        name = editing?.name ?? look.shape.displayName
        isMain = editing?.isMain ?? false
        job = editing?.job ?? JobPresets.all[0].job
        eyes = look.eyes
        accessory = look.accessory
        cheeks = look.cheeks
        gaze = look.gaze
        reaction = look.reaction
        if editing == nil { suggestIfTwin() }
        // Lauf D: der erste Orbi ist der Hauptorbi; er führt danach das Onboarding im Chat.
        if editing == nil, OnboardingRule.firstOrbiIsMain(existingOrbis: self.others.count) { setMain(true) }
    }

    // MARK: Aussehen

    var look: OrbiLook {
        var look = exactHex.map { OrbiLook(avatar: shape.serviceName, colorHex: $0) } ?? OrbiLook(shape: shape, hue: customColor ? hue : nil, saturation: customColor ? saturation : nil)
        look.eyes = eyes; look.accessory = accessory; look.cheeks = cheeks; look.gaze = gaze; look.reaction = reaction
        return look
    }

    func setCustomHue(_ value: Double) { customColor = true; exactHex = nil; hue = value; suggestionNote = nil }
    func setCustomSaturation(_ value: Double) { customColor = true; exactHex = nil; saturation = value; suggestionNote = nil }

    func useOriginalColor() {
        customColor = false
        exactHex = nil
        hue = shape.defaultHue
        saturation = shape.defaultSaturation
        suggestionNote = nil
    }

    func useColor(hex: String) {
        guard let parsed = FigureColor.hueAndSaturation(hex: hex) else { return }
        customColor = true
        exactHex = hex
        hue = parsed.hue
        saturation = max(20, min(90, parsed.saturation))
        suggestionNote = nil
    }

    func resetLook() {
        eyes = nil; accessory = .none; cheeks = false
        gaze = OrbiLook.defaultGaze; reaction = OrbiLook.defaultReaction
    }

    // Anderer Orbi mit derselben Form in zu ähnlicher Farbe (Doppelgänger-Regel).
    var twin: Bot? {
        let mine = look
        return others.first { Similarity.isTwin(mine, OrbiLook(avatar: $0.avatar, colorHex: $0.color, look: $0.look)) }
    }

    // Nächste freie Farbe: größter Abstand zu allen Orbis derselben Form.
    func suggestFreeColor() {
        let mine = look
        let free = Similarity.nextFreeHue(for: mine, among: others.map { OrbiLook(avatar: $0.avatar, colorHex: $0.color, look: $0.look) })
        customColor = true
        exactHex = nil
        hue = free
        suggestionNote = nil
    }

    private func suggestIfTwin() {
        guard twin != nil else { suggestionNote = nil; return }
        suggestFreeColor()
        suggestionNote = "Farbe vorgeschlagen, weil ein anderer Orbi mit dieser Form ähnlich aussah."
    }

    private func shapeChanged(from old: OrbiShape) {
        // Wahl einer Form setzt ihren Namen ins Namensfeld (auch beim Bearbeiten); danach kann man ihn frei ändern.
        name = shape.displayName
        if !customColor {
            hue = shape.defaultHue
            saturation = shape.defaultSaturation
            // Neue Orbis bekommen bei zu ähnlicher Farbe gleich einen freien Farbton.
            if editing == nil { suggestIfTwin() }
        }
    }

    // MARK: Profil

    func selectPreset(_ preset: String?) {
        guard !isMain else { return }
        if let preset, let entry = JobPresets.all.first(where: { $0.job == preset }) {
            job = entry.job
        } else {
            // Eigener Orbi: die Aufgabe wird frei eingetragen.
            job = ""
        }
    }

    var isCustomJob: Bool { !isMain && !JobPresets.all.contains { $0.job == job } }

    func setMain(_ on: Bool) {
        isMain = on
        if on {
            job = JobPresets.mainJob
        } else if JobPresets.isMainJob(job) {
            job = JobPresets.all[0].job
        }
    }

    // Der bisherige Hauptorbi wird zum normalen Orbi (der Dienst setzt es zurück): Hinweis im Dialog.
    var replacesMain: Bot? { isMain && editing?.isMain != true ? others.first { $0.isMain } : nil }

    // MARK: Prüfen und Speichern

    var validationMessage: String? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty { return "Gib deinem Orbi einen Namen." }
        if trimmedName.count > 40 { return "Der Name darf höchstens 40 Zeichen haben." }
        let trimmedJob = job.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedJob.isEmpty { return "Gib deinem Orbi eine Aufgabe." }
        if trimmedJob.count > 60 { return "Die Aufgabe darf höchstens 60 Zeichen haben." }
        return nil
    }

    var form: ServiceClient.BotForm {
        ServiceClient.BotForm(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines), avatar: shape.serviceName,
            color: customColor ? (exactHex ?? look.serviceColorHex) : nil, isMain: isMain,
            job: job.trimmingCharacters(in: .whitespacesAndNewlines),
            instructions: editing?.instructions ?? "", look: look.serviceLook)
    }
}
