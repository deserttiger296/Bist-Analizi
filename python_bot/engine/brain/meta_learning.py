# -*- coding: utf-8 -*-
"""
Adaptive Meta-Learning Engine (Local / Postgres-based)

Replaces the Firestore-dependent meta-learning module with a zero-cloud,
local-first implementation that:

1. Reads recent approved trade signals from predictions_log.csv
2. Evaluates actual price outcomes via yfinance (did the stock go UP?)
3. Computes per-engine accuracy (RF hit rate vs LSTM hit rate)
4. Outputs calibrated confidence thresholds saved to models/meta_weights.json

The Dynamic Regulation formula adjusts thresholds:
    New Threshold = Base Threshold × (1 + η × (0.5 - hit_rate))
    
If an engine has been accurate (hit_rate > 0.5), its threshold is lowered
(we trust it more). If inaccurate, threshold is raised (we trust it less).
"""

import csv
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
import yfinance as yf

logger = logging.getLogger("MetaLearning")

_PYTHON_BOT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_LOG = _PYTHON_BOT_ROOT / "predictions_log.csv"
META_WEIGHTS_PATH = _PYTHON_BOT_ROOT / "models" / "meta_weights.json"

# Default thresholds
DEFAULT_RF_THRESHOLD = 0.60
DEFAULT_LSTM_THRESHOLD = 0.60
DEFAULT_SENTIMENT_THRESHOLD = 0.0
BASE_ETA = 0.10  # Learning rate for threshold adjustment


class MetaLearningCalibrationEngine:
    def __init__(self, eta: float = BASE_ETA, lookback_days: int = 14):
        """
        Initialize the meta-learning calibration engine.

        :param eta: Learning rate for Dynamic Regulation formula
        :param lookback_days: How far back to look for signal evaluation
        """
        self.eta = eta
        self.lookback_days = lookback_days
        self.weights = self.load_current_weights()

    def load_current_weights(self) -> Dict[str, Any]:
        """Load calibrated weights from local JSON, or return defaults."""
        if META_WEIGHTS_PATH.exists():
            try:
                with open(META_WEIGHTS_PATH, "r") as f:
                    data = json.load(f)
                logger.info(f"Loaded meta weights from {META_WEIGHTS_PATH}")
                return data
            except Exception as e:
                logger.warning(f"Failed to load meta weights: {e}")

        return {
            "rf_threshold": DEFAULT_RF_THRESHOLD,
            "lstm_threshold": DEFAULT_LSTM_THRESHOLD,
            "sentiment_threshold": DEFAULT_SENTIMENT_THRESHOLD,
            "rf_hit_rate": 0.5,
            "lstm_hit_rate": 0.5,
            "last_calibrated": None,
            "total_signals_evaluated": 0,
        }

    def save_weights(self, weights: Dict[str, Any]) -> None:
        """Persist calibrated weights to local JSON."""
        META_WEIGHTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        weights["last_calibrated"] = datetime.now(timezone.utc).isoformat()
        with open(META_WEIGHTS_PATH, "w") as f:
            json.dump(weights, f, indent=2)
        logger.info(f"Saved calibrated meta weights to {META_WEIGHTS_PATH}")

    def fetch_recent_signals(self) -> List[Dict[str, str]]:
        """
        Read recent approved signals from predictions_log.csv.
        Format: Timestamp, Symbol, Entry_Price_TL, Target_Price_TL,
                Target_Price_USD, USD_Rate, Confidence, Sniper_Label, Status
        """
        if not PREDICTIONS_LOG.exists():
            logger.info("No predictions_log.csv found, no signals to evaluate.")
            return []

        cutoff = datetime.now(timezone.utc) - timedelta(days=self.lookback_days)
        signals = []

        try:
            with open(PREDICTIONS_LOG, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        ts = datetime.strptime(row["Timestamp"], "%Y-%m-%d %H:%M:%S")
                        ts = ts.replace(tzinfo=timezone.utc)
                        if ts >= cutoff:
                            signals.append(row)
                    except (ValueError, KeyError):
                        continue
        except Exception as e:
            logger.error(f"Error reading predictions log: {e}")

        logger.info(f"Found {len(signals)} signals within {self.lookback_days}-day lookback window.")
        return signals

    def evaluate_signal_outcome(self, signal: Dict[str, str], forward_days: int = 5) -> Optional[Dict[str, Any]]:
        """
        Evaluate whether a signal was correct by checking actual price movement.
        
        Returns dict with:
          - symbol, entry_price, actual_price, actual_return, was_correct
        """
        symbol = signal.get("Symbol", "")
        if not symbol:
            return None

        try:
            entry_price = float(signal["Entry_Price_TL"])
        except (ValueError, KeyError):
            return None

        ticker = f"{symbol}.IS" if not symbol.endswith(".IS") else symbol
        try:
            ts = datetime.strptime(signal["Timestamp"], "%Y-%m-%d %H:%M:%S")
            # Fetch prices from signal date forward
            start_date = ts.strftime("%Y-%m-%d")
            end_date = (ts + timedelta(days=forward_days + 5)).strftime("%Y-%m-%d")

            hist = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if hasattr(hist.columns, 'droplevel') and isinstance(hist.columns, type(hist.columns)):
                try:
                    hist.columns = hist.columns.droplevel(1)
                except (IndexError, ValueError):
                    pass

            if hist.empty or len(hist) < forward_days:
                return None

            # Get the close price N trading days after the signal
            actual_price = float(hist["Close"].iloc[min(forward_days, len(hist) - 1)])
            actual_return = (actual_price - entry_price) / entry_price

            return {
                "symbol": symbol,
                "entry_price": entry_price,
                "actual_price": actual_price,
                "actual_return": actual_return,
                "was_correct": actual_return > 0.02,  # UP threshold = +2%
            }
        except Exception as e:
            logger.warning(f"Failed to evaluate {symbol}: {e}")
            return None

    def run_calibration(self) -> Dict[str, Any]:
        """
        Main calibration cycle:
        1. Load recent signals from CSV
        2. Evaluate actual outcomes
        3. Compute per-engine hit rates
        4. Adjust thresholds using Dynamic Regulation
        5. Save calibrated weights
        """
        signals = self.fetch_recent_signals()
        if not signals:
            logger.info("No signals to calibrate on. Using current weights.")
            return self.weights

        # Evaluate outcomes
        outcomes = []
        for sig in signals:
            result = self.evaluate_signal_outcome(sig)
            if result:
                outcomes.append(result)

        if not outcomes:
            logger.info("No evaluable outcomes. Using current weights.")
            return self.weights

        # Parse Sniper_Label to separate RF and LSTM scores
        # Format: "RF:65|LSTM:72"
        rf_correct = 0
        rf_total = 0
        lstm_correct = 0
        lstm_total = 0

        for i, sig in enumerate(signals):
            if i >= len(outcomes):
                break
            outcome = outcomes[i] if i < len(outcomes) else None
            if outcome is None:
                continue

            label = sig.get("Sniper_Label", "")
            was_correct = outcome["was_correct"]

            # Count RF accuracy
            if "RF:" in label:
                rf_total += 1
                if was_correct:
                    rf_correct += 1

            # Count LSTM accuracy
            if "LSTM:" in label:
                lstm_total += 1
                if was_correct:
                    lstm_correct += 1

        # Compute hit rates
        rf_hit_rate = rf_correct / rf_total if rf_total > 0 else 0.5
        lstm_hit_rate = lstm_correct / lstm_total if lstm_total > 0 else 0.5
        overall_hit_rate = sum(1 for o in outcomes if o["was_correct"]) / len(outcomes)

        logger.info(f"Calibration Results: RF hit={rf_hit_rate:.2%} ({rf_correct}/{rf_total}), "
                    f"LSTM hit={lstm_hit_rate:.2%} ({lstm_correct}/{lstm_total}), "
                    f"Overall={overall_hit_rate:.2%}")

        # Dynamic Regulation: adjust thresholds
        # If hit_rate > 0.5, lower threshold (trust more); if < 0.5, raise threshold (trust less)
        rf_threshold = DEFAULT_RF_THRESHOLD * (1 + self.eta * (0.5 - rf_hit_rate))
        lstm_threshold = DEFAULT_LSTM_THRESHOLD * (1 + self.eta * (0.5 - lstm_hit_rate))

        # Clamp thresholds to reasonable range [0.45, 0.80]
        rf_threshold = max(0.45, min(0.80, rf_threshold))
        lstm_threshold = max(0.45, min(0.80, lstm_threshold))

        calibrated = {
            "rf_threshold": round(rf_threshold, 4),
            "lstm_threshold": round(lstm_threshold, 4),
            "sentiment_threshold": DEFAULT_SENTIMENT_THRESHOLD,
            "rf_hit_rate": round(rf_hit_rate, 4),
            "lstm_hit_rate": round(lstm_hit_rate, 4),
            "overall_hit_rate": round(overall_hit_rate, 4),
            "total_signals_evaluated": len(outcomes),
            "lookback_days": self.lookback_days,
        }

        self.save_weights(calibrated)
        self.weights = calibrated
        return calibrated


if __name__ == "__main__":
    engine = MetaLearningCalibrationEngine(lookback_days=14)
    print("Current weights:", json.dumps(engine.weights, indent=2))
    
    # Run calibration if we have signal history
    result = engine.run_calibration()
    print("\nCalibrated weights:", json.dumps(result, indent=2))
