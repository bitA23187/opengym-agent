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
    func cancel() { }
    func post(_ config: WatchConfiguration, path: String, body: Data) async throws -> Data {
        if path == "/api/heart-rate/pending" || path == "/api/watch-devices/verify" {
            if rejectAccount { throw WatchFailure.http(401) }
            if offlineAccount { throw URLError(.notConnectedToInternet) }
            return try JSONSerialization.data(withJSONObject: ["owner": owner])
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
            try require(transport.uploads.count == 4, "Full change page did not fetch next page")
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
        print("PASS: configuration, owner isolation, durable replay, strict ACK, disk failures, paging, deletion policy, revocation, disconnect races, state binding, diagnostics.")
    }
}
