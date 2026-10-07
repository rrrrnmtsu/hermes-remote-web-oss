#!/usr/bin/env python3
"""Verify deterministic project/entitlement/source ownership; this does not substitute for Xcode."""
from pathlib import Path
import plistlib
import unittest

from generate_project import ROOT, outputs, project


class NativeSourceContract(unittest.TestCase):
    def test_project_is_current_and_every_source_exists(self):
        for path, content in outputs().items():
            self.assertEqual(path.read_text(), content)
        value, targets = project()
        self.assertEqual(set(targets), {"HermesRemote", "HermesRemoteShare", "HermesRemoteTests"})
        for item in value["objects"].values():
            if item["isa"] == "PBXFileReference" and item["sourceTree"] == "<group>":
                self.assertTrue((ROOT / item["path"]).is_file(), item["path"])

    def test_shared_entitlements_are_identical_and_origin_is_never_guessed(self):
        app = plistlib.loads((ROOT / "App/HermesRemote.entitlements").read_bytes())
        share = plistlib.loads((ROOT / "ShareExtension/HermesRemoteShare.entitlements").read_bytes())
        self.assertEqual(app, share)
        self.assertEqual(app["com.apple.security.application-groups"], ["$(HERMES_APP_GROUP)"])
        for directory in ("App", "ShareExtension"):
            info = plistlib.loads((ROOT / directory / "Info.plist").read_bytes())
            self.assertEqual(info["HermesApprovedOrigin"], "$(HERMES_APPROVED_ORIGIN)")
            self.assertNotIn("NSAllowsArbitraryLoads", str(info))

    def test_every_bridge_method_has_native_allowlist_and_no_rpc_or_token_escape(self):
        bridge = (ROOT / "App/NativeBridge.swift").read_text()
        for name in ["device.capabilities", "device.authenticate", "device.invalidate", "storage.save", "storage.read", "storage.remove", "share.pending", "share.accept", "share.finish", "share.cancel"]:
            self.assertIn('"' + name + '"', bridge)
        for name in ["prompt.submit", "approval.respond", "URLSession", "HTTPCookie", "api_key", "UIPasteboard"]:
            self.assertNotIn(name, bridge)
        self.assertIn("message.frameInfo.isMainFrame", bridge)
        self.assertIn("configuration.permitsApplication(message.webView?.url)", bridge)

    def test_project_does_not_sign_install_or_request_provisioning(self):
        for item in project()[0]["objects"].values():
            if item["isa"] == "XCBuildConfiguration":
                self.assertEqual(item["buildSettings"].get("HERMES_APPROVED_ORIGIN"), "")
        self.assertNotIn("packageReferences", str(project()[0]))
        self.assertFalse(any(ROOT.glob("Pods/**")))

    def test_native_queue_checks_thread_safe_token_before_action_and_reply(self):
        bridge = (ROOT / "App/NativeBridge.swift").read_text()
        policy = (ROOT / "Shared/NativePolicy.swift").read_text()
        tests = (ROOT / "Tests/NativePolicyTests.swift").read_text()
        queue_body = bridge.split("self.queue.async {", 1)[1].split("DispatchQueue.main.async", 1)[0]
        self.assertIn("self.operations.perform(token, action: action)", queue_body)
        self.assertNotIn("owner.generation", queue_body)
        self.assertIn("self.operations.isCurrent(token), owner.generation == generation", bridge)
        self.assertIn("operations.invalidate(); offered = nil", bridge)
        self.assertIn("private let lock = NSLock()", policy)
        self.assertLess(policy.index("guard isCurrent(token)"), policy.index("return try action()"))
        self.assertIn("testQueuedRemovalDoesNotRunAfterInvalidation", tests)
        self.assertIn("testQueuedShareFinishDoesNotRemovePendingAfterScopeChange", tests)
        shell = (ROOT / "App/WebShellViewController.swift").read_text()
        self.assertIn("func lock() { bridge?.invalidate(); generation += 1", shell)

    def test_js_invalidation_control_has_no_content_or_storage_action(self):
        bridge = (ROOT / "App/NativeBridge.swift").read_text()
        control = bridge.split('if method == "device.invalidate" {', 1)[1].split('if method == "device.capabilities"', 1)[0]
        self.assertIn('params.isEmpty, body["scope"] is NSNull', control)
        self.assertIn("invalidate(); owner.invalidateBridgeAuthentication()", control)
        self.assertNotIn("store.", control)
        self.assertNotIn("queue.async", control)
        self.assertNotIn("authenticate {", control)
        self.assertIn('"scopeInvalidationVersion": 1', bridge)


if __name__ == "__main__":
    unittest.main(verbosity=2)
