import XCTest

// Gemeinsame Menü-Komponente (Theme.Menu, WebMenuItem, MenuRows): Maße nach dem Grok-Bot-Menü und Trennlinien zwischen Gruppen.
final class MenuTests: XCTestCase {
    func testMeasuresFollowGrokMenu() {
        XCTAssertTrue(Theme.Menu.radius == 15)
        XCTAssertTrue(Theme.Menu.rowHeight == 35)
        XCTAssertTrue(Theme.Menu.iconSize == 17)
        // Inhalt 14 vom Rand: Rand bis Hover-Fläche + Hover-Fläche bis Symbol.
        XCTAssertTrue(Theme.Menu.padding + Theme.Menu.rowPaddingH == 14)
        // Hover-Ecken konzentrisch zur Menü-Ecke.
        XCTAssertTrue(Theme.Menu.rowRadius == Theme.Menu.radius - Theme.Menu.padding)
        XCTAssertTrue(Theme.Menu.wideWidth > Theme.Menu.minWidth)
    }

    func testSeparatorOnlyBetweenGroups() {
        let items = [WebMenuItem(title: "Erster", separatorBefore: true) {},
                     WebMenuItem(title: "Zweiter") {},
                     WebMenuItem(title: "Löschen", icon: "trash", destructive: true, separatorBefore: true) {}]
        let rows = MenuRows.rows(items)
        XCTAssertTrue(rows.map(\.separator) == [false, false, true])
        XCTAssertTrue(rows.map(\.item.title) == ["Erster", "Zweiter", "Löschen"])
        XCTAssertTrue(MenuRows.rows([]).isEmpty)
    }

    func testRowModelKeepsValueChevronAndDefaults() {
        let usage = WebMenuItem(title: "Nutzung", icon: "gauge.with.needle", value: "67 % genutzt", chevron: true) {}
        XCTAssertTrue(usage.value == "67 % genutzt" && usage.chevron)
        let plain = WebMenuItem(title: "Einmalig") {}
        XCTAssertTrue(plain.value == nil && !plain.chevron && !plain.destructive && !plain.checked && !plain.disabled)
    }
}
