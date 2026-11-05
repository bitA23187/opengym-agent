import Foundation

// Real engine + JSON-on-disk store; network and HealthKit are the only substituted boundaries.
private final class DiskStore: WatchStoring {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("opengym-watch-tests-" + UUID().uuidString)
    var failNextStateWrite = false
    init() throws { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
    deinit { try? FileManager.default.removeItem(at: root) }
    func load<T: Decodable>(_ name: String) throws -> T? {
        let file = root.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: file.path) ? try JSONDecoder().decode(T.self, from: Data(contentsOf: file)) : nil
    }
    func save<T: Encodable>(_ value: T, _ name: String) throws {
        try JSONEncoder().encode(value).write(to: root.appendingPathComponent(name), options: .atomic)
    }
    func loadConfiguration() throws -> WatchConfiguration? { try load("config.json") }
    func saveConfiguration(_ value: WatchConfiguration) throws { try save(value, "config.json") }
    func removeConfiguration() throws { try remove("config.json") }
    func loadState() throws -> WatchState? { try load("state.json") }
    func saveState(_ value: WatchState) throws {
        if failNextStateWrite { failNextStateWrite = false; throw WatchFailure.storage }
        try save(value, "state.json")
    }
    func removeState() throws { try remove("state.json") }
    private func remove(_ name: String) throws {
        let file = root.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}

private actor Gate {
    var waiting: CheckedContinuation<Void, Never>?
    var observer: CheckedContinuation<Void, Never>?
    var entered = false
    var released = false
    func pause() async {
        entered = true; observer?.resume(); observer = nil
        if !released { await withCheckedContinuation { waiting = $0 } }
    }
    func waitUntilEntered() async {
        if !entered { await withCheckedContinuation { observer = $0 } }
    }
    func release() { released = true; waiting?.resume(); waiting = nil }
}

private final class Health: WatchHealthReading {
    var authorized = 0
    var reads = 0
    var sleepPages = [1]
    var deletions = 0
    var onPage: (() -> Void)?
    var workout: Data?
    var workoutReads = 0
    var onWorkout: (() -> Void)?
    func workoutBody(id: String, day: DateInterval, since: Date) async throws -> Data? {
        workoutReads += 1; onWorkout?(); return workout
    }
    func authorize() async throws { authorized += 1 }
    func earliestDate() async -> Date { Date().addingTimeInterval(-10 * 86400) }
    func inspect(since: Date) async throws -> [WatchMetricSummary] {
        reads += 1
        return WatchMetric.allCases.map { WatchMetricSummary(metric: $0, count: 0, truncated: false, latest: nil) }
    }
    func page(metric: WatchMetric, anchor: Data?, since: Date) async throws -> WatchPage {
        reads += 1
        let index = anchor.flatMap { String(data: $0, encoding: .utf8) }.flatMap(Int.init) ?? 0
        let count = metric == .sleep && index < sleepPages.count ? sleepPages[index] : 0
        let removed = metric == .sleep && index == 0 ? deletions : 0
        let samples: [[String: Any]] = (0..<count).map { _ in ["id": UUID().uuidString] }
        let body = try JSONSerialization.data(withJSONObject: ["metric": metric.rawValue, "samples": samples, "deleted": [String]()], options: .sortedKeys)
        onPage?()
        return WatchPage(pending: HealthPending(metric: metric.rawValue, body: body, anchor: Data("\(index + 1)".utf8)), sampleCount: count, ignoredDeletions: removed)
    }
}

private final class Transport: WatchTransporting {
    var owner = "test-owner"
    var offline = false
    var badAck = false
    var rejectAccount = false
    var offlineAccount = false
    var uploads: [Data] = []
    var gate: Gate?
    var beforeAck: (() -> Void)?
    var targets: [[String: String]] = []
    var workoutUploads: [Data] = []
    var workoutOffline = false
    var workoutBadAck = false
    var workoutSkip = false
    var beforeWorkoutAck: (() -> Void)?
    var workoutGate: Gate?
    func cancel() { }
    func post(_ config: WatchConfiguration, path: String, body: Data) async throws -> Data {
        if path == "/api/heart-rate/pending" || path == "/api/watch-devices/verify" {
            if rejectAccount { throw WatchFailure.http(401) }
            if offlineAccount { throw URLError(.notConnectedToInternet) }
            return try JSONSerialization.data(withJSONObject: ["owner": owner, "workouts": targets])
        }
        if path == "/api/heart-rate/import" {
            workoutUploads.append(body)
            if let workoutGate { await workoutGate.pause() }
            if workoutOffline { throw URLError(.networkConnectionLost) }
            beforeWorkoutAck?()
            if workoutBadAck { return Data(#"{"ok":true,"storedWorkouts":0}"#.utf8) }
            return workoutSkip ? Data(#"{"ok":true,"storedWorkouts":0,"skipped":"already_imported"}"#.utf8)
                : Data(#"{"ok":true,"storedWorkouts":1}"#.utf8)
        }
        uploads.append(body)
        if let gate { await gate.pause() }
        if offline { throw URLError(.notConnectedToInternet) }
        let request = try HealthSyncProtocol.object(body)
        beforeAck?()
        return try JSONSerialization.data(withJSONObject: ["ok": !badAck, "metric": request["metric"]!])
    }
}

@main struct WatchSyncTests {
    static let token = "ogh_" + String(repeating: "a", count: 43)
    static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw NSError(domain: message, code: 1) }
    }
    static func rejects(_ action: () async throws -> Void) async throws {
        do { try await action() } catch { return }
        throw NSError(domain: "Expected rejection", code: 1)
    }
    private static func connected(_ health: Health, _ transport: Transport, _ store: DiskStore) async throws -> WatchSyncEngine {
        let engine = WatchSyncEngine(health: health, transport: transport, storage: store)
        try await engine.connect(server: "https://gym.example/", owner: "test-owner", token: token)
        return engine
    }
    static func main() async throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let locale = Locale(identifier: "zh_CN")
        for seconds: Double in [-1, 0, 0.01, 30, 59.99] {
            try require(WatchRelativeTime.text(for: now.addingTimeInterval(-seconds), now: now, locale: locale) == "刚刚", "Recent sync showed seconds or future time")
        }
        for (seconds, components) in [(60.0, DateComponents(minute: -1)), (119.0, DateComponents(minute: -1)),
                                      (3600.0, DateComponents(hour: -1)), (86400.0, DateComponents(day: -1))] {
            let expected = RelativeDateTimeFormatter()
            expected.locale = locale; expected.unitsStyle = .full; expected.dateTimeStyle = .numeric
            try require(WatchRelativeTime.text(for: now.addingTimeInterval(-seconds), now: now, locale: locale) == expected.localizedString(from: components), "Relative time crossed unit boundary incorrectly")
        }
        // A timeout, DNS failure or certificate problem must not be diagnosed as no Wi-Fi.
        let offlineMessage = WatchFailure.message(URLError(.notConnectedToInternet))
        try require(offlineMessage.contains("iPhone"), "Offline guidance omits the paired phone route")
        for code: URLError.Code in [.timedOut, .cannotFindHost, .cannotConnectToHost, .secureConnectionFailed, .cancelled] {
            let message = WatchFailure.message(URLError(code))
            try require(message != offlineMessage && !message.contains("热点"), "Distinct network failure misreported as offline")
        }
        try require(WatchFailure.message(URLError(.timedOut)).contains("超时"), "Timeout reason lost")
        try require(WatchFailure.message(URLError(.secureConnectionFailed)).contains("HTTPS"), "TLS guidance lost")
        let config = try WatchConfiguration.validated(server: "https://GYM.example/", owner: "test-owner", token: "Bearer " + token)
        try require(config.server == "https://gym.example" && config.token == token, "Origin/token normalization failed")
        for url in ["http://gym.example", "https://user:pass@gym.example", "https://gym.example/path", "https://gym.example?secret=x", "https://gym.example#x", "https://gym.example:0", "https://gym.example/%2f"] {
            try await rejects { _ = try WatchConfiguration.validated(server: url, owner: "test-owner", token: token) }
        }
        try await rejects { _ = try WatchConfiguration.validated(server: "https://gym.example", owner: "", token: token) }
        try await rejects { _ = try WatchConfiguration.validated(server: "https://gym.example", owner: "x", token: "bad\r\nheader") }

        // QR credentials verify without depending on workout state or touching HealthKit.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = WatchSyncEngine(health: health, transport: transport, storage: store)
            try await engine.connect(server: "https://gym.example", owner: "test-owner", token: "ogw_" + String(repeating: "b", count: 43))
            try require(try store.loadConfiguration()?.token.hasPrefix("ogw_") == true, "Watch credential not persisted")
            try require(health.authorized == 0 && health.reads == 0 && transport.uploads.isEmpty, "QR binding accessed health data")
        }

        // Credentials for a different user must never be saved, authorized or read.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            transport.owner = "someone-else"
            try await rejects { _ = try await connected(health, transport, store) }
            try require(try store.loadConfiguration() == nil, "Wrong owner persisted credentials")
            try require(health.authorized == 0 && health.reads == 0, "Wrong owner reached HealthKit")
        }

        // Network loss stages bytes before sending. New engine must replay the exact bytes.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = try await connected(health, transport, store)
            transport.offline = true
            try await rejects { try await engine.sync() }
            let saved = try store.loadState()!
            try require(saved.pending != nil && saved.anchors.isEmpty, "Failed upload lost pending page or advanced anchor")
            let original = transport.uploads[0]
            let restarted = WatchSyncEngine(health: health, transport: transport, storage: store)
            transport.offline = false
            try await restarted.sync()
            try require(transport.uploads[1] == original, "Restart did not replay exact request bytes")
            let done = try store.loadState()!
            try require(done.pending == nil && done.lastSuccess != nil && done.anchors.count == 3, "Replay did not finish all metrics")
            try require(done.since >= Date().addingTimeInterval(-11 * 86400), "Platform history floor ignored")
        }

        // Rejected and malformed acknowledgements retain the original durable page.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = try await connected(health, transport, store)
            transport.badAck = true
            try await rejects { try await engine.sync() }
            let state = try store.loadState()!
            try require(state.pending != nil && state.anchors.isEmpty, "Bad ACK advanced cursor")
        }

        // Starting a sync offline still stages a page for an already verified account.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = try await connected(health, transport, store)
            transport.offlineAccount = true
            try await rejects { try await engine.sync() }
            let queued = try store.loadState()!.pending!.pending.body
            try require(transport.uploads.isEmpty && health.reads == 1, "Offline start sent data or failed to stage a page")
            let restarted = WatchSyncEngine(health: health, transport: transport, storage: store)
            transport.offlineAccount = false
            try await restarted.sync()
            try require(transport.uploads.first == queued, "Offline staged bytes did not replay")
            transport.offlineAccount = true
            try await restarted.inspect()
            let inspected = try await restarted.snapshot()
            try require(inspected.state?.summaries.count == 5, "Local diagnostics required a network")
        }

        // Server committed, then local disk failed: repeat that same batch next time.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = try await connected(health, transport, store)
            transport.beforeAck = { store.failNextStateWrite = true }
            try await rejects { try await engine.sync() }
            try require(try store.loadState()?.pending != nil, "ACK write failure discarded replay")
            transport.beforeAck = nil
            let original = transport.uploads[0]
            try await engine.sync()
            try require(transport.uploads[1] == original, "ACK write failure changed request bytes")
        }

        // Cannot persist a freshly queried batch: do not send it at all.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = try await connected(health, transport, store)
            health.onPage = { store.failNextStateWrite = true }
            try await rejects { try await engine.sync() }
            try require(transport.uploads.isEmpty, "Non-durable page was sent")
        }

        // Paging is per metric; ignored Watch deletion events are never forwarded.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            health.sleepPages = [498, 1]; health.deletions = 2
            let engine = try await connected(health, transport, store)
            try await engine.sync()
            let state = try store.loadState()!
            try require(state.uploaded["sleep"] == 499 && state.ignoredDeletions == 2, "Pagination/deletion accounting wrong")
            try require(transport.uploads.count == 2, "Empty pages sent uploads or full change page did not fetch next page")
            for bytes in transport.uploads {
                let body = try HealthSyncProtocol.object(bytes)
                try require((body["deleted"] as? [String])?.isEmpty == true, "Unverified Watch deletions forwarded")
            }
        }

        // Revocation on subsequent sync must block both replay and new reads.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            let engine = try await connected(health, transport, store)
            transport.rejectAccount = true
            try await rejects { try await engine.sync() }
            try require(health.reads == 0 && transport.uploads.isEmpty, "Revoked connection read/uploaded")
        }

        // Disconnect while upload awaits ACK: the late response cannot resurrect state.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport(), gate = Gate()
            let engine = try await connected(health, transport, store)
            transport.gate = gate
            let work = Task { try await engine.sync() }
            await gate.waitUntilEntered()
            try await rejects { try await engine.inspect() }
            try await engine.disconnect()
            await gate.release()
            try await rejects { try await work.value }
            try require(try store.loadConfiguration() == nil && store.loadState() == nil, "Late ACK restored cleared connection")
            transport.gate = nil
            try await engine.connect(server: "https://gym.example", owner: "test-owner", token: token)
            let fresh = try await engine.snapshot()
            try require(fresh.state?.anchors.isEmpty == true && fresh.pendingCount == 0, "New connection inherited old queue")
        }

        // A leftover state belonging to another connection must never replay.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            _ = try await connected(health, transport, store)
            var stale = WatchState(connectionID: UUID())
            stale.anchors["sleep"] = Data("wrong-user".utf8)
            try store.saveState(stale)
            let restored = WatchSyncEngine(health: health, transport: transport, storage: store)
            let snapshot = try await restored.snapshot()
            try require(snapshot.state?.anchors.isEmpty == true, "Mismatched state inherited another account's cursor")
            try await restored.inspect()
            let inspected = try await restored.snapshot()
            try require(inspected.state?.summaries.count == 5 && inspected.state?.lastSuccess == nil, "Inspection confused with upload success")
        }
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "yyyy-MM-dd"; dayFormatter.locale = Locale(identifier: "en_US_POSIX")
        let target = ["date": dayFormatter.string(from: Date()), "workout_id": "workout-1"]
        let workoutBytes = Data(#"{"client":"opengym-healthkit","workout_id":"workout-1","batch":true,"sync_workout_time":true,"samples":[{"at":"2026-11-02T09:00:00+08:00","bpm":120}],"apple_workout_id":["apple-1"],"started_at":["2026-11-02T08:00:00+08:00"],"ended_at":["2026-11-02T10:00:00+08:00"]}"#.utf8)

        // Upgrade an existing state file without any new workout fields or a new binding.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            _ = try await connected(health, transport, store)
            let restored = WatchSyncEngine(health: health, transport: transport, storage: store)
            let snapshot = try await restored.snapshot()
            try require(snapshot.connected && snapshot.pendingCount == 0 && snapshot.state?.storedWorkouts == nil, "Legacy state migration failed")
        }

        // Missing samples are skipped and queried again next manual sync; never manufacture a batch.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            transport.targets = [target]
            let engine = try await connected(health, transport, store)
            try await engine.sync()
            try require(transport.workoutUploads.isEmpty && store.loadState()?.skippedWorkouts == 1, "Empty workout sent or not counted")
            health.workout = workoutBytes
            try await engine.sync()
            try require(health.workoutReads == 2 && transport.workoutUploads == [workoutBytes], "Missing heart samples were not retried")
            try require(try store.loadState()?.storedWorkouts == 1, "Stored workout not reported")
        }

        // Query horizon matches iPhone; Watch cannot promise older HealthKit history.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            transport.targets = [["date": "2000-01-01", "workout_id": "old"]]
            let engine = try await connected(health, transport, store)
            try await engine.sync()
            try require(health.workoutReads == 0 && transport.workoutUploads.isEmpty, "Backfill queried beyond history horizon")
        }

        // Lost network/ACK or failed local commit must replay the same persisted workout bytes.
        for mode in ["network", "bad-ack", "disk"] {
            let store = try DiskStore(), health = Health(), transport = Transport()
            health.workout = workoutBytes; transport.targets = [target]
            let engine = try await connected(health, transport, store)
            transport.workoutOffline = mode == "network"
            transport.workoutBadAck = mode == "bad-ack"
            if mode == "disk" { transport.beforeWorkoutAck = { store.failNextStateWrite = true } }
            try await rejects { try await engine.sync() }
            try require(try store.loadState()?.pendingWorkout == workoutBytes, "Workout failure discarded pending bytes")
            let pending = try await engine.snapshot()
            try require(pending.pendingCount == 1, "Pending workout missing from status")
            transport.workoutOffline = false; transport.workoutBadAck = false; transport.beforeWorkoutAck = nil
            // The other device may already have filled this workout. Replay accepts only a strict skip ACK.
            transport.workoutSkip = true; transport.targets = []
            let restarted = WatchSyncEngine(health: health, transport: transport, storage: store)
            try await restarted.sync()
            try require(transport.workoutUploads == [workoutBytes, workoutBytes], "Workout replay changed bytes")
            try require(try store.loadState()?.pendingWorkout == nil && store.loadState()?.skippedWorkouts == 1, "Duplicate ACK did not finish replay")
        }

        // Nothing reaches the network until the workout is durably queued.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            health.workout = workoutBytes; transport.targets = [target]
            health.onWorkout = { store.failNextStateWrite = true }
            let engine = try await connected(health, transport, store)
            try await rejects { try await engine.sync() }
            try require(transport.workoutUploads.isEmpty, "Non-durable workout sent")
        }

        // Empty and deletion-only pages advance local anchors without HTTP uploads.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport()
            health.sleepPages = [0, 1]; health.deletions = 500
            let engine = try await connected(health, transport, store)
            try await engine.sync()
            try require(transport.uploads.count == 1 && store.loadState()?.ignoredDeletions == 500, "Empty/deletion-only page handling incorrect")
            try require(try store.loadState()?.uploaded["sleep"] == 1, "Deletion-only page truncated pagination")
        }

        // A late workout ACK after disconnect cannot restore another account's state.
        do {
            let store = try DiskStore(), health = Health(), transport = Transport(), gate = Gate()
            health.workout = workoutBytes; transport.targets = [target]; transport.workoutGate = gate
            let engine = try await connected(health, transport, store)
            let work = Task { try await engine.sync() }
            await gate.waitUntilEntered()
            try await engine.disconnect(); await gate.release()
            try await rejects { try await work.value }
            try require(try store.loadState() == nil && store.loadConfiguration() == nil, "Late workout ACK restored disconnected state")
        }
        print("PASS: daily and workout upload, migration, durable replay, strict ACK, empty pages, history horizon, disk failures, deduplication and disconnect isolation.")
    }
}
