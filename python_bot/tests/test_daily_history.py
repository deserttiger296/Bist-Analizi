# -*- coding: utf-8 -*-
"""
engine/journal/daily_history.py testleri.

Kapsam:
- log_daily_scan: aynı (tarih, sembol) karar satırını iki kez yazmaz.
- resolve_pending_outcomes: ufuk dolmadan sonuç üretmez; doldukça ayrı bir
  "outcome" olayı ekler, karar satırını asla geriye yazmaz.
- get_history: karar + sonuç olaylarını bellekte birleştirip doğru
  resolved/pending sayılarını ve doğruluk oranlarını hesaplar.

Ağdan bağımsızdır: _fetch_actual_price monkeypatch'lenir.
"""
import csv
from datetime import datetime, timedelta, timezone

import pytest

from python_bot.engine.journal import daily_history as dh


@pytest.fixture(autouse=True)
def _isolated_journal_files(tmp_path, monkeypatch):
    monkeypatch.setattr(dh, "DECISIONS_FILE", tmp_path / "daily_scan_log.csv")
    monkeypatch.setattr(dh, "OUTCOMES_FILE", tmp_path / "daily_scan_outcomes.csv")
    yield


def _write_decision_rows(rows):
    """Test kolaylığı: dh.log_daily_scan tarihi 'bugün' sabitlediği için,
    geçmiş bir tarihli karar satırı yazmak için CSV'yi doğrudan yazıyoruz."""
    dh.DECISIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(dh.DECISIONS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=dh.DECISION_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def test_log_daily_scan_does_not_duplicate_same_day_symbol():
    predictions = [
        {"symbol": "THYAO", "predicted_label": "UP", "probability": 0.7,
         "current_price": 100.0, "sniper_approved": True, "confluence_level": 2},
    ]
    written_first = dh.log_daily_scan(predictions)
    written_second = dh.log_daily_scan(predictions)  # aynı gün, aynı sembol -- tekrar yazılmamalı
    assert written_first == 1
    assert written_second == 0
    rows = dh._read_csv(dh.DECISIONS_FILE)
    assert len(rows) == 1


def test_resolve_pending_outcomes_skips_rows_before_horizon():
    today = datetime.now(timezone.utc).date()
    recent_date = (today - timedelta(days=1)).isoformat()  # resolve_after_days=5, henüz dolmadı
    _write_decision_rows([{
        "date": recent_date, "symbol": "THYAO", "predicted_label": "UP", "probability": "0.7",
        "current_price": "100.0", "sniper_approved": "True", "confluence_level": "2",
        "resolve_after_days": "5",
    }])
    resolved = dh.resolve_pending_outcomes()
    assert resolved == 0
    assert dh._read_csv(dh.OUTCOMES_FILE) == []


def test_resolve_pending_outcomes_appends_outcome_without_touching_decision(monkeypatch):
    today = datetime.now(timezone.utc).date()
    old_date = (today - timedelta(days=10)).isoformat()  # ufuk (5 gün) çok önce doldu
    decision_row = {
        "date": old_date, "symbol": "THYAO", "predicted_label": "UP", "probability": "0.7",
        "current_price": "100.0", "sniper_approved": "True", "confluence_level": "2",
        "resolve_after_days": "5",
    }
    _write_decision_rows([decision_row])
    monkeypatch.setattr(dh, "_fetch_actual_price", lambda symbol: 110.0)  # +%10 gerçekleşti

    resolved = dh.resolve_pending_outcomes()
    assert resolved == 1

    # Karar satırı AYNEN kalmalı (hiç dokunulmamış)
    decisions_after = dh._read_csv(dh.DECISIONS_FILE)
    assert len(decisions_after) == 1
    assert decisions_after[0] == decision_row

    outcomes = dh._read_csv(dh.OUTCOMES_FILE)
    assert len(outcomes) == 1
    assert outcomes[0]["date"] == old_date and outcomes[0]["symbol"] == "THYAO"
    assert float(outcomes[0]["actual_return_pct"]) == pytest.approx(10.0, rel=1e-6)
    assert outcomes[0]["was_correct"] == "True"  # UP tahmini, pozitif gerçekleşti -> doğru

    # Tekrar çağırmak aynı satırı ikinci kez eklememeli
    resolved_again = dh.resolve_pending_outcomes()
    assert resolved_again == 0
    assert len(dh._read_csv(dh.OUTCOMES_FILE)) == 1


def test_get_history_joins_decisions_and_outcomes_and_computes_accuracy(monkeypatch):
    today = datetime.now(timezone.utc).date()
    old_date = (today - timedelta(days=10)).isoformat()
    _write_decision_rows([
        {"date": old_date, "symbol": "THYAO", "predicted_label": "UP", "probability": "0.7",
         "current_price": "100.0", "sniper_approved": "True", "confluence_level": "2", "resolve_after_days": "5"},
        {"date": old_date, "symbol": "GARAN", "predicted_label": "DOWN", "probability": "0.6",
         "current_price": "50.0", "sniper_approved": "False", "confluence_level": "1", "resolve_after_days": "5"},
    ])

    def fake_price(symbol):
        return {"THYAO": 90.0, "GARAN": 60.0}[symbol]  # THYAO: UP tahmini ama düştü (yanlış); GARAN: DOWN ama yükseldi (yanlış)

    monkeypatch.setattr(dh, "_fetch_actual_price", fake_price)
    dh.resolve_pending_outcomes()

    history = dh.get_history()
    assert history["total_rows"] == 2
    assert history["resolved_rows"] == 2
    assert history["pending_rows"] == 0
    assert history["overall_accuracy_pct"] == pytest.approx(0.0)  # ikisi de yanlış çıktı
    # Yalnızca THYAO sniper_approved=True idi
    assert history["approved_only_count"] == 1
    assert history["approved_only_accuracy_pct"] == pytest.approx(0.0)
