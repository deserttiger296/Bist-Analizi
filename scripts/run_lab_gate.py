"""Required pre-production laboratory gate; exits nonzero on any incomplete check."""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from python_bot.lab_runner import run_test_suite


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    reports = []
    for suite in ("resilience", "pu30", "mtf", "viop", "compatibility"):
        result = run_test_suite(suite)
        reports.append(result)
        summary = result.get("summary", {})
        print(f"{suite}: {'PASS' if result.get('passed') and summary.get('total', 0) else 'FAIL'} {summary}", flush=True)
        if not result.get("passed"):
            print(result.get("output", result.get("detail", "Test raporu eksik")), flush=True)
    success = all(report.get("passed") and report.get("summary", {}).get("total", 0) > 0 for report in reports)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        public_reports = [{key: value for key, value in report.items() if key != "output"} for report in reports]
        args.report.write_text(json.dumps({"passed": success, "generated_at": datetime.now(timezone.utc).isoformat(), "suites": public_reports}, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
