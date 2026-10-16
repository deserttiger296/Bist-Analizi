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
    monkeypatch.setattr(dh, "SIGNAL_DECISIONS_FILE", tmp_path / "pu30_signal_log.csv")
    monkeypatch.setattr(dh, "SIGNAL_OUTCOMES_FILE", tmp_path / "pu30_signal_outcomes.csv")
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


def test_log_pu30_signals_and_resolve_outcomes_immutably(monkeypatch):
    sig_untriggered = {
        "symbol": "ASELS",
        "type": "PU30",
        "confirm_date": "2026-10-01 14:30",
        "knowable_at": "2026-10-01T18:10:00+03:00",
        "last_close": 80.0,
        "tetiklendi": False,
        "saatlik_seviye": {"price": 82.5, "durum": "bekleniyor_kirilim", "kirildi": False},
        "confirmed_timeframes": ["4h"],
    }
    assert dh.log_pu30_signals([sig_untriggered], interval="4h") == 1
    assert dh.log_pu30_signals([sig_untriggered], interval="4h") == 0  # duplicate skipped

    # Later the hourly trust level breaks -> logged as a separate immutable event
    sig_triggered = {
        **sig_untriggered,
        "last_close": 83.0,
        "tetiklendi": True,
        "saatlik_seviye": {"price": 82.5, "durum": "kirildi", "kirildi": True},
    }
    assert dh.log_pu30_signals([sig_triggered], interval="4h") == 1

    rows = dh._read_csv(dh.SIGNAL_DECISIONS_FILE)
    assert len(rows) == 2
    assert rows[0]["tetiklendi"] == "False" and rows[1]["tetiklendi"] == "True"

    # Backdate both rows so they are past the 5-day horizon
    old_date = (datetime.now(timezone.utc).date() - timedelta(days=10)).isoformat()
    for r in rows:
        r["date"] = old_date
    with open(dh.SIGNAL_DECISIONS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=dh.SIGNAL_DECISION_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    monkeypatch.setattr(dh, "_fetch_actual_price", lambda sym: 90.0)
    resolved = dh.resolve_pending_signal_outcomes()
    assert resolved == 2

    hist = dh.get_history()
    assert hist["pu30_total_rows"] == 2
    assert hist["pu30_resolved_rows"] == 2
    assert hist["pu30_triggered_count"] == 1
    assert hist["pu30_overall_accuracy_pct"] == pytest.approx(100.0)
    assert hist["pu30_triggered_accuracy_pct"] == pytest.approx(100.0)

