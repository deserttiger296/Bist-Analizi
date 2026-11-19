"""Explicit laboratory suites with machine-readable, per-test results."""
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
SUITES = {
    "resilience": {"label": "Veri güvenilirliği", "description": "Timeout / 429, önbellek, 15dk indirme ve minimum mum korumaları.", "targets": ["test_data_resilience.py"]},
    "pu30": {"label": "Klasik RSI kuralları", "description": "PU30 / NU70 eşikleri, güven seviyeleri ve kapanmış mum kuralları.", "targets": ["test_pu30_strict.py", "test_hourly_trust_level.py", "test_rsi_pu30.py", "test_screener_cli.py", "test_nu70_semih_rules.py"]},
    "mtf": {"label": "MTF strateji laboratuvarı", "description": "Çoklu zaman dilimi, günlük veto, alt periyot baskısı ve klasik motor izolasyonu.", "targets": ["test_pu30_mtf.py", "test_mtf_lab_isolation.py"]},
    "compatibility": {"label": "Uyumluluk kapısı", "description": "Ortak arayüz, Lab raporları, API sözleşmeleri, Shield risk sınırları ve klasik / MTF izolasyonu. Üretim öncesi zorunlu.", "targets": ["test_lab_runner.py", "test_vercel_engine.py", "test_mtf_lab_isolation.py", "test_shield_risk.py", "test_ui_shell.py"]},
    "all": {"label": "Tüm regresyonlar", "description": "Depodaki tüm Python testleri; daha uzun sürebilir.", "targets": []},
}


def suite_catalog():
    return [{"id": key, "label": value["label"], "description": value["description"]} for key, value in SUITES.items()]


def run_test_suite(suite):
    if suite not in SUITES:
        raise ValueError(f"Bilinmeyen test paketi: {suite}")
    targets = [f"python_bot/tests/{name}" for name in SUITES[suite]["targets"]] or ["python_bot/tests/"]
    missing = [target for target in targets if not (ROOT / target).exists()]
    if missing:
        return {"status": "error", "detail": "Test dosyaları bulunamadı: " + ", ".join(missing)}
    started = time.monotonic()
    results = []
    timed_out = False
    with TemporaryDirectory(prefix="bist-lab-") as temp:
        report = Path(temp) / "results.xml"
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", *targets, "-v", "--tb=short", "-p", "no:cacheprovider", f"--junitxml={report}"],
                cwd=ROOT, capture_output=True, text=True, timeout=60,
            )
            exit_code, output = proc.returncode, (proc.stdout or "") + (proc.stderr or "")
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            def decode(value):
                return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""
            exit_code, output = 124, decode(exc.stdout) + decode(exc.stderr)
        if report.exists():
            try:
                for case in ET.parse(report).iter("testcase"):
                    state = "passed"
                    message = ""
                    for tag in ("failure", "error", "skipped"):
                        node = case.find(tag)
                        if node is not None:
                            state = {"failure": "failed", "error": "error", "skipped": "skipped"}[tag]
                            message = node.get("message", "")
                            break
                    results.append({"name": case.get("name"), "group": case.get("classname"), "status": state, "duration_sec": float(case.get("time", 0)), "message": message})
            except ET.ParseError:
                pass
    summary = {state: sum(row["status"] == state for row in results) for state in ("passed", "failed", "error", "skipped")}
    summary["total"] = len(results)
    passed = exit_code == 0 and bool(results) and not summary["failed"] and not summary["error"]
    if exit_code == 0 and not results:
        output += "\nTest raporu eksik veya okunamadı; doğrulama tamamlanmadı."
    return {"status": "success", "mode": "pytest", "suite": suite, "label": SUITES[suite]["label"],
            "exit_code": exit_code, "passed": passed, "timed_out": timed_out,
            "duration_sec": round(time.monotonic() - started, 2), "completed_at": datetime.now(timezone.utc).isoformat(),
            "summary": summary, "results": results, "targets": targets, "output": output}
