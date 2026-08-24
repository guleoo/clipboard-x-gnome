from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path


MAX_CONFIGURATION_BYTES = 64 * 1024


class ConfigurationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Configuration:
    server_address: str = ""
    api_key: str = ""
    active_channel_id: str = ""

    @property
    def api_key_configured(self) -> bool:
        return bool(self.api_key)

    def public_values(self) -> dict[str, object]:
        return {
            "server-address": self.server_address,
            "api-key-configured": self.api_key_configured,
            "active-channel-id": self.active_channel_id,
        }


def default_path() -> Path:
    data_home = os.environ.get("XDG_DATA_HOME")
    if not data_home:
        data_home = str(Path.home() / ".local" / "share")
    return Path(data_home) / "clipboard-x" / "sync.json"


def load(path: Path) -> Configuration:
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return Configuration()
    if size > MAX_CONFIGURATION_BYTES:
        raise ConfigurationError("sync.json exceeds the supported size")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ConfigurationError(f"cannot read sync.json: {error}") from error
    if not isinstance(document, dict) or document.get("version") != 1:
        raise ConfigurationError("sync.json has an unsupported structure")
    values = {
        name: document.get(name, "")
        for name in ("serverAddress", "apiKey", "activeChannelId")
    }
    if not all(isinstance(value, str) for value in values.values()):
        raise ConfigurationError("sync.json contains a non-string configuration value")
    return Configuration(
        server_address=values["serverAddress"].strip(),
        api_key=values["apiKey"],
        active_channel_id=values["activeChannelId"].strip(),
    )
