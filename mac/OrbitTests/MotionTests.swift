import XCTest

// Bewegung wie die Web-UI: Kurven und Keyframes (der Kopf ist seit 04.11.2026 ein fester Streifen ohne Einrasten).
@MainActor
final class MotionTests: XCTestCase {
    func testCurvesMatchCSS() {
        let ease = Theme.Motion.panel
        XCTAssertEqual(ease.value(at: 0), 0, accuracy: 1e-6)
        XCTAssertEqual(ease.value(at: ease.duration), 1, accuracy: 1e-6)
        // cubic-bezier(.32,.72,0,1) ist nach 25 % der Zeit schon weit über die Hälfte.
        XCTAssertGreaterThan(ease.value(at: ease.duration * 0.25), 0.6)
        let linearish = Theme.Motion.Curve(x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75, duration: 1)
        XCTAssertEqual(linearish.value(at: 0.3), 0.3, accuracy: 1e-3)
    }

    func testTypingDotKeyframes() {
        XCTAssertEqual(Theme.Motion.dot(Theme.Motion.typingDot, at: 0.36, delay: 0)[0], -3, accuracy: 1e-6)   // 30 % von 1,2 s: oben
        XCTAssertEqual(Theme.Motion.dot(Theme.Motion.typingDot, at: 0.36, delay: 0)[1], 1, accuracy: 1e-6)
        XCTAssertEqual(Theme.Motion.dot(Theme.Motion.typingDot, at: 0.0, delay: 0.32)[1], 1, accuracy: 1e-6)  // vor dem Versatz: Grundstil
        XCTAssertEqual(Theme.Motion.dot(Theme.Motion.typingDot, at: 0.32, delay: 0.32)[1], 0.35, accuracy: 1e-6)
    }
}
