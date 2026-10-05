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


def test_invalid_interval_rejected_before_any_fetch():
    assert client.get("/api/py/api/scan/rsi-pu30", params={"interval": "15m"}).status_code == 400
    assert client.get("/api/py/api/scan/most-rsi", params={"interval": "4h"}).status_code == 400
