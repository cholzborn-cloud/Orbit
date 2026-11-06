import Foundation
import XCTest

// Anbieterliste: Decoding und Statustexte. Es gibt kein Feld für Werte, nur Namen fehlender Felder.
final class ProvidersTests: XCTestCase {
    func testDecodesProviderList() throws {
        let json = """
        {"ok":true,"providers":[
        {"id":"nango","label":"Nango","route":"nango","services":["Gmail","Slack"],"setup":[{"key":"secretKey","label":"Secret Key","secret":true}],"cost":"Gratis bis 10 Verbindungen","note":"Hinweis","configured":true,"connected":true,"missing":[]},
        {"id":"direct","label":"Direkt","route":"direct","services":[],"setup":[],"cost":"","note":"","configured":false,"connected":false,"missing":["token"]}]}
        """
        let response = try JSONDecoder().decode(ProvidersResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.providers.count, 2)
        XCTAssertEqual(response.providers[0].statusText, "Verbunden ✓")
        XCTAssertEqual(response.providers[0].routeText, "Über Nango")
        XCTAssertEqual(response.providers[0].setup.first?.secret, true)
        XCTAssertEqual(response.providers[1].statusText, "Einrichtung fehlt")
        XCTAssertEqual(response.providers[1].missing, ["token"])
    }

    func testReadResponseText() throws {
        let ok = try JSONDecoder().decode(ProviderReadResponse.self, from: Data(#"{"ok":true,"summary":"3 Mails"}"#.utf8))
        let bad = try JSONDecoder().decode(ProviderReadResponse.self, from: Data(#"{"ok":false,"error":"Nicht verbunden"}"#.utf8))
        XCTAssertEqual(ok.text, "3 Mails")
        XCTAssertEqual(bad.text, "Nicht verbunden")
    }
}
