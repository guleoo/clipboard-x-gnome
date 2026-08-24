from __future__ import annotations

import argparse
from importlib.resources import files
from pathlib import Path

from . import __version__
from .application import ServiceApplication
from .configuration import default_path


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Clipboard X local synchronization service")
    result.add_argument("--version", action="version", version=__version__)
    result.add_argument("--configuration", type=Path, default=default_path())
    return result


def main(arguments: list[str] | None = None) -> int:
    options = parser().parse_args(arguments)
    protocol_path = Path(str(files("clipboard_x_service").joinpath(
        "io.github.guleo.ClipboardX.Sync1.xml",
    )))
    return ServiceApplication(options.configuration, protocol_path).run()
