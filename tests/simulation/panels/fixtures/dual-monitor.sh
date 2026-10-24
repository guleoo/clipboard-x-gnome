#!/usr/bin/env bash
set -euo pipefail
# The official headless runner already supplies the first 1280x720 monitor.
exec "$@" --virtual-monitor 1024x768
