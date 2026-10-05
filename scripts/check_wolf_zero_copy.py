#!/usr/bin/env python3
"""Run with python3 scripts/check_wolf_zero_copy.py; no Docker/GPU required."""
import os
import re
import subprocess
from pathlib import Path

source = Path(__file__).with_name("omarchy-wolf-install").read_text()
function = re.search(r"^wolf_zero_copy\(\) \{\n.*?^\}", source, re.M | re.S).group()
script = "die() { printf '%s\\n' \"$*\" >&2; exit 1; }\nnvidia-smi() { echo 6.1; }\n" + function + "\nwolf_zero_copy"
for override, expected in [(None, "TRUE"), ("", "TRUE"), ("true", "TRUE"), ("false", "FALSE"), ("invalid", None)]:
    env = {k: v for k, v in os.environ.items() if k != "OMARCHY_WOLF_ZERO_COPY"}
    if override is not None:
        env["OMARCHY_WOLF_ZERO_COPY"] = override
    result = subprocess.run(["bash", "-eu", "-c", script], env=env, text=True, capture_output=True)
    if expected is None:
        assert result.returncode != 0 and "TRUE oppure FALSE" in result.stderr, result
    else:
        assert result.returncode == 0 and result.stdout.strip() == expected, result
print("Wolf zero-copy: default Pascal, override e validazione OK")
