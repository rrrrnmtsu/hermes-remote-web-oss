import Foundation
import WebKit
import UIKit

/** Every operation is origin/main-frame scoped. This bridge deliberately has no network or prompt operation. */
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
  private weak var owner: WebShellViewController?
  private let configuration: NativeConfiguration
  private let store: SharedDraftStore
  private let queue = DispatchQueue(label: "HermesRemote.NativeStore", qos: .userInitiated)
  private let operations = NativeOperationGate()
  private var offered: (id: String, scope: String, generation: Int, token: NativeOperationGate.Token)?
  init(owner: WebShellViewController, configuration: NativeConfiguration) { self.owner = owner; self.configuration = configuration; self.store = SharedDraftStore(configuration) }
  func invalidate() { operations.invalidate(); offered = nil }
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void) {
    let security = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame, security.protocol == "https", security.host.lowercased() == configuration.host,
      (security.port == 0 ? 443 : security.port) == configuration.port, configuration.permitsApplication(message.webView?.url),
      let body = message.body as? [String: Any], Set(body.keys) == Set(["version", "id", "method", "scope", "params"]),
      body["version"] as? Int == 1, let id = body["id"] as? String, id.hasPrefix("native-"), id.count <= 80,
      let method = body["method"] as? String, let params = body["params"] as? [String: Any] else { replyHandler(nil, "invalid"); return }
    let complete: (Result<Any, Error>) -> Void = { result in
      switch result {
      case .success(let value): replyHandler(["version": 1, "id": id, "ok": true, "value": value], nil)
      case .failure(let error): replyHandler(["version": 1, "id": id, "ok": false, "error": (error as? NativeFailure)?.rawValue ?? "invalid"], nil)
      }
    }
    guard let owner else { complete(.failure(NativeFailure.unavailable)); return }
    if method == "device.invalidate" {
      guard params.isEmpty, body["scope"] is NSNull else { complete(.failure(NativeFailure.invalid)); return }
      invalidate(); owner.invalidateBridgeAuthentication(); complete(.success(true)); return
    }
    if method == "device.capabilities", params.isEmpty {
      complete(.success(["version": 1, "origin": configuration.origin, "scopeInvalidationVersion": 1, "keychain": KeychainVault(configuration).available,
        "sharing": store.available, "maxFileBytes": SharedDraft.fileLimit, "maxStorageBytes": SharedDraftStore.storageLimit])); return
    }
    if method == "device.authenticate", params.isEmpty { invalidate(); owner.authenticate { complete($0 ? .success(true) : .failure(NativeFailure.denied)) }; return }
    do {
      let scope = try NativeScope(body["scope"], configuration: configuration)
      guard let context = owner.authentication else { throw NativeFailure.denied }
      let generation = owner.generation
      let token = operations.capture(scopeKey: scope.key, deviceGeneration: generation)
      if let offered, offered.token != token { self.offered = nil }
      let execute: (@escaping () throws -> Any) -> Void = { action in
        self.queue.async {
          let result = Result { try self.operations.perform(token, action: action) }
          DispatchQueue.main.async {
            guard self.operations.isCurrent(token), owner.generation == generation, owner.authentication != nil else { complete(.failure(NativeFailure.denied)); return }
            complete(result)
          }
        }
      }
      switch method {
      case "storage.save":
        guard Set(params.keys) == Set(["value", "expiresAt"]), let value = params["value"] as? String, value.utf8.count <= SharedDraftStore.storageLimit,
          let expires = params["expiresAt"] as? NSNumber else { throw NativeFailure.invalid }
        execute { try self.store.save(value, scope: scope, expiresAt: expires.int64Value, context: context); return true }
      case "storage.read":
        guard params.isEmpty else { throw NativeFailure.invalid }
        execute { try self.store.read(scope: scope, context: context) as Any? ?? NSNull() }
      case "storage.remove":
        guard params.isEmpty else { throw NativeFailure.invalid }
        owner.confirm("端末保存を消去", message: "この利用者・profile・会話の暗号化保存と鍵だけを消去します。Hermesの履歴は変更しません。") { accepted in
          guard accepted, self.operations.isCurrent(token), owner.generation == generation else { complete(.failure(NativeFailure.denied)); return }
          execute { try self.store.remove(scope: scope); return true }
        }
      case "share.pending":
        guard params.isEmpty else { throw NativeFailure.invalid }
        execute { try self.store.pending()?.metadata as Any? ?? NSNull() }
      case "share.accept":
        guard Set(params.keys) == Set(["id"]), let pendingID = params["id"] as? String, UUID(uuidString: pendingID) != nil else { throw NativeFailure.invalid }
        owner.confirm("共有内容を下書きへ取り込む", message: "profile: \(scope.profile)\n現在の会話の下書きへ取り込みます。選択だけでは送信しません。") { accepted in
          guard accepted, self.operations.isCurrent(token), owner.generation == generation else { complete(.failure(NativeFailure.denied)); return }
          self.offered = (pendingID, scope.key, generation, token)
          execute { guard let pending = try self.store.pending(), pending.id == pendingID else { throw NativeFailure.denied }; return pending.payload }
        }
      case "share.finish":
        guard Set(params.keys) == Set(["id"]), let pendingID = params["id"] as? String,
          let offered, offered.id == pendingID, offered.scope == scope.key, offered.generation == generation,
          offered.token == token, operations.isCurrent(offered.token) else { throw NativeFailure.denied }
        self.offered = nil
        execute { try self.store.removeShare(pendingID); return true }
      case "share.cancel":
        guard Set(params.keys) == Set(["id"]), let pendingID = params["id"] as? String, UUID(uuidString: pendingID) != nil else { throw NativeFailure.invalid }
        owner.confirm("共有待ちを取消", message: "この端末の一致する共有待ちだけを消去します。共有元の原本とVPSは変更しません。") { accepted in
          guard accepted, self.operations.isCurrent(token), owner.generation == generation else { complete(.failure(NativeFailure.denied)); return }
          self.offered = nil; execute { try self.store.removeShare(pendingID); return true }
        }
      default: throw NativeFailure.denied
      }
    } catch { complete(.failure(error)) }
  }
}
