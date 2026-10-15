"""Offline regressions for shadow decisions, FX outages and sentiment fallback."""
import importlib
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
import pytest

from python_bot.engine.brain.finbert_sentiment import FinBertSentimentAnalyzer


@pytest.fixture(scope="module")
def api():
    # Import the real API without downloading/loading a HuggingFace model.
    with patch("python_bot.engine.brain.finbert_sentiment.FinBertSentimentAnalyzer",
               return_value=SimpleNamespace(model_loaded=False)):
        return importlib.import_module("python_bot.main_api")


@pytest.fixture
def prediction_api(api, monkeypatch):
    monkeypatch.setattr(api, "meta_engine", SimpleNamespace(weights={}))
    monkeypatch.setattr(api, "_compute_shap_explanation", lambda result: {})
    monkeypatch.setattr(api, "predict_lstm", lambda symbol: 0.9)
    monkeypatch.setattr(api, "_fetch_news_sentiment", lambda symbol: {
        "sentiment_score": 0.8, "sentiment_label": "POSITIVE"})
    monkeypatch.setattr(api, "get_usd_rate", lambda: None)
    monkeypatch.setattr(api, "log_prediction", Mock())
    monkeypatch.setattr(api, "predict_rf", lambda symbol: {
        "class_probabilities": {"UP": 0.9},
        "current_price": 100.0, "features": {"atr_14": 2.0}})
    return api


@pytest.mark.parametrize("mode", ["shadow", "decide", "invalid"])
def test_scan_keeps_candidates_but_only_decide_approves(prediction_api, monkeypatch, mode):
    api = prediction_api
    monkeypatch.setattr(api, "MODEL_DECISION_MODE", mode)
    monkeypatch.setattr(api, "BIST100_SYMBOLS", ["THYAO"])
    response = api.scan_all_symbols()
    assert response["scanned"] == 1 and response["count"] == 1
    result = response["data"][0]
    assert result["rf_threshold_passed"] is True
    for flag in ("sniper_approved", "quantum_approved", "sentiment_approved"):
        assert result[flag] is (mode == "decide")
    assert result["confluence_level"] == (3 if mode == "decide" else 0)
    assert result["lstm_probability"] == 0.9
    assert api.log_prediction.call_count == (1 if mode == "decide" else 0)


@pytest.mark.parametrize("rate", [None, 40.0])
def test_missing_fx_preserves_tl_target_without_inventing_usd(prediction_api, monkeypatch, rate):
    api = prediction_api
    monkeypatch.setattr(api, "MODEL_DECISION_MODE", "shadow")
    monkeypatch.setattr(api, "get_usd_rate", lambda: rate)
    result = api._process_prediction(api.predict_rf("THYAO"), "THYAO")
    assert result["target_price_tl"] == 105.0
    assert result["usd_rate"] == rate
    assert result["target_price_usd"] == (None if rate is None else 2.625)
    assert result["usd_rate_status"] == ("unavailable" if rate is None else "available")


@pytest.fixture
def fx_api(api, monkeypatch):
    monkeypatch.setattr(api, "_USD_RATE", None)
    monkeypatch.setattr(api, "_USD_LAST_FETCH", 0)
    monkeypatch.setattr(api, "_USD_LAST_ATTEMPT", None)
    monkeypatch.setattr(api.time, "time", lambda: 10000.0)
    return api


@pytest.mark.parametrize("value", [float("nan"), float("inf"), 0, -1])
def test_invalid_fx_is_unavailable(fx_api, monkeypatch, value):
    history = Mock(return_value=pd.DataFrame({"Close": [value]}))
    monkeypatch.setattr(fx_api.yf, "Ticker", lambda symbol: SimpleNamespace(history=history))
    assert fx_api.get_usd_rate() is None


def test_fx_outage_does_not_use_expired_cache_and_throttles_retry(fx_api, monkeypatch):
    monkeypatch.setattr(fx_api, "_USD_RATE", 34.0)
    monkeypatch.setattr(fx_api, "_USD_LAST_FETCH", 5000.0)
    history = Mock(side_effect=OSError("offline"))
    monkeypatch.setattr(fx_api.yf, "Ticker", lambda symbol: SimpleNamespace(history=history))
    assert fx_api.get_usd_rate() is None
    assert fx_api.get_usd_rate() is None
    assert history.call_count == 1
    monkeypatch.setattr(fx_api.time, "time", lambda: 10061.0)
    history.side_effect = None
    history.return_value = pd.DataFrame({"Close": [40.0]})
    assert fx_api.get_usd_rate() == 40.0
    assert fx_api.get_usd_rate() == 40.0
    assert history.call_count == 2


def test_empty_fx_data_is_unavailable(fx_api, monkeypatch):
    monkeypatch.setattr(fx_api.yf, "Ticker", lambda symbol: SimpleNamespace(
        history=lambda **kwargs: pd.DataFrame()))
    assert fx_api.get_usd_rate() is None


def test_loaded_finbert_falls_back_when_inference_fails(monkeypatch):
    pipeline = Mock(side_effect=RuntimeError("inference failed"))
    transformers = SimpleNamespace(
        AutoTokenizer=SimpleNamespace(from_pretrained=Mock()),
        AutoModelForSequenceClassification=SimpleNamespace(from_pretrained=Mock()),
        pipeline=Mock(return_value=pipeline))
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    analyzer = FinBertSentimentAnalyzer()
    assert analyzer.model_loaded is True
    result = analyzer.analyze_headline("profit growth")
    assert result["engine"] == "Financial_Lexicon"
    assert result["label"] == "POSITIVE" and result["net_score"] > 0
