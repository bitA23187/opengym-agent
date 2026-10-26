import Foundation

struct WatchPairingSession: Codable {
    let server: String
    let deviceCode: String
    let userCode: String
    let verificationURL: String
    let qr: [String]
    let expiresAt: Date
    let interval: Int
    var expired: Bool { Date() >= expiresAt }
}

struct WatchPairingResult: Decodable {
    let status: String
    let scanned: Bool?
    let owner: String?
    let token: String?
    let device_id: String?
}

protocol WatchPairingTransporting {
    func pairingPost(server: String, path: String, body: Data) async throws -> Data
}

struct WatchPairingAPI {
    let transport: any WatchPairingTransporting
    func start(server: String) async throws -> WatchPairingSession {
        let origin = try WatchConfiguration.origin(server)
        let data = try await transport.pairingPost(server: origin, path: "/api/watch-pair/start", body: Data("{\"name\":\"Apple Watch\"}".utf8))
        struct Reply: Decodable {
            let device_code: String; let user_code: String; let verification_uri_complete: String
            let expires_in: Int; let interval: Int; let qr: [String]
        }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        let code = reply.user_code.replacingOccurrences(of: "-", with: "")
        guard reply.device_code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              code.range(of: "^[A-HJ-NP-Z2-9]{8}$", options: .regularExpression) != nil,
              reply.verification_uri_complete == origin + "/#/watch-pair?code=" + code,
              (30...600).contains(reply.expires_in), (5...30).contains(reply.interval),
              (21...177).contains(reply.qr.count), (reply.qr.count - 17) % 4 == 0,
              reply.qr.allSatisfy({ $0.count == reply.qr.count && $0.allSatisfy({ $0 == "0" || $0 == "1" }) })
        else { throw WatchFailure.invalidResponse }
        return WatchPairingSession(server: origin, deviceCode: reply.device_code, userCode: reply.user_code,
                                   verificationURL: reply.verification_uri_complete, qr: reply.qr,
                                   expiresAt: Date().addingTimeInterval(Double(reply.expires_in)), interval: reply.interval)
    }
    func poll(_ session: WatchPairingSession) async throws -> WatchPairingResult {
        guard !session.expired else { throw WatchFailure.pairingExpired }
        let data = try await post(session, "poll")
        let result = try JSONDecoder().decode(WatchPairingResult.self, from: data)
        guard ["pending", "approved", "denied"].contains(result.status) else { throw WatchFailure.invalidResponse }
        if result.status == "approved" {
            guard let owner = result.owner, let token = result.token, token.hasPrefix("ogw_"),
                  let id = result.device_id, UUID(uuidString: id) != nil else { throw WatchFailure.invalidResponse }
            _ = try WatchConfiguration.validated(server: session.server, owner: owner, token: token)
        }
        return result
    }
    func acknowledge(_ session: WatchPairingSession) async throws {
        struct Ack: Decodable { let ok: Bool }
        let response = try await post(session, "ack")
        guard try JSONDecoder().decode(Ack.self, from: response).ok else { throw WatchFailure.invalidResponse }
    }
    func cancel(_ session: WatchPairingSession) async throws { _ = try await post(session, "cancel") }
    private func post(_ session: WatchPairingSession, _ action: String) async throws -> Data {
        do {
            return try await transport.pairingPost(server: session.server, path: "/api/watch-pair/" + action,
                body: JSONSerialization.data(withJSONObject: ["device_code": session.deviceCode]))
        } catch WatchFailure.http(410) { throw WatchFailure.pairingExpired }
    }
}
