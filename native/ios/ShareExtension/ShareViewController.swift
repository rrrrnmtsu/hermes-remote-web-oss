import UIKit
import UniformTypeIdentifiers

/** Local-only, one item. The extension never opens the host app or sends to Hermes/provider. */
final class ShareViewController: UIViewController {
  private let editor = UITextView()
  private let status = UILabel()
  private let saveButton = UIButton(type: .system)
  private var fileDraft: SharedDraft?
  private var configuration: NativeConfiguration?
  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .systemBackground
    editor.font = .preferredFont(forTextStyle: .body); editor.adjustsFontForContentSizeCategory = true
    status.font = .preferredFont(forTextStyle: .body); status.adjustsFontForContentSizeCategory = true; status.numberOfLines = 0
    status.text = "端末内の確認用下書きです。送信はHermes Remoteで内容と宛先を確認してから行います。共有待ちは1件・期限1時間です。"
    saveButton.setTitle("確認用下書きを端末に置く", for: .normal); saveButton.addTarget(self, action: #selector(save), for: .touchUpInside); saveButton.isEnabled = false
    let cancel = UIButton(type: .system); cancel.setTitle("取消", for: .normal); cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [status, editor, saveButton, cancel]); stack.axis = .vertical; stack.spacing = 12; stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16), stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16), stack.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -16), editor.heightAnchor.constraint(greaterThanOrEqualToConstant: 80), saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48), cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
    do { configuration = try NativeConfiguration(); try loadInput() }
    catch { status.text = "共有できるのはテキストまたはJPEG/PNG/TXT/Markdown/CSV/PDF1件です。署名・App Group設定も確認してください。" }
  }
  private func loadInput() throws {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    guard providers.count == 1, let provider = providers.first else { throw NativeFailure.invalid }
    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
      provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { [weak self] item, _ in
        guard let self, let url = item as? URL, url.isFileURL else { DispatchQueue.main.async { self?.status.text = "選択した資料を読み取れません。転送していません。" }; return }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        self.acceptFile(Result { try SharedDraft.file(url, caption: "") })
      }
      return
    }
    let files = [UTType.png.identifier, UTType.jpeg.identifier, UTType.pdf.identifier, UTType.commaSeparatedText.identifier, "net.daringfireball.markdown"]
    if let type = files.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) {
      provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, _ in
        guard let self, let url else { DispatchQueue.main.async { self?.status.text = "選択した資料を読み取れません。転送していません。" }; return }
        self.acceptFile(Result { try SharedDraft.file(url, caption: "") })
      }
    } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
        guard let text = item as? String, text.utf8.count <= SharedDraft.textLimit else { DispatchQueue.main.async { self?.status.text = "テキストは最大64KiBです。" }; return }
        DispatchQueue.main.async { self?.editor.text = text; self?.saveButton.isEnabled = true }
      }
    } else { throw NativeFailure.invalid }
  }
  private func acceptFile(_ result: Result<SharedDraft, Error>) {
    DispatchQueue.main.async { switch result { case .success(let draft): self.fileDraft = draft; self.status.text = "\(draft.name) · \(draft.bytes)bytes\n説明文を入力して確認用下書きへ。送信していません。"; self.saveButton.isEnabled = true
      case .failure: self.status.text = "資料は最大5MiBです。実形式と読み取り権限を確認してください。" } }
  }
  @objc private func save() {
    guard let configuration else { return }
    do {
      let text = editor.text ?? ""
      let draft: SharedDraft
      if let fileDraft {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= SharedDraft.textLimit else { throw NativeFailure.invalid }
        draft = SharedDraft(id: fileDraft.id, kind: "file", name: fileDraft.name, bytes: fileDraft.bytes, expiresAt: SharedDraft.expiry(), text: text, mime: fileDraft.mime, contentBase64: fileDraft.contentBase64)
      } else { draft = try SharedDraft.text(text) }
      try SharedDraftStore(configuration).enqueue(draft)
      editor.text = ""; self.fileDraft = nil; extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    } catch NativeFailure.pending { status.text = "共有待ちが既にあります。Hermes Remoteで取り込むか取消してから、この共有をやり直してください。" }
    catch { status.text = "端末内の保護された下書きを保存できません。内容は送信していません。" }
  }
  @objc private func close() { editor.text = ""; fileDraft = nil; extensionContext?.cancelRequest(withError: NativeFailure.denied) }
}
