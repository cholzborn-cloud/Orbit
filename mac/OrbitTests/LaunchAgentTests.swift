import XCTest

// Laufzeit-Wahl des LaunchAgents: Node bleibt der Standard (Plist unverändert), Python nur mit Datei, Interpreter und Paket.
final class LaunchAgentTests: XCTestCase {
    private var root: URL!
    private var data: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appending(path: "orbit-la-\(UUID().uuidString)")
        data = root.appending(path: "data")
        let fm = FileManager.default
        try fm.createDirectory(at: data, withIntermediateDirectories: true)
        let res = root.appending(path: "Test.bundle/Contents/Resources")
        try fm.createDirectory(at: res.appending(path: "service/drizzle/sqlite"), withIntermediateDirectories: true)
        try fm.createDirectory(at: res.appending(path: "runtime"), withIntermediateDirectories: true)
        try Data("""
        <?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.la</string></dict></plist>
        """.utf8).write(to: root.appending(path: "Test.bundle/Contents/Info.plist"))
        try executable(res.appending(path: "runtime/node"))
        try Data().write(to: res.appending(path: "service/orbitd.mjs"))
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    private var resources: URL { root.appending(path: "Test.bundle/Contents/Resources") }
    private var bundle: Bundle { Bundle(url: root.appending(path: "Test.bundle"))! }

    private func executable(_ url: URL) throws {
        try Data().write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }

    private func addPython(interpreter: Bool = true, package: Bool = true) throws {
        let fm = FileManager.default
        if interpreter {
            try fm.createDirectory(at: resources.appending(path: "runtime/python/bin"), withIntermediateDirectories: true)
            try executable(resources.appending(path: "runtime/python/bin/python3.13"))
        }
        if package { try fm.createDirectory(at: resources.appending(path: "service-py/orbitd"), withIntermediateDirectories: true) }
    }

    private func marker(_ text: String) throws { try Data(text.utf8).write(to: data.appending(path: "runtime")) }

    func testNodeIsDefaultWithUnchangedPlist() throws {
        let spec = try XCTUnwrap(LaunchAgent.bundled(bundle: bundle, data: data))
        XCTAssertEqual(spec.programArguments, [resources.appending(path: "runtime/node").path, resources.appending(path: "service/orbitd.mjs").path])
        let plist = try PropertyListSerialization.propertyList(from: LaunchAgent().plist(for: spec), format: nil) as? [String: Any]
        let environment = try XCTUnwrap(plist?["EnvironmentVariables"] as? [String: String])
        XCTAssertEqual(environment["ORBIT_MIGRATIONS_DIR"], resources.appending(path: "service/drizzle/sqlite").path)
        XCTAssertNil(environment["PYTHONPATH"])
        XCTAssertEqual(plist?["ProgramArguments"] as? [String], spec.programArguments)
    }

    func testPythonNeedsFileInterpreterAndPackage() throws {
        try marker("python\n")
        try addPython(interpreter: false)
        XCTAssertEqual(LaunchAgent.bundled(bundle: bundle, data: data)?.programArguments.first, resources.appending(path: "runtime/node").path)
        try FileManager.default.removeItem(at: resources.appending(path: "service-py"))
        try addPython(package: false)
        XCTAssertEqual(LaunchAgent.bundled(bundle: bundle, data: data)?.programArguments.first, resources.appending(path: "runtime/node").path)
        try addPython()
        let spec = try XCTUnwrap(LaunchAgent.bundled(bundle: bundle, data: data))
        XCTAssertEqual(spec.programArguments, [resources.appending(path: "runtime/python/bin/python3.13").path, "-m", "orbitd"])
        XCTAssertEqual(spec.environment["PYTHONPATH"], resources.appending(path: "service-py").path)
        XCTAssertEqual(spec.environment["PYTHONDONTWRITEBYTECODE"], "1")
        XCTAssertNil(spec.environment["ORBIT_AGENTS_PATH"])
        let plist = try PropertyListSerialization.propertyList(from: LaunchAgent().plist(for: spec), format: nil) as? [String: Any]
        XCTAssertNil((plist?["EnvironmentVariables"] as? [String: String])?["ORBIT_MIGRATIONS_DIR"])
    }

    func testOtherFileContentMeansNode() throws {
        try addPython()
        for text in ["node", "Python", "python3", ""] {
            try marker(text)
            XCTAssertEqual(LaunchAgent.bundled(bundle: bundle, data: data)?.programArguments.first, resources.appending(path: "runtime/node").path, text)
        }
        try FileManager.default.removeItem(at: data.appending(path: "runtime"))
        XCTAssertEqual(LaunchAgent.bundled(bundle: bundle, data: data)?.programArguments.first, resources.appending(path: "runtime/node").path)
    }
}
