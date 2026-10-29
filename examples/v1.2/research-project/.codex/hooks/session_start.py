"""Advisory project state reminder at Codex session start."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = ("AGENTS.md", "STATE.md", "DECISIONS.md", "AUDIT_ISSUES.md")


def main() -> int:
    try:
        json.load(sys.stdin)
    except (OSError, ValueError):
        pass
    missing = [name for name in REQUIRED if not (ROOT / name).is_file()]
    message = (
        "Research state files missing: " + ", ".join(missing) + "."
        if missing else
        "Research state files found. Read STATE.md and unresolved audit issues before execution."
    )
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart", "additionalContext": message
    }}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

