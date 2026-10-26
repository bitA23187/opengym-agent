import Foundation

struct HealthConfiguration: Codable, Equatable {
    let server: String
    let token: String
    let owner: String
}
struct HealthPending: Codable {
    let metric: String
    let body: Data
    let anchor: Data
}
struct HealthSyncState: Codable {
    var since = Date().addingTimeInterval(-30 * 86400)
    var anchors: [String: Data] = [:]
    var pending: HealthPending?
    var pendingWorkout: Data?
    var received: [String: Int]?
    var storedWorkouts: Int?
    var skippedWorkouts: Int?
    var backgroundWarning: String?
    var lastSuccess: Date?
    var error: String?
    var retryAfter: Date?
    var failures = 0
}
enum HealthSyncFailure: Error {
    case invalidConfiguration, storage, stopped, busy, sampleLimit, rejected(Int), badAcknowledgement
}

enum HealthSyncPolicy {
    static func shouldSync(manual: Bool, changed: Bool, lastSuccess: Date?, retryAfter: Date?, now: Date = Date()) -> Bool {
        if manual { return true }
        if let retryAfter, retryAfter > now { return false }
        if !changed, let lastSuccess, now.timeIntervalSince(lastSuccess) < 60 { return false }
        return true
    }
    static func backgroundDate(retryAfter: Date?, now: Date = Date()) -> Date {
        retryAfter.map { max($0, now.addingTimeInterval(15 * 60)) } ?? now.addingTimeInterval(6 * 3600)
    }
}

// Shared, SDK-independent protocol rules, also exercised on Macs without an iOS SDK.
enum HealthSyncProtocol {
    static func object(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw HealthSyncFailure.badAcknowledgement }
        return value
    }
    private struct DailyAck: Decodable { let ok: Bool; let metric: String }
    private struct WorkoutAck: Decodable { let ok: Bool; let storedWorkouts: Int; let skipped: String? }
    static func dailyAck(_ data: Data, metric: String) throws {
        let ack = try JSONDecoder().decode(DailyAck.self, from: data)
        guard ack.ok, ack.metric == metric else { throw HealthSyncFailure.badAcknowledgement }
    }
    static func workoutAck(_ data: Data) throws -> Bool {
        let ack = try JSONDecoder().decode(WorkoutAck.self, from: data)
        guard ack.ok else { throw HealthSyncFailure.badAcknowledgement }
        if ack.storedWorkouts == 1 { return true }
        let skips = ["already_imported", "ambiguous_date", "no_samples", "no_apple_workout", "no_matching_samples"]
        guard ack.storedWorkouts == 0, let reason = ack.skipped, skips.contains(reason) else { throw HealthSyncFailure.badAcknowledgement }
        return false
    }
    static func day(_ text: String, timezone: TimeZone = .current) throws -> DateInterval {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timezone
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timezone; formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard text.count == 10, let date = formatter.date(from: text), formatter.string(from: date) == text,
              let end = calendar.date(byAdding: .day, value: 1, to: date) else { throw HealthSyncFailure.invalidConfiguration }
        return DateInterval(start: date, end: end)
    }
}

extension HealthSyncState {
    mutating func acknowledgeDaily(_ data: Data) throws {
        guard let page = pending else { throw HealthSyncFailure.badAcknowledgement }
        try HealthSyncProtocol.dailyAck(data, metric: page.metric)
        anchors[page.metric] = page.anchor
        pending = nil
    }
}
