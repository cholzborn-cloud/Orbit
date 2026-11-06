import Darwin
import Foundation

// Entwicklungsmodus: Läuft schon ein Dienst, wird er genutzt und nie beendet; sonst startet die App
// `npm run service` im Repo als Kindprozess und beendet ihn samt Unterprozessen mit sich.
final class ServiceProcess: @unchecked Sendable {
    private let client: ServiceClient
    private let lock = NSLock()
    private var child: Process?
    private(set) var startedByApp = false

    init(client: ServiceClient) { self.client = client }

    // Repo mit dem Dienst: Umgebung, dann Einstellung, dann Info.plist (zur Buildzeit gesetzt).
    static var repoURL: URL? {
        let environment = ProcessInfo.processInfo.environment["ORBIT_REPO_PATH"]
        let defaults = UserDefaults.standard.string(forKey: "repoPath")
        let plist = Bundle.main.object(forInfoDictionaryKey: "OrbitRepoPath") as? String
        guard let path = [environment, defaults, plist].compactMap({ $0 }).first(where: { !$0.isEmpty }) else { return nil }
        return URL(fileURLWithPath: path).standardizedFileURL
    }

    static var logURL: URL {
        ServiceClient.defaultDataDirectory.appending(path: "service-dev.log")
    }

    func ensureRunning(timeout: TimeInterval = 60) async throws {
        // Installierte App: der Dienst gehört launchd (läuft ohne App, startet beim Anmelden); die App richtet ihn nur ein.
        if let spec = LaunchAgent.bundled() {
            let agent = LaunchAgent()
            try agent.install(spec)
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                do { try await client.health(); return }
                catch ServiceError.noToken, ServiceError.offline { try await Task.sleep(for: .milliseconds(300)) }
            }
            let note = agent.isRunning ? "" : " Der Dienst läuft nicht (belegt ein anderer Dienst den Port?)."
            throw ServiceError.server(status: 0, message: "Der Dienst ist nach \(Int(timeout)) Sekunden nicht bereit.\(note) Log: \(spec.dataDirectory.appending(path: "orbitd-service.log").path)")
        }
        do {
            try await client.health()
            return
        } catch ServiceError.noToken, ServiceError.offline {
            // Kein Dienst da: starten.
        }
        try start()
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let message = exitMessage() { throw ServiceError.server(status: 0, message: message) }
            do {
                try await client.health()
                return
            } catch ServiceError.noToken, ServiceError.offline {
                try await Task.sleep(for: .milliseconds(300))
            }
        }
        shutdown()
        throw ServiceError.server(status: 0, message: "Der Dienst ist nach \(Int(timeout)) Sekunden nicht bereit. Log: \(Self.logURL.path)")
    }

    private func start() throws {
        guard let repo = Self.repoURL, FileManager.default.fileExists(atPath: repo.appending(path: "service/src/index.ts").path)
        else { throw ServiceError.server(status: 0, message: "Das Repo mit dem Dienst wurde nicht gefunden (ORBIT_REPO_PATH).") }
        let log = Self.logURL
        try FileManager.default.createDirectory(at: log.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let handle = try FileHandle(forWritingTo: log)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        // Login-Shell, damit Node aus Homebrew/nvm im PATH liegt; exec ersetzt die Shell durch npm.
        process.arguments = ["-l", "-c", "cd \"$ORBIT_REPO\" && exec npm run service"]
        var environment = ProcessInfo.processInfo.environment
        environment["ORBIT_REPO"] = repo.path
        process.environment = environment
        process.standardOutput = handle
        process.standardError = handle
        process.standardInput = FileHandle.nullDevice
        try process.run()
        lock.withLock {
            child = process
            startedByApp = true
        }
    }

    private func exitMessage() -> String? {
        guard let process = lock.withLock({ child }), !process.isRunning else { return nil }
        let tail = (try? String(contentsOf: Self.logURL, encoding: .utf8))?
            .split(separator: "\n").suffix(3).joined(separator: " | ") ?? ""
        return "Der Dienst wurde beendet (Code \(process.terminationStatus)). \(tail)"
    }

    // Nur den selbst gestarteten Dienst beenden, samt Unterprozessen (npm → tsx → node).
    func shutdown() {
        guard let process = lock.withLock({ () -> Process? in
            defer { child = nil }
            return child
        }) else { return }
        let pids = Self.descendants(of: process.processIdentifier) + [process.processIdentifier]
        for pid in pids.reversed() { kill(pid, SIGTERM) }
        let deadline = Date().addingTimeInterval(4)
        while Date() < deadline, pids.contains(where: { kill($0, 0) == 0 }) {
            usleep(100_000)
        }
        for pid in pids where kill(pid, 0) == 0 { kill(pid, SIGKILL) }
        process.waitUntilExit()
    }

    private static func descendants(of pid: Int32) -> [Int32] {
        let pgrep = Process()
        pgrep.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        pgrep.arguments = ["-P", String(pid)]
        let pipe = Pipe()
        pgrep.standardOutput = pipe
        pgrep.standardError = FileHandle.nullDevice
        guard (try? pgrep.run()) != nil else { return [] }
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        pgrep.waitUntilExit()
        let children = String(decoding: output, as: UTF8.self)
            .split(separator: "\n").compactMap { Int32($0) }
        return children + children.flatMap { descendants(of: $0) }
    }
}
