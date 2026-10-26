import SwiftUI

@MainActor final class WatchViewModel: ObservableObject {
    @Published var snapshot = WatchSnapshot()
    @Published var error: String?
    @Published var working = false
    @Published var pairing: WatchPairingSession?
    @Published var pairingPhase: String?
    @Published var pairingFeedback: String?
    private let engine: WatchSyncEngine
    private let pairingAPI: WatchPairingAPI
    private let pairingStorage = WatchPairingStorage()
    private var restoredPairing = false
    private var operation: Task<Void, Never>?
    private var actionID = UUID()

    init() {
        let transport = WatchTransport()
        engine = WatchSyncEngine(health: WatchHealthReader(), transport: transport, storage: WatchStorage())
        pairingAPI = WatchPairingAPI(transport: transport)
    }

    var busy: Bool { working || snapshot.busy }
    var connectionReady: Bool { restoredPairing && snapshot.connected && pairing == nil }
    var defaultServer: String { Bundle.main.object(forInfoDictionaryKey: "OpenGymServerURL") as? String ?? "" }

    func refresh() async {
        do {
            snapshot = try await engine.snapshot()
            if !restoredPairing { pairing = try pairingStorage.load(); restoredPairing = true }
        }
        catch { self.error = WatchFailure.message(error) }
    }

    private func run(_ action: @escaping (WatchSyncEngine) async throws -> Void) {
        guard !busy else { return }
        error = nil; working = true
        let id = UUID(); actionID = id
        operation = Task {
            do { try await action(engine) }
            catch { if actionID == id { self.error = WatchFailure.message(error) } }
            if actionID == id { working = false; await refresh() }
        }
    }

    func connect(server: String, owner: String, token: String) {
        guard restoredPairing && pairing == nil else { return }
        run { try await $0.connect(server: server, owner: owner, token: token) }
    }
    func inspect() { guard restoredPairing && pairing == nil else { return }; run { try await $0.inspect() } }
    func sync() { guard restoredPairing && pairing == nil else { return }; run { try await $0.sync() } }

    func startPairing(server: String) {
        guard !busy else { return }
        run { engine in
            if let old = self.pairing {
                try await engine.disconnect()
                try? await self.pairingAPI.cancel(old)
                try Task.checkCancellation()
                try self.pairingStorage.clear(); self.pairing = nil
            }
            guard !(try await engine.snapshot()).connected else { throw WatchFailure.busy }
            self.pairingFeedback = nil
            self.pairingPhase = "生成二维码…"
            let session = try await self.pairingAPI.start(server: server)
            try Task.checkCancellation()
            try self.pairingStorage.save(session)
            self.pairing = session
            try await self.waitForBinding(session)
        }
    }

    func resumePairing() {
        guard let session = pairing else { return }
        run { _ in try await self.waitForBinding(session) }
    }

    private func waitForBinding(_ session: WatchPairingSession) async throws {
        if session.expired {
            try await engine.disconnect()
            throw WatchFailure.pairingExpired
        }
        pairingPhase = "等待手机扫码确认…"
        while !session.expired {
            try Task.checkCancellation()
            let result: WatchPairingResult
            do { result = try await pairingAPI.poll(session) }
            catch WatchFailure.http(429) {
                try await Task.sleep(for: .seconds(10)); continue
            }
            try Task.checkCancellation()
            switch result.status {
            case "pending":
                if result.scanned == true { pairingFeedback = "scanned" }
                try await Task.sleep(for: .seconds(session.interval))
            case "denied": throw WatchFailure.pairingDenied
            case "approved":
                guard let owner = result.owner, let token = result.token else { throw WatchFailure.invalidResponse }
                pairingFeedback = "connecting"
                pairingPhase = "保存连接…"
                let current = try await engine.snapshot()
                if !current.connected { try await engine.connect(server: session.server, owner: owner, token: token) }
                else if current.server != session.server || current.owner != owner { throw WatchFailure.accountMismatch }
                try Task.checkCancellation()
                try await pairingAPI.acknowledge(session)
                try Task.checkCancellation()
                try pairingStorage.clear()
                pairingFeedback = "connected"
                pairing = nil; pairingPhase = nil
                return
            default: throw WatchFailure.invalidResponse
            }
        }
        try await engine.disconnect()
        throw WatchFailure.pairingExpired
    }

    // Leaving the connection page preserves the redemption secret in Keychain; reopening can resume.
    func pausePairing() {
        guard pairing != nil || pairingPhase != nil else { return }
        operation?.cancel(); actionID = UUID(); working = false
        if pairing == nil { pairingPhase = nil }
    }

    func cancelPairing() {
        operation?.cancel(); actionID = UUID(); error = nil; working = true
        let session = pairing
        operation = Task {
            do {
                try await engine.disconnect()
                try pairingStorage.clear(); pairing = nil; pairingPhase = nil
                if let session { try? await pairingAPI.cancel(session) }
            } catch { self.error = WatchFailure.message(error) }
            working = false; await refresh()
        }
    }

    func disconnect() {
        if pairing != nil { cancelPairing(); return }
        operation?.cancel()
        error = nil; working = true
        let id = UUID(); actionID = id
        operation = Task {
            do { try await engine.disconnect(); try pairingStorage.clear(); pairing = nil; pairingPhase = nil }
            catch { self.error = WatchFailure.message(error) }
            if actionID == id { working = false; await refresh() }
        }
    }
}
