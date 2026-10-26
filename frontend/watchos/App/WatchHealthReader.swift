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
