import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SAMPLE = Path(__file__).resolve().parents[1] / "research-project"
sys.path.insert(0, str(SAMPLE / "scripts"))
from gate import check  # noqa: E402


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "experiments/plans").mkdir(parents=True)
        (self.root / "audits/experiment-gates").mkdir(parents=True)
        (self.root / "approvals").mkdir()
        self.plan = self.root / "experiments/plans/EXP-001.md"
        self.plan.write_text("frozen plan", encoding="utf-8")
        self.digest = hashlib.sha256(self.plan.read_bytes()).hexdigest()

    def records(self, verdict="PASS", approved=True):
        (self.root / "audits/experiment-gates/EXP-001.json").write_text(
            json.dumps({"experiment_id": "EXP-001", "verdict": verdict, "plan_sha256": self.digest}),
            encoding="utf-8",
        )
        (self.root / "approvals/EXP-001.json").write_text(
            json.dumps({"experiment_id": "EXP-001", "approved": approved, "plan_sha256": self.digest}),
            encoding="utf-8",
        )

    def test_missing_audit_denied(self):
        self.assertFalse(check(self.root, "EXP-001")[0])

    def test_missing_approval_denied(self):
        self.records()
        (self.root / "approvals/EXP-001.json").unlink()
        self.assertFalse(check(self.root, "EXP-001")[0])

    def test_revise_denied(self):
        self.records(verdict="REVISE")
        self.assertFalse(check(self.root, "EXP-001")[0])

    def test_stale_plan_denied(self):
        self.records()
        self.plan.write_text("revised plan", encoding="utf-8")
        self.assertFalse(check(self.root, "EXP-001")[0])

    def test_matching_records_pass(self):
        self.records()
        self.assertTrue(check(self.root, "EXP-001")[0])

    def test_hook_denies_launcher_without_records_and_ignores_other_commands(self):
        (self.root / ".codex/hooks").mkdir(parents=True)
        (self.root / "scripts").mkdir()
        shutil.copy2(SAMPLE / "scripts/gate.py", self.root / "scripts/gate.py")
        hook = self.root / ".codex/hooks/pre_tool_use.py"
        shutil.copy2(SAMPLE / ".codex/hooks/pre_tool_use.py", hook)
        event = {"tool_name": "Bash", "tool_input": {"command": "py -3.14 scripts/run_experiment.py --experiment EXP-001"}}
        result = subprocess.run([sys.executable, str(hook)], input=json.dumps(event), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
        event["tool_input"]["command"] = "git status"
        result = subprocess.run([sys.executable, str(hook)], input=json.dumps(event), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_hook_allows_matching_records(self):
        self.records()
        (self.root / ".codex/hooks").mkdir(parents=True)
        (self.root / "scripts").mkdir()
        shutil.copy2(SAMPLE / "scripts/gate.py", self.root / "scripts/gate.py")
        hook = self.root / ".codex/hooks/pre_tool_use.py"
        shutil.copy2(SAMPLE / ".codex/hooks/pre_tool_use.py", hook)
        event = {"tool_name": "Bash", "tool_input": {"command": "py -3.14 scripts/run_experiment.py --experiment EXP-001"}}
        result = subprocess.run([sys.executable, str(hook)], input=json.dumps(event), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()

