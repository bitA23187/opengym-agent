import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin {
    private var stateObserver: NSObjectProtocol?
    public override func load() {
        stateObserver = NotificationCenter.default.addObserver(forName: HealthKitSync.stateChanged, object: nil, queue: .main) { [weak self] _ in
            // No account, credentials or health records cross the event channel.
            self?.notifyListeners("healthSyncChanged", data: [:])
        }
    }
    deinit { if let observer = stateObserver { NotificationCenter.default.removeObserver(observer) } }
    @objc func status(_ call: CAPPluginCall) {
        Task { do {
            let owner = call.getString("owner") ?? ""
            if let server = call.getString("server"), let token = call.getString("token") {
                try await HealthKitSync.shared.refreshSession(server: server, token: token, owner: owner)
            }
            var result = try await HealthKitSync.shared.status(owner: owner)
            result["available"] = HKHealthStore.isHealthDataAvailable(); call.resolve(result)
        } catch { call.reject("Health sync state unavailable. Unlock iPhone and retry.") } }
    }
    @objc func enable(_ call: CAPPluginCall) {
        guard let server = call.getString("server"), let token = call.getString("token"), let owner = call.getString("owner") else { call.reject("Server, credential and account required."); return }
        Task { do { try await HealthKitSync.shared.enable(server: server, token: token, owner: owner); call.resolve(try await HealthKitSync.shared.status(owner: owner)) } catch { call.reject("Could not enable Health sync. Check Health permissions and account settings.") } }
    }
    @objc func sync(_ call: CAPPluginCall) {
        let owner = call.getString("owner") ?? ""
        Task { do {
            guard try await HealthKitSync.shared.status(owner: owner)["enabled"] as? Bool == true else { call.reject("Health sync is not enabled for this account."); return }
            await HealthKitSync.shared.sync(manual: true); call.resolve(try await HealthKitSync.shared.status(owner: owner))
        } catch { call.reject("Health sync state unavailable.") } }
    }
    @objc func disable(_ call: CAPPluginCall) {
        Task { do { try await HealthKitSync.shared.disable(); call.resolve(["enabled": false]) } catch { call.reject("Could not clear Health sync credentials.") } }
    }
}
