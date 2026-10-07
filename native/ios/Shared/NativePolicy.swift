import Foundation
import CryptoKit
import Darwin

enum NativeFailure: String, Error { case invalid, denied, unavailable, expired, too_large, pending }

/** Cross-thread eligibility for queued operations. Invalidation never waits for file I/O. */
final class NativeOperationGate: @unchecked Sendable {
  struct Token: Equatable, Sendable { let marker: UUID; let scopeKey: String; let deviceGeneration: Int }
  private let lock = NSLock()
  private var marker = UUID()
  private var binding: (scopeKey: String, deviceGeneration: Int)?

  func capture(scopeKey: String, deviceGeneration: Int) -> Token {
    lock.lock(); defer { lock.unlock() }
    if binding?.scopeKey != scopeKey || binding?.deviceGeneration != deviceGeneration {
      marker = UUID(); binding = (scopeKey, deviceGeneration)
    }
    return Token(marker: marker, scopeKey: scopeKey, deviceGeneration: deviceGeneration)
  }
  func invalidate() { lock.lock(); defer { lock.unlock() }; marker = UUID(); binding = nil }
  func isCurrent(_ token: Token) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return marker == token.marker && binding?.scopeKey == token.scopeKey && binding?.deviceGeneration == token.deviceGeneration
  }
  func perform<T>(_ token: Token, action: () throws -> T) throws -> T {
    // This is the action's admission point. Already-running I/O is not rolled back;
    // work waiting in the queue must never act after lock/scope invalidation.
    guard isCurrent(token) else { throw NativeFailure.denied }
    return try action()
  }
}

struct NativeConfiguration {
  let origin: String
  let host: String
  let port: Int
  let appGroup: String
  let keychainGroup: String
  var webURL: URL { URL(string: origin + "/hermes-remote-web/")! }

  init(bundle: Bundle = .main) throws {
    guard let raw = bundle.object(forInfoDictionaryKey: "HermesApprovedOrigin") as? String,
      let parts = URLComponents(string: raw), parts.scheme == "https", let host = parts.host,
      !host.isEmpty, parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      parts.path.isEmpty, let group = bundle.object(forInfoDictionaryKey: "HermesAppGroup") as? String,
      let keychain = bundle.object(forInfoDictionaryKey: "HermesKeychainGroup") as? String,
      group.hasPrefix("group."), !group.contains("$("), !keychain.isEmpty, !keychain.contains("$(") else { throw NativeFailure.invalid }
    let port = parts.port ?? 443
    guard (1...65535).contains(port) else { throw NativeFailure.invalid }
    let hostname = host.lowercased()
    let origin = "https://" + (hostname.contains(":") && !hostname.hasPrefix("[") ? "[" + hostname + "]" : hostname) + (port == 443 ? "" : ":\(port)")
    guard raw == origin else { throw NativeFailure.invalid }
    self.origin = origin; self.host = hostname; self.port = port; self.appGroup = group; self.keychainGroup = keychain
  }

  func permits(_ url: URL?) -> Bool {
    guard let url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
    return parts.scheme == "https" && parts.host?.lowercased() == host && (parts.port ?? 443) == port && parts.user == nil && parts.password == nil
  }
  func permitsApplication(_ url: URL?) -> Bool {
    guard permits(url), let path = url?.path else { return false }
    return path == "/hermes-remote-web" || path.hasPrefix("/hermes-remote-web/")
  }
  var namespace: String { Self.digest(Data(origin.utf8)) }
  static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}

struct NativeScope: Codable, Equatable {
  let origin: String
  let principal: String
  let profile: String
  let durableSession: String
  init(_ value: Any?, configuration: NativeConfiguration) throws {
    guard let value = value as? [String: String], Set(value.keys) == Set(["origin", "principal", "profile", "durableSession"]),
      value["origin"] == configuration.origin else { throw NativeFailure.denied }
    for name in ["principal", "profile", "durableSession"] {
      guard let field = value[name], !field.isEmpty, field.count <= 200,
        !field.unicodeScalars.contains(where: { $0.value < 32 }) else { throw NativeFailure.invalid }
    }
    origin = value["origin"]!; principal = value["principal"]!; profile = value["profile"]!; durableSession = value["durableSession"]!
  }
  var authenticatedData: Data { try! JSONEncoder.sorted.encode(self) }
  var key: String { NativeConfiguration.digest(authenticatedData) }
}

extension JSONEncoder {
  static var sorted: JSONEncoder { let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; return encoder }
}

struct SharedDraft: Codable {
  let id: String
  let kind: String
  let name: String
  let bytes: Int
  let expiresAt: Int64
  let text: String
  let mime: String
  let contentBase64: String
  var metadata: [String: Any] { ["id": id, "kind": kind, "name": name, "bytes": bytes, "expiresAt": expiresAt] }
  var payload: [String: Any] { metadata.merging(["text": text, "mime": mime, "contentBase64": contentBase64]) { _, new in new } }
  static let fileLimit = 5 * 1024 * 1024
  static let textLimit = 64 * 1024
  static func text(_ value: String) throws -> SharedDraft {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, value.utf8.count <= textLimit else { throw NativeFailure.too_large }
    return SharedDraft(id: UUID().uuidString, kind: "text", name: "共有テキスト", bytes: value.utf8.count,
      expiresAt: expiry(), text: value, mime: "text/plain", contentBase64: "")
  }
  static func file(_ url: URL, caption: String) throws -> SharedDraft {
    guard url.isFileURL, caption.utf8.count <= textLimit else { throw NativeFailure.too_large }
    let descriptor = url.withUnsafeFileSystemRepresentation { path in path.map { Darwin.open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC) } ?? -1 }
    guard descriptor >= 0 else { throw NativeFailure.denied }; defer { Darwin.close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size > 0, info.st_size <= fileLimit else { throw NativeFailure.too_large }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
    guard let data = try handle.read(upToCount: Int(info.st_size) + 1), data.count == Int(info.st_size) else { throw NativeFailure.invalid }
    let suffix = url.pathExtension.lowercased()
    let mimes = ["txt": "text/plain", "md": "text/markdown", "markdown": "text/markdown", "csv": "text/csv", "pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"]
    guard let mime = mimes[suffix] else { throw NativeFailure.invalid }
    if mime == "image/png" { guard data.starts(with: [137,80,78,71,13,10,26,10]) else { throw NativeFailure.invalid } }
    else if mime == "image/jpeg" { guard data.starts(with: [255,216,255]), data.suffix(2) == Data([255,217]) else { throw NativeFailure.invalid } }
    else if mime == "application/pdf" { guard data.starts(with: Data("%PDF-".utf8)) else { throw NativeFailure.invalid } }
    else { guard !data.contains(0), let text = String(data: data, encoding: .utf8), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw NativeFailure.invalid } }
    let stem = url.deletingPathExtension().lastPathComponent.unicodeScalars.filter { $0.value >= 32 && $0.value != 127 && $0 != "/" && $0 != "\\" }.map(String.init).joined()
    let name = String(stem.prefix(max(1, 119 - suffix.count))) + "." + suffix
    return SharedDraft(id: UUID().uuidString, kind: "file", name: name, bytes: data.count, expiresAt: expiry(),
      text: caption, mime: mime, contentBase64: data.base64EncodedString())
  }
  static func expiry() -> Int64 { Int64((Date().timeIntervalSince1970 + 3600) * 1000) }
}
