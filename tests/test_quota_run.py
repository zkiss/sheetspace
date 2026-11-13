import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


WRAPPER = Path(__file__).resolve().parents[1] / "quota-run"
DEFAULT_MODEL = "openai/gpt-6.1-sol#medium"

FAKE_OPENCODE = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
root = Path(os.environ["FAKE_ROOT"])
if args[:2] == ["api", "post"] and args[2] == "/api/session":
    print(json.dumps({"data": {"id": "ses_test"}}))
elif args[:2] == ["api", "get"] and args[2] == "/api/session/ses_test":
    print(json.dumps({"data": {"location": {"directory": os.getcwd()}}}))
elif args[:2] == ["api", "get"] and args[2] == "/api/session/active":
    print(json.dumps({"data": {}}))
elif args[:2] == ["api", "get"] and args[2].startswith("/api/session/ses_test/message?"):
    result = root / "result.json"
    print(json.dumps({"data": [json.loads(result.read_text())] if result.exists() else []}))
elif args[0] == "run":
    with (root / "runs.jsonl").open("a") as log:
        log.write(json.dumps({"args": args, "prompt": sys.stdin.read()}) + "\n")
    result = root / "result.json"
    previous = json.loads(result.read_text())["id"] if result.exists() else ""
    result.write_text(json.dumps({"id": previous + "x", "type": "idle", "outcome": "succeeded"}))
else:
    raise SystemExit("unexpected command: " + repr(args))
'''


class QuotaRunModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        opencode = bin_dir / "opencode"
        opencode.write_text(FAKE_OPENCODE)
        opencode.chmod(0o755)
        self.checker = self.root / "checker.sh"
        self.checker.write_text("echo '{\"five_hour\":{\"remaining_percent\":100},\"weekly\":{\"remaining_percent\":100}}'\n")
        self.env = os.environ | {
            "HOME": str(self.root),
            "XDG_STATE_HOME": str(self.root / "state"),
            "FAKE_ROOT": str(self.root),
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
        }

    def run_wrapper(self, *args, success=True):
        result = subprocess.run(
            [str(WRAPPER), "--checker", str(self.checker), *args],
            cwd=self.root, env=self.env, text=True, capture_output=True, timeout=15,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def assert_last_model(self, expected):
        runs = [json.loads(line) for line in (self.root / "runs.jsonl").read_text().splitlines()]
        args = runs[-1]["args"]
        self.assertEqual(args[args.index("--model") + 1], expected)
        state_file, = (self.root / "state").rglob("ses_test.json")
        self.assertEqual(json.loads(state_file.read_text())["options"]["model"], expected)
        return runs[-1]

    def test_new_session_uses_default_model(self):
        self.run_wrapper("first prompt")
        self.assertEqual(self.assert_last_model(DEFAULT_MODEL)["prompt"], "first prompt\n")

    def test_explicit_model_overrides_default(self):
        self.run_wrapper("--model", "provider/custom#high", "first prompt")
        self.assert_last_model("provider/custom#high")

    def test_resume_preserves_saved_model_and_explicit_override_replaces_it(self):
        self.run_wrapper("--model", "provider/saved", "first prompt")
        self.run_wrapper("--session", "ses_test")
        self.assertIn("Continue the original requested work", self.assert_last_model("provider/saved")["prompt"])
        self.run_wrapper("--session", "ses_test", "--model", "provider/new", "new prompt")
        self.assertEqual(self.assert_last_model("provider/new")["prompt"], "new prompt\n")
        self.run_wrapper("--session", "ses_test")
        self.assert_last_model("provider/new")

    def test_resume_without_saved_state_uses_default(self):
        self.run_wrapper("--session", "ses_test")
        self.assert_last_model(DEFAULT_MODEL)

    def test_missing_model_value_fails_without_running_opencode(self):
        result = self.run_wrapper("--model", success=False)
        self.assertIn("Missing value for --model", result.stderr)
        self.assertFalse((self.root / "runs.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
