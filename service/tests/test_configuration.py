from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from clipboard_x_service.configuration import ConfigurationError, default_path, load


class ConfigurationTest(unittest.TestCase):
    def test_missing_file_uses_empty_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            configuration = load(Path(directory) / "sync.json")
        self.assertEqual(configuration.server_address, "")
        self.assertFalse(configuration.api_key_configured)

    def test_loads_plugin_configuration_without_checking_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sync.json"
            path.write_text(json.dumps({
                "version": 1,
                "serverAddress": " 127.0.0.1:8765 ",
                "apiKey": "secret",
                "activeChannelId": "channel",
            }), encoding="utf-8")
            path.chmod(0o644)
            configuration = load(path)
        self.assertEqual(configuration.server_address, "127.0.0.1:8765")
        self.assertTrue(configuration.api_key_configured)
        self.assertEqual(configuration.active_channel_id, "channel")

    def test_rejects_invalid_structure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sync.json"
            path.write_text("[]", encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                load(path)

    def test_default_path_uses_xdg_data_home(self):
        with patch.dict(os.environ, {"XDG_DATA_HOME": "/tmp/cbx-data"}):
            self.assertEqual(default_path(), Path("/tmp/cbx-data/clipboard-x/sync.json"))


if __name__ == "__main__":
    unittest.main()
