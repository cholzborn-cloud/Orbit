import XCTest

// Suchfeld der Seitenleiste: Textfeld (und damit Tastaturfokus) nur nach Klick hinein; jeder Fokusverlust und jede Chat-Wahl nimmt es weg.
@MainActor
final class SearchFocusTests: XCTestCase {
    func testFieldStartsInactive() {
        let search = SearchStore(client: ServiceClient())
        XCTAssertFalse(search.fieldActive)
        XCTAssertFalse(search.fieldFocused)
    }

    func testClickActivatesAndFocusLossDeactivates() {
        let search = SearchStore(client: ServiceClient())
        search.dismissed = true
        search.activateField()
        XCTAssertTrue(search.fieldActive)
        XCTAssertFalse(search.dismissed)
        search.fieldFocusChanged(true)
        XCTAssertTrue(search.fieldFocused)
        search.fieldFocusChanged(false)
        XCTAssertFalse(search.fieldActive)
        XCTAssertFalse(search.fieldFocused)
    }

    func testChatSelectionResignsFieldButKeepsQuery() {
        let search = SearchStore(client: ServiceClient())
        search.activateField()
        search.query = "rezept"
        search.resignField()
        XCTAssertFalse(search.fieldActive)
        XCTAssertTrue(search.dismissed)
        XCTAssertTrue(search.query == "rezept")
    }

    func testClickOutsideFieldAndResultsResigns() {
        let search = SearchStore(client: ServiceClient())
        search.fieldFrame = CGRect(x: 10, y: 50, width: 240, height: 24)
        search.popoverFrame = CGRect(x: 10, y: 82, width: 384, height: 200)
        search.activateField()
        search.windowClick(at: CGPoint(x: 100, y: 60))
        XCTAssertTrue(search.fieldActive, "Klick ins Feld")
        search.windowClick(at: CGPoint(x: 300, y: 150))
        XCTAssertTrue(search.fieldActive, "Klick in die Treffer")
        search.windowClick(at: CGPoint(x: 100, y: 500))
        XCTAssertFalse(search.fieldActive)
        XCTAssertTrue(search.dismissed)
    }
}
