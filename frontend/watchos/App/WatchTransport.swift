import Foundation

private final class WatchNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class WatchTransport: WatchTransporting, WatchPairingTransporting {
    private let lock = NSLock()
    private var active: [UUID: URLSession] = [:]
    private let delegate = WatchNoRedirect()

    private func set(_ session: URLSession?, id: UUID) { lock.lock(); active[id] = session; lock.unlock() }
    func cancel() { lock.lock(); let sessions = Array(active.values); active = [:]; lock.unlock(); sessions.forEach { $0.invalidateAndCancel() } }

    func post(_ config: WatchConfiguration, path: String, body: Data) async throws -> Data {
        guard ["/api/heart-rate/pending", "/api/daily-health/healthkit", "/api/watch-devices/verify"].contains(path) else { throw WatchFailure.invalidConfiguration }
        return try await send(server: config.server, path: path, body: body, token: config.token)
    }
    func pairingPost(server: String, path: String, body: Data) async throws -> Data {
        guard ["start", "poll", "ack", "cancel"].map({ "/api/watch-pair/" + $0 }).contains(path) else { throw WatchFailure.invalidConfiguration }
        return try await send(server: server, path: path, body: body, token: nil)
    }
    private func send(server: String, path: String, body: Data, token: String?) async throws -> Data {
        try Task.checkCancellation()
        guard let url = URL(string: try WatchConfiguration.origin(server) + path) else { throw WatchFailure.invalidConfiguration }
        let settings = URLSessionConfiguration.ephemeral
        settings.httpShouldSetCookies = false; settings.httpCookieStorage = nil; settings.urlCache = nil
        settings.requestCachePolicy = .reloadIgnoringLocalCacheData
        settings.timeoutIntervalForRequest = 30; settings.timeoutIntervalForResource = 45
        let session = URLSession(configuration: settings, delegate: delegate, delegateQueue: nil)
        let id = UUID(); set(session, id: id)
        defer { set(nil, id: id); session.finishTasksAndInvalidate() }
        try Task.checkCancellation()
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw WatchFailure.invalidResponse }
        guard http.statusCode == 200 else { throw WatchFailure.http(http.statusCode) }
        guard data.count <= 2_000_000 else { throw WatchFailure.invalidResponse }
        return data
    }
}
