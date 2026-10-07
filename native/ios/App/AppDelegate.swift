import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = WebShellViewController(); window.makeKeyAndVisible(); self.window = window; return true
  }
  func applicationWillResignActive(_ application: UIApplication) { (window?.rootViewController as? WebShellViewController)?.coverForPrivacy() }
  func applicationDidEnterBackground(_ application: UIApplication) { (window?.rootViewController as? WebShellViewController)?.lock() }
  func applicationDidBecomeActive(_ application: UIApplication) { (window?.rootViewController as? WebShellViewController)?.becameActive() }
}
