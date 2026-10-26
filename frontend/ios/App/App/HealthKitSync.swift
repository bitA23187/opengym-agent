import Foundation
import HealthKit
import Security
import BackgroundTasks

// Never forward the upload credential to an HTTP redirect destination.
private final class HealthNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

actor HealthKitSync {
    static let shared = HealthKitSync()
    private let health = HKHealthStore()
    private var configuration: HealthConfiguration?
    private var state = HealthSyncState()
    private var observers: [HKObserverQuery] = []
    private var running = false
    private var configuring = false
    private var resyncRequested = false
    private var syncWaiters: [CheckedContinuation<Void, Never>] = []
    private var loaded = false
    private var epoch = 0
    private let delegate = HealthNoRedirect()
    private var session: URLSession?
    private let keychain: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "opengym.healthkit", kSecAttrAccount as String: "upload"]
    private var file: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("healthkit-sync.json") }
    private var types: [(String, HKSampleType)] {
        [("sleep", HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!),
         ("restingHeartRate", HKObjectType.quantityType(forIdentifier: .restingHeartRate)!),
         ("hrv", HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!)]
    }
    private var observedTypes: [HKSampleType] {
        types.map { $0.1 } + [HKObjectType.workoutType(), HKObjectType.quantityType(forIdentifier: .heartRate)!]
    }
    private var readTypes: Set<HKObjectType> {
        Set(types.map { $0.1 as HKObjectType } + [HKObjectType.workoutType(), HKObjectType.quantityType(forIdentifier: .heartRate)!])
    }
    private func check(_ config: HealthConfiguration, _ version: Int) throws {
        try Task.checkCancellation()
        guard configuration == config, epoch == version else { throw HealthSyncFailure.stopped }
    }
    private func load() throws {
        if loaded { return }
        var query = keychain
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data {
            configuration = try JSONDecoder().decode(HealthConfiguration.self, from: data)
            if FileManager.default.fileExists(atPath: file.path) { state = try JSONDecoder().decode(HealthSyncState.self, from: Data(contentsOf: file)) }
        } else if status != errSecItemNotFound { throw HealthSyncFailure.storage }
        loaded = true
    }
    private func persist() throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var url = file; try url.setResourceValues(values)
    }
    nonisolated static let refreshIdentifier = "ch.duartesantos.opengym.health-refresh"
    nonisolated static let stateChanged = Notification.Name("OpenGymHealthSyncChanged")
    private func notifyStateChanged() { NotificationCenter.default.post(name: Self.stateChanged, object: nil) }
    nonisolated static func registerBackgroundRefresh() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshIdentifier, using: nil) { task in
            let work = Task {
                let success = await shared.boot()
                task.setTaskCompleted(success: success && !Task.isCancelled)
            }
            task.expirationHandler = { work.cancel() }
        }
    }
    private func scheduleRefresh() {
        guard configuration != nil else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshIdentifier)
        // Let iOS schedule opportunities; failures must not request rapid background wakeups.
        request.earliestBeginDate = HealthSyncPolicy.backgroundDate(retryAfter: state.retryAfter)
        try? BGTaskScheduler.shared.submit(request)
    }
    @discardableResult func boot() async -> Bool {
        do {
            try load()
            if configuration != nil { startObservers(); await sync(manual: false) }
            return state.error == nil && !Task.isCancelled
        } catch { return false } // Protected data may be unavailable until first unlock.
    }
    func status(owner: String) throws -> [String: Any] {
        try load()
        guard configuration?.owner == owner else { return ["enabled": false, "running": running] }
        var result: [String: Any] = ["enabled": true, "running": running, "pending": (state.pending == nil ? 0 : 1) + (state.pendingWorkout == nil ? 0 : 1)]
        if let at = state.lastSuccess { result["lastSuccess"] = ISO8601DateFormatter().string(from: at) }
        if let error = state.error { result["error"] = error }
        result["received"] = state.received ?? [:]
        result["storedWorkouts"] = state.storedWorkouts ?? 0
        result["skippedWorkouts"] = state.skippedWorkouts ?? 0
        if let warning = state.backgroundWarning { result["backgroundWarning"] = warning }
        return result
    }
    func enable(server: String, token: String, owner: String) async throws {
        try load()
        guard !running, !configuring else { throw HealthSyncFailure.busy }
        configuring = true
        let version = epoch
        defer { configuring = false }
        guard HKHealthStore.isHealthDataAvailable(), let url = URL(string: server), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, !token.isEmpty, token.count < 4096, !token.contains("\n"), !token.contains("\r"), !owner.isEmpty else { throw HealthSyncFailure.invalidConfiguration }
        let config = HealthConfiguration(server: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")), token: token, owner: owner)
        if let existing = configuration, existing.owner != owner || existing.server != config.server { throw HealthSyncFailure.invalidConfiguration }
        // Read authorization has no inspectable granted flag. An empty query is never described as permission granted.
        // Validate ownership before saving an upload credential or reading any samples.
        let validation = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { validation.finishTasksAndInvalidate() }
        let account = try HealthSyncProtocol.object(await send(config, path: "/api/heart-rate/pending", body: JSONSerialization.data(withJSONObject: ["expected_owner": owner]), transport: validation))
        guard epoch == version, account["owner"] as? String == owner else { throw HealthSyncFailure.invalidConfiguration }
        try await health.requestAuthorization(toShare: [], read: readTypes)
        guard epoch == version else { throw HealthSyncFailure.stopped }
        try saveConfiguration(config)
        if configuration == nil { state = HealthSyncState() }
        configuration = config
        try persist()
        startObservers()
        configuring = false
        await sync(manual: true)
    }
    // Follow the signed-in app's renewed session without requesting Health permission again.
    // Keep anchors and queued batches; an account/server change must go through disable first.
    func refreshSession(server: String, token: String, owner: String) async throws {
        try load()
        guard let existing = configuration else { return }
        let config = HealthConfiguration(server: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")), token: token, owner: owner)
        guard existing.owner == owner, existing.server == config.server else { throw HealthSyncFailure.invalidConfiguration }
        guard config != existing else { return }
        guard !running, !configuring else { return } // Next status refresh retries after in-flight work.
        guard !token.isEmpty, token.count < 4096, !token.contains("\n"), !token.contains("\r") else { throw HealthSyncFailure.invalidConfiguration }
        configuring = true
        let version = epoch
        defer { configuring = false }
        let transport = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { transport.finishTasksAndInvalidate() }
        let account: [String: Any]
        do {
            account = try HealthSyncProtocol.object(await send(config, path: "/api/heart-rate/pending", body: JSONSerialization.data(withJSONObject: ["expected_owner": owner]), transport: transport))
        } catch HealthSyncFailure.rejected(let code) {
            // An old upload-only configuration must not outlive a revoked app login.
            if epoch == version && (code == 401 || code == 403) { try disable() }
            throw HealthSyncFailure.rejected(code)
        }
        guard epoch == version, configuration == existing, account["owner"] as? String == owner else { throw HealthSyncFailure.stopped }
        try saveConfiguration(config)
        configuration = config
    }
    private func saveConfiguration(_ config: HealthConfiguration) throws {
        var item = keychain
        item[kSecValueData as String] = try JSONEncoder().encode(config)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let update = SecItemUpdate(keychain as CFDictionary, [kSecValueData as String: item[kSecValueData as String]!] as CFDictionary)
        if update == errSecItemNotFound { guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw HealthSyncFailure.storage } }
        else if update != errSecSuccess { throw HealthSyncFailure.storage }
    }
    func disable() throws {
        epoch += 1
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshIdentifier)
        for observer in observers { health.stop(observer) }
        observers = []
        for type in observedTypes { health.disableBackgroundDelivery(for: type) { _, _ in } }
        session?.invalidateAndCancel(); session = nil
        let status = SecItemDelete(keychain as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw HealthSyncFailure.storage }
        configuration = nil; loaded = true; state = HealthSyncState()
        resyncRequested = false
        notifyStateChanged()
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    private func startObservers() {
        guard observers.isEmpty else { return }
        let version = epoch
        for type in observedTypes {
            let observer = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                Task {
                    if error == nil { await self.sync(manual: false, changed: true) }
                    completion()
                }
            }
            observers.append(observer); health.execute(observer)
            health.enableBackgroundDelivery(for: type, frequency: .hourly) { success, _ in
                if !success { Task { await self.backgroundUnavailable(version) } }
            }
        }
    }
    func sync(manual: Bool, changed: Bool = false) async {
        if running {
            // Launch/foreground callbacks share the current pass. Actual HealthKit
            // changes request one catch-up pass, and observers ACK only after it ends.
            if changed { resyncRequested = true }
            await withCheckedContinuation { syncWaiters.append($0) }
            return
        }
        guard !configuring else { return }
        do { try load() } catch { return }
        guard let config = configuration else { return }
        guard HealthSyncPolicy.shouldSync(manual: manual, changed: changed, lastSuccess: state.lastSuccess, retryAfter: state.retryAfter) else { return }
        running = true
        notifyStateChanged()
        let version = epoch
        defer {
            running = false; resyncRequested = false; scheduleRefresh(); notifyStateChanged()
            let waiters = syncWaiters; syncWaiters = []
            for waiter in waiters { waiter.resume() }
        }
        repeat {
            resyncRequested = false
            await syncOnce(config, version)
        } while resyncRequested && epoch == version && state.error == nil && !Task.isCancelled
    }
    private func syncOnce(_ config: HealthConfiguration, _ version: Int) async {
        do {
            let transport = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
            session = transport
            defer { transport.finishTasksAndInvalidate() }
            state.received = [:]; state.storedWorkouts = 0; state.skippedWorkouts = 0
            // A pending page is durable before the request. Never query beyond its anchor until ACK.
            if state.pending != nil { try await flush(config, version, transport) }
            if state.pendingWorkout != nil { try await flushWorkout(config, version, transport) }
            for (metric, type) in types {
                while true {
                    guard configuration == config, version == epoch else { throw HealthSyncFailure.stopped }
                    try Task.checkCancellation()
                    let page = try await query(metric, type)
                    guard configuration == config, version == epoch else { throw HealthSyncFailure.stopped }
                    state.received?[metric, default: 0] += page.count
                    // Empty pages contain no server mutations to acknowledge. Keep the
                    // new cursor locally without an HTTP request or a durable retry batch.
                    if page.count == 0 {
                        state.anchors[metric] = page.pending.anchor
                        try persist()
                        break
                    }
                    state.pending = page.pending
                    try persist()
                    try await flush(config, version, transport)
                    if page.count < 500 { break }
                }
            }
            try await syncWorkouts(config, version, transport)
            try check(config, version)
            state.lastSuccess = Date(); state.error = nil; state.failures = 0; state.retryAfter = nil
            try persist()
        } catch {
            guard version == epoch else { return }
            state.failures += 1
            state.retryAfter = Date().addingTimeInterval(min(3600, pow(2, Double(min(state.failures, 10))) * 15))
            // No token, endpoint, or health payload in diagnostics.
            if case HealthSyncFailure.rejected(let status) = error { state.error = "HTTP \(status)" }
            else if case HealthSyncFailure.sampleLimit = error { state.error = "Too many samples in one workout. Use a smaller manual import." }
            else { state.error = "Health sync incomplete; unlock iPhone, check access and retry." }
            try? persist()
        }
    }
    private func flush(_ config: HealthConfiguration, _ version: Int, _ transport: URLSession) async throws {
        guard let page = state.pending else { return }
        try check(config, version)
        let data = try await send(config, path: "/api/daily-health/healthkit", body: page.body, transport: transport)
        try check(config, version)
        let previous = state
        try state.acknowledgeDaily(data)
        do { try persist() } catch { state = previous; throw error }
    }
    private func backgroundUnavailable(_ version: Int) {
        guard epoch == version, configuration != nil else { return }
        state.backgroundWarning = "Background Health delivery unavailable. Open the app to sync."
        try? persist()
        notifyStateChanged()
    }
    private func send(_ config: HealthConfiguration, path: String, body: Data, transport: URLSession) async throws -> Data {
        guard let url = URL(string: config.server + path) else { throw HealthSyncFailure.invalidConfiguration }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.httpBody = body; request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + config.token, forHTTPHeaderField: "Authorization")
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw HealthSyncFailure.rejected((response as? HTTPURLResponse)?.statusCode ?? 0) }
        return data
    }
    private func flushWorkout(_ config: HealthConfiguration, _ version: Int, _ transport: URLSession) async throws {
        guard let body = state.pendingWorkout else { return }
        try check(config, version)
        let data = try await send(config, path: "/api/heart-rate/import", body: body, transport: transport)
        try check(config, version)
        let stored = try HealthSyncProtocol.workoutAck(data)
        let previous = state
        state.pendingWorkout = nil
        if stored { state.storedWorkouts = (state.storedWorkouts ?? 0) + 1 }
        else { state.skippedWorkouts = (state.skippedWorkouts ?? 0) + 1 }
        do { try persist() } catch { state = previous; throw error }
    }
    private func samples(_ type: HKSampleType, predicate: NSPredicate, limit: Int) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: limit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, rows, error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: rows ?? []) }
            }
            health.execute(query)
        }
    }
    private func syncWorkouts(_ config: HealthConfiguration, _ version: Int, _ transport: URLSession) async throws {
        let data = try await send(config, path: "/api/heart-rate/pending", body: JSONSerialization.data(withJSONObject: ["expected_owner": config.owner]), transport: transport)
        try check(config, version)
        let response = try HealthSyncProtocol.object(data)
        guard response["owner"] as? String == config.owner, let targets = response["workouts"] as? [[String: Any]] else { throw HealthSyncFailure.badAcknowledgement }
        // Only fill missing, unambiguous workouts within the original 30-day backfill horizon.
        // Re-query empty dates on the next run: Watch -> iPhone delivery may still be in progress.
        for target in targets.reversed() {
            try check(config, version)
            guard let date = target["date"] as? String, let id = target["workout_id"] as? String else { throw HealthSyncFailure.badAcknowledgement }
            let day = try HealthSyncProtocol.day(date)
            if day.end < state.since { continue }
            let predicate = HKQuery.predicateForSamples(withStart: day.start, end: day.end, options: .strictStartDate)
            let workouts = try await samples(HKObjectType.workoutType(), predicate: predicate, limit: 5001).compactMap { $0 as? HKWorkout }.filter { $0.startDate < day.end }
            try check(config, version)
            guard workouts.count <= 5000 else { throw HealthSyncFailure.sampleLimit }
            if workouts.isEmpty { state.skippedWorkouts = (state.skippedWorkouts ?? 0) + 1; continue }
            let windows = workouts.map { HKQuery.predicateForSamples(withStart: $0.startDate, end: $0.endDate, options: .strictStartDate) }
            let heart = try await samples(HKObjectType.quantityType(forIdentifier: .heartRate)!, predicate: NSCompoundPredicate(orPredicateWithSubpredicates: windows), limit: 20001)
            try check(config, version)
            guard heart.count <= 20000 else { throw HealthSyncFailure.sampleLimit }
            if heart.isEmpty { state.skippedWorkouts = (state.skippedWorkouts ?? 0) + 1; continue }
            let iso = ISO8601DateFormatter(); iso.timeZone = .current; iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let rows = heart.compactMap { $0 as? HKQuantitySample }.map { ["at": iso.string(from: $0.startDate), "bpm": $0.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))] as [String: Any] }
            let body: [String: Any] = ["client": "opengym-healthkit", "workout_id": id, "batch": true, "sync_workout_time": true, "samples": rows,
                "apple_workout_id": workouts.map { $0.uuid.uuidString }, "started_at": workouts.map { iso.string(from: $0.startDate) }, "ended_at": workouts.map { iso.string(from: $0.endDate) }]
            state.pendingWorkout = try JSONSerialization.data(withJSONObject: body)
            try persist()
            try await flushWorkout(config, version, transport)
        }
    }
    private func query(_ metric: String, _ type: HKSampleType) async throws -> (pending: HealthPending, count: Int) {
        let anchor: HKQueryAnchor?
        if let data = state.anchors[metric] { anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) } else { anchor = nil }
        let predicate = HKQuery.predicateForSamples(withStart: state.since, end: nil, options: [])
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: anchor, limit: 500) { _, samples, deleted, next, error in
                do {
                    if let error = error { throw error }
                    guard let next = next else { throw HealthSyncFailure.badAcknowledgement }
                    let iso = ISO8601DateFormatter(); iso.timeZone = .current; iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    let rows: [[String: Any]] = try (samples ?? []).map { sample in
                        var row: [String: Any] = ["id": sample.uuid.uuidString, "start": iso.string(from: sample.startDate), "end": iso.string(from: sample.endDate), "source": sample.sourceRevision.source.name, "sourceIdentifier": sample.sourceRevision.source.bundleIdentifier]
                        if let category = sample as? HKCategorySample {
                            let names = [0:"inBed",1:"asleepUnspecified",2:"awake",3:"asleepCore",4:"asleepDeep",5:"asleepREM"]
                            guard let name = names[category.value] else { throw HealthSyncFailure.badAcknowledgement }
                            row["category"] = name
                        } else if let quantity = sample as? HKQuantitySample {
                            row["value"] = quantity.quantity.doubleValue(for: metric == "hrv" ? HKUnit.secondUnit(with: .milli) : HKUnit.count().unitDivided(by: .minute()))
                        }
                        return row
                    }
                    let body: [String: Any] = ["metric": metric, "timezone": TimeZone.current.identifier, "unit": metric == "hrv" ? "ms" : "bpm", "samples": rows, "deleted": (deleted ?? []).map { $0.uuid.uuidString }]
                    let pending = HealthPending(metric: metric, body: try JSONSerialization.data(withJSONObject: body), anchor: try NSKeyedArchiver.archivedData(withRootObject: next, requiringSecureCoding: true))
                    continuation.resume(returning: (pending, (samples?.count ?? 0) + (deleted?.count ?? 0)))
                } catch { continuation.resume(throwing: error) }
            }
            health.execute(query)
        }
    }
}
