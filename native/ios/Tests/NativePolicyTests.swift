import XCTest
@testable import HermesRemote

final class NativePolicyTests: XCTestCase {
  func testSharedTextIsDraftAndBounded() throws {
    let draft = try SharedDraft.text("日本語の共有テキスト\n改行")
    XCTAssertEqual(draft.kind, "text"); XCTAssertEqual(draft.mime, "text/plain"); XCTAssertEqual(draft.contentBase64, "")
    XCTAssertEqual(draft.bytes, draft.text.utf8.count); XCTAssertNotNil(UUID(uuidString: draft.id))
    XCTAssertGreaterThan(draft.expiresAt, Int64(Date().timeIntervalSince1970 * 1000))
    XCTAssertThrowsError(try SharedDraft.text(" "))
    XCTAssertThrowsError(try SharedDraft.text(String(repeating: "あ", count: SharedDraft.textLimit)))
  }
  func testDigestDoesNotPersistPlainScope() {
    let value = NativeConfiguration.digest(Data("DEMO-principal/profile/session".utf8))
    XCTAssertEqual(value.count, 64); XCTAssertFalse(value.contains("DEMO"))
    XCTAssertNotEqual(value, NativeConfiguration.digest(Data("other-principal/profile/session".utf8)))
  }
  func testURLSharesAndUnsupportedFilesAreRefused() throws {
    XCTAssertThrowsError(try SharedDraft.file(URL(string: "https://example.invalid/private.png")!, caption: "説明"))
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".svg")
    try Data("<svg/>".utf8).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    XCTAssertThrowsError(try SharedDraft.file(file, caption: "説明"))
  }
  func testQueuedRemovalDoesNotRunAfterInvalidation() throws {
    let gate = NativeOperationGate()
    let token = gate.capture(scopeKey: "DEMO-scope", deviceGeneration: 0)
    let queue = DispatchQueue(label: "DEMO.NativeQueueCancellation")
    let entered = DispatchSemaphore(value: 0); let release = DispatchSemaphore(value: 0)
    let finished = expectation(description: "Queued operation refuses obsolete authority")
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data("DEMO-owned-content".utf8).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    queue.async { entered.signal(); release.wait() }
    XCTAssertEqual(entered.wait(timeout: .now() + 2), .success)
    queue.async {
      do {
        try gate.perform(token) { try FileManager.default.removeItem(at: file) }
        XCTFail("An invalidated queued operation performed its side effect")
      } catch { XCTAssertEqual(error as? NativeFailure, .denied) }
      finished.fulfill()
    }
    gate.invalidate(); release.signal(); wait(for: [finished], timeout: 3)
    XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
  }
  func testQueuedShareFinishDoesNotRemovePendingAfterScopeChange() {
    let gate = NativeOperationGate()
    let stale = gate.capture(scopeKey: "DEMO-scope-A", deviceGeneration: 3)
    let queue = DispatchQueue(label: "DEMO.NativeShareScopeCancellation")
    let entered = DispatchSemaphore(value: 0); let release = DispatchSemaphore(value: 0)
    let finished = expectation(description: "Queued share finish preserves pending content")
    queue.async { entered.signal(); release.wait() }
    XCTAssertEqual(entered.wait(timeout: .now() + 2), .success)
    queue.async {
      XCTAssertThrowsError(try gate.perform(stale) { XCTFail("Stale share finish executed") })
      finished.fulfill()
    }
    let next = gate.capture(scopeKey: "DEMO-scope-B", deviceGeneration: 3)
    release.signal(); wait(for: [finished], timeout: 3)
    XCTAssertFalse(gate.isCurrent(stale)); XCTAssertTrue(gate.isCurrent(next))
    XCTAssertNoThrow(try gate.perform(next) { true })
    gate.invalidate(); XCTAssertFalse(gate.isCurrent(next))
  }
}
