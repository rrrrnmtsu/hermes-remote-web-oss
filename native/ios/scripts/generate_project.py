#!/usr/bin/env python3
"""Deterministic dependency-free Xcode project. Never signs, installs packages or contacts a Mac."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]


def identifier(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def project():
    objects = {}
    def add(identity, isa, **values):
        key = identifier(identity); objects[key] = {"isa": isa, **values}; return key
    files = {}
    sources = {
        "HermesRemote": ["Shared/NativePolicy.swift", "Shared/KeychainVault.swift", "Shared/SharedDraftStore.swift", "App/AppDelegate.swift", "App/WebShellViewController.swift", "App/NativeBridge.swift"],
        "HermesRemoteShare": ["Shared/NativePolicy.swift", "Shared/KeychainVault.swift", "Shared/SharedDraftStore.swift", "ShareExtension/ShareViewController.swift"],
        "HermesRemoteTests": ["Tests/NativePolicyTests.swift"],
    }
    for path in sorted(set(sum(sources.values(), [])) | {"App/Info.plist", "ShareExtension/Info.plist", "App/HermesRemote.entitlements", "ShareExtension/HermesRemoteShare.entitlements"}):
        files[path] = add("file:" + path, "PBXFileReference", lastKnownFileType="sourcecode.swift" if path.endswith("swift") else "text.plist.entitlements" if path.endswith("entitlements") else "text.plist.xml", path=path, sourceTree="<group>")
    products = {}
    for name, suffix, file_type in [("HermesRemote", ".app", "wrapper.application"), ("HermesRemoteShare", ".appex", "wrapper.app-extension"), ("HermesRemoteTests", ".xctest", "wrapper.cfbundle")]:
        products[name] = add("product:" + name, "PBXFileReference", explicitFileType=file_type, path=name + suffix, sourceTree="BUILT_PRODUCTS_DIR", includeInIndex=0)
    products_group = add("products", "PBXGroup", name="Products", children=list(products.values()), sourceTree="<group>")
    main_group = add("main_group", "PBXGroup", children=list(files.values()) + [products_group], sourceTree="<group>")
    configs = {}
    defaults = {"CLANG_ENABLE_MODULES": "YES", "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "16.4", "SDKROOT": "iphoneos", "TARGETED_DEVICE_FAMILY": "1",
        "HERMES_APPROVED_ORIGIN": "", "HERMES_APP_GROUP": "group.net.sakura.hermesremote", "HERMES_KEYCHAIN_GROUP": "net.sakura.hermesremote.shared"}
    for name in ["project", *sources]:
        rows = []
        for variant in ("Debug", "Release"):
            settings = dict(defaults)
            if name != "project":
                settings.update({"PRODUCT_NAME": "$(TARGET_NAME)", "GENERATE_INFOPLIST_FILE": "NO", "CODE_SIGN_STYLE": "Manual", "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if variant == "Debug" else "-O"})
                if name == "HermesRemote": settings.update({"PRODUCT_BUNDLE_IDENTIFIER": "net.sakura.hermesremote", "INFOPLIST_FILE": "App/Info.plist", "CODE_SIGN_ENTITLEMENTS": "App/HermesRemote.entitlements", "ENABLE_TESTABILITY": "YES" if variant == "Debug" else "NO", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks"})
                if name == "HermesRemoteShare": settings.update({"PRODUCT_BUNDLE_IDENTIFIER": "net.sakura.hermesremote.share", "INFOPLIST_FILE": "ShareExtension/Info.plist", "CODE_SIGN_ENTITLEMENTS": "ShareExtension/HermesRemoteShare.entitlements", "APPLICATION_EXTENSION_API_ONLY": "YES", "SKIP_INSTALL": "YES", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"})
                if name == "HermesRemoteTests": settings.update({"PRODUCT_BUNDLE_IDENTIFIER": "net.sakura.hermesremote.tests", "GENERATE_INFOPLIST_FILE": "YES", "TEST_HOST": "$(BUILT_PRODUCTS_DIR)/HermesRemote.app/HermesRemote", "BUNDLE_LOADER": "$(TEST_HOST)", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @loader_path/Frameworks"})
            rows.append(add("config:" + name + ":" + variant, "XCBuildConfiguration", name=variant, buildSettings=settings))
        configs[name] = add("configlist:" + name, "XCConfigurationList", buildConfigurations=rows, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
    targets = {}
    for name, paths in sources.items():
        builds = [add("build:" + name + ":" + path, "PBXBuildFile", fileRef=files[path]) for path in paths]
        phases = [add("sources:" + name, "PBXSourcesBuildPhase", buildActionMask=2147483647, files=builds, runOnlyForDeploymentPostprocessing=0),
                  add("frameworks:" + name, "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)]
        if name == "HermesRemote":
            extension = add("embed:share", "PBXBuildFile", fileRef=products["HermesRemoteShare"], settings={"ATTRIBUTES": ["CodeSignOnCopy", "RemoveHeadersOnCopy"]})
            phases.append(add("extensions", "PBXCopyFilesBuildPhase", buildActionMask=2147483647, dstPath="", dstSubfolderSpec=13, files=[extension], runOnlyForDeploymentPostprocessing=0, name="Embed App Extensions"))
        targets[name] = add("target:" + name, "PBXNativeTarget", buildConfigurationList=configs[name], buildPhases=phases, buildRules=[], dependencies=[], name=name, productName=name, productReference=products[name], productType="com.apple.product-type.application" if name == "HermesRemote" else "com.apple.product-type.app-extension" if name == "HermesRemoteShare" else "com.apple.product-type.bundle.unit-test")
    for source, target in [("HermesRemote", "HermesRemoteShare"), ("HermesRemoteTests", "HermesRemote")]:
        proxy = add("proxy:" + source, "PBXContainerItemProxy", containerPortal=identifier("project"), proxyType=1, remoteGlobalIDString=targets[target], remoteInfo=target)
        objects[targets[source]]["dependencies"] = [add("dependency:" + source, "PBXTargetDependency", target=targets[target], targetProxy=proxy)]
    root = add("project", "PBXProject", attributes={"LastUpgradeCheck": "1600", "TargetAttributes": {targets["HermesRemoteTests"]: {"TestTargetID": targets["HermesRemote"]}}}, buildConfigurationList=configs["project"], compatibilityVersion="Xcode 14.0", developmentRegion="ja", knownRegions=["ja", "Base"], mainGroup=main_group, productRefGroup=products_group, projectDirPath="", projectRoot="", targets=list(targets.values()))
    return {"archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": objects, "rootObject": root}, targets


def openstep(value, depth=0):
    indent = "  " * depth
    if isinstance(value, dict):
        return "{\n" + "".join(indent + "  " + json.dumps(str(key)) + " = " + openstep(item, depth + 1) + ";\n" for key, item in value.items()) + indent + "}"
    if isinstance(value, list): return "(" + ", ".join(openstep(item, depth) for item in value) + ")"
    if isinstance(value, int): return str(value)
    return json.dumps(value, ensure_ascii=False)


def outputs():
    value, targets = project()
    scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['HermesRemote']}" BuildableName="HermesRemote.app" BlueprintName="HermesRemote" ReferencedContainer="container:HermesRemote.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['HermesRemoteTests']}" BuildableName="HermesRemoteTests.xctest" BlueprintName="HermesRemoteTests" ReferencedContainer="container:HermesRemote.xcodeproj"/></TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="NO"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{targets['HermesRemote']}" BuildableName="HermesRemote.app" BlueprintName="HermesRemote" ReferencedContainer="container:HermesRemote.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugServiceExtension="internal"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>
'''
    return {ROOT / "HermesRemote.xcodeproj/project.pbxproj": "// !$*UTF8*$!\n" + openstep(value) + "\n",
            ROOT / "HermesRemote.xcodeproj/xcshareddata/xcschemes/HermesRemote.xcscheme": scheme}


if __name__ == "__main__":
    for path, content in outputs().items():
        if "--check" in sys.argv:
            if not path.is_file() or path.read_text() != content:
                raise SystemExit("Generated native project is stale")
        else:
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text(content)
