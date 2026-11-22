import AppKit
import Foundation
import UserNotifications

// Mitteilungen des Systems für Freigaben (Einmal / Immer / Ablehnen direkt in der Mitteilung), Rückfragen und fertige Automationen.
// Sie kommen aus `GET /v1/events`, laufen also auch bei geschlossenem Fenster. Ist die App gerade vorn, gibt es keine (man sieht es ja).
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private weak var model: AppModel?
    private var planner = NoticePlanner()
    private var started = false
    private(set) var authorized: Bool?
    private static let approvalCategory = "orbit.approval"
    private static let otherCategory = "orbit.other"

    func start(model: AppModel) {
        guard !started, Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else { return }
        started = true
        self.model = model
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.approvalCategory, actions: [
                UNNotificationAction(identifier: "once", title: "Einmal erlauben", options: []),
                UNNotificationAction(identifier: "always", title: "Immer für diese Art", options: []),
                UNNotificationAction(identifier: "deny", title: "Ablehnen", options: [.destructive]),
            ], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Self.otherCategory, actions: [], intentIdentifiers: [], options: []),
        ])
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
            Task { @MainActor in self?.authorized = granted }
        }
        model.events.onApplied = { [weak self] in self?.evaluate() }
        model.events.onAutomationDone = { [weak self] event in self?.automationDone(event) }
    }

    private func evaluate() {
        guard let model else { return }
        let notices = planner.notices(for: model.events.interactions, botName: { model.botStore.bot(id: $0)?.name })
        for notice in notices { post(notice) }
    }

    private func automationDone(_ event: AutomationEvent) {
        guard let model else { return }
        let automation = model.automations.items.first { $0.automation.id == event.automationId }?.automation
        if let notice = NoticePlanner.finished(event, automation: automation) { post(notice) }
    }

    private func post(_ notice: Notice) {
        guard !NSApp.isActive, authorized != false else { return }
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = .default
        content.categoryIdentifier = notice.kind == .approval ? Self.approvalCategory : Self.otherCategory
        content.userInfo = ["id": notice.id, "chatId": notice.chatId ?? "", "botId": notice.botId ?? ""]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: notice.id, content: content, trigger: nil))
    }

    // Klick auf eine Aktion der Mitteilung oder auf die Mitteilung selbst.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let id = info["id"] as? String ?? "", botId = info["botId"] as? String ?? "", chatId = info["chatId"] as? String ?? ""
        let action = response.actionIdentifier
        await MainActor.run {
            guard let model else { return }
            switch action {
            case "once": Task { await model.cards.decide(id, .once) }
            case "always": Task { await model.cards.decide(id, .always) }
            case "deny": Task { await model.cards.decide(id, .deny) }
            default:
                // Erst der Chat der Mitteilung (bei Rückfragen anderer Orbis der Root-Chat), sonst der Orbi.
                if chatId.isEmpty || !model.openChat(chatId, botId: botId.isEmpty ? nil : botId), let bot = model.botStore.bot(id: botId) { model.selection = .bot(bot.id) }
                NSApp.activate()
                if !NSApp.windows.contains(where: { $0.isVisible && $0.canBecomeMain }) { model.holdSelection = true; Notifier.reopenWindow() }
            }
        }
    }

    // Nur im Vordergrund einer sichtbaren App wäre das hier nötig; bei verdecktem Fenster zeigt das System den Banner selbst.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound] }

    // Ohne Fenster: dieselbe Reaktion wie ein Klick auf das Dock-Symbol (das System meldet der laufenden App „neu öffnen“).
    static func reopenWindow() {
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: NSWorkspace.OpenConfiguration())
    }
}
