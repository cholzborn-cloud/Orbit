import XCTest

@MainActor
final class BotRefreshTests: XCTestCase {
    private func bot(_ id: String, main: Bool) -> Bot {
        Bot(chatId: "chat-" + id, id: id, name: id, avatar: "strobi", color: nil, job: "Helfer", instructions: nil,
            isMain: main, look: nil, lastMessageAt: .distantPast)
    }

    func testConfirmedCreationSurvivesFailedRefresh() {
        let store = BotStore(client: ServiceClient())
        store.applySavedBot(bot("first", main: true))
        store.finishLoadFailure("Dienst kurz offline", silent: true)
        XCTAssertEqual(store.state, .loaded)
        XCTAssertEqual(store.main?.id, "first")
        XCTAssertEqual(store.refreshError, "Dienst kurz offline")
    }

    func testChangingMainKeepsPreviousBotAndConfirmedRename() {
        let store = BotStore(client: ServiceClient())
        store.applySavedBot(bot("old", main: true))
        store.applySavedBot(bot("new", main: true))
        store.finishLoadFailure("Offline", silent: true)
        XCTAssertEqual(store.main?.id, "new")
        XCTAssertEqual(store.bots.map(\.id), ["old"])
        XCTAssertFalse(store.bots[0].isMain)
    }

    func testInitialFailureStillShowsLoadError() {
        let store = BotStore(client: ServiceClient())
        store.finishLoadFailure("Offline", silent: true)
        XCTAssertEqual(store.state, .failed("Offline"))
    }

    func testFirstOrbiButtonRequiresLoadedEmptyList() {
        let store = BotStore(client: ServiceClient())
        XCTAssertFalse(store.canCreateFirstOrbi)
        store.finishLoadFailure("Offline", silent: false)
        XCTAssertFalse(store.canCreateFirstOrbi)
        store.simulate(BotsResponse(main: nil, bots: [], groups: []))
        XCTAssertTrue(store.canCreateFirstOrbi)
        store.applySavedBot(bot("first", main: true))
        XCTAssertFalse(store.canCreateFirstOrbi)
    }

    func testEditingNameAndJobKeepsOldInstructions() {
        let original = Bot(chatId: "chat", id: "old", name: "Alt", avatar: "strobi", color: nil, job: "Lernen",
                           instructions: "Alte Anweisung", isMain: false, look: nil, lastMessageAt: .distantPast)
        let editor = BotEditorModel(editing: original, others: [])
        editor.name = "Neu"
        editor.selectPreset("Recherche")
        XCTAssertEqual(editor.form.name, "Neu")
        XCTAssertEqual(editor.form.job, "Recherche")
        XCTAssertEqual(editor.form.instructions, "Alte Anweisung")
    }

}
