import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-fragen-ui`: der Fragebogen in einem unsichtbaren Fenster, bedient mit echten Maus- und Tastenereignissen:
// Einzelwahl (Klick und Zifferntaste), Mehrfachwahl mit eigenem Text, Weiter/Senden, Überspringen, Schließen (alle überspringen).
@MainActor
enum SelfTestAsk {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    private final class FrameBox: @unchecked Sendable { var frames: [String: CGRect] = [:] }

    static let questions = [
        AskQuestion(question: "Welche Farbe?", options: [AskOption(label: "Blau", description: "ruhig", recommended: true), AskOption(label: "Rot", description: nil, recommended: false), AskOption(label: "Grün", description: nil, recommended: false)], multiple: false),
        AskQuestion(question: "Welche Formen?", options: [AskOption(label: "Kreis", description: nil, recommended: false), AskOption(label: "Dreieck", description: nil, recommended: false), AskOption(label: "Quadrat", description: nil, recommended: false)], multiple: true),
        AskQuestion(question: "Welche Größe?", options: [AskOption(label: "Klein", description: nil, recommended: false), AskOption(label: "Groß", description: nil, recommended: false)], multiple: false),
    ]

    static func run() async -> Int32 {
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String = "") { checks.append(Check(name: name, ok: ok, detail: detail)) }
        let size = CGSize(width: 800, height: 420)

        func session(_ body: (Driver) async -> Void) async {
            let driver = Driver(size: size)
            await driver.open()
            await body(driver)
            driver.close()
        }

        // Einzelwahl, Mehrfachwahl und erneut Einzelwahl.
        await session { d in
            check("Einzelwahl ohne Weiter", !d.has("ask-submit"))
            await d.click("ask-row-0")
            check("Einzelwahl geht direkt weiter", d.model.page == 1 && d.model.picked[0] == ["Blau"] && d.has("ask-submit"))
            await d.click("ask-row-0"); await d.click("ask-row-2")
            check("Mehrfachwahl wartet auf Weiter", d.model.page == 1 && d.model.picked[1] == ["Kreis", "Quadrat"] && d.model.buttonTitle == "Weiter (2)")
            await d.click("ask-field")
            for ch in "St1" { await d.key(String(ch), code: 0) }
            check("Eigener Text kommt dazu", d.model.custom == "St1" && d.model.buttonTitle == "Weiter (3)")
            await d.key("\r", code: 36)
            check("Enter geht zur dritten Frage ohne Weiter", d.model.page == 2 && !d.has("ask-submit"))
            await d.key("1", code: 18)
            let ok = d.submitted == [QuestionAnswer(question: "Welche Farbe?", answers: ["Blau"]), QuestionAnswer(question: "Welche Formen?", answers: ["Kreis", "Quadrat", "St1"]), QuestionAnswer(question: "Welche Größe?", answers: ["Klein"])]
            check("Zifferntaste sendet letzte Einzelwahl", ok)
        }
        // Eigener Text kann per Enter übernommen werden.
        await session { d in
            await d.click("ask-field")
            for ch in "Gelb" { await d.key(String(ch), code: 0) }
            check("Einzelwahl: eigener Text", d.model.choice == ["Gelb"] && d.has("ask-submit"))
            await d.click("ask-submit")
            check("Eigener Text übernommen", d.model.page == 1 && d.model.picked[0] == ["Gelb"] && d.model.custom.isEmpty)
        }
        // 3. Schließen überspringt alles.
        await session { d in
            await d.click("ask-skip")
            check("Schließen überspringt alle Fragen", d.skipped && d.submitted == nil, "übersprungen \(d.skipped)")
        }

        struct Report: Encodable { let ok: Bool; let checks: [Check] }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(Report(ok: checks.allSatisfy(\.ok), checks: checks)) { print(String(decoding: data, as: UTF8.self)) }
        return checks.allSatisfy(\.ok) ? 0 : 1
    }

    @MainActor
    final class Driver {
        let model = AskPanelModel(questions: SelfTestAsk.questions)
        var submitted: [QuestionAnswer]?
        var skipped = false
        private let box = FrameBox()
        private let size: CGSize
        private let window: NSWindow

        init(size: CGSize) {
            self.size = size
            window = NSWindow(contentRect: NSRect(origin: NSPoint(x: 200, y: 200), size: size), styleMask: [.titled], backing: .buffered, defer: false)
        }

        func open() async {
            window.appearance = NSAppearance(named: .darkAqua)
            let box = box
            let root = AskPanelView(model: model, onSubmit: { [weak self] in self?.submitted = $0 }, onSkip: { [weak self] in self?.skipped = true })
                .environment(\.layoutProbing, true)
                .frame(width: size.width, height: size.height, alignment: .bottom)
                .coordinateSpace(name: "orbit-window")
                .background(Theme.Palette.background)
                .onPreferenceChange(LayoutFrames.self) { box.frames = $0 }
            window.contentView = NSHostingView(rootView: AnyView(root))
            window.alphaValue = 0
            window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(800))
        }

        func close() { window.orderOut(nil) }

        func has(_ name: String) -> Bool { box.frames[name] != nil }

        func click(_ name: String) async {
            guard let frame = box.frames[name] else { return }
            // Fensterinhalt: SwiftUI-Ursprung oben links, AppKit unten links; Titelleiste liegt oberhalb der Inhaltsfläche.
            let content = window.contentLayoutRect
            let point = NSPoint(x: frame.midX, y: content.height - frame.midY)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                if let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                  windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                    window.sendEvent(event)
                }
                try? await Task.sleep(for: .milliseconds(60))
            }
            try? await Task.sleep(for: .milliseconds(250))
        }

        func key(_ characters: String, code: UInt16) async {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                    window.sendEvent(event)
                }
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }
}

final class SelfTestAskDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestAsk.run()) }
    }
}
