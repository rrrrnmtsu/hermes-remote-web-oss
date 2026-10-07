#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
webkit_directory="${HERMES_TEST_WEBKIT_DIR:?Set this to the pinned Playwright WebKit directory}"
webkit_port="${HERMES_TEST_WEBKIT_PORT:-wpe}"
case "$webkit_port" in wpe|gtk) ;; *) exit 2 ;; esac
webkit_bundle="$webkit_directory/minibrowser-$webkit_port"
export WEBKIT_EXEC_PATH="$webkit_bundle/bin"
export WEBKIT_INJECTED_BUNDLE_PATH="$webkit_bundle/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="$webkit_bundle/share"
export WEBKIT_FORCE_COMPLEX_TEXT=1
export LD_LIBRARY_PATH="$task_root/output/webkit-runtime/root/usr/lib/x86_64-linux-gnu:$webkit_bundle/lib:$webkit_bundle/sys/lib"
if [[ -f "$task_root/output/webkit-runtime/root/usr/share/glvnd/egl_vendor.d/50_mesa.json" ]]; then
  export __EGL_VENDOR_LIBRARY_FILENAMES="$task_root/output/webkit-runtime/root/usr/share/glvnd/egl_vendor.d/50_mesa.json"
fi
exec "$webkit_bundle/bin/MiniBrowser" "$@"
