import Compression
import Foundation
import XCTest

// RFB-Dekoder (4e) mit zusammengesetzten Serverdaten, auch in Stücken geliefert; Tasten und Bildlage.
final class DesktopTests: XCTestCase {
    private func be16(_ v: Int) -> [UInt8] { [UInt8(v >> 8), UInt8(v & 255)] }
    private func be32(_ v: UInt32) -> [UInt8] { withUnsafeBytes(of: v.bigEndian, Array.init) }
    private func header(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ enc: Int32) -> [UInt8] { be16(x) + be16(y) + be16(w) + be16(h) + be32(UInt32(bitPattern: enc)) }
    private func update(_ rects: [[UInt8]]) -> [UInt8] { [0, 0] + be16(rects.count) + rects.flatMap { $0 } }
    private func px(_ rgb: UInt32) -> [UInt8] { [UInt8(rgb & 255), UInt8(rgb >> 8 & 255), UInt8(rgb >> 16 & 255), 0] }

    func testRawAndCopyRect() throws {
        let d = RFBDecoder(width: 4, height: 2)
        let raw = header(0, 0, 2, 1, 0) + px(0xFF0000) + px(0x00FF00)
        let copy = header(2, 0, 2, 1, 1) + be16(0) + be16(0)
        let out = try d.feed(Data(update([raw, copy])))
        XCTAssertTrue(out == [.updateFinished])
        XCTAssertTrue(d.framebuffer[0, 0] == 0xFF0000 && d.framebuffer[1, 0] == 0x00FF00 && d.framebuffer[2, 0] == 0xFF0000 && d.framebuffer[3, 0] == 0x00FF00)
        XCTAssertTrue(d.takeDirty() && !d.takeDirty())
    }

    func testHextileInPiecesGivesSameImage() throws {
        // 20×16: zwei Kacheln. Kachel 1: Hintergrund blau + ein farbiges Unterrechteck; Kachel 2 (4 breit): Raw.
        var tile1: [UInt8] = [2 | 8 | 16] + px(0x0000FF) + [1] + px(0xFFFFFF) + [0x11, 0x11]
        var tile2: [UInt8] = [1] + (0..<(4 * 16)).flatMap { _ in px(0x123456) }
        tile1 += []; tile2 += []
        let message = update([header(0, 0, 20, 16, 5) + tile1 + tile2])
        let whole = RFBDecoder(width: 20, height: 16)
        _ = try whole.feed(Data(message))
        let pieces = RFBDecoder(width: 20, height: 16)
        var events: [RFBDecoded] = []
        for byte in message { events += try pieces.feed(Data([byte])) }
        XCTAssertTrue(events == [.updateFinished])
        XCTAssertTrue(whole.framebuffer.difference(to: pieces.framebuffer) == 0)
        XCTAssertTrue(whole.framebuffer[0, 0] == 0x0000FF && whole.framebuffer[1, 1] == 0xFFFFFF && whole.framebuffer[3, 3] == 0x0000FF && whole.framebuffer[17, 5] == 0x123456)
    }

    func testCursorSizeAndCutText() throws {
        let d = RFBDecoder(width: 8, height: 8)
        let cursor = header(1, 2, 2, 1, -239) + px(0xFF0000) + px(0x00FF00) + [0b1000_0000]
        let size = header(0, 1, 16, 12, -308) + [1, 0, 0, 0] + be32(7) + be16(0) + be16(0) + be16(16) + be16(12) + be32(5)
        var out = try d.feed(Data(update([cursor, size])))
        guard case .cursor(let shape) = out[0] else { return XCTFail("kein Cursor") }
        XCTAssertTrue(shape.hotspotX == 1 && shape.hotspotY == 2 && shape.rgba == [255, 0, 0, 255, 0, 255, 0, 0])
        XCTAssertTrue(out[1] == .size(width: 16, height: 12, reason: 0, result: 1))
        XCTAssertTrue(d.framebuffer.width == 16 && d.screen?.id == 7 && d.screen?.flags == 5)
        out = try d.feed(Data([3, 0, 0, 0] + be32(3) + [0xE4, 0x62, 0x63]))
        XCTAssertTrue(out == [.cutText("äbc", truncated: false)])
    }

    func testZRLESolidAndPalettedTiles() throws {
        // Zwei 64×64-Kacheln nebeneinander: einfarbig rot, dann 2-Farben-Palette (grün/blau, Zeilen gepackt).
        var raw: [UInt8] = [1, 0, 0, 255]
        raw += [2, 0, 255, 0, 255, 0, 0]
        for row in 0..<64 { for byte in 0..<8 { raw.append(row % 2 == 0 ? 0xFF : 0x00); _ = byte } }
        // Apples ZLIB-Kodierung liefert rohes Deflate; ein zlib-Kopf (2 Byte) kommt davor.
        var compressed = [UInt8](repeating: 0, count: 4096)
        let n = raw.withUnsafeBufferPointer { compression_encode_buffer(&compressed, compressed.count, $0.baseAddress!, raw.count, nil, COMPRESSION_ZLIB) }
        XCTAssertTrue(n > 0)
        let payload: [UInt8] = [0x78, 0x9c] + compressed[0..<n]
        let d = RFBDecoder(width: 128, height: 64)
        let out = try d.feed(Data(update([header(0, 0, 128, 64, 16) + be32(UInt32(payload.count)) + payload])))
        XCTAssertTrue(out == [.updateFinished])
        XCTAssertTrue(d.framebuffer[10, 10] == 0xFF0000)
        XCTAssertTrue(d.framebuffer[64, 0] == 0x0000FF && d.framebuffer[64, 1] == 0x00FF00 && d.framebuffer[127, 62] == 0x0000FF)
    }

    func testUnknownInputIsAnError() {
        XCTAssertThrowsError(try RFBDecoder(width: 1, height: 1).feed(Data([9])))
        XCTAssertThrowsError(try RFBDecoder(width: 1, height: 1).feed(Data(update([header(0, 0, 1, 1, 99)]))))
    }

    func testMessagesAndClipboardLatin1() {
        XCTAssertTrue(RFBMessage.key(0xFF1B, down: true) == [4, 1, 0, 0, 0, 0, 0xFF, 0x1B])
        XCTAssertTrue(RFBMessage.pointer(x: 300, y: 5, buttons: 4) == [5, 4, 1, 44, 0, 5])
        let c = RFBMessage.clipboard("ä€")
        XCTAssertTrue(c.bytes == [6, 0, 0, 0, 0, 0, 0, 2, 0xE4, 0x3F] && c.lost == 1)
        XCTAssertTrue(RFBMessage.setDesktopSize(width: 1280, height: 800, screenId: 1, flags: 0).count == 24)
    }

    func testKeysAndGeometry() {
        XCTAssertTrue(DesktopKeys.keysym(forScalar: 0x61) == 0x61 && DesktopKeys.keysym(forScalar: 0xE4) == 0xE4 && DesktopKeys.keysym(forScalar: 0x20AC) == 0x0100_20AC)
        XCTAssertTrue(DesktopKeys.keysym(forScalar: 0x03) == nil)
        let rect = DesktopGeometry.fit(content: CGSize(width: 1024, height: 768), in: CGSize(width: 1000, height: 500))
        XCTAssertTrue(abs(rect.width - 666.67) < 0.1 && abs(rect.minX - 166.67) < 0.1)
        let p = DesktopGeometry.remote(CGPoint(x: 500, y: 250), content: CGSize(width: 1024, height: 768), in: CGSize(width: 1000, height: 500))
        XCTAssertTrue(p?.x == 512 && p?.y == 384)
        XCTAssertTrue(DesktopGeometry.remote(CGPoint(x: -50, y: 900), content: CGSize(width: 1024, height: 768), in: CGSize(width: 1000, height: 500))?.x == 0)
    }
}
