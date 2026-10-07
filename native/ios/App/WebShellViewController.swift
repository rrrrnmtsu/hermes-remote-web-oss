import UIKit
import WebKit
import LocalAuthentication

/** The entire chat UI is the existing same-origin React application, not a second renderer. */
final class WebShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  private var configuration: NativeConfiguration?
  private var webView: WKWebView?
  private var bridge: NativeBridge?
  private let shield = UIView()
  private let message = UILabel()
  private let unlockButton = UIButton(type: .system)
  private var hasLoaded = false
  private(set) var authentication: LAContext?
  private(set) var generation = 0
  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .systemBackground
    shield.backgroundColor = .systemBackground; shield.frame = view.bounds; shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    message.text = "端末認証でHermes Remoteを開きます。"; message.numberOfLines = 0; message.textAlignment = .center
    message.font = .preferredFont(forTextStyle: .body); message.adjustsFontForContentSizeCategory = true
    unlockButton.setTitle("Face ID／端末認証で開く", for: .normal); unlockButton.addTarget(self, action: #selector(unlock), for: .touchUpInside)
    unlockButton.titleLabel?.font = .preferredFont(forTextStyle: .body); unlockButton.titleLabel?.adjustsFontForContentSizeCategory = true
    let stack = UIStackView(arrangedSubviews: [message, unlockButton]); stack.axis = .vertical; stack.spacing = 20
    stack.translatesAutoresizingMaskIntoConstraints = false; shield.addSubview(stack)
    NSLayoutConstraint.activate([stack.centerYAnchor.constraint(equalTo: shield.centerYAnchor), stack.leadingAnchor.constraint(equalTo: shield.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: shield.trailingAnchor, constant: -24), unlockButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)])
    do {
      let configuration = try NativeConfiguration(); self.configuration = configuration
      let webConfiguration = WKWebViewConfiguration(); webConfiguration.websiteDataStore = .default()
      let bridge = NativeBridge(owner: self, configuration: configuration); self.bridge = bridge
      webConfiguration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "hermesRemote")
      let webView = WKWebView(frame: view.bounds, configuration: webConfiguration); self.webView = webView
      webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]; webView.navigationDelegate = self; webView.uiDelegate = self
      webView.scrollView.contentInsetAdjustmentBehavior = .never; webView.allowsBackForwardNavigationGestures = false
      view.addSubview(webView)
    } catch { message.text = "承認済みHTTPS接続先と署名設定が必要です。導入設定を確認してください。"; unlockButton.isEnabled = false }
    view.addSubview(shield)
  }
  func coverForPrivacy() { shield.isHidden = false }
  func lock() { bridge?.invalidate(); generation += 1; authentication?.invalidate(); authentication = nil; coverForPrivacy() }
  /** JS scope/auth expiry revokes native storage authority without changing the Web conversation. */
  func invalidateBridgeAuthentication() { generation += 1; authentication?.invalidate(); authentication = nil }
  func becameActive() { if authentication != nil { shield.isHidden = true } }
  @objc private func unlock() { authenticate { _ in } }
  func authenticate(_ completion: @escaping (Bool) -> Void) {
    guard configuration != nil else { completion(false); return }
    let token = generation; let context = LAContext(); context.localizedCancelTitle = "取消"
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { message.text = "端末のパスコードまたは生体認証を設定してください。"; completion(false); return }
    unlockButton.isEnabled = false
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Hermes Remoteの会話と端末保存を開きます。") { [weak self] success, _ in
      DispatchQueue.main.async {
        guard let self else { completion(false); return }
        self.unlockButton.isEnabled = true
        guard success, token == self.generation, UIApplication.shared.applicationState != .background else { context.invalidate(); completion(false); return }
        self.authentication?.invalidate(); self.authentication = context; self.shield.isHidden = UIApplication.shared.applicationState == .active
        if !self.hasLoaded, let configuration = self.configuration { self.hasLoaded = true; self.webView?.load(URLRequest(url: configuration.webURL)) }
        else { self.webView?.evaluateJavaScript("window.dispatchEvent(new Event('hermes-native-resume'))", completionHandler: nil) }
        completion(true)
      }
    }
  }
  func confirm(_ title: String, message: String, completion: @escaping (Bool) -> Void) {
    guard presentedViewController == nil, authentication != nil else { completion(false); return }
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completion(false) })
    alert.addAction(UIAlertAction(title: "確認して続ける", style: .default) { _ in completion(true) }); present(alert, animated: true)
  }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let configuration, configuration.permits(navigationAction.request.url) else { decisionHandler(.cancel); return }
    if navigationAction.targetFrame == nil { decisionHandler(.cancel); return }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    // No authenticated URL or native error detail is printed or returned to the page.
    if !hasLoaded { message.text = "接続できません。ネットワークを確認して開き直してください。" }
  }
}
