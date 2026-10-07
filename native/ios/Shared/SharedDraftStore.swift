import Foundation
import CryptoKit
import LocalAuthentication
import Darwin

/** Explicit native storage lives only in this app group, encrypted, bounded and expiry checked. */
final class SharedDraftStore {
  static let storageLimit = 1024 * 1024
  private let configuration: NativeConfiguration
  private let vault: KeychainVault
  init(_ configuration: NativeConfiguration) { self.configuration = configuration; vault = KeychainVault(configuration) }
  var available: Bool { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: configuration.appGroup) != nil }
  private func directory() throws -> URL {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: configuration.appGroup) else { throw NativeFailure.unavailable }
    let directory = container.appendingPathComponent("HermesRemote/v1/" + configuration.namespace, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
    return directory
  }
  private func boundedRead(_ url: URL, limit: Int) throws -> Data? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let descriptor = url.withUnsafeFileSystemRepresentation { path in path.map { Darwin.open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC) } ?? -1 }
    guard descriptor >= 0 else { throw NativeFailure.denied }; defer { Darwin.close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size > 0, info.st_size <= limit else { throw NativeFailure.invalid }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
    guard let data = try handle.read(upToCount: Int(info.st_size) + 1), data.count == Int(info.st_size) else { throw NativeFailure.invalid }
    return data
  }
  private func coordinated<T>(_ url: URL, write: Bool, _ action: (URL) throws -> T) throws -> T {
    let coordinator = NSFileCoordinator(filePresenter: nil); var error: NSError?; var result: Result<T, Error>?
    let accessor: (URL) -> Void = { location in result = Result { try action(location) } }
    if write { coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &error, byAccessor: accessor) }
    else { coordinator.coordinate(readingItemAt: url, options: [], error: &error, byAccessor: accessor) }
    if error != nil { throw NativeFailure.unavailable }; guard let result else { throw NativeFailure.unavailable }; return try result.get()
  }
  func enqueue(_ draft: SharedDraft) throws {
    let url = try directory().appendingPathComponent("pending-share.aes")
    try coordinated(url, write: true) { location in
      guard let key = try vault.key("share", context: nil, presence: false, create: true) else { throw NativeFailure.unavailable }
      if let previous = try boundedRead(location, limit: SharedDraft.fileLimit * 4 / 3 + SharedDraft.textLimit * 6 + 16384) {
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: previous), using: key, authenticating: Data(configuration.origin.utf8))
        let old = try JSONDecoder().decode(SharedDraft.self, from: plain)
        guard old.expiresAt <= Int64(Date().timeIntervalSince1970 * 1000) else { throw NativeFailure.pending }
        try FileManager.default.removeItem(at: location) // Expired, authenticated, app-owned handoff only.
      }
      let plain = try JSONEncoder.sorted.encode(draft)
      guard plain.count <= SharedDraft.fileLimit * 4 / 3 + SharedDraft.textLimit * 6 + 16384 else { throw NativeFailure.too_large }
      guard let sealed = try AES.GCM.seal(plain, using: key, authenticating: Data(configuration.origin.utf8)).combined else { throw NativeFailure.unavailable }
      try sealed.write(to: location, options: [.atomic, .completeFileProtection])
    }
  }
  func pending() throws -> SharedDraft? {
    let url = try directory().appendingPathComponent("pending-share.aes")
    return try coordinated(url, write: true) { location in
      guard let data = try boundedRead(location, limit: SharedDraft.fileLimit * 4 / 3 + SharedDraft.textLimit * 6 + 16384) else { return nil }
      guard let key = try vault.key("share", context: nil, presence: false, create: false) else { throw NativeFailure.denied }
      let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key, authenticating: Data(configuration.origin.utf8))
      let draft = try JSONDecoder().decode(SharedDraft.self, from: plain)
      if draft.expiresAt <= Int64(Date().timeIntervalSince1970 * 1000) { try FileManager.default.removeItem(at: location); return nil }
      return draft
    }
  }
  func removeShare(_ id: String) throws {
    guard UUID(uuidString: id) != nil else { throw NativeFailure.invalid }
    let url = try directory().appendingPathComponent("pending-share.aes")
    try coordinated(url, write: true) { location in
      guard let data = try boundedRead(location, limit: SharedDraft.fileLimit * 4 / 3 + SharedDraft.textLimit * 6 + 16384),
        let key = try vault.key("share", context: nil, presence: false, create: false) else { throw NativeFailure.denied }
      let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key, authenticating: Data(configuration.origin.utf8))
      guard try JSONDecoder().decode(SharedDraft.self, from: plain).id == id else { throw NativeFailure.denied }
      try FileManager.default.removeItem(at: location) // Only this matching, app-owned encrypted handoff.
    }
  }
  private struct Snapshot: Codable { let scope: NativeScope; let value: String; let expiresAt: Int64 }
  func save(_ value: String, scope: NativeScope, expiresAt: Int64, context: LAContext) throws {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard !value.isEmpty, value.utf8.count <= Self.storageLimit, expiresAt > now, expiresAt <= now + 7 * 86400 * 1000 else { throw NativeFailure.too_large }
    let location = try directory().appendingPathComponent("snapshot-" + scope.key + ".aes")
    try coordinated(location, write: true) { url in
      let plain = try JSONEncoder.sorted.encode(Snapshot(scope: scope, value: value, expiresAt: expiresAt))
      let entries = try FileManager.default.contentsOfDirectory(at: url.deletingLastPathComponent(), includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        .filter { $0.lastPathComponent.hasPrefix("snapshot-") && $0.pathExtension == "aes" }
      var total = plain.count + 28 // AES-GCM combined nonce/tag overhead.
      for entry in entries where entry != url {
        let values = try entry.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize else { throw NativeFailure.invalid }
        total += size
      }
      guard entries.count < 110 || entries.contains(url), total <= 20 * 1024 * 1024 else { throw NativeFailure.too_large }
      guard let key = try vault.key("snapshot-" + scope.key, context: context, presence: true, create: true),
        let sealed = try AES.GCM.seal(plain, using: key, authenticating: scope.authenticatedData).combined else { throw NativeFailure.unavailable }
      try sealed.write(to: url, options: [.atomic, .completeFileProtection])
    }
  }
  func read(scope: NativeScope, context: LAContext) throws -> String? {
    let location = try directory().appendingPathComponent("snapshot-" + scope.key + ".aes")
    return try coordinated(location, write: false) { url in
      guard let data = try boundedRead(url, limit: Self.storageLimit * 6 + 16384) else { return nil }
      guard let key = try vault.key("snapshot-" + scope.key, context: context, presence: true, create: false) else { throw NativeFailure.denied }
      let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key, authenticating: scope.authenticatedData)
      let snapshot = try JSONDecoder().decode(Snapshot.self, from: plain)
      guard snapshot.scope == scope, snapshot.value.utf8.count <= Self.storageLimit else { throw NativeFailure.denied }
      guard snapshot.expiresAt > Int64(Date().timeIntervalSince1970 * 1000) else { throw NativeFailure.expired }
      return snapshot.value
    }
  }
  func remove(scope: NativeScope) throws {
    let location = try directory().appendingPathComponent("snapshot-" + scope.key + ".aes")
    try coordinated(location, write: true) { url in
      if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
      try vault.remove("snapshot-" + scope.key)
    }
  }
}
