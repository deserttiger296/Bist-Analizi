from types import SimpleNamespace
import subprocess

import pandas as pd
import pytest
from fastapi import HTTPException

from python_bot import lab_runner, signal_api
from python_bot.engine.data.provider import DataResult, DataStatus


def test_lab_catalog_is_explicit_and_unknown_suite_rejected():
    catalog = signal_api.run_lab_suite(mode="catalog")
    assert {row["id"] for row in catalog["suites"]} == {"resilience", "pu30", "mtf", "compatibility", "all"}
    with pytest.raises(HTTPException) as exc:
        signal_api.run_lab_suite(mode="pytest", suite="typo")
    assert exc.value.status_code == 400


def test_runner_reports_per_test_results(monkeypatch):
    def run(args, **kwargs):
        report = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--junitxml="))
        from pathlib import Path
        Path(report).write_text('<testsuites><testsuite><testcase name="ok" time="0.1"/><testcase name="bad"><failure message="wrong value"/></testcase><testcase name="skip"><skipped/></testcase></testsuite></testsuites>')
        return SimpleNamespace(returncode=1, stdout="2 results", stderr="")
    monkeypatch.setattr(lab_runner.subprocess, "run", run)
    result = signal_api.run_lab_suite(mode="pytest", suite="resilience")
    assert not result["passed"]
    assert result["summary"] == {"passed": 1, "failed": 1, "error": 0, "skipped": 1, "total": 3}
    assert result["results"][1]["message"] == "wrong value"


def test_runner_handles_timeout_as_incomplete_result(monkeypatch):
    def run(*args, **kwargs):
        raise subprocess.TimeoutExpired("pytest", 60, output=b"partial output")
    monkeypatch.setattr(lab_runner.subprocess, "run", run)
    result = signal_api.run_lab_suite(mode="pytest", suite="resilience")
    assert result["timed_out"] and not result["passed"]
    assert result["exit_code"] == 124 and result["output"] == "partial output"


def test_missing_report_never_passes_even_with_exit_zero(monkeypatch):
    monkeypatch.setattr(lab_runner.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout="", stderr=""))
    result = signal_api.run_lab_suite(mode="pytest", suite="resilience")
    assert not result["passed"] and result["summary"]["total"] == 0


def test_impulse_short_history_is_data_problem(monkeypatch):
    from python_bot.engine.data import provider
    short = pd.DataFrame({"close": [100.]})
    fake = SimpleNamespace(fetch_ohlcv=lambda *a, **k: DataResult(symbol="THYAO", interval="1h", df=short, status=DataStatus.FRESH))
    monkeypatch.setattr(provider, "get_default_provider", lambda: fake)
    result = signal_api.run_lab_suite(mode="impulse", symbols="THYAO")
    assert result["items"][0]["status"] == "INSUFFICIENT_HISTORY"
    assert result["items"][0]["bar_count"] == 1
