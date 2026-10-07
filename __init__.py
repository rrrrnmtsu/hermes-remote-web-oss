"""Source-only static client: no legacy plugin hooks are installed."""
from typing import Any


def register(ctx: Any) -> None:
    """Remote Web is static-only; retained upstream observers are never registered."""
    return
