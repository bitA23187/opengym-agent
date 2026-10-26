import Foundation

struct WatchConfiguration: Codable, Equatable {
    let id: UUID
    let server: String
    let owner: String
    let token: String

    static func origin(_ server: String) throws -> String {
        let address = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: address), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              parts.port == nil || (1...65535).contains(parts.port!),
              !address.contains(where: { $0.isWhitespace })
        else { throw WatchFailure.invalidConfiguration }
        parts.scheme = "https"; parts.host = host.lowercased(); parts.path = ""
        guard let origin = parts.url?.absoluteString else { throw WatchFailure.invalidConfiguration }
        return origin
    }
    static func validated(server: String, owner: String, token: String) throws -> Self {
        let origin = try origin(server)
        let account = owner.trimmingCharacters(in: .whitespacesAndNewlines)
        var secret = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if secret.hasPrefix("Bearer ") { secret = String(secret.dropFirst(7)) }
        guard !account.isEmpty, account.count <= 200, !account.contains(where: { $0.isWhitespace || $0.isNewline }),
              secret.range(of: "^(ogh_|ogd_|ogw_)[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw WatchFailure.invalidConfiguration }
        return Self(id: UUID(), server: origin, owner: account, token: secret)
    }
}

enum WatchMetric: String, CaseIterable, Codable {
    case sleep, restingHeartRate, hrv, workouts, heartRate
    static let uploads: [Self] = [.sleep, .restingHeartRate, .hrv]
    var title: String {
        switch self {
        case .sleep: return "睡眠"
        case .restingHeartRate: return "静息心率"
        case .hrv: return "HRV · SDNN"
        case .workouts: return "已保存训练"
        case .heartRate: return "心率"
        }
    }
    var symbol: String {
        switch self {
        case .sleep: return "bed.double.fill"
        case .restingHeartRate: return "heart.fill"
        case .hrv: return "waveform.path.ecg"
        case .workouts: return "figure.strengthtraining.traditional"
        case .heartRate: return "heart.text.clipboard"
        }
    }
}

struct WatchMetricSummary: Codable, Identifiable {
    var id: WatchMetric { metric }
    let metric: WatchMetric
    let count: Int
    let truncated: Bool
    let latest: Date?
}

struct WatchPage {
    let pending: HealthPending
    let sampleCount: Int
    let ignoredDeletions: Int
    var hasMore: Bool { sampleCount + ignoredDeletions >= 500 }
}

struct WatchQueuedPage: Codable {
    let pending: HealthPending
    let sampleCount: Int
    let ignoredDeletions: Int
}

struct WatchState: Codable {
    let connectionID: UUID
    var since = Date().addingTimeInterval(-30 * 86400)
    var anchors: [String: Data] = [:]
    var pending: WatchQueuedPage?
    var summaries: [WatchMetricSummary] = []
    var earliest: Date?
    var inspectedAt: Date?
    var lastSuccess: Date?
    var uploaded: [String: Int] = [:]
    var ignoredDeletions = 0
    var error: String?
}

struct WatchSnapshot {
    var server: String?
    var owner: String?
    var busy = false
    var phase: String?
    var state: WatchState?
    var connected: Bool { server != nil }
    var pendingCount: Int { state?.pending == nil ? 0 : 1 }
}

enum WatchFailure: Error, LocalizedError {
    case invalidConfiguration, accountMismatch, busy, storage, invalidResponse, http(Int)
    case stopped, healthUnavailable, invalidHealthData, pairingExpired, pairingDenied
    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "请填写 HTTPS 根地址、账户 ID 和有效的 Apple 健康上传凭证。"
        case .accountMismatch: return "凭证与账户 ID 不匹配，或服务器未支持账户校验。"
        case .busy: return "正在处理，请稍后重试。"
        case .storage: return "无法保存本机数据。请解锁手表、检查存储空间后重试。"
        case .invalidResponse: return "服务器确认无效，请检查服务器版本后重试。"
        case .http(401): return "连接已失效，请在连接设置中解除连接后重新扫码。"
        case .http(403): return "服务器拒绝访问，请解除连接后重新扫码。"
        case .http(let code): return "服务器返回 HTTP \(code)，请稍后重试。"
        case .stopped: return "连接已解除，本次操作已停止。"
        case .healthUnavailable: return "此设备无法读取健康数据，请使用支持 HealthKit 的 Apple Watch。"
        case .invalidHealthData: return "健康数据包含无法识别的记录，尚未推进同步进度。"
        case .pairingExpired: return "二维码已过期，请重新生成后扫码。"
        case .pairingDenied: return "绑定已被拒绝或撤销，请核对账户后重新扫码。"
        }
    }
    static func message(_ error: Error) -> String {
        if let failure = error as? Self { return failure.errorDescription! }
        if error is CancellationError { return "操作已中断，重新打开后可手动重试。" }
        if error is URLError { return "网络请求未完成。请连接 Wi-Fi 或热点，再点立即同步。" }
        if error is DecodingError || error is HealthSyncFailure { return Self.invalidResponse.errorDescription! }
        return "操作未完成。请解锁手表、检查健康读取权限后重试。"
    }
}

protocol WatchHealthReading {
    func authorize() async throws
    func earliestDate() async -> Date
    func inspect(since: Date) async throws -> [WatchMetricSummary]
    func page(metric: WatchMetric, anchor: Data?, since: Date) async throws -> WatchPage
}

protocol WatchTransporting {
    func post(_ config: WatchConfiguration, path: String, body: Data) async throws -> Data
    func cancel()
}

protocol WatchStoring {
    func loadConfiguration() throws -> WatchConfiguration?
    func saveConfiguration(_ value: WatchConfiguration) throws
    func removeConfiguration() throws
    func loadState() throws -> WatchState?
    func saveState(_ value: WatchState) throws
    func removeState() throws
}
