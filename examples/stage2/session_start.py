"""Advisory Codex SessionStart hook for a versioned research repository."""

import json
import subprocess
import sys
from pathlib import Path


REQUIRED = ("AGENTS.md", "STATE.md", "DECISIONS.md", "AUDIT_ISSUES.md")


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        print(json.dumps({"systemMessage": "Research state check received invalid input."}))
        return 0

    cwd = Path(event.get("cwd") or ".").resolve()
    result = subprocess.run(
        ["git", "-C", str(cwd), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        message = "Research state check: Git repository not found."
    else:
        root = Path(result.stdout.strip())
        missing = [name for name in REQUIRED if not (root / name).is_file()]
        message = (
            "Research state check: missing " + ", ".join(missing) + "."
            if missing
            else "Research state files found. Read STATE.md and unresolved audit issues; load decisions only when relevant."
        )

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": message,
        }
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

