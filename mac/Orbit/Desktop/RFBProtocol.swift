import Compression
import CoreGraphics
import Foundation

// RFB (VNC) für den Computer eines Orbis, Entscheidung B in plan/API.md: reiner Dekoder ohne Netz und ohne Uhr, damit er sich mit
// zusammengesetzten Serverdaten testen lässt (auch bei Lieferung in beliebig kleinen Stücken). Kodierungen: Raw, CopyRect, Hextile;
// Pseudo: Cursor, DesktopSize, ExtendedDesktopSize, LastRect, PointerPos. ZRLE nur, wenn eine Messung unter Last es verlangt.

enum RFBEncoding {
    static let raw: Int32 = 0, copyRect: Int32 = 1, hextile: Int32 = 5, zrle: Int32 = 16
    static let desktopSize: Int32 = -223, lastRect: Int32 = -224, cursor: Int32 = -239, xCursor: Int32 = -240
    static let pointerPos: Int32 = -232, extendedDesktopSize: Int32 = -308
    // Reihenfolge der Wünsche an den Server.
    static let preferred: [Int32] = [zrle, hextile, copyRect, raw, cursor, desktopSize, extendedDesktopSize, lastRect, pointerPos]
}

enum RFBError: LocalizedError, Equatable, Sendable {
    case unsupportedMessage(UInt8)
    case unsupportedEncoding(Int32)
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedMessage(let type): "Der Computer hat eine unbekannte Nachricht gesendet (Typ \(type))."
        case .unsupportedEncoding(let id): "Der Computer nutzt eine nicht unterstützte Bildkodierung (\(id))."
        case .invalid(let text): "Ungültige Daten vom Computer: \(text)"
        }
    }
}

// Cursor-Form vom Server (Pseudo-Kodierung): RGBA, Hotspot.
struct CursorShape: Sendable, Equatable {
    let width: Int
    let height: Int
    let hotspotX: Int
    let hotspotY: Int
    let rgba: [UInt8]
}

// Bild als Umschlag, damit es über Akteure wandern darf (CGImage ist unveränderlich).
struct FrameImage: @unchecked Sendable {
    let image: CGImage
}

// Pixel als 0x00RRGGBB, little endian (B, G, R, X im Speicher), passend zu SetPixelFormat. Alle Zugriffe begrenzt auf die Fläche.
// Als Sendable markiert, weil nur Kopien (`snapshot`) den Akteur verlassen.
final class PixelBuffer: @unchecked Sendable {
    private(set) var width: Int
    private(set) var height: Int
    private var pixels: UnsafeMutablePointer<UInt32>

    init(width: Int, height: Int) {
        self.width = max(0, width)
        self.height = max(0, height)
        pixels = .allocate(capacity: max(1, self.width * self.height))
        pixels.initialize(repeating: 0, count: max(1, self.width * self.height))
    }

    deinit { pixels.deallocate() }

    func resize(width: Int, height: Int) {
        // Gleiche Größe (der Server meldet sie nach dem Start nochmals): Bild behalten, sonst blitzt es schwarz.
        guard width != self.width || height != self.height else { return }
        pixels.deallocate()
        self.width = max(0, width)
        self.height = max(0, height)
        pixels = .allocate(capacity: max(1, self.width * self.height))
        pixels.initialize(repeating: 0, count: max(1, self.width * self.height))
    }

    subscript(x: Int, y: Int) -> UInt32 { x >= 0 && y >= 0 && x < width && y < height ? pixels[y * width + x] : 0 }

    func fill(x: Int, y: Int, w: Int, h: Int, color: UInt32) {
        let x0 = max(0, x), y0 = max(0, y), x1 = min(width, x + w), y1 = min(height, y + h)
        guard x0 < x1, y0 < y1 else { return }
        for row in y0..<y1 { (pixels + row * width + x0).update(repeating: color, count: x1 - x0) }
    }

    // `source` zeigt auf w·h Pixel (4 Byte je Pixel, little endian), Zeile für Zeile.
    func put(x: Int, y: Int, w: Int, h: Int, from source: UnsafeRawPointer) {
        let x0 = max(0, x), x1 = min(width, x + w)
        guard x0 < x1 else { return }
        for row in 0..<h {
            let ty = y + row
            guard ty >= 0, ty < height else { continue }
            memcpy(pixels + ty * width + x0, source + (row * w + (x0 - x)) * 4, (x1 - x0) * 4)
        }
    }

    // CopyRect: Quelle und Ziel dürfen sich überlappen (memmove je Zeile, Zeilenreihenfolge nach Richtung).
    func copy(fromX sx: Int, fromY sy: Int, toX x: Int, toY y: Int, w: Int, h: Int) {
        guard w > 0, h > 0, sx >= 0, sy >= 0, x >= 0, y >= 0 else { return }
        let columns = min(w, width - sx, width - x)
        guard columns > 0 else { return }
        for row in y > sy ? Array((0..<h).reversed()) : Array(0..<h) where sy + row < height && y + row < height {
            memmove(pixels + (y + row) * width + x, pixels + (sy + row) * width + sx, columns * 4)
        }
    }

    func makeImage() -> CGImage? {
        guard width > 0, height > 0 else { return nil }
        let data = Data(bytes: pixels, count: width * height * 4)
        guard let provider = CGDataProvider(data: data as CFData) else { return nil }
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info, provider: provider, decode: nil,
                       shouldInterpolate: true, intent: .defaultIntent)
    }

    // Anteil abweichender Pixel (0…1) gegen ein anderes Bild gleicher Größe, optional nur in einem Ausschnitt.
    func difference(to other: PixelBuffer, in rect: CGRect? = nil) -> Double {
        guard width == other.width, height == other.height, width > 0 else { return 1 }
        let r = rect.map { $0.intersection(CGRect(x: 0, y: 0, width: width, height: height)) } ?? CGRect(x: 0, y: 0, width: width, height: height)
        guard r.width > 0, r.height > 0 else { return 0 }
        var different = 0
        for y in Int(r.minY)..<Int(r.maxY) { for x in Int(r.minX)..<Int(r.maxX) where self[x, y] != other[x, y] { different += 1 } }
        return Double(different) / Double(Int(r.width) * Int(r.height))
    }

    func snapshot() -> PixelBuffer {
        let other = PixelBuffer(width: width, height: height)
        other.pixels.update(from: pixels, count: width * height)
        return other
    }
}

// Ereignisse des Dekoders, in der Reihenfolge der Serverdaten.
enum RFBDecoded: Equatable, Sendable {
    case updateFinished
    case cursor(CursorShape)
    case cutText(String, truncated: Bool)
    // Größe des Desktops: `reason` 0 Server, 1 auf unsere Bitte, 2 anderer Client; `result` 0 Erfolg (nur bei reason 1 aussagekräftig).
    case size(width: Int, height: Int, reason: Int, result: Int)
    case bell
}

// Zustandsautomat über der Byte-Reihenfolge des Servers. `feed` nimmt beliebig zerstückelte Daten.
final class RFBDecoder {
    let framebuffer: PixelBuffer
    // Erste Bildschirmkennung aus ExtendedDesktopSize (für SetDesktopSize), samt Flags.
    private(set) var screen: (id: UInt32, flags: UInt32)?
    private(set) var extendedClipboardSeen = false
    // Seit dem letzten `takeDirty` wurden Pixel verändert.
    private var dirty = false
    // Größenänderung seit der letzten Meldung; zählt erst, wenn schon Pixel gezeichnet wurden (sonst blitzt ein leeres Bild auf).
    private var resized = false
    private var drewPixels = false

    private struct Rect { var x, y, w, h: Int; var encoding: Int32 }
    private struct Hextile { var tile = 0; var background: UInt32 = 0; var foreground: UInt32 = 0 }
    private enum State {
        case messageType
        case updateHeader
        case rectHeader(remaining: Int)
        case rectBody(Rect, remaining: Int, Hextile)
        case cutHeader
        case cutBody(length: Int, extended: Bool)
    }

    private var buffer: [UInt8] = []
    // Ein zlib-Strom für die ganze Verbindung (ZRLE teilt ihn über alle Rechtecke).
    private let inflater = ZlibInflater()
    private var position = 0
    private var state = State.messageType

    init(width: Int, height: Int) { framebuffer = PixelBuffer(width: width, height: height) }

    // Zwischen zwei Nachrichten (kein Update halb angewendet).
    var isIdle: Bool { if case .messageType = state { true } else { false } }

    func takeDirty() -> Bool { defer { dirty = false; if drewPixels { resized = false } }; return dirty || (resized && drewPixels) }

    private var available: Int { buffer.count - position }

    func feed(_ data: Data) throws -> [RFBDecoded] {
        buffer.append(contentsOf: data)
        var out: [RFBDecoded] = []
        defer { compact() }
        while try step(&out) {}
        return out
    }

    private func compact() {
        if position == buffer.count { buffer.removeAll(keepingCapacity: true); position = 0 }
        else if position > 1 << 16 { buffer.removeSubrange(0..<position); position = 0 }
    }

    private func u16(_ offset: Int) -> Int { Int(buffer[position + offset]) << 8 | Int(buffer[position + offset + 1]) }
    private func u32(_ offset: Int) -> UInt32 {
        (0..<4).reduce(0) { $0 << 8 | UInt32(buffer[position + offset + $1]) }
    }
    private func pixel(_ offset: Int) -> UInt32 {
        UInt32(buffer[position + offset]) | UInt32(buffer[position + offset + 1]) << 8 | UInt32(buffer[position + offset + 2]) << 16 | UInt32(buffer[position + offset + 3]) << 24
    }

    // Ein Schritt; false = es fehlen Daten.
    private func step(_ out: inout [RFBDecoded]) throws -> Bool {
        switch state {
        case .messageType:
            guard available >= 1 else { return false }
            let type = buffer[position]
            position += 1
            switch type {
            case 0: state = .updateHeader
            case 2: out.append(.bell)
            case 3: state = .cutHeader
            default: throw RFBError.unsupportedMessage(type)
            }
        case .updateHeader:
            guard available >= 3 else { return false }
            let count = u16(1)
            position += 3
            if count == 0 { out.append(.updateFinished); state = .messageType } else { state = .rectHeader(remaining: count) }
        case .rectHeader(let remaining):
            guard available >= 12 else { return false }
            let rect = Rect(x: u16(0), y: u16(2), w: u16(4), h: u16(6), encoding: Int32(bitPattern: u32(8)))
            position += 12
            if rect.encoding == RFBEncoding.lastRect { out.append(.updateFinished); state = .messageType }
            else { state = .rectBody(rect, remaining: remaining, Hextile()) }
        case .rectBody(let rect, let remaining, var hextile):
            guard try decodeBody(rect, &hextile, &out) else {
                state = .rectBody(rect, remaining: remaining, hextile)
                return false
            }
            if remaining <= 1 { out.append(.updateFinished); state = .messageType } else { state = .rectHeader(remaining: remaining - 1) }
        case .cutHeader:
            guard available >= 7 else { return false }
            let length = Int32(bitPattern: u32(3))
            position += 7
            state = .cutBody(length: Int(length.magnitude), extended: length < 0)
        case .cutBody(let length, let extended):
            guard available >= length else { return false }
            let bytes = Array(buffer[position..<position + length])
            position += length
            state = .messageType
            if extended { extendedClipboardSeen = true } else {
                // Latin-1: jedes Byte ist ein Zeichen.
                out.append(.cutText(String(bytes.map { Character(Unicode.Scalar($0)) }), truncated: false))
            }
        }
        return true
    }

    // true = Rechteck fertig. Fehlen Daten, bleibt `position` unverändert (oder der Fortschritt steht in `hextile`).
    private func decodeBody(_ rect: Rect, _ hextile: inout Hextile, _ out: inout [RFBDecoded]) throws -> Bool {
        switch rect.encoding {
        case RFBEncoding.raw:
            let need = rect.w * rect.h * 4
            guard available >= need else { return false }
            buffer.withUnsafeBytes { framebuffer.put(x: rect.x, y: rect.y, w: rect.w, h: rect.h, from: $0.baseAddress! + position) }
            position += need
            dirty = true; drewPixels = true
        case RFBEncoding.copyRect:
            guard available >= 4 else { return false }
            framebuffer.copy(fromX: u16(0), fromY: u16(2), toX: rect.x, toY: rect.y, w: rect.w, h: rect.h)
            position += 4
            dirty = true; drewPixels = true
        case RFBEncoding.hextile:
            return decodeHextile(rect, &hextile)
        case RFBEncoding.zrle:
            guard available >= 4 else { return false }
            let length = Int(u32(0))
            guard available >= 4 + length else { return false }
            let compressed = Data(buffer[position + 4..<position + 4 + length])
            position += 4 + length
            try decodeZRLE(rect, try inflater.inflate(compressed))
            dirty = true; drewPixels = true
        case RFBEncoding.cursor:
            let mask = ((rect.w + 7) / 8) * rect.h
            let need = rect.w * rect.h * 4 + mask
            guard available >= need else { return false }
            var rgba = [UInt8](repeating: 0, count: rect.w * rect.h * 4)
            for row in 0..<rect.h {
                for column in 0..<rect.w {
                    let source = position + (row * rect.w + column) * 4
                    let bit = buffer[position + rect.w * rect.h * 4 + row * ((rect.w + 7) / 8) + column / 8] >> (7 - UInt8(column % 8)) & 1
                    let target = (row * rect.w + column) * 4
                    // Quelle ist B, G, R, X im Speicher.
                    rgba[target] = buffer[source + 2]; rgba[target + 1] = buffer[source + 1]; rgba[target + 2] = buffer[source]
                    rgba[target + 3] = bit == 1 ? 255 : 0
                }
            }
            position += need
            out.append(.cursor(CursorShape(width: rect.w, height: rect.h, hotspotX: rect.x, hotspotY: rect.y, rgba: rgba)))
        case RFBEncoding.xCursor:
            let need = rect.w == 0 || rect.h == 0 ? 0 : 6 + 2 * ((rect.w + 7) / 8) * rect.h
            guard available >= need else { return false }
            position += need
        case RFBEncoding.desktopSize:
            let changed = framebuffer.width != rect.w || framebuffer.height != rect.h
            framebuffer.resize(width: rect.w, height: rect.h)
            if changed { resized = true; drewPixels = false }
            out.append(.size(width: rect.w, height: rect.h, reason: 0, result: 0))
        case RFBEncoding.extendedDesktopSize:
            guard available >= 1 else { return false }
            let screens = Int(buffer[position])
            let need = 4 + screens * 16
            guard available >= need else { return false }
            if screens > 0 { screen = (u32(4), u32(4 + 12)) }
            position += need
            // x = Grund, y = Ergebnis (0 Erfolg; 1 verboten, 2 keine Mittel, 3 ungültige Anordnung).
            let changed = framebuffer.width != rect.w || framebuffer.height != rect.h
            framebuffer.resize(width: rect.w, height: rect.h)
            if changed { resized = true; drewPixels = false }
            out.append(.size(width: rect.w, height: rect.h, reason: rect.x, result: rect.y))
        case RFBEncoding.pointerPos:
            break
        default:
            throw RFBError.unsupportedEncoding(rect.encoding)
        }
        return true
    }

    // ZRLE: Kacheln zu 64×64, CPIXEL = 3 Byte (B, G, R). Modi: 0 roh, 1 einfarbig, 2–16 Palette gepackt, 128 Lauflängen, 130–255 Palette mit Läufen.
    private func decodeZRLE(_ rect: Rect, _ data: [UInt8]) throws {
        var o = 0
        func need(_ n: Int) throws { if o + n > data.count { throw RFBError.invalid("ZRLE-Daten zu kurz") } }
        func cpixel() throws -> UInt32 { try need(3); defer { o += 3 }; return UInt32(data[o]) | UInt32(data[o + 1]) << 8 | UInt32(data[o + 2]) << 16 }
        for ty in stride(from: 0, to: rect.h, by: 64) {
            for tx in stride(from: 0, to: rect.w, by: 64) {
                let tw = min(64, rect.w - tx), th = min(64, rect.h - ty)
                try need(1)
                let sub = data[o]; o += 1
                let rle = sub & 128 != 0, size = Int(sub & 127)
                var palette: [UInt32] = []
                if size > 1 && !(rle && size == 1) { for _ in 0..<size { palette.append(try cpixel()) } }
                var colors = [UInt32](repeating: 0, count: tw * th)
                func run() throws -> Int { var n = 1; while true { try need(1); let b = Int(data[o]); o += 1; n += b; if b != 255 { return n } } }
                switch (rle, size) {
                case (false, 0): for i in 0..<tw * th { colors[i] = try cpixel() }
                case (false, 1): let c = try cpixel(); colors = [UInt32](repeating: c, count: tw * th)
                case (false, 2...16):
                    let bits = size == 2 ? 1 : size <= 4 ? 2 : 4
                    for row in 0..<th {
                        var bitPos = 0
                        for column in 0..<tw {
                            try need(bitPos / 8 + 1)
                            let byte = data[o + bitPos / 8]
                            let index = Int(byte >> UInt8(8 - bits - bitPos % 8)) & ((1 << bits) - 1)
                            guard index < palette.count else { throw RFBError.invalid("ZRLE-Palette") }
                            colors[row * tw + column] = palette[index]
                            bitPos += bits
                        }
                        o += (bitPos + 7) / 8
                    }
                case (true, 0):
                    var i = 0
                    while i < tw * th { let c = try cpixel(); let n = try run(); for _ in 0..<n where i < tw * th { colors[i] = c; i += 1 } }
                case (true, 2...127):
                    var i = 0
                    while i < tw * th {
                        try need(1)
                        let index = Int(data[o] & 127), long = data[o] & 128 != 0
                        o += 1
                        guard index < palette.count else { throw RFBError.invalid("ZRLE-Palette") }
                        let n = long ? try run() : 1
                        for _ in 0..<n where i < tw * th { colors[i] = palette[index]; i += 1 }
                    }
                default: throw RFBError.invalid("ZRLE-Kachelart \(sub)")
                }
                colors.withUnsafeBytes { framebuffer.put(x: rect.x + tx, y: rect.y + ty, w: tw, h: th, from: $0.baseAddress!) }
            }
        }
    }

    // Kachelweise fortsetzbar: `hextile.tile` zählt fertige Kacheln, Vorder- und Hintergrundfarbe gelten über Kacheln hinweg.
    private func decodeHextile(_ rect: Rect, _ state: inout Hextile) -> Bool {
        let columns = (rect.w + 15) / 16, rows = (rect.h + 15) / 16
        while state.tile < columns * rows {
            let tx = (state.tile % columns) * 16, ty = (state.tile / columns) * 16
            let tw = min(16, rect.w - tx), th = min(16, rect.h - ty)
            guard available >= 1 else { return false }
            let sub = buffer[position]
            var offset = 1
            if sub & 1 != 0 {
                let need = 1 + tw * th * 4
                guard available >= need else { return false }
                buffer.withUnsafeBytes { framebuffer.put(x: rect.x + tx, y: rect.y + ty, w: tw, h: th, from: $0.baseAddress! + position + 1) }
                position += need
                state.tile += 1
                dirty = true; drewPixels = true
                continue
            }
            var background = state.background, foreground = state.foreground
            if sub & 2 != 0 { guard available >= offset + 4 else { return false }; background = pixel(offset); offset += 4 }
            if sub & 4 != 0 { guard available >= offset + 4 else { return false }; foreground = pixel(offset); offset += 4 }
            var count = 0
            let coloured = sub & 16 != 0
            if sub & 8 != 0 {
                guard available >= offset + 1 else { return false }
                count = Int(buffer[position + offset])
                offset += 1
                guard available >= offset + count * (coloured ? 6 : 2) else { return false }
            }
            framebuffer.fill(x: rect.x + tx, y: rect.y + ty, w: tw, h: th, color: background)
            for _ in 0..<count {
                var color = foreground
                if coloured { color = pixel(offset); offset += 4 }
                let xy = buffer[position + offset], wh = buffer[position + offset + 1]
                offset += 2
                framebuffer.fill(x: rect.x + tx + Int(xy >> 4), y: rect.y + ty + Int(xy & 15), w: Int(wh >> 4) + 1, h: Int(wh & 15) + 1, color: color)
            }
            state.background = background
            state.foreground = foreground
            position += offset
            state.tile += 1
            dirty = true; drewPixels = true
        }
        return true
    }
}

// Nachrichten an den Server (Client → Server) als fertige Bytes.
enum RFBMessage {
    // 32 bpp, little endian, R16 G8 B0.
    static let pixelFormat: [UInt8] = [0, 0, 0, 0, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]

    static func encodings(_ list: [Int32] = RFBEncoding.preferred) -> [UInt8] {
        var out: [UInt8] = [2, 0, UInt8(list.count >> 8), UInt8(list.count & 0xFF)]
        for encoding in list { out += withUnsafeBytes(of: encoding.bigEndian, Array.init) }
        return out
    }

    static func updateRequest(incremental: Bool, x: Int = 0, y: Int = 0, width: Int, height: Int) -> [UInt8] {
        [3, incremental ? 1 : 0, UInt8(x >> 8), UInt8(x & 0xFF), UInt8(y >> 8), UInt8(y & 0xFF),
         UInt8(width >> 8), UInt8(width & 0xFF), UInt8(height >> 8), UInt8(height & 0xFF)]
    }

    // Tasten als Maske (1 links, 2 Mitte, 4 rechts, 8/16 Rad hoch/runter).
    static func pointer(x: Int, y: Int, buttons: UInt8) -> [UInt8] {
        [5, buttons, UInt8(x >> 8), UInt8(x & 0xFF), UInt8(y >> 8), UInt8(y & 0xFF)]
    }

    static func key(_ keysym: UInt32, down: Bool) -> [UInt8] {
        [4, down ? 1 : 0, 0, 0] + withUnsafeBytes(of: keysym.bigEndian, Array.init)
    }

    // Zwischenablage nur als Latin-1 (Grundprotokoll). Zeichen außerhalb werden zu „?“; `lost` zählt sie.
    static func clipboard(_ text: String) -> (bytes: [UInt8], lost: Int) {
        var latin1: [UInt8] = []
        var lost = 0
        for scalar in text.unicodeScalars {
            if scalar.value < 256 { latin1.append(UInt8(scalar.value)) } else { latin1.append(0x3F); lost += 1 }
        }
        return ([6, 0, 0, 0] + withUnsafeBytes(of: UInt32(latin1.count).bigEndian, Array.init) + latin1, lost)
    }

    // SetDesktopSize mit einem Bildschirm (Kennung und Flags aus der letzten ExtendedDesktopSize).
    static func setDesktopSize(width: Int, height: Int, screenId: UInt32, flags: UInt32) -> [UInt8] {
        [251, 0, UInt8(width >> 8), UInt8(width & 0xFF), UInt8(height >> 8), UInt8(height & 0xFF), 1, 0]
            + withUnsafeBytes(of: screenId.bigEndian, Array.init) + [0, 0, 0, 0, UInt8(width >> 8), UInt8(width & 0xFF), UInt8(height >> 8), UInt8(height & 0xFF)]
            + withUnsafeBytes(of: flags.bigEndian, Array.init)
    }
}


// Entpackt den zlib-Strom von ZRLE über alle Rechtecke hinweg (Compression kennt nur rohes Deflate: die zwei Kopfbytes des Stroms entfallen).
final class ZlibInflater {
    private var stream = compression_stream(dst_ptr: UnsafeMutablePointer<UInt8>(bitPattern: 1)!, dst_size: 0, src_ptr: UnsafePointer<UInt8>(bitPattern: 1)!, src_size: 0, state: nil)
    private var ready = false
    private var headerSkipped = false

    deinit { if ready { compression_stream_destroy(&stream) } }

    func inflate(_ input: Data) throws -> [UInt8] {
        if !ready {
            guard compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else { throw RFBError.invalid("zlib") }
            ready = true
        }
        var bytes = [UInt8](input)
        if !headerSkipped { guard bytes.count >= 2 else { throw RFBError.invalid("ZRLE-Kopf") }; bytes.removeFirst(2); headerSkipped = true }
        var out: [UInt8] = []
        var chunk = [UInt8](repeating: 0, count: 1 << 16)
        try bytes.withUnsafeBufferPointer { source in
            stream.src_ptr = source.baseAddress ?? UnsafePointer(bitPattern: 1)!
            stream.src_size = source.count
            while true {
                let produced: Int = try chunk.withUnsafeMutableBufferPointer { destination in
                    stream.dst_ptr = destination.baseAddress!
                    stream.dst_size = destination.count
                    guard compression_stream_process(&stream, 0) != COMPRESSION_STATUS_ERROR else { throw RFBError.invalid("zlib-Strom") }
                    return destination.count - stream.dst_size
                }
                out += chunk[0..<produced]
                if stream.src_size == 0 && produced < chunk.count { break }
            }
        }
        return out
    }
}
