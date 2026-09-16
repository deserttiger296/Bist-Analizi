"""
Order dispatcher for Osmanlı Menkul's algorithmic trading webhook.

Unlike AlgoLab (discontinued 2025-12-31), Osmanli's algo system is not a
REST/WebSocket trading API you call directly. It's a TradingView-alert-style
webhook: their platform (accessed via e-şube -> "Özel/Sentetik ve Algoritmik
İşlemler" contract -> Algo/İdeal Algo or TradingView integration) issues you
an account-specific webhook URL and a JSON payload template. Sending that
exact JSON to that URL triggers a real BIST order on your account.

The exact URL and JSON field names are account-specific and only visible
after the contract is approved in e-şube — they are NOT public/guessable.
This module is deliberately generic: it does not hardcode field names, it
fills in a user-supplied template. Until OSMANLI_WEBHOOK_URL and
OSMANLI_WEBHOOK_PAYLOAD_TEMPLATE are set, every call is a safe no-op dry run.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Literal

import requests

logger = logging.getLogger(__name__)

Direction = Literal["BUY", "SELL"]


@dataclass
class WebhookOrderResult:
    configured: bool
    dry_run: bool
    sent: bool
    payload: dict | None
    status_code: int | None = None
    response_text: str | None = None
    error: str | None = None


def _get_config() -> tuple[str | None, str | None]:
    url = os.environ.get("OSMANLI_WEBHOOK_URL")
    template = os.environ.get("OSMANLI_WEBHOOK_PAYLOAD_TEMPLATE")
    return url, template


def build_payload(template: str, symbol: str, direction: Direction, quantity: int) -> dict:
    """
    Fill in the user-supplied JSON template. The template is a JSON string
    containing the placeholders {symbol}, {direction}, {quantity} wherever
    Osmanlı's real field names expect them, e.g. once you have the real
    template from e-şube it might look like:
        '{"ticker": "{symbol}", "action": "{direction}", "contracts": {quantity}}'
    We do simple str.format substitution rather than guessing key names.
    """
    filled = template.format(symbol=symbol, direction=direction, quantity=quantity)
    return json.loads(filled)


def send_webhook_order(
    symbol: str,
    direction: Direction,
    quantity: int,
    dry_run: bool = True,
    timeout_seconds: float = 8.0,
) -> WebhookOrderResult:
    """
    Dispatch a BUY/SELL signal to Osmanlı's algo webhook.

    dry_run defaults to True on purpose: until the real webhook URL/template
    has been obtained from e-şube and verified, this must never fire a real
    order by accident. Callers that actually want to place a live order must
    explicitly pass dry_run=False.
    """
    url, template = _get_config()

    if not url or not template:
        logger.warning(
            "Osmanli webhook not configured (OSMANLI_WEBHOOK_URL / "
            "OSMANLI_WEBHOOK_PAYLOAD_TEMPLATE unset) - skipping order for "
            "%s %s x%d", symbol, direction, quantity,
        )
        return WebhookOrderResult(configured=False, dry_run=dry_run, sent=False, payload=None)

    try:
        payload = build_payload(template, symbol, direction, quantity)
    except Exception as exc:  # noqa: BLE001 - surface template errors clearly, don't crash caller
        logger.error("Failed to build Osmanli webhook payload from template: %s", exc)
        return WebhookOrderResult(
            configured=True, dry_run=dry_run, sent=False, payload=None, error=str(exc)
        )

    if dry_run:
        logger.info("[DRY RUN] Would POST to Osmanli webhook: %s", payload)
        return WebhookOrderResult(configured=True, dry_run=True, sent=False, payload=payload)

    try:
        resp = requests.post(url, json=payload, timeout=timeout_seconds)
        return WebhookOrderResult(
            configured=True,
            dry_run=False,
            sent=resp.ok,
            payload=payload,
            status_code=resp.status_code,
            response_text=resp.text[:500],
        )
    except requests.RequestException as exc:
        logger.error("Osmanli webhook request failed: %s", exc)
        return WebhookOrderResult(
            configured=True, dry_run=False, sent=False, payload=payload, error=str(exc)
        )
