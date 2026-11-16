import json
import signal
import unittest

from quota_run_support import QuotaRunTestCase

DEFAULT_MODEL = "openai/gpt-6.1-sol#medium"


class QuotaRunModelTests(QuotaRunTestCase):
    def assert_last_model(self, expected):
        runs = self.runs()
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


class QuotaRunMonitoringTests(QuotaRunTestCase):
    def assert_continued_after_quota(self, result):
        self.assertIn("Quota exhausted", result.stdout)
        self.assertIn("Quota blocked", result.stdout)
        self.assertIn("Requested work completed.", result.stdout)
        self.assertEqual(len(self.runs()), 2)
        self.assertEqual(self.runs()[0]["prompt"], "original scope\n")
        self.assertIn("Continue the original requested work", self.runs()[1]["prompt"])
        self.assertEqual(self.state()["phase"], "done")

    def test_live_quota_is_saved_before_cleanup_and_resumes_after_reset(self):
        self.configure_runs("quota-hang", "success")
        result = self.run_wrapper("original scope")
        self.assert_continued_after_quota(result)
        termination, = [event for event in self.events() if event["kind"] == "signal"]
        self.assertEqual(termination, {"kind": "signal", "signal": signal.SIGTERM, "phase": "quota"})
        events = self.events()
        self.assertLess(events.index(termination), events.index({"kind": "check", "blocked": True}))

    def test_successful_intermediate_turn_does_not_end_background_monitoring(self):
        self.configure_runs("success-then-quota", "success")
        result = self.run_wrapper("original scope")
        self.assert_continued_after_quota(result)

    def test_quota_cli_that_exits_without_cleanup_still_resumes(self):
        self.configure_runs("quota-exit", "success")
        result = self.run_wrapper("original scope")
        self.assert_continued_after_quota(result)
        self.assertFalse(any(event["kind"] == "signal" for event in self.events()))

    def test_quota_checker_is_recalled_periodically_and_early_reset_resumes_work(self):
        self.configure_runs("quota-hang", "success")
        (self.root / "blocked-checks.json").write_text(json.dumps([2, 3, 4]))
        result = self.run_wrapper("original scope")
        self.assert_continued_after_quota(result)
        checks = [event["blocked"] for event in self.events() if event["kind"] == "check"]
        self.assertEqual(checks, [False, True, True, True, False])
        quota_waits = [event["seconds"] for event in self.events()
                       if event["kind"] == "sleep" and event["seconds"] > 2]
        self.assertEqual(quota_waits, [300, 300, 300])

    def test_quota_wait_uses_shorter_buffered_reset_deadline(self):
        self.configure_runs("quota-hang", "success")
        (self.root / "reset-at").write_text("2026-11-16T17:26:50Z")
        result = self.run_wrapper("original scope")
        self.assert_continued_after_quota(result)
        quota_waits = [event["seconds"] for event in self.events()
                       if event["kind"] == "sleep" and event["seconds"] > 2]
        self.assertEqual(quota_waits, [40])

    def test_stale_quota_marker_does_not_terminate_new_work(self):
        self.configure_runs("stale-quota", blocked=False)
        stale = {"id": "old-quota", "type": "idle", "outcome": "failed",
                 "error": {"type": "provider.quota", "message": "Limit reached"}}
        (self.root / "idle.json").write_text(json.dumps(stale))
        result = self.run_wrapper("original scope")
        self.assertNotIn("Quota exhausted", result.stdout)
        self.assertEqual(len(self.runs()), 1)
        signals = [event["signal"] for event in self.events() if event["kind"] == "signal"]
        self.assertEqual(signals, [signal.SIGUSR1])

    def test_monitor_failure_stops_cli_without_retrying(self):
        self.configure_runs("api-failure", blocked=False)
        result = self.run_wrapper("original scope", success=False)
        self.assertIn("Cannot read session outcome", result.stderr)
        self.assertEqual(len(self.runs()), 1)
        self.assertTrue(any(event["kind"] == "signal" for event in self.events()))

    def test_nonquota_failure_does_not_retry(self):
        self.configure_runs("failure-exit", blocked=False)
        result = self.run_wrapper("original scope", success=False)
        self.assertIn("Network failed", result.stderr)
        self.assertEqual(len(self.runs()), 1)

    def test_user_interrupt_still_cleans_up_without_retrying(self):
        self.configure_runs("wrapper-interrupt", blocked=False)
        result = self.run_wrapper("original scope", success=False)
        self.assertEqual(result.returncode, 130)
        self.assertIn("Stopped. Resume with:", result.stderr)
        self.assertEqual(len(self.runs()), 1)
        self.assertIn({"kind": "interrupt"}, self.events())
        self.assertTrue(any(event["kind"] == "signal" for event in self.events()))

    def test_live_quota_disagreement_stops_after_cleanup(self):
        self.configure_runs("quota-hang", blocked=False)
        result = self.run_wrapper("original scope", success=False)
        self.assertIn("quota failure contradicts checker", result.stderr)
        self.assertEqual(self.state()["phase"], "quota")
        self.assertEqual(len(self.runs()), 1)

    def test_unresponsive_cli_cleanup_is_bounded_before_quota_wait(self):
        self.configure_runs("quota-ignore-term", "success")
        result = self.run_wrapper("original scope")
        self.assert_continued_after_quota(result)
        cleanup_waits = [event for event in self.events()
                         if event["kind"] == "sleep" and event["seconds"] == 1]
        self.assertEqual(len(cleanup_waits), 30)


if __name__ == "__main__":
    unittest.main()
