"""Deterministic experiment gate shared by the launcher and Codex hook."""

import hashlib
import json
import re
from pathlib import Path

EXPERIMENT_ID = re.compile(r"^EXP-[0-9]+$")


def check(root: Path, experiment_id: str) -> tuple[bool, str]:
    if not EXPERIMENT_ID.fullmatch(experiment_id):
        return False, "Invalid experiment ID."
    plan = root / "experiments" / "plans" / f"{experiment_id}.md"
    audit = root / "audits" / "experiment-gates" / f"{experiment_id}.json"
    approval = root / "approvals" / f"{experiment_id}.json"
    if not plan.is_file():
        return False, f"{experiment_id}: experiment plan is missing."
    digest = hashlib.sha256(plan.read_bytes()).hexdigest()
    for label, path in (("audit", audit), ("approval", approval)):
        if not path.is_file():
            return False, f"{experiment_id}: {label} record is missing."
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False, f"{experiment_id}: {label} record is invalid JSON."
        if not isinstance(record, dict) or record.get("experiment_id") != experiment_id:
            return False, f"{experiment_id}: {label} record has the wrong experiment ID."
        if record.get("plan_sha256") != digest:
            return False, f"{experiment_id}: {label} record does not match the current plan SHA-256."
        if label == "audit" and record.get("verdict") != "PASS":
            return False, f"{experiment_id}: independent audit is not PASS."
        if label == "approval" and record.get("approved") is not True:
            return False, f"{experiment_id}: human Preview is not approved."
    return True, f"{experiment_id}: gate passed for plan SHA-256 {digest}."

