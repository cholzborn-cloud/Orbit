import XCTest

final class SimilarityTests: XCTestCase {
    func testSamePlanetCloseHueIsTwin() {
        let a = OrbiLook(shape: .strobi, hue: 212), b = OrbiLook(shape: .strobi, hue: 222)
        XCTAssertTrue(Similarity.isTwin(a, b))
        XCTAssertLessThan(Similarity.hueDistance(a.oklchHue, b.oklchHue), 28)
    }

    func testDifferentPlanetNeverTwin() {
        XCTAssertFalse(Similarity.isTwin(OrbiLook(shape: .strobi, hue: 100), OrbiLook(shape: .kirby, hue: 100)))
    }

    func testFarHueIsNoTwin() {
        XCTAssertFalse(Similarity.isTwin(OrbiLook(shape: .strobi, hue: 212), OrbiLook(shape: .strobi, hue: 330)))
    }

    func testHueDistanceWrapsAroundZero() {
        XCTAssertEqual(Similarity.hueDistance(350, 10), 20)
        XCTAssertEqual(Similarity.hueDistance(10, 350), 20)
        XCTAssertEqual(Similarity.hueDistance(0, 180), 180)
    }

    func testNextFreeHueKeepsMinimumDistance() {
        let others = [100.0, 200].map { OrbiLook(shape: .strobi, hue: $0) }
        let me = OrbiLook(shape: .strobi, hue: 0)
        let free = Similarity.nextFreeHue(for: me, among: others)
        let candidate = OrbiLook(shape: .strobi, hue: free)
        for other in others {
            XCTAssertGreaterThanOrEqual(Similarity.hueDistance(candidate.oklchHue, other.oklchHue), Similarity.threshold)
        }
    }

    func testNextFreeHuePicksTheLargestGap() {
        // Zwei Figuren (OKLCH ca. 29° und 264°): die größte Lücke liegt dazwischen, nicht daneben.
        let a = OrbiLook(shape: .onee, hue: 0), b = OrbiLook(shape: .onee, hue: 200)
        let me = OrbiLook(shape: .onee, hue: 10)
        let free = OrbiLook(shape: .onee, hue: Similarity.nextFreeHue(for: me, among: [a, b]))
        let best = min(Similarity.hueDistance(free.oklchHue, a.oklchHue), Similarity.hueDistance(free.oklchHue, b.oklchHue))
        for step in stride(from: 0.0, to: 360, by: 5) {
            let other = OrbiLook(shape: .onee, hue: step)
            let distance = min(Similarity.hueDistance(other.oklchHue, a.oklchHue), Similarity.hueDistance(other.oklchHue, b.oklchHue))
            XCTAssertLessThanOrEqual(distance, best + 1.0, "Farbton \(step) wäre freier")
        }
    }

    func testNoCompetitorKeepsHue() {
        let me = OrbiLook(shape: .freddy, hue: 77)
        XCTAssertEqual(Similarity.nextFreeHue(for: me, among: [OrbiLook(shape: .strobi, hue: 77)]), 77)
    }

    func testLookFromServiceColor() {
        let look = OrbiLook(avatar: "nepi", colorHex: "#ec4899")
        XCTAssertEqual(look.shape, .trixi)
        XCTAssertEqual(look.hue, 330, accuracy: 1)
        XCTAssertEqual(look.saturation, 81, accuracy: 1)
        XCTAssertEqual(OrbiLook(avatar: "universi", colorHex: nil).shape, .sunee)
        XCTAssertEqual(OrbiLook(avatar: "erdi", colorHex: "kaputt").hue, OrbiShape.strobi.defaultHue)
    }

    func testIdenticalTwinIsAvoided() {
        // Ein Orbi mit genau derselben Farbe darf nicht mit dem Bearbeiteten verwechselt werden (früherer Fehler: beide gleich, beide gefiltert).
        let twin = OrbiLook(shape: .freddy), me = OrbiLook(shape: .freddy)
        let free = OrbiLook(shape: .freddy, hue: Similarity.nextFreeHue(for: me, among: [twin]), saturation: me.saturation)
        XCTAssertFalse(Similarity.isTwin(free, twin))
    }

    func testMentionPicksNamedMember() {
        let members = [GroupText.Member(id: "a", name: "Erdi"), GroupText.Member(id: "b", name: "Erdi 2")]
        XCTAssertEqual(GroupText.mentionTarget(in: "Hey @Erdi 2, los", members: members), "b")
        XCTAssertEqual(GroupText.mentionTarget(in: "@erdi hallo", members: members), "a")
        XCTAssertNil(GroupText.mentionTarget(in: "mail@erdi.de", members: members))
        XCTAssertNil(GroupText.mentionTarget(in: "@Erdix", members: members))
        XCTAssertNil(GroupText.mentionTarget(in: "ohne Erwähnung", members: members))
    }

    func testSenderTagStripped() {
        XCTAssertEqual(GroupText.stripSenderTag("[C++]: Hallo", names: ["C++", "Erdi"]), "Hallo")
        XCTAssertEqual(GroupText.stripSenderTag("  [Erdi]:   Hi", names: ["Erdi"]), "Hi")
        XCTAssertEqual(GroupText.stripSenderTag("Text [Erdi]: Mitte", names: ["Erdi"]), "Text [Erdi]: Mitte")
        XCTAssertEqual(GroupText.stripSenderTag("[Fremd]: x", names: ["Erdi"]), "[Fremd]: x")
    }

    func testServiceColorRoundTrip() {
        let look = OrbiLook(shape: .strobi, hue: 100, saturation: 70)
        let back = OrbiLook(avatar: "erdi", colorHex: look.serviceColorHex)
        XCTAssertEqual(back.hue, 100, accuracy: 2)
        XCTAssertEqual(back.saturation, 70, accuracy: 2)
        XCTAssertNil(OrbiLook(shape: .strobi).serviceLook)
    }
}
