#!/usr/bin/env python3
"""Private default URI handler: record the launch, never open a network URL."""
import json
from pathlib import Path
import sys

destination = Path(sys.argv[1])
values = json.loads(destination.read_text()) if destination.exists() else []
values.extend(sys.argv[2:])
temporary = destination.with_suffix('.tmp')
temporary.write_text(json.dumps(values))
temporary.replace(destination)
