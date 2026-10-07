"""Config-to-agent output-cap acceptance, red on the fixed unpatched backend."""

import socket
import json


def test_pilot_config_reaches_the_native_output_cap(tmp_path, monkeypatch):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from run_agent import AIAgent

    def no_network(*args, **kwargs):
        raise AssertionError("No real network in cap acceptance")
    monkeypatch.setattr(socket.socket, "connect", no_network)
    home = tmp_path / "pilot"
    home.mkdir()
    config = {"model": {"default": "claude-sonnet-5", "provider": "anthropic", "context_length": 200000},
        "agent": {"environment_probe": False, "text_pilot":
            {"model": "claude-sonnet-5", "max_input_tokens": 3072, "max_output_tokens": 128}}}
    (home / "config.yaml").write_text(json.dumps(config))
    token = set_hermes_home_override(home)
    agent = None
    try:
        agent = AIAgent(model="claude-sonnet-5", provider="anthropic", api_mode="anthropic_messages",
            api_key="fixture-only", base_url="https://api.anthropic.com", enabled_toolsets=[],
            skip_context_files=True, skip_memory=True, skip_background_review=True, quiet_mode=True)
        assert agent.max_tokens == config["agent"]["text_pilot"]["max_output_tokens"]
    finally:
        if agent:
            agent.close()
        reset_hermes_home_override(token)
