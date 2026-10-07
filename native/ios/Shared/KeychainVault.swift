import Foundation
import Security
import LocalAuthentication
import CryptoKit

/** Own AES material only. Hermes/provider tokens and WebKit cookies are never returned to JavaScript. */
final class KeychainVault {
  let configuration: NativeConfiguration
  init(_ configuration: NativeConfiguration) { self.configuration = configuration }
  private func query(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "HermesRemote.Native.v1",
     kSecAttrAccount as String: configuration.namespace + ":" + account,
     kSecAttrAccessGroup as String: configuration.keychainGroup]
  }
  var available: Bool {
    var query = query("capability-probe")
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    return status == errSecItemNotFound || status == errSecSuccess
  }
  func key(_ account: String, context: LAContext?, presence: Bool, create: Bool) throws -> SymmetricKey? {
    var lookup = query(account); lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    if let context { lookup[kSecUseAuthenticationContext as String] = context }
    var item: CFTypeRef?; let status = SecItemCopyMatching(lookup as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data, data.count == 32 { return SymmetricKey(data: data) }
    guard status == errSecItemNotFound else { throw NativeFailure.denied }
    if !create { return nil }
    var random = [UInt8](repeating: 0, count: 32)
    let result = random.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }
    guard result == errSecSuccess else { throw NativeFailure.unavailable }
    let data = Data(random); var insert = query(account); insert[kSecValueData as String] = data
    if presence {
      var error: Unmanaged<CFError>?
      guard let control = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.userPresence], &error) else { throw NativeFailure.unavailable }
      insert[kSecAttrAccessControl as String] = control
      if let context { insert[kSecUseAuthenticationContext as String] = context }
    } else { insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly }
    let inserted = SecItemAdd(insert as CFDictionary, nil)
    if inserted == errSecDuplicateItem { return try key(account, context: context, presence: presence, create: false) }
    guard inserted == errSecSuccess else { throw NativeFailure.denied }
    return SymmetricKey(data: data)
  }
  func remove(_ account: String) throws {
    let status = SecItemDelete(query(account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeFailure.denied }
  }
}
