import Foundation
import HealthKit

final class WatchHealthReader: WatchHealthReading {
    private let store = HKHealthStore()
    private func type(_ metric: WatchMetric) -> HKSampleType {
        switch metric {
        case .sleep: return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        case .restingHeartRate: return HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
        case .hrv: return HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
        case .workouts: return HKObjectType.workoutType()
        case .heartRate: return HKObjectType.quantityType(forIdentifier: .heartRate)!
        }
    }

    func authorize() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw WatchFailure.healthUnavailable }
        try await store.requestAuthorization(toShare: [], read: Set(WatchMetric.allCases.map { type($0) as HKObjectType }))
        // Completion is not evidence that all read types were granted.
    }

    func earliestDate() async -> Date { store.earliestPermittedSampleDate() }

    private func samples(_ sampleType: HKSampleType, predicate: NSPredicate, limit: Int) async throws -> [HKSample] {
        try Task.checkCancellation()
        let rows: [HKSample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: sampleType, predicate: predicate, limit: limit,
                                      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, rows, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: rows ?? []) }
            }
            store.execute(query)
        }
        try Task.checkCancellation()
        return rows
    }

    func workoutBody(id: String, day: DateInterval, since: Date) async throws -> Data? {
        let earliest = await earliestDate()
        guard day.end >= max(since, earliest) else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: day.start, end: day.end, options: .strictStartDate)
        let workouts = try await samples(HKObjectType.workoutType(), predicate: predicate, limit: 5001)
            .compactMap { $0 as? HKWorkout }.filter { $0.startDate < day.end }
        guard workouts.count <= 5000 else { throw WatchFailure.sampleLimit }
        guard !workouts.isEmpty else { return nil }
        let windows = workouts.map { HKQuery.predicateForSamples(withStart: $0.startDate, end: $0.endDate, options: .strictStartDate) }
        let heart = try await samples(type(.heartRate), predicate: NSCompoundPredicate(orPredicateWithSubpredicates: windows), limit: 20001)
        guard heart.count <= 20000 else { throw WatchFailure.sampleLimit }
        guard !heart.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.timeZone = .current; iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let rows = try heart.map { sample -> [String: Any] in
            guard let quantity = sample as? HKQuantitySample else { throw WatchFailure.invalidHealthData }
            return ["at": iso.string(from: quantity.startDate),
                    "bpm": quantity.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))]
        }
        let body: [String: Any] = [
            "client": "opengym-healthkit", "workout_id": id, "batch": true, "sync_workout_time": true,
            "samples": rows, "apple_workout_id": workouts.map { $0.uuid.uuidString },
            "started_at": workouts.map { iso.string(from: $0.startDate) },
            "ended_at": workouts.map { iso.string(from: $0.endDate) }
        ]
        return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    func inspect(since: Date) async throws -> [WatchMetricSummary] {
        var result: [WatchMetricSummary] = []
        for metric in WatchMetric.allCases {
            try Task.checkCancellation()
            let rows: [HKSample] = try await withCheckedThrowingContinuation { continuation in
                let query = HKSampleQuery(
                    sampleType: type(metric),
                    predicate: HKQuery.predicateForSamples(withStart: since, end: Date(), options: []),
                    limit: 501,
                    sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
                ) { _, rows, error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume(returning: rows ?? []) }
                }
                store.execute(query)
            }
            try Task.checkCancellation()
            result.append(WatchMetricSummary(metric: metric, count: min(rows.count, 500), truncated: rows.count > 500, latest: rows.first?.endDate))
        }
        return result
    }

    func page(metric: WatchMetric, anchor: Data?, since: Date) async throws -> WatchPage {
        try Task.checkCancellation()
        let cursor: HKQueryAnchor?
        if let anchor {
            guard let decoded = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: anchor) else {
                throw WatchFailure.invalidHealthData
            }
            cursor = decoded
        } else { cursor = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: type(metric), predicate: HKQuery.predicateForSamples(withStart: since, end: nil, options: []),
                anchor: cursor, limit: 500
            ) { _, samples, deleted, next, error in
                do {
                    if let error { throw error }
                    guard let next else { throw WatchFailure.invalidHealthData }
                    let iso = ISO8601DateFormatter()
                    iso.timeZone = .current; iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    let rows: [[String: Any]] = try (samples ?? []).map { sample in
                        var row: [String: Any] = [
                            "id": sample.uuid.uuidString, "start": iso.string(from: sample.startDate),
                            "end": iso.string(from: sample.endDate), "source": sample.sourceRevision.source.name,
                            "sourceIdentifier": sample.sourceRevision.source.bundleIdentifier
                        ]
                        if let category = sample as? HKCategorySample, metric == .sleep {
                            switch HKCategoryValueSleepAnalysis(rawValue: category.value) {
                            case .inBed: row["category"] = "inBed"
                            case .asleepUnspecified: row["category"] = "asleepUnspecified"
                            case .awake: row["category"] = "awake"
                            case .asleepCore: row["category"] = "asleepCore"
                            case .asleepDeep: row["category"] = "asleepDeep"
                            case .asleepREM: row["category"] = "asleepREM"
                            default: throw WatchFailure.invalidHealthData
                            }
                        } else if let quantity = sample as? HKQuantitySample, metric != .sleep {
                            let unit = metric == .hrv ? HKUnit.secondUnit(with: .milli) : HKUnit.count().unitDivided(by: .minute())
                            row["value"] = quantity.quantity.doubleValue(for: unit)
                        } else { throw WatchFailure.invalidHealthData }
                        return row
                    }
                    let body: [String: Any] = [
                        "metric": metric.rawValue, "timezone": TimeZone.current.identifier,
                        "unit": metric == .hrv ? "ms" : "bpm", "samples": rows,
                        // Watch history eviction has not been distinguished from deliberate deletion on a real device.
                        "deleted": [String]()
                    ]
                    let pending = HealthPending(
                        metric: metric.rawValue, body: try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
                        anchor: try NSKeyedArchiver.archivedData(withRootObject: next, requiringSecureCoding: true)
                    )
                    continuation.resume(returning: WatchPage(pending: pending, sampleCount: rows.count, ignoredDeletions: deleted?.count ?? 0))
                } catch { continuation.resume(throwing: error) }
            }
            store.execute(query)
        }
    }
}
