import XCTest

// Gemeinsame Menü-Komponente (Theme.Menu, WebMenuItem, MenuRows): kompakte Maße (Consti 15.11.2026) und Trennlinien zwischen Gruppen.
final class MenuTests: XCTestCase {
    // Maße nach Constis Vorlage (16.11.2026): Zeilen 34, Symbol 14 dünn, Symbol 15 und Text 37 vom Menürand.
    func testMeasuresMatchReference() {
        XCTAssertTrue(Theme.Menu.radius == 12)
        XCTAssertTrue(Theme.Menu.rowHeight == 34)
        XCTAssertTrue(Theme.Menu.iconSize == 14)
        XCTAssertTrue(Theme.Menu.iconWeight == .light)
        XCTAssertTrue(Theme.Menu.padding + Theme.Menu.rowPaddingH == 15)
        XCTAssertTrue(Theme.Menu.padding + Theme.Menu.rowPaddingH + Theme.Menu.iconFrame + Theme.Menu.gap == 37)
        // Hover-Ecken konzentrisch zur Menü-Ecke.
        XCTAssertTrue(Theme.Menu.rowRadius == Theme.Menu.radius - Theme.Menu.padding)
        XCTAssertTrue(Theme.Menu.wideWidth > Theme.Menu.minWidth)
    }

    // Von Codex Terra geschrieben (16.11.2026): gleitende Pille ohne gewählten Eintrag bleibt leer, Hover-Ecken konzentrisch.
    func testSlidingPillTargets() {
        var value = PillTargetKey.defaultValue
        XCTAssertTrue(value == nil)
        PillTargetKey.reduce(value: &value) { nil }
        XCTAssertTrue(value == nil)
        XCTAssertTrue(Theme.Menu.rowRadius == Theme.Menu.radius - Theme.Menu.padding)
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
