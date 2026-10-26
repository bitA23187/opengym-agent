import Foundation
import Security

// The device redemption secret never appears in the QR or a preferences file.
final class WatchPairingStorage {
    private let key: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "opengym.watch.health-sync", kSecAttrAccount as String: "pairing"]
    func load() throws -> WatchPairingSession? {
        var query = key; query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw WatchFailure.storage }
        return try JSONDecoder().decode(WatchPairingSession.self, from: data)
    }
    func save(_ session: WatchPairingSession) throws {
        let values: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(session),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(key as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(key.merging(values) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw WatchFailure.storage }
        } else if status != errSecSuccess { throw WatchFailure.storage }
    }
    func clear() throws {
        let status = SecItemDelete(key as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw WatchFailure.storage }
    }
}
