# -*- coding: utf-8 -*-
"""
Tamper-Evident Hash-Chain Audit Log

Ported from src/core/backtest.py's WalkForwardBacktester -- only the SHA-256
hash-chain logging mechanism is kept (previous_hash/hash linking each JSONL
record to the one before it, so any retroactive edit breaks the chain). The
fake hardcoded-price backtest loop from the original file is NOT ported;
here the mechanism is wrapped around python_bot's real vectorbt backtest
(see main.py's /api/backtest endpoint) instead.
"""
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict

DEFAULT_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "journal", "backtests")


class HashChainAuditLog:
    """
    Appends tamper-evident JSONL records to a per-run log file. Each record
    embeds the SHA-256 hash of the previous record ("previous_hash") and its
    own hash ("hash"), so verify_chain() can detect any record that was
    edited or removed after the fact.
    """

    GENESIS_HASH = "GENESIS_BLOCK_000000000000"

    def __init__(self, log_dir: str = DEFAULT_LOG_DIR):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        self.last_hash = self.GENESIS_HASH
        self.log_file = os.path.join(
            self.log_dir, f"backtest_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')}.jsonl"
        )

    def _calculate_hash(self, data: Dict[str, Any]) -> str:
        data_string = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(data_string.encode("utf-8")).hexdigest()

    def record(self, event: Dict[str, Any]) -> str:
        """Seals `event` into the chain and appends it to the JSONL log file."""
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "previous_hash": self.last_hash,
        }
        current_hash = self._calculate_hash(payload)
        payload["hash"] = current_hash
        self.last_hash = current_hash

        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, default=str) + "\n")

        return current_hash

    @staticmethod
    def verify_chain(log_file: str) -> Dict[str, Any]:
        """Replays a JSONL audit log and confirms every hash link is intact."""
        prev_hash = HashChainAuditLog.GENESIS_HASH
        record_count = 0
        with open(log_file, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                claimed_hash = payload.pop("hash")
                if payload.get("previous_hash") != prev_hash:
                    return {"valid": False, "broken_at_line": line_no, "reason": "previous_hash mismatch"}
                recalculated = hashlib.sha256(
                    json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
                ).hexdigest()
                if recalculated != claimed_hash:
                    return {"valid": False, "broken_at_line": line_no, "reason": "hash mismatch (tampered)"}
                prev_hash = claimed_hash
                record_count += 1
        return {"valid": True, "records_verified": record_count}


def record_backtest_run(symbol: str, params: Dict[str, Any], result_metrics: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience helper for FastAPI endpoints: seals one real backtest run
    (inputs + resulting metrics) into a fresh hash-chained JSONL file and
    returns the audit metadata to attach to the API response.
    """
    audit = HashChainAuditLog()
    record_hash = audit.record({
        "type": "vectorbt_backtest",
        "symbol": symbol,
        "params": params,
        "metrics": result_metrics,
    })
    return {
        "audit_log_file": os.path.basename(audit.log_file),
        "record_hash": record_hash,
    }
