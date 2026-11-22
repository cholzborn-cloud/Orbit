import AppKit
import ApplicationServices
import CoreGraphics
import CoreServices
import Quartz
import UniformTypeIdentifiers

@_cdecl("orbit_request_permission")
public func requestOrbitPermission(_ rawKind: UnsafePointer<CChar>, _ rawTarget: UnsafePointer<CChar>?) -> Int32 {
    switch String(cString: rawKind) {
    case "accessibility":
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: true] as CFDictionary) ? 1 : 0
    case "screen":
        return CGRequestScreenCaptureAccess() ? 1 : 0
    case "automation":
        guard let rawTarget else { return -1 }
        let target = Array(String(cString: rawTarget).utf8)
        var address = AEAddressDesc()
        let created = target.withUnsafeBytes { bytes in
            AECreateDesc(0x62756E64, bytes.baseAddress, bytes.count, &address) // 'bund'
        }
        guard created == noErr else { return -1 }
        defer { AEDisposeDesc(&address) }
        let result = AEDeterminePermissionToAutomateTarget(&address, 0x2A2A2A2A, 0x2A2A2A2A, true) // '****'
        switch result {
        case noErr: return 1
        case -1743, -1744: return 0
        case -600: return -600
        default: return -1
        }
    default:
        return -1
    }
}

private final class OrbitDragView: NSView, NSDraggingSource {
    private let appURL: URL
    private let icon: NSImage

    init(appURL: URL, hint text: String) {
        self.appURL = appURL
        self.icon = NSWorkspace.shared.icon(forFile: appURL.path)
        super.init(frame: NSRect(x: 0, y: 0, width: 242, height: 148))
        let image = NSImageView(frame: NSRect(x: 91, y: 78, width: 60, height: 60))
        image.image = icon
        image.imageScaling = .scaleProportionallyUpOrDown
        addSubview(image)
        let label = NSTextField(labelWithString: "Orbit.app")
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.alignment = .center
        label.frame = NSRect(x: 0, y: 54, width: 242, height: 18)
        addSubview(label)
        let hint = NSTextField(wrappingLabelWithString: text)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .center
        hint.frame = NSRect(x: 20, y: 10, width: 202, height: 38)
        addSubview(hint)
        setAccessibilityLabel("Orbit.app zum Ziehen")
    }

    required init?(coder: NSCoder) { nil }

    // The entire small panel body is a drag target.
    override func hitTest(_ point: NSPoint) -> NSView? {
        bounds.contains(convert(point, from: superview)) ? self : nil
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDragged(with event: NSEvent) {
        let item = NSDraggingItem(pasteboardWriter: appURL as NSURL)
        let point = convert(event.locationInWindow, from: nil)
        item.setDraggingFrame(NSRect(x: point.x - 24, y: point.y - 24, width: 48, height: 48), contents: icon)
        beginDraggingSession(with: [item], event: event, source: self)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        [.copy, .link]
    }

    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        if !operation.isEmpty { window?.close() }
    }
}

@MainActor private var orbitPermissionPanel: NSPanel?

@MainActor
@_cdecl("orbit_show_permission_drag")
public func showOrbitPermissionDrag(_ rawPath: UnsafePointer<CChar>, _ rawList: UnsafePointer<CChar>) {
    orbitPermissionPanel?.close()
    let view = OrbitDragView(appURL: URL(fileURLWithPath: String(cString: rawPath), isDirectory: true),
                             hint: "Zieh das Symbol in die Liste für \(String(cString: rawList)).")
    let panel = NSPanel(contentRect: view.frame, styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.title = "Orbit hinzufügen"
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.contentView = view
    panel.center()
    if let visible = NSScreen.main?.visibleFrame {
        let origin = NSPoint(x: visible.maxX - panel.frame.width - 24, y: visible.midY - panel.frame.height / 2)
        panel.setFrameOrigin(origin)
    }
    orbitPermissionPanel = panel
    panel.orderFrontRegardless()
}

private final class OrbitFilePreview: NSObject, NSWindowDelegate {
    static let shared = OrbitFilePreview()
    private var window: NSWindow?
    private var directory: URL?

    func show(data: Data, name: String, mime: String) throws {
        window?.close()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("OrbitPreview-\(UUID())", isDirectory: true)
        let base = (name.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
        var filename = base.isEmpty || [".", "..", "/"].contains(base) ? "Datei" : String(base.prefix(180))
        if (filename as NSString).pathExtension.isEmpty, let ext = UTType(mimeType: mime)?.preferredFilenameExtension {
            filename += "." + ext
        }
        let file = directory.appendingPathComponent(filename, isDirectory: false)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            try data.write(to: file, options: [.atomic])
            let frame = NSRect(x: 0, y: 0, width: 820, height: 620)
            guard let view = QLPreviewView(frame: frame, style: .normal) else {
                throw CocoaError(.fileReadUnknown)
            }
            view.previewItem = file as NSURL
            let panel = NSPanel(contentRect: frame, styleMask: [.titled, .closable, .resizable, .utilityWindow], backing: .buffered, defer: false)
            panel.title = name
            panel.contentView = view
            panel.delegate = self
            panel.isReleasedWhenClosed = false
            self.directory = directory
            window = panel
            panel.center()
            panel.makeKeyAndOrderFront(nil)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    func windowWillClose(_ notification: Notification) {
        (window?.contentView as? QLPreviewView)?.close()
        window = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
    }
}

@_cdecl("orbit_preview_attachment")
public func previewOrbitAttachment(_ contents: UnsafePointer<CChar>, _ name: UnsafePointer<CChar>, _ mime: UnsafePointer<CChar>) -> Int32 {
    guard let data = Data(base64Encoded: String(cString: contents)), data.count <= 10 * 1024 * 1024 else { return 0 }
    do {
        try OrbitFilePreview.shared.show(data: data, name: String(cString: name), mime: String(cString: mime))
        return 1
    } catch {
        return 0
    }
}
