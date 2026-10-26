import Foundation

private final class PairTransport: WatchPairingTransporting {
    var response: [String: Any] = [:]
    var failure: WatchFailure?
    var calls: [(String, String, Data)] = []
    func pairingPost(server: String, path: String, body: Data) async throws -> Data {
        calls.append((server, path, body))
        if let failure { throw failure }
        return try JSONSerialization.data(withJSONObject: response)
    }
}

@main struct WatchPairingTests {
    static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw NSError(domain: message, code: 1) }
    }
    static func rejects(_ action: () async throws -> Void) async throws {
        do { try await action() } catch { return }
        throw NSError(domain: "Expected protocol rejection", code: 1)
    }
    static func main() async throws {
        let transport = PairTransport(), api = WatchPairingAPI(transport: transport)
        let good: [String: Any] = ["device_code": String(repeating: "a", count: 43), "user_code": "ABCD-EFGH",
            "verification_uri_complete": "https://gym.example/#/watch-pair?code=ABCDEFGH", "expires_in": 300, "interval": 5,
            "qr": Array(repeating: String(repeating: "0", count: 21), count: 21)]
        transport.response = good
        let session = try await api.start(server: "https://GYM.example/")
        try require(session.server == "https://gym.example", "Wrong origin normalization")
        try require(session.interval == 5 && !session.expired, "Wrong polling deadline")
        let saved = try JSONEncoder().encode(session), restored = try JSONDecoder().decode(WatchPairingSession.self, from: saved)
        try require(restored.deviceCode == session.deviceCode && restored.qr == session.qr, "Restart loses redemption context")
        let invalid: [(String, Any)] = [
            ("verification_uri_complete", "https://attacker.example/#/watch-pair?code=ABCDEFGH"),
            ("verification_uri_complete", "https://gym.example/#/watch-pair?code=ABCDEFGH&device_code=secret"),
            ("device_code", "ABCDEFGH"), ("user_code", "ABCD-EFG0"), ("expires_in", 86400), ("interval", 0),
            ("qr", []), ("qr", Array(repeating: String(repeating: "0", count: 22), count: 22)),
            ("qr", Array(repeating: String(repeating: "x", count: 21), count: 21))
        ]
        for (key, value) in invalid {
            transport.response = good; transport.response[key] = value
            try await rejects { _ = try await api.start(server: "https://gym.example") }
        }
        transport.response = ["status": "pending"]
        let pending = try await api.poll(restored)
        try require(pending.status == "pending", "Pending rejected")
        let body = try JSONSerialization.jsonObject(with: transport.calls.last!.2) as! [String: String]
        try require(body == ["device_code": session.deviceCode], "Polling leaked or omitted secret")
        transport.response = ["status": "pending", "scanned": true]
        let scanned = try await api.poll(restored)
        try require(scanned.status == "pending" && scanned.scanned == true, "Scan acknowledgement rejected")
        transport.response = ["status": "approved", "owner": "alice", "token": "ogw_" + String(repeating: "b", count: 43), "device_id": UUID().uuidString]
        _ = try await api.poll(restored)
        transport.response["token"] = "ogh_" + String(repeating: "b", count: 43)
        try await rejects { _ = try await api.poll(restored) }
        transport.response = ["status": "unknown"]
        try await rejects { _ = try await api.poll(restored) }
        transport.response = ["ok": false]
        try await rejects { try await api.acknowledge(restored) }
        transport.response = ["ok": "true"]
        try await rejects { try await api.acknowledge(restored) }
        transport.response = ["ok": true]
        try await api.acknowledge(restored); try await api.acknowledge(restored)
        try await api.cancel(restored)
        let expired = WatchPairingSession(server: session.server, deviceCode: session.deviceCode, userCode: session.userCode,
            verificationURL: session.verificationURL, qr: session.qr, expiresAt: .distantPast, interval: 5)
        let count = transport.calls.count
        try await rejects { _ = try await api.poll(expired) }
        try require(transport.calls.count == count, "Expired binding sent a network request")
        transport.failure = .http(410)
        do { _ = try await api.poll(restored); throw NSError(domain: "Expected expiration", code: 1) }
        catch WatchFailure.pairingExpired { }
        print("PASS: QR origin, shape, secret validation, restart serialization, scoped credential, strict ACK, expiry and retry protocol.")
    }
}
