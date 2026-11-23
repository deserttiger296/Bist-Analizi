# -*- coding: utf-8 -*-
"""api/index.py (Vercel lite engine): ML endpoints must report an explicit
unavailable state, never a fabricated prediction. Network-free."""
from fastapi.testclient import TestClient

from api.index import app

client = TestClient(app)


def test_health_reports_lite_deployment_without_ml():
    r = client.get("/api/py/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["deployment"] == "vercel-lite"
    assert body["rf_model"]["present"] is False
    assert body["lstm"]["usable"] is False


def test_scan_all_and_predict_are_explicitly_unavailable():
    for response in (client.get("/api/py/api/scan_all"), client.post("/api/py/api/predict", json={"symbol": "THYAO"})):
        assert response.status_code == 501
        body = response.json()
        assert body["status"] == "model_unavailable"
        assert body["data"] is None and body["scanned"] == 0


def test_invalid_interval_rejected_before_any_fetch(monkeypatch):
    from python_bot import signal_api

    monkeypatch.setattr(
        signal_api,
        "scan_universe_rsi_pu30",
        lambda symbols, max_workers=4, interval="4h", signal_type="all": {
            "status": "success",
            "interval": interval,
            "signal_type": signal_type,
            "total_scanned": len(symbols),
            "matched": 0,
            "failed": 0,
            "signals": [],
            "errors": [],
        },
    )
    assert client.get("/api/py/api/scan/rsi-pu30", params={"interval": "5m"}).status_code == 400
    r15 = client.get("/api/py/api/scan/rsi-pu30", params={"interval": "15m"})
    assert r15.status_code == 200
    assert r15.json()["data"]["interval"] == "15m"
    assert client.get("/api/py/api/scan/most-rsi", params={"interval": "4h"}).status_code == 400


def test_agentic_council_15m_standalone_trap_warning(monkeypatch):
    import numpy as np
    import pandas as pd
    from types import SimpleNamespace
    from python_bot.engine.brain import agentic_council
    from python_bot.engine.data.provider import DataResult, DataStatus

    bars_15m = pd.DataFrame({
        "date": pd.date_range("2026-11-18 10:00", periods=45, freq="15min", tz="Europe/Istanbul"),
        "open": np.full(45, 100.0),
        "close": np.full(45, 100.0),
        "high": np.full(45, 105.0),
        "low": np.full(45, 99.0),
        "volume": np.full(45, 1000.0),
        "is_closed": True,
    })

    def fake_fetch(symbol, interval="15m", include_forming_bar=False):
        if interval == "15m":
            return DataResult(symbol=symbol, interval="15m", df=bars_15m, status=DataStatus.FRESH)
        return DataResult(symbol=symbol, interval=interval, df=None, status=DataStatus.ERROR)

    monkeypatch.setattr(agentic_council, "get_default_provider", lambda: SimpleNamespace(fetch_ohlcv=fake_fetch))
    monkeypatch.setattr(
        agentic_council,
        "detect_rsi_pu30",
        lambda df, cfg, ignore_lifetime=False, interval="15m": (
            {
                "type": "PU30",
                "dip1": {"index": 10, "price": 95.0, "rsi": 24.5},
                "dip2": {"index": 25, "price": 94.0, "rsi": 33.2},
                "fibonacci_levels": [{"level": 1.618, "price": 112.0}],
            }
            if interval == "15m"
            else None
        ),
    )

    res = agentic_council.run_agentic_council("ASELS", interval="15m", use_llm=False)
    assert res["status"] == "ok"
    assert res["interval"] == "15m"
    agent3 = res["agents"][2]
    assert any("15dk (NU15/PU15) tek başına sinyal" in w for w in agent3["warnings"])
