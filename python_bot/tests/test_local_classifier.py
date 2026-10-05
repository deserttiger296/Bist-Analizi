# -*- coding: utf-8 -*-
"""
engine/brain/local_classifier.validate_artifact testleri.

Amaç: Uyumsuz/eksik bir model dosyası sessizce yanlış tahmin üretmemeli --
predict() şema/sürüm/etiket tanımı uyuşmazlığında MODEL_INCOMPATIBLE
ValueError fırlatmalı (section 5: "Uyumsuz modelle tahmin üretme").
Tamamen deterministik, ağ ve dosya sistemi gerektirmez.
"""
import pytest

from python_bot.engine.brain.local_classifier import (
    FEATURE_COLUMNS,
    FEATURE_SCHEMA_VERSION,
    FORWARD_HORIZON_DAYS,
    validate_artifact,
)

LABEL_DEFINITION = "UP/DOWN/FLAT: +/-0.5*ATR/close*sqrt(5), 5 trading bars"


def _valid_payload():
    return {
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_columns": FEATURE_COLUMNS,
        "training_start": "2020-01-01",
        "training_end": "2024-01-01",
        "selection_end": "2024-06-01",
        "label_definition": LABEL_DEFINITION,
        "forward_horizon_days": FORWARD_HORIZON_DAYS,
        "preprocessing_version": FEATURE_SCHEMA_VERSION,
        "validation_method": "shared-date-purged-holdout",
        "validation_results": {"selection_accuracy": 0.4},
        "model_version": "local_rf_v2",
    }


def test_valid_payload_passes():
    validate_artifact(_valid_payload())  # raise etmemeli


def test_rejects_feature_schema_version_mismatch():
    payload = _valid_payload()
    payload["feature_schema_version"] = "stale-v1"
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_feature_columns_mismatch():
    payload = _valid_payload()
    payload["feature_columns"] = FEATURE_COLUMNS[:-1]  # eksik bir özellik
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_feature_column_order_mismatch():
    payload = _valid_payload()
    payload["feature_columns"] = list(reversed(FEATURE_COLUMNS))
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


@pytest.mark.parametrize("missing_key", [
    "training_start", "training_end", "selection_end", "label_definition",
    "forward_horizon_days", "preprocessing_version", "validation_method",
    "validation_results", "model_version",
])
def test_rejects_missing_metadata_key(missing_key):
    payload = _valid_payload()
    del payload[missing_key]
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_forward_horizon_mismatch():
    payload = _valid_payload()
    payload["forward_horizon_days"] = FORWARD_HORIZON_DAYS + 1
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)


def test_rejects_label_definition_mismatch():
    payload = _valid_payload()
    payload["label_definition"] = "some other label definition"
    with pytest.raises(ValueError, match="MODEL_INCOMPATIBLE"):
        validate_artifact(payload)
