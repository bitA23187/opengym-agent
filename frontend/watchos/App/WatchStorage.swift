import Foundation
import Security

final class WatchStorage: WatchStoring {
    private let key: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "opengym.watch.health-sync",
        kSecAttrAccount as String: "connection"
    ]
    private let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("WatchHealthSync", isDirectory: true)
    private var file: URL { directory.appendingPathComponent("state.json") }

    func loadConfiguration() throws -> WatchConfiguration? {
        var query = key; query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw WatchFailure.storage }
        return try JSONDecoder().decode(WatchConfiguration.self, from: data)
    }

    func saveConfiguration(_ value: WatchConfiguration) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(key.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw WatchFailure.storage }
        } else if status != errSecSuccess { throw WatchFailure.storage }
    }

    func removeConfiguration() throws {
        let status = SecItemDelete(key as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw WatchFailure.storage }
    }

    func loadState() throws -> WatchState? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try JSONDecoder().decode(WatchState.self, from: Data(contentsOf: file))
    }

    func saveState(_ value: WatchState) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var folder = directory; try folder.setResourceValues(values)
        try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var destination = file; try destination.setResourceValues(values)
    }

    func removeState() throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }
}
