import XCTest

private actor MockReminderService: ReminderService {
    private var jobs: [ReminderJob]
    private(set) var completed: [(String, ReminderResult)] = []
    init(_ jobs: [ReminderJob]) { self.jobs = jobs }
    func claimReminder() async throws -> ReminderJob? { jobs.isEmpty ? nil : jobs.removeFirst() }
    func completeReminder(id: String, result: ReminderResult) async throws { completed.append((id, result)) }
    func reminderIsActive(id: String) async throws -> Bool { true }
}

@MainActor private final class MockReminderAccess: ReminderAccess {
    private(set) var seen: [ReminderTask] = []
    func perform(_ task: ReminderTask, isActive: @escaping @MainActor () async -> Bool) async -> ReminderResult {
        seen.append(task)
        if task.kind == "list" { return ReminderResult(ok: true, items: [ReminderItem(title: "Buch", list: "Privat", due: nil, completed: false)]) }
        return ReminderResult(ok: true)
    }
}

@MainActor private final class WaitingReminderAccess: ReminderAccess {
    var started = false
    func perform(_ task: ReminderTask, isActive: @escaping @MainActor () async -> Bool) async -> ReminderResult {
        started = true
        do { try await Task.sleep(for: .seconds(30)) } catch { return ReminderResult(ok: false, error: "Abgebrochen") }
        return ReminderResult(ok: true)
    }
}

@MainActor final class ReminderBridgeTests: XCTestCase {
    func testCancellationStopsAnInFlightTask() async {
        let service = MockReminderService([ReminderJob(id: "stop", task: ReminderTask(kind: "create", title: "Test"))])
        let access = WaitingReminderAccess()
        let worker = ReminderWorker(service: service, access: access)
        let run = Task { await worker.drain() }
        while !access.started { await Task.yield() }
        worker.cancel("stop")
        await run.value
        let completed = await service.completed
        XCTAssertTrue(completed.isEmpty)
    }

    func testReadAndCreateUseMockAndAreCompletedOnce() async {
        let service = MockReminderService([
            ReminderJob(id: "1", task: ReminderTask(kind: "list", list: "Privat")),
            ReminderJob(id: "2", task: ReminderTask(kind: "create", title: "Anrufen")),
        ])
        let access = MockReminderAccess()
        let worker = ReminderWorker(service: service, access: access)
        await worker.drain()
        await worker.drain()
        let completed = await service.completed
        XCTAssertEqual(access.seen.map(\.kind), ["list", "create"])
        XCTAssertEqual(completed.map(\.0), ["1", "2"])
        XCTAssertEqual(completed[0].1.items?.first?.title, "Buch")
        XCTAssertTrue(completed[1].1.ok)
    }
}
