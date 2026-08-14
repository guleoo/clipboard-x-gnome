#!/usr/bin/env python3
"""Briefly stop and continue the nested Shell process for resume testing."""

import os
import signal
import sys
import time


process_id = int(sys.argv[1])
time.sleep(0.2)
os.kill(process_id, signal.SIGSTOP)
time.sleep(0.3)
os.kill(process_id, signal.SIGCONT)
