#!/usr/bin/env bash
set -euo pipefail
task_source="${1:?Pass the independent source directory}"
task_python="${2:?Pass the fixed test interpreter}"
cd "$task_source"
HERMES_PYTHON="$task_python" HERMES_TEST_FILE_RETRIES=0 scripts/run_tests.sh -j 1 \
  tests/tui_gateway/test_remote_app.py \
  tests/tui_gateway/test_remote_conversations.py \
  tests/tui_gateway/test_remote_information.py \
  tests/tui_gateway/test_remote_information_integration.py \
  tests/tui_gateway/test_resume_remote_model_limits.py \
  tests/tui_gateway/test_remote_project_scope.py \
  tests/tui_gateway/test_remote_files.py tests/tui_gateway/test_remote_files_integration.py \
  tests/tui_gateway/test_remote_notifications.py \
  tests/tui_gateway/test_document_turn_validation.py tests/tui_gateway/test_document_pdf_boundary.py \
  tests/tui_gateway/test_document_image_provider_policy.py tests/tui_gateway/test_document_turn_integration.py \
  tests/tui_gateway/test_image_turn_validation.py tests/tui_gateway/test_image_turn_integration.py \
  tests/tui_gateway/test_text_pilot_construction.py tests/tui_gateway/contracts/test_generated.py \
  tests/tui_gateway/test_tui_gateway_event_replay.py tests/tui_gateway/test_session_resume_db_ownership.py \
  tests/tui_gateway/test_resume_profile_scope.py tests/tui_gateway/test_resume_live_profile_scope.py \
  tests/tui_gateway/test_approval_cancelled_on_reap.py tests/tui_gateway/test_interrupt_agent_loop_stopped_hook.py \
  tests/agent/test_text_pilot.py tests/agent/test_text_pilot_integration.py tests/agent/test_image_rejection_fallback.py
