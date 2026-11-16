import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest


WRAPPER = Path(__file__).resolve().parents[1] / "quota-run"

FAKE_OPENCODE = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import signal
import sys

args = sys.argv[1:]
root = Path(os.environ["FAKE_ROOT"])

def read(name, default=None):
    path = root / name
    return json.loads(path.read_text()) if path.exists() else default

def write(name, value):
    temporary = root / (name + "." + str(os.getpid()))
    temporary.write_text(json.dumps(value))
    temporary.replace(root / name)

def publish(message):
    write("result.json", message)
    if message["type"] == "idle":
        write("idle.json", message)

def event(kind, **values):
    with (root / "events.jsonl").open("a") as log:
        log.write(json.dumps({"kind": kind, **values}) + "\n")

scenario = read("scenario.json", [])
if args[:2] == ["api", "post"] and args[2] == "/api/session":
    print(json.dumps({"data": {"id": "ses_test"}}))
elif args[:2] == ["api", "post"] and args[2].endswith("/interrupt"):
    event("interrupt")
    print("{}")
elif args[:2] == ["api", "get"] and args[2] == "/api/session/ses_test":
    print(json.dumps({"data": {"location": {"directory": os.getcwd()}}}))
elif args[:2] == ["api", "get"] and args[2] == "/api/session/active":
    print(json.dumps({"data": {}}))
elif args[:2] == ["api", "get"] and args[2].startswith("/api/session/ses_test/message?"):
    idle_only = "type=idle" in args[2]
    active = read("active.json")
    if idle_only and active:
        active["reads"] += 1
        write("active.json", active)
        event("monitor", mode=active["mode"])
        if active["mode"] == "api-failure":
            raise SystemExit("simulated API failure")
        if active["mode"] == "wrapper-interrupt" and active["reads"] == 1:
            os.kill(int((root / "wrapper.pid").read_text()), signal.SIGTERM)
        if active["mode"] == "stale-quota" and active["reads"] == 2:
            os.kill(active["pid"], signal.SIGUSR1)
        if active["mode"] == "success-then-quota" and active["reads"] == 2:
            publish({"id": "new-quota", "type": "idle", "outcome": "failed",
                     "error": {"type": "provider.quota", "message": "Limit reached"}})
    message = read("idle.json" if idle_only else "result.json")
    print(json.dumps({"data": [message] if message else []}))
elif args[0] == "run":
    runs = root / "runs.jsonl"
    index = len(runs.read_text().splitlines()) if runs.exists() else 0
    with runs.open("a") as log:
        log.write(json.dumps({"args": args, "prompt": sys.stdin.read()}) + "\n")
    mode = scenario[index] if index < len(scenario) else "success"
    event("run", mode=mode)
    message = {"id": f"msg_{index}", "type": "idle", "outcome": "succeeded"}
    if mode in ("quota-exit", "quota-hang", "quota-ignore-term"):
        message.update(outcome="failed", error={"type": "provider.quota", "message": "Limit reached"})
    if mode == "failure-exit":
        message.update(outcome="failed", error={"type": "provider.transport", "message": "Network failed"})
    if mode == "quota-exit" or mode == "failure-exit":
        publish(message)
        raise SystemExit(1)
    if mode == "success":
        publish(message)
    else:
        def finish(signum, frame):
            states = list((root / "state").rglob("ses_test.json"))
            phase = json.loads(states[0].read_text())["phase"]
            event("signal", signal=signum, phase=phase)
            if signum == signal.SIGTERM and mode == "quota-ignore-term":
                return
            publish({"id": f"cleanup_{index}", "type": "idle",
                     "outcome": "succeeded" if signum == signal.SIGUSR1 else "interrupted"})
            (root / "active.json").unlink(missing_ok=True)
            raise SystemExit(0 if signum == signal.SIGUSR1 else 143)
        signal.signal(signal.SIGTERM, finish)
        signal.signal(signal.SIGUSR1, finish)
        if mode != "stale-quota":
            publish(message)
        # Non-idle notifications must not conceal the terminal quota outcome.
        publish({"id": f"notice_{index}", "type": "synthetic", "text": "Background shell still running"})
        write("active.json", {"mode": mode, "pid": os.getpid(), "reads": 0})
        while True:
            signal.pause()
else:
    raise SystemExit("unexpected command: " + repr(args))
'''

FAKE_SLEEP = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

root = Path(os.environ["FAKE_ROOT"])
with (root / "events.jsonl").open("a") as log:
    log.write(json.dumps({"kind": "sleep", "seconds": int(sys.argv[1])}) + "\n")
'''

FAKE_DATE = r'''#!/usr/bin/env python3
from datetime import datetime, timezone
import sys

args = sys.argv[1:]
if args == ["+%s"]:
    print(1794850000)
else:
    value = args[args.index("-d") + 1]
    instant = (datetime.fromtimestamp(int(value[1:]), timezone.utc) if value.startswith("@")
               else datetime.fromisoformat(value.replace("Z", "+00:00")))
    print(int(instant.timestamp()) if args[-1] == "+%s" else instant.isoformat())
'''

FAKE_CHECKER = r'''import json
import os
from pathlib import Path

root = Path(os.environ["FAKE_ROOT"])
counter = root / "checks"
count = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(count))
blocked_checks = root / "blocked-checks.json"
blocked = count in (json.loads(blocked_checks.read_text()) if blocked_checks.exists() else [])
with (root / "events.jsonl").open("a") as log:
    log.write(json.dumps({"kind": "check", "blocked": blocked}) + "\n")
reset_file = root / "reset-at"
reset = reset_file.read_text() if reset_file.exists() else "2099-01-01T00:00:00Z"
window = {"remaining_percent": 0 if blocked else 100, "resetsAt": reset}
print(json.dumps({"five_hour": window, "weekly": window}))
'''


class QuotaRunTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        for name, content in (("opencode", FAKE_OPENCODE), ("sleep", FAKE_SLEEP), ("date", FAKE_DATE)):
            executable = bin_dir / name
            executable.write_text(content)
            executable.chmod(0o755)
        (self.root / "checker.py").write_text(FAKE_CHECKER)
        self.checker = self.root / "checker.sh"
        self.checker.write_text('exec python3 "$FAKE_ROOT/checker.py"\n')
        self.env = os.environ | {
            "HOME": str(self.root),
            "XDG_STATE_HOME": str(self.root / "state"),
            "FAKE_ROOT": str(self.root),
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
        }

    def configure_runs(self, *modes, blocked=True):
        (self.root / "scenario.json").write_text(json.dumps(modes))
        if blocked:
            (self.root / "blocked-checks.json").write_text(json.dumps([2]))

    def run_wrapper(self, *args, success=True):
        process = subprocess.Popen(
            [str(WRAPPER), "--checker", str(self.checker), *args],
            cwd=self.root, env=self.env, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
        )
        (self.root / "wrapper.pid").write_text(str(process.pid))
        try:
            stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            active_file = self.root / "active.json"
            if active_file.exists():
                self.kill_group(json.loads(active_file.read_text())["pid"])
            self.kill_group(process.pid)
            process.communicate()
            raise
        result = subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def kill_group(self, pid):
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def runs(self):
        return [json.loads(line) for line in (self.root / "runs.jsonl").read_text().splitlines()]

    def events(self):
        return [json.loads(line) for line in (self.root / "events.jsonl").read_text().splitlines()]

    def state(self):
        state_file, = (self.root / "state").rglob("ses_test.json")
        return json.loads(state_file.read_text())
