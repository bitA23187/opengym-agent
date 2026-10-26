import Foundation

@main struct HealthSyncModelsTests {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: message, code: 1) }
    }
    static func rejects(_ action: () throws -> Void) throws {
        var failed = false
        do { try action() } catch { failed = true }
        try require(failed, "Expected invalid protocol input to fail")
    }
    static func json(_ text: String) -> Data { Data(text.utf8) }
    static func main() throws {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let recent = now.addingTimeInterval(-10), retry = now.addingTimeInterval(30)
        try require(!HealthSyncPolicy.shouldSync(manual: false, changed: false, lastSuccess: recent, retryAfter: nil, now: now), "Repeated foreground callbacks must be throttled")
        try require(HealthSyncPolicy.shouldSync(manual: false, changed: true, lastSuccess: recent, retryAfter: nil, now: now), "Health changes must not be lost to foreground throttling")
        try require(!HealthSyncPolicy.shouldSync(manual: false, changed: true, lastSuccess: nil, retryAfter: retry, now: now), "Health events must respect network backoff")
        try require(HealthSyncPolicy.shouldSync(manual: true, changed: false, lastSuccess: recent, retryAfter: retry, now: now), "Manual retry must bypass automatic limits")
        try require(HealthSyncPolicy.shouldSync(manual: false, changed: false, lastSuccess: now.addingTimeInterval(-60), retryAfter: nil, now: now), "Foreground sync must resume after throttle expires")
        try require(HealthSyncPolicy.backgroundDate(retryAfter: retry, now: now) == now.addingTimeInterval(900), "Background failures must not request rapid wakeups")
        try require(HealthSyncPolicy.backgroundDate(retryAfter: now.addingTimeInterval(3600), now: now) == now.addingTimeInterval(3600), "Longer retry backoff must be preserved")
        try require(HealthSyncPolicy.backgroundDate(retryAfter: nil, now: now) == now.addingTimeInterval(21600), "Idle background fallback must remain infrequent")
        // Existing installations must retain their cursor when optional workout fields are added.
        let old = json("{\"since\":0,\"anchors\":{\"sleep\":\"b2xk\"},\"failures\":0}")
        var state = try JSONDecoder().decode(HealthSyncState.self, from: old)
        try require(state.pendingWorkout == nil && state.anchors["sleep"] == Data("old".utf8), "Legacy migration discarded cursor")
        let body = json("{\"samples\":[]}")
        state.pending = HealthPending(metric: "sleep", body: body, anchor: Data("next".utf8))
        state.pendingWorkout = json("{\"workout_id\":\"test-only\"}")
        let disk = try JSONEncoder().encode(state)
        state = try JSONDecoder().decode(HealthSyncState.self, from: disk)
        try require(state.pending?.body == body && state.pendingWorkout != nil, "Restart lost queued bytes")
        for text in ["{}", "{\"ok\":false,\"metric\":\"sleep\"}", "{\"ok\":1,\"metric\":\"sleep\"}", "{\"ok\":true,\"metric\":\"hrv\"}"] {
            try rejects { try state.acknowledgeDaily(json(text)) }
            try require(state.anchors["sleep"] == Data("old".utf8) && state.pending != nil, "Bad ACK advanced cursor")
        }
        try state.acknowledgeDaily(json("{\"ok\":true,\"metric\":\"sleep\"}"))
        try require(state.anchors["sleep"] == Data("next".utf8) && state.pending == nil, "Valid ACK did not commit")
        try require(state.pendingWorkout != nil, "Daily ACK erased workout retry")
        let saved = try HealthSyncProtocol.workoutAck(json("{\"ok\":true,\"storedWorkouts\":1}"))
        let skipped = try HealthSyncProtocol.workoutAck(json("{\"ok\":true,\"storedWorkouts\":0,\"skipped\":\"already_imported\"}"))
        try require(saved && !skipped, "Workout retry ACK misclassified")
        for text in ["{\"ok\":true}", "{\"ok\":true,\"storedWorkouts\":true}", "{\"ok\":true,\"storedWorkouts\":0}", "{\"ok\":true,\"storedWorkouts\":0,\"skipped\":\"unknown\"}"] {
            try rejects { _ = try HealthSyncProtocol.workoutAck(json(text)) }
        }
        let zone = TimeZone(identifier: "America/New_York")!
        let spring = try HealthSyncProtocol.day("2026-03-08", timezone: zone)
        let autumn = try HealthSyncProtocol.day("2026-11-01", timezone: zone)
        try require(spring.duration == 23 * 3600 && autumn.duration == 25 * 3600, "DST day shifted workout matching")
        let taipei = try HealthSyncProtocol.day("2026-10-24", timezone: TimeZone(identifier: "Asia/Taipei")!)
        try require(taipei.duration == 86400, "Taipei day boundaries incorrect")
        for date in ["2026-02-30", "2026-1-1", "invalid"] { try rejects { _ = try HealthSyncProtocol.day(date) } }
        print("Health sync protocol checks passed: legacy migration, durable retry, ACK cursor isolation, strict response types, DST/date bounds.")
    }
}
