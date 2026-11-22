import Darwin
import Foundation

// Der Dienst läuft als LaunchAgent des Benutzers (launchctl bootstrap, bewusst nicht SMAppService: das braucht eine Team-ID).
// Er startet beim Anmelden und nach Abstürzen von selbst, unabhängig davon, ob die App offen ist.
struct LaunchAgent {
    struct Spec {
        let programArguments: [String]
        var migrations: URL?  // nur für Node
        let workingDirectory: URL
        let dataDirectory: URL
        var environment: [String: String] = [:]
    }

    static let defaultLabel = "de.consti.orbit2.service"
    var label = ProcessInfo.processInfo.environment["ORBIT_LAUNCH_LABEL"] ?? Self.defaultLabel

    var plistURL: URL { FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/LaunchAgents/\(label).plist") }
    private var domain: String { "gui/\(getuid())" }
    private var target: String { "\(domain)/\(label)" }

    // Dienst und Node-Laufzeit der installierten App (Contents/Resources); nil in der Entwicklung (dann startet ServiceProcess ihn selbst).
    static func bundled(bundle: Bundle = .main, data: URL = ServiceClient.defaultDataDirectory) -> Spec? {
        guard let resources = bundle.resourceURL else { return nil }
        let fm = FileManager.default
        var environment = ["PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"]
        for key in ["ORBIT_DATA_DIR", "ORBITD_PORT", "ORBIT_FAKE_SANDBOX"] { if let value = ProcessInfo.processInfo.environment[key] { environment[key] = value } }
        // Python-Dienst nur, wenn die Datei „runtime“ im Datenordner „python“ sagt und Interpreter und Paket im Bündel liegen; sonst Node wie bisher.
        let python = resources.appending(path: "runtime/python/bin/python3.13"), package = resources.appending(path: "service-py")
        if (try? String(contentsOf: data.appending(path: "runtime"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) == "python",
           fm.isExecutableFile(atPath: python.path), fm.fileExists(atPath: package.appending(path: "orbitd").path) {
            environment["PYTHONPATH"] = package.path
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            return Spec(programArguments: [python.path, "-m", "orbitd"], workingDirectory: data, dataDirectory: data, environment: environment)
        }
        let node = resources.appending(path: "runtime/node"), script = resources.appending(path: "service/orbitd.mjs")
        guard fm.isExecutableFile(atPath: node.path), fm.fileExists(atPath: script.path) else { return nil }
        // Übergang bis zum Aufräumen: liegt das Repo noch da, liefert dessen .env.local die Schlüssel, die secrets.env noch nicht hat.
        let repo = ServiceProcess.repoURL
        let workingDirectory = repo.flatMap { FileManager.default.fileExists(atPath: $0.appending(path: ".env.local").path) ? $0 : nil } ?? data
        // Grundanleitung (Kopie im Bündel, mac/scripts/build.sh); fehlt sie, gilt der Standardpfad des Dienstes.
        let agents = resources.appending(path: "rules/AGENTS.md")
        if FileManager.default.fileExists(atPath: agents.path) { environment["ORBIT_AGENTS_PATH"] = agents.path }
        return Spec(programArguments: [node.path, script.path], migrations: resources.appending(path: "service/drizzle/sqlite"), workingDirectory: workingDirectory, dataDirectory: data, environment: environment)
    }

    func plist(for spec: Spec) throws -> Data {
        var environment = spec.environment
        if let migrations = spec.migrations { environment["ORBIT_MIGRATIONS_DIR"] = migrations.path }
        let dictionary: [String: Any] = [
            "Label": label,
            "ProgramArguments": spec.programArguments,
            "WorkingDirectory": spec.workingDirectory.path,
            "EnvironmentVariables": environment,
            "RunAtLoad": true,
            "KeepAlive": true,
            "ThrottleInterval": 10,
            "StandardOutPath": spec.dataDirectory.appending(path: "orbitd-service.log").path,
            "StandardErrorPath": spec.dataDirectory.appending(path: "orbitd-service.log").path,
            // Systemeinstellungen → Anmeldeobjekte zeigen „Orbit“ statt „node“.
            "AssociatedBundleIdentifiers": ["de.consti.orbit2"],
        ]
        return try PropertyListSerialization.data(fromPropertyList: dictionary, format: .xml, options: 0)
    }

    // Schreibt die Plist (nur bei Änderung), lädt den Dienst und startet ihn, wenn er nicht läuft. Gibt zurück, ob etwas getan wurde.
    @discardableResult
    func install(_ spec: Spec) throws -> Bool {
        let wanted = try plist(for: spec)
        let existing = try? Data(contentsOf: plistURL)
        var changed = false
        if existing != wanted {
            try FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: spec.dataDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            if existing != nil { _ = Self.launchctl(["bootout", target]) }
            try wanted.write(to: plistURL, options: .atomic)
            changed = true
        }
        if !isLoaded {
            let result = Self.launchctl(["bootstrap", domain, plistURL.path])
            guard result.status == 0 else { throw ServiceError.server(status: 0, message: "Der Dienst ließ sich nicht laden (launchctl \(result.status)): \(result.output)") }
            changed = true
        } else if changed {
            _ = Self.launchctl(["kickstart", "-k", target])
        }
        return changed
    }

    func uninstall() {
        _ = Self.launchctl(["bootout", target])
        try? FileManager.default.removeItem(at: plistURL)
    }

    var isLoaded: Bool { Self.launchctl(["print", target]).status == 0 }

    // „state = running“ aus `launchctl print`: geladen heißt noch nicht, dass der Prozess lebt (Absturzschleife, belegter Port).
    var isRunning: Bool { Self.launchctl(["print", target]).output.contains("state = running") }

    @discardableResult
    static func launchctl(_ arguments: [String]) -> (status: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        guard (try? process.run()) != nil else { return (-1, "launchctl nicht startbar") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
