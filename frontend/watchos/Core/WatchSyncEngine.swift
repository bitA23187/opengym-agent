import Foundation

// Every continuation is fenced by generation. A disconnect can interrupt any awaited call.
actor WatchSyncEngine {
    private let health: any WatchHealthReading
    private let transport: any WatchTransporting
    private let storage: any WatchStoring
    private var configuration: WatchConfiguration?
    private var state: WatchState?
    private var loaded = false
    private var busy = false
    private var phase: String?
    private var generation = 0

    init(health: any WatchHealthReading, transport: any WatchTransporting, storage: any WatchStoring) {
        self.health = health; self.transport = transport; self.storage = storage
    }

    private func load() throws {
        guard !loaded else { return }
        do {
            let config = try storage.loadConfiguration()
            let saved = config == nil ? nil : try storage.loadState()
            configuration = config
            if let config { state = saved?.connectionID == config.id ? saved : WatchState(connectionID: config.id) }
            loaded = true
        } catch { throw WatchFailure.storage }
    }

    func snapshot() throws -> WatchSnapshot {
        try load()
        return WatchSnapshot(server: configuration?.server, owner: configuration?.owner, busy: busy, phase: phase, state: state)
    }

    private func check(_ version: Int) throws {
        try Task.checkCancellation()
        guard generation == version else { throw WatchFailure.stopped }
    }

    private func validate(_ config: WatchConfiguration) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["expected_owner": config.owner])
        let path = config.token.hasPrefix("ogw_") ? "/api/watch-devices/verify" : "/api/heart-rate/pending"
        let response = try await transport.post(config, path: path, body: body)
        struct Account: Decodable { let owner: String }
        let account: Account
        do { account = try JSONDecoder().decode(Account.self, from: response) }
        catch { throw WatchFailure.accountMismatch }
        guard account.owner == config.owner else { throw WatchFailure.accountMismatch }
    }

    func connect(server: String, owner: String, token: String) async throws {
        try load()
        guard !busy, configuration == nil else { throw WatchFailure.busy }
        let config = try WatchConfiguration.validated(server: server, owner: owner, token: token)
        busy = true; phase = "验证连接…"
        let version = generation
        defer { busy = false; phase = nil }
        try await validate(config)
        try check(version)
        let initial = WatchState(connectionID: config.id)
        do {
            // Configuration is the commit marker. An orphan state file has no credentials.
            try storage.saveState(initial)
            try storage.saveConfiguration(config)
        } catch { throw WatchFailure.storage }
        configuration = config; state = initial
    }

    func disconnect() throws {
        generation += 1
        transport.cancel()
        do { try storage.removeConfiguration() } catch { throw WatchFailure.storage }
        configuration = nil; state = nil; loaded = true
        do { try storage.removeState() } catch { throw WatchFailure.storage }
    }

    private func commit(_ next: WatchState) throws {
        do { try storage.saveState(next) } catch { throw WatchFailure.storage }
        state = next
    }

    private func record(_ error: Error, version: Int) {
        guard generation == version, var next = state else { return }
        next.error = WatchFailure.message(error)
        // In-memory error remains visible even when protected files cannot be written.
        state = next
        try? storage.saveState(next)
    }

    func inspect() async throws {
        try load()
        guard !busy else { throw WatchFailure.busy }
        guard configuration != nil else { throw WatchFailure.invalidConfiguration }
        let version = generation
        busy = true; phase = "请求健康读取…"
        defer { busy = false; phase = nil }
        do {
            try await health.authorize()
            try check(version)
            let earliest = await health.earliestDate()
            try check(version)
            phase = "检查本机数据…"
            let summaries = try await health.inspect(since: max(earliest, Date().addingTimeInterval(-7 * 86400)))
            try check(version)
            guard var next = state else { throw WatchFailure.stopped }
            next.summaries = summaries; next.earliest = earliest; next.inspectedAt = Date(); next.error = nil
            try commit(next)
        } catch { record(error, version: version); throw error }
    }

    func sync() async throws {
        try load()
        guard !busy else { throw WatchFailure.busy }
        guard let config = configuration else { throw WatchFailure.invalidConfiguration }
        let version = generation
        busy = true; phase = "验证连接…"
        defer { busy = false; phase = nil }
        do {
            // A previously verified connection may stage a local page while offline.
            // No replay or upload is allowed until ownership has been revalidated.
            var networkFailure: URLError?
            do { try await validate(config) }
            catch let error as URLError where error.code != .cancelled { networkFailure = error }
            try check(version)
            phase = "请求健康读取…"
            try await health.authorize()
            try check(version)
            let earliest = await health.earliestDate()
            try check(version)
            guard var next = state else { throw WatchFailure.stopped }
            next.earliest = earliest; next.uploaded = [:]; next.ignoredDeletions = 0; next.error = nil
            if next.pending == nil && next.anchors.isEmpty { next.since = max(next.since, earliest) }
            try commit(next)
            if let networkFailure {
                if next.pending == nil {
                    let metric = WatchMetric.uploads[0]
                    phase = "保存待传数据…"
                    let page = try await health.page(metric: metric, anchor: next.anchors[metric.rawValue], since: next.since)
                    try check(version)
                    guard page.pending.metric == metric.rawValue else { throw WatchFailure.invalidHealthData }
                    next.pending = WatchQueuedPage(pending: page.pending, sampleCount: page.sampleCount, ignoredDeletions: page.ignoredDeletions)
                    try commit(next)
                }
                throw networkFailure
            }
            try await flush(config, version: version)
            for metric in WatchMetric.uploads {
                while true {
                    try check(version)
                    guard let current = state else { throw WatchFailure.stopped }
                    phase = "读取\(metric.title)…"
                    let page = try await health.page(metric: metric, anchor: current.anchors[metric.rawValue], since: current.since)
                    try check(version)
                    guard page.pending.metric == metric.rawValue else { throw WatchFailure.invalidHealthData }
                    var queued = current
                    queued.pending = WatchQueuedPage(pending: page.pending, sampleCount: page.sampleCount, ignoredDeletions: page.ignoredDeletions)
                    // If persistence fails, never put these bytes on the network.
                    try commit(queued)
                    try await flush(config, version: version)
                    if !page.hasMore { break }
                }
            }
            try check(version)
            guard var completed = state else { throw WatchFailure.stopped }
            completed.lastSuccess = Date(); completed.error = nil
            try commit(completed)
        } catch { record(error, version: version); throw error }
    }

    private func flush(_ config: WatchConfiguration, version: Int) async throws {
        try check(version)
        guard let queued = state?.pending else { return }
        phase = "上传\(WatchMetric(rawValue: queued.pending.metric)?.title ?? "健康数据")…"
        let response = try await transport.post(config, path: "/api/daily-health/healthkit", body: queued.pending.body)
        try check(version)
        do { try HealthSyncProtocol.dailyAck(response, metric: queued.pending.metric) }
        catch { throw WatchFailure.invalidResponse }
        guard var next = state else { throw WatchFailure.stopped }
        next.anchors[queued.pending.metric] = queued.pending.anchor
        next.pending = nil
        next.uploaded[queued.pending.metric, default: 0] += queued.sampleCount
        next.ignoredDeletions += queued.ignoredDeletions
        // Commit last: a failed ACK write retains the original replayable page and anchor.
        try commit(next)
    }
}
