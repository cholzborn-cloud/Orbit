import AppKit
import Foundation
import UniformTypeIdentifiers

// Bausteine des Composers (4c) nach plan/API.md und der Web-Vorlage: Modellkatalog, Freigabe-Modi, Slash-Skills, Anhänge.

// Modell aus GET /v1/models (lib/chat-catalog.ts). `auto` (Jev) steht nie in der Liste.
struct ModelInfo: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let description: String
    let provider: String
    let efforts: [String]

    static let autoId = "auto"
    static let providerNames = ["anthropic": "Anthropic", "openai": "OpenAI", "google": "Google"]
    static let providerOrder = ["anthropic", "openai", "google"]
    // Beschriftung der Stufen (EFFORT_LABELS im Web).
    static let effortLabels = ["low": "Low", "medium": "Mid", "high": "High", "xhigh": "XHigh", "max": "Max"]
    // Stufe, die ein Modell ohne gemerkte Wahl bekommt: Mid, sonst die erste.
    var defaultEffort: String? { efforts.contains("medium") ? "medium" : efforts.first }
}

struct ModelsResponse: Decodable, Sendable {
    let modelsAvailable: Bool
    let models: [ModelInfo]
}

// Gesamtzustand der Einstellungen, soweit der Composer ihn braucht (GET /v1/settings).
struct SettingsResponse: Decodable, Sendable {
    struct Values: Decodable, Sendable { let jevAuto: Bool? }
    let settings: Values
}

// Skill aus GET /v1/skills/slash.
struct SlashSkill: Decodable, Hashable, Sendable, Identifiable {
    let name: String
    let description: String
    let source: String  // "orbit" | "brain"
    var id: String { "\(source)-\(name)" }
}

struct SlashSkillsResponse: Decodable, Sendable {
    let skills: [SlashSkill]
    let brainOffline: Bool
}

struct BrainSkillResponse: Decodable, Sendable { let body: String? }

enum SlashMenuLogic {
    // Das Menü ist offen, solange der Text nur aus „/“ und einem Suchwort ohne Leerzeichen besteht (Web: /^\/([^\s]*)$/).
    static func query(in draft: String) -> String? {
        guard draft.hasPrefix("/"), !draft.dropFirst().contains(where: { $0.isWhitespace }) else { return nil }
        return String(draft.dropFirst())
    }

    // lib/skills/slash-filter.ts: Name und Beschreibung, Groß/Klein egal, Teiltreffer.
    static func filter(_ skills: [SlashSkill], query: String) -> [SlashSkill] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "^/", with: "", options: .regularExpression)
        // Leeres Suchwort („/“ allein) zeigt alle Skills; `contains("")` wäre in Swift falsch.
        guard !needle.isEmpty else { return skills }
        return skills.filter { "\($0.name) \($0.description)".lowercased().contains(needle) }
    }

    // `/skill neu <name>` legt einen Skill an (Web: Dialog „Neuer Skill“); der Dialog liegt in NewSkillDialog.swift.
    static func newSkillName(in draft: String) -> String? {
        draft.range(of: #"^/skill\s+neu\s+([a-z0-9-]{2,40})$"#, options: .regularExpression).map {
            String(draft[$0].split(separator: " ").last ?? "")
        }
    }
}

// Anhang im Entwurf. `data` ist schon verkleinert und endgültig, so wie es gesendet wird.
struct Attachment: Identifiable, Hashable, @unchecked Sendable {
    let id = UUID()
    var filename: String
    var mediaType: String
    var data: Data
    var thumbnail: NSImage?

    var isImage: Bool { mediaType.hasPrefix("image/") }
    var dataURL: String { "data:\(mediaType);base64,\(data.base64EncodedString())" }
    var part: [String: String] { ["type": "file", "mediaType": mediaType, "url": dataURL, "filename": filename] }
    static func == (a: Attachment, b: Attachment) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// Grenzen wie im Web: höchstens 10 Dateien, je 25 MB beim Hinzufügen, gesendet höchstens 2 MB; Fotos werden vorher auf die
// längste Seite 1600 px als JPEG (0,85) verkleinert (components/media.tsx: shrinkImage).
enum AttachmentRules {
    static let maxFiles = 10
    static let maxAddBytes = 25 * 1024 * 1024
    static let maxSendBytes = 2 * 1024 * 1024
    static let maxSide: CGFloat = 1600

    enum Failure: Error, Equatable {
        case tooMany, tooBig(name: String), tooBigToSend(name: String), unreadable(name: String)

        // Die Texte aus ATTACH_ERRORS und der Größenprüfung im Web.
        var text: String {
            switch self {
            case .tooMany: "Zu viele Dateien auf einmal."
            case .tooBig: "Datei ist zu groß."
            case .tooBigToSend(let name): "\(name) ist zu groß (max. \(formatBytes(maxSendBytes)))."
            case .unreadable(let name): "\(name) konnte nicht gelesen werden."
            }
        }
    }

    // formatBytes im Web (components/media.tsx): B, ganze KB, MB mit einer Nachkommastelle.
    static func formatBytes(_ bytes: Int) -> String {
        bytes < 1024 ? "\(bytes) B" : bytes < 1024 * 1024 ? "\(Int((Double(bytes) / 1024).rounded())) KB" : String(format: "%.1f MB", locale: Locale(identifier: "de_DE"), Double(bytes) / 1_048_576)
    }

    // Erster Anhang über der Sendegrenze (2 MB), sonst nil.
    static func oversize(_ attachments: [Attachment]) -> Attachment? { attachments.first { $0.data.count > maxSendBytes } }

    static func mediaType(for url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    private static let shrinkable = #"^image/(png|jpe?g|webp|heic|heif|bmp)$"#

    // Verkleinern: unverändert, wenn schon klein (≤ 1600 px und < 500 KB), sonst JPEG auf weißem Grund (längste Seite ≤ 1600).
    static func shrink(_ data: Data, filename: String, mediaType: String) -> (Data, String, String) {
        guard mediaType.range(of: shrinkable, options: .regularExpression) != nil,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? CGFloat, let height = props[kCGImagePropertyPixelHeight] as? CGFloat,
              width > 0, height > 0 else { return (data, filename, mediaType) }
        if max(width, height) <= maxSide && data.count < 500_000 { return (data, filename, mediaType) }
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                        kCGImageSourceThumbnailMaxPixelSize: maxSide]
        guard let thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let context = CGContext(data: nil, width: thumb.width, height: thumb.height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return (data, filename, mediaType) }
        let rect = CGRect(x: 0, y: 0, width: thumb.width, height: thumb.height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))  // JPEG kennt keine Transparenz
        context.fill(rect)
        context.draw(thumb, in: rect)
        guard let flat = context.makeImage(),
              let jpeg = NSBitmapImageRep(cgImage: flat).representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else { return (data, filename, mediaType) }
        let base = (filename as NSString).deletingPathExtension
        return (jpeg, "\(base.isEmpty ? "bild" : base).jpg", "image/jpeg")
    }

    // Bereitet eine Datei zum Anhängen vor: Größe beim Hinzufügen (25 MB), Verkleinern. Die 2-MB-Grenze gilt erst beim Senden
    // (`oversize`), wie im Web: dort bleibt dann die Eingabe samt Anhang erhalten.
    static func prepare(data: Data, filename: String, mediaType: String) -> Result<Attachment, Failure> {
        guard data.count <= maxAddBytes else { return .failure(.tooBig(name: filename)) }
        let (shrunk, name, type) = shrink(data, filename: filename, mediaType: mediaType)
        return .success(Attachment(filename: name, mediaType: type, data: shrunk, thumbnail: type.hasPrefix("image/") ? NSImage(data: shrunk) : nil))
    }
}

// Name der Datei im Entwurf, wenn die Zwischenablage keinen liefert (Web: „anhang.png“).
extension AttachmentRules {
    static func pastedName(mediaType: String) -> String {
        "einfügung.\(UTType(mimeType: mediaType)?.preferredFilenameExtension ?? "bin")"
    }
}

// `clientData.modelPinned` (Phase 2): nur senden, wenn Consti in der Modellauswahl dieses Chats ausdrücklich ein Modell gewählt hat.
// Auto (Jev), der Standard und eine fehlende Wahl senden nichts (nil), dann nutzt jeder geweckte Orbi sein eigenes Modell.
enum ModelPin {
    static func clientValue(pinned: Bool, isAuto: Bool) -> Bool? { pinned && !isAuto ? true : nil }
}
