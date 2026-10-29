"""Block a recognized run_experiment.py invocation lacking gate records."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from gate import check  # noqa: E402

LAUNCHER = re.compile(r"(?:^|[\\/\s])run_experiment\.py(?:\s|$)", re.IGNORECASE)
EXPERIMENT = re.compile(r"--experiment(?:\s+|=)(EXP-[0-9]+)(?:\s|$)")


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (OSError, ValueError):
        return deny("Invalid PreToolUse event.")
    command = (event.get("tool_input") or {}).get("command", "")
    if not isinstance(command, str) or not LAUNCHER.search(command):
        return 0
    match = EXPERIMENT.search(command)
    if not match:
        return deny("Experiment launcher requires --experiment EXP-NNN.")
    allowed, reason = check(ROOT, match.group(1))
    if not allowed:
        return deny(reason)
    return 0


def deny(reason: str) -> int:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

