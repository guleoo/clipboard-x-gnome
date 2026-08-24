from pathlib import Path
import unittest

import clipboard_x_service


class ProtocolTest(unittest.TestCase):
    def test_packaged_protocol_matches_canonical_protocol(self):
        project_directory = Path(__file__).resolve().parents[2]
        canonical = (
            project_directory
            / "protocol"
            / "io.github.guleo.ClipboardX.Sync1.xml"
        )
        packaged = (
            Path(clipboard_x_service.__file__).resolve().parent
            / "io.github.guleo.ClipboardX.Sync1.xml"
        )
        self.assertEqual(
            packaged.read_text(encoding="utf-8"),
            canonical.read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
